//! Live watch-configuration reload.
//!
//! The config file's *parent directory* is watched (editors save atomically by
//! renaming a temp file over the target, which invalidates a file-level watch).
//! A settled event re-reads and reconciles the config, unless the bytes are
//! unchanged since the last applied revision.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_full::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{entry_for, InboxEntry, Origin, ReloadResult};
use crate::config::{self, Limits, Platform, MAX_FILES};
use crate::folder::{self, ProgressSink, MAX_SCAN_ENTRIES};
use crate::watcher::WatcherState;

/// Debounce window for config-file events; matches the document debounce so a
/// save burst settles on the last bytes.
pub const CONFIG_DEBOUNCE_MS: u64 = 300;

/// The directory that must be watched for a config file.
pub fn config_watch_target(config_path: &Path) -> PathBuf {
    match config_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

/// Whether a reload should expand the config.
///
/// The same revision that is already applied means the file watcher fired for
/// the in-app save that produced it; expanding again would duplicate the scan
/// and flicker the list.
pub fn should_expand(last_applied: Option<&str>, revision: &str) -> bool {
    last_applied != Some(revision)
}

/// Owns the config-file watcher and the last revision it successfully applied.
#[derive(Clone)]
pub struct ConfigWatchState {
    last_applied: Arc<Mutex<Option<String>>>,
    last_result: Arc<Mutex<Option<ReloadResult>>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>>,
}

impl ConfigWatchState {
    pub fn new() -> Self {
        Self {
            last_applied: Arc::new(Mutex::new(None)),
            last_result: Arc::new(Mutex::new(None)),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    pub fn last_applied_revision(&self) -> Option<String> {
        self.last_applied.lock().ok().and_then(|guard| guard.clone())
    }

    /// Records a successfully applied revision.
    pub fn record_applied(&self, revision: &str) {
        if let Ok(mut guard) = self.last_applied.lock() {
            *guard = Some(revision.to_string());
        }
    }

    /// Whether `revision` differs from the last one this process applied.
    pub fn revision_changed(&self, revision: &str) -> bool {
        should_expand(self.last_applied_revision().as_deref(), revision)
    }

    /// The most recent applied plan, for a no-op reload.
    pub fn cached_result(&self) -> Option<ReloadResult> {
        self.last_result.lock().ok().and_then(|guard| guard.clone())
    }

    /// Caches an applied plan so an unchanged reload can skip expansion.
    pub fn remember_result(&self, result: &ReloadResult) {
        if let Ok(mut guard) = self.last_result.lock() {
            *guard = Some(result.clone());
        }
    }

    /// Starts watching the config file's parent directory.
    pub fn start(&self, app: AppHandle, config_path: PathBuf) -> Result<(), String> {
        let target = config_watch_target(&config_path);
        let watched_name = config_path.file_name().map(|name| name.to_owned());
        let event_app = app.clone();
        let callback_state = self.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(CONFIG_DEBOUNCE_MS),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else {
                    return;
                };
                let touches_config = events.iter().any(|event| {
                    event.event.paths.iter().any(|path| {
                        path == &config_path
                            || path.file_name().map(|name| name.to_owned()) == watched_name
                    })
                });
                if !touches_config {
                    return;
                }

                let Some(revision) = config::revision_of_path(&config_path) else {
                    // Deleted/unreadable: report without replacing watches.
                    emit_reload(&event_app, &config_path, None, &callback_state);
                    return;
                };
                if !callback_state.revision_changed(&revision) {
                    return;
                }

                let thread_app = event_app.clone();
                let thread_state = callback_state.clone();
                let thread_path = config_path.clone();
                std::thread::spawn(move || {
                    emit_reload(&thread_app, &thread_path, Some(revision), &thread_state);
                });
            },
        )
        .map_err(|error| error.to_string())?;

        // If the parent directory does not exist yet, the watcher cannot be
        // registered; the next successful save creates it and a later start
        // (or the in-app surface) picks it up.
        let _ = debouncer.watch(&target, RecursiveMode::NonRecursive);

        *self.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
        Ok(())
    }
}

impl Default for ConfigWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Reads, expands and reconciles the config on a background worker, then emits
/// `config-reloaded` with the result.
fn emit_reload(
    app: &AppHandle,
    config_path: &Path,
    revision: Option<String>,
    state: &ConfigWatchState,
) {
    let watcher = app.state::<WatcherState>();
    let generation = config::next_generation();
    let result = reconcile_config(
        &watcher,
        config_path,
        &config::home_dir(),
        Platform::current(),
        Limits::default(),
        generation,
        revision.unwrap_or_default(),
        &mut |_, _, _| {},
    );

    if result.error.is_none() && result.found {
        state.record_applied(&result.revision);
        state.remember_result(&result);
    }

    let _ = app.emit("config-reloaded", result);
}

/// The shared reload path used by startup, saves and external edits.
///
/// A successful result re-applies the excludes, replaces the config-owned
/// watches, rescans session roots under the new excludes, and returns config
/// and session entries together. A rejected result changes nothing.
#[allow(clippy::too_many_arguments)]
pub fn reconcile_config(
    watcher: &WatcherState,
    config_path: &Path,
    home: &Path,
    platform: Platform,
    limits: Limits,
    generation: u64,
    revision: String,
    progress: ProgressSink<'_>,
) -> ReloadResult {
    let at = config::now_millis();
    let path = config_path.to_string_lossy().into_owned();
    let session_roots = watcher.session_roots();

    let loaded = match config::load_with_platform(config_path, platform) {
        Ok(loaded) => loaded,
        Err(error) => {
            return ReloadResult {
                generation,
                at,
                path,
                found: true,
                revision,
                watch: Vec::new(),
                exclude: Vec::new(),
                roots: roots_as_strings(&watcher.all_roots()),
                entries: Vec::new(),
                warnings: Vec::new(),
                error: Some(error),
                truncated: false,
            };
        }
    };

    if !loaded.found {
        return ReloadResult {
            generation,
            at,
            path,
            found: false,
            revision,
            watch: Vec::new(),
            exclude: Vec::new(),
            roots: roots_as_strings(&watcher.all_roots()),
            entries: Vec::new(),
            warnings: Vec::new(),
            error: None,
            truncated: false,
        };
    }

    let plan = config::expand_with_platform(
        &loaded.config,
        home,
        limits,
        platform,
        &mut *progress,
    );

    let mut warnings = plan.warnings;
    let mut truncated = plan.truncated;
    let mut entries: Vec<InboxEntry> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for file in &plan.files {
        if entries.len() >= MAX_FILES {
            truncated = true;
            warnings.push(format!(
                "file limit ({MAX_FILES}) reached; remaining file selectors skipped"
            ));
            break;
        }
        if seen.insert(file.clone()) {
            match entry_for(file, Origin::Config) {
                Some(entry) => entries.push(entry),
                None => warnings.push(format!(
                    "{} vanished before it could be listed",
                    file.display()
                )),
            }
        }
    }

    for root in &plan.roots {
        let remaining = MAX_FILES.saturating_sub(entries.len());
        match folder::scan_markdown_with_progress(
            root,
            &plan.excludes,
            remaining,
            MAX_SCAN_ENTRIES,
            &mut *progress,
        ) {
            Ok(outcome) => {
                truncated |= absorb_scan(outcome, root, Origin::Config, &mut warnings, &mut entries, &mut seen);
            }
            Err(error) => warnings.push(error),
        }
    }

    // Session roots are rescanned so excludes changed by the config apply to
    // them too; they are never removed by a reload.
    for root in &session_roots {
        let remaining = MAX_FILES.saturating_sub(entries.len());
        if remaining == 0 {
            truncated = true;
            warnings.push(format!(
                "file limit ({MAX_FILES}) reached; remaining session folders skipped"
            ));
            break;
        }
        match folder::scan_markdown_with_progress(
            root,
            &plan.excludes,
            remaining,
            MAX_SCAN_ENTRIES,
            &mut *progress,
        ) {
            Ok(outcome) => {
                truncated |= absorb_scan(outcome, root, Origin::Session, &mut warnings, &mut entries, &mut seen);
            }
            Err(error) => warnings.push(error),
        }
    }

    if let Err(error) = watcher.set_excludes(plan.excludes.clone()) {
        warnings.push(format!("could not apply exclude patterns: {error}"));
    }
    if let Err(error) = watcher.replace_config_watches(&plan.roots, &plan.files) {
        warnings.push(format!("could not update watches: {error}"));
    }
    let scanned: Vec<PathBuf> = entries.iter().map(|entry| PathBuf::from(&entry.path)).collect();
    watcher.remember_paths(&scanned);

    let mut roots = roots_as_strings(&plan.roots);
    roots.extend(roots_as_strings(&session_roots));

    let revision = if revision.is_empty() {
        config::revision_of_path(config_path).unwrap_or_default()
    } else {
        revision
    };

    ReloadResult {
        generation,
        at,
        path: loaded.path.to_string_lossy().into_owned(),
        found: loaded.found,
        revision,
        watch: loaded.config.watch.clone(),
        exclude: loaded.config.exclude.clone(),
        roots,
        entries,
        warnings,
        error: None,
        truncated,
    }
}

/// Folds one root scan into the shared inventory. Returns whether it truncated.
fn absorb_scan(
    outcome: folder::ScanOutcome,
    root: &Path,
    origin: Origin,
    warnings: &mut Vec<String>,
    entries: &mut Vec<InboxEntry>,
    seen: &mut HashSet<PathBuf>,
) -> bool {
    if outcome.truncated {
        warnings.push(format!(
            "scan of {} truncated at the {MAX_FILES} file limit",
            root.display()
        ));
    }
    if outcome.entries_truncated {
        warnings.push(format!(
            "scan of {} stopped at the {MAX_SCAN_ENTRIES} entry limit; some documents may be missing (narrow the selector or add an exclude pattern)",
            root.display()
        ));
    }
    warnings.extend(outcome.warnings);
    for file in outcome.files {
        if seen.insert(file.clone()) {
            if let Some(entry) = entry_for(&file, origin) {
                entries.push(entry);
            }
        }
    }
    outcome.truncated || outcome.entries_truncated
}

fn roots_as_strings(roots: &[PathBuf]) -> Vec<String> {
    roots
        .iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect()
}
