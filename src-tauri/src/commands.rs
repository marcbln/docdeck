//! Tauri command surface: disk reads, config loading, watch registration.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::{open_path, open_url};

use crate::config::{self, Limits, MAX_FILES};
use crate::folder::{self, MAX_SCAN_ENTRIES};
use crate::paths::modified_millis;
use crate::watcher::WatcherState;

/// Throttle for `scan-progress`: fast enough to feel live, slow enough that a
/// huge walk cannot flood the webview with events.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Live scan state forwarded to the inbox while a walk is running.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub path: String,
    pub directories: u64,
    pub files: usize,
}

/// Accumulates walk counters and emits them at most once per throttle window.
struct ScanReporter {
    app: AppHandle,
    last_emit: Option<Instant>,
    directories: u64,
    files: usize,
}

impl ScanReporter {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_emit: None,
            directories: 0,
            files: 0,
        }
    }

    /// Records one visited entry; emits when the throttle window has elapsed.
    fn sample(&mut self, path: &Path, is_dir: bool, files: usize) {
        if is_dir {
            self.directories += 1;
        }
        self.files = files;

        let due = self
            .last_emit
            .is_none_or(|last| last.elapsed() >= PROGRESS_INTERVAL);
        if due {
            self.emit(path);
        }
    }

    fn emit(&mut self, path: &Path) {
        self.last_emit = Some(Instant::now());
        let _ = self.app.emit(
            "scan-progress",
            ScanProgress {
                path: path.to_string_lossy().into_owned(),
                directories: self.directories,
                files: self.files,
            },
        );
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FilePayload {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub modified_time: u64,
}

/// Which source owns an inventory row. Reload reconciliation replaces `config`
/// rows, rescans `session` rows, and never removes `manual` ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Config,
    Session,
}

/// One inbox row: a watched file and its last modification time.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEntry {
    pub path: String,
    pub filename: String,
    pub modified_time: u64,
    pub origin: Origin,
}

/// The result of loading or reloading the global config.
///
/// `error` is set for an unreadable or malformed file, in which case no
/// watches are registered. Warnings never abort the remaining selectors.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLoad {
    pub config_path: String,
    pub config_found: bool,
    pub roots: Vec<String>,
    pub entries: Vec<InboxEntry>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub truncated: bool,
    /// Revision of the bytes that produced this plan.
    pub revision: String,
    /// Monotonic reload generation; older results are discarded by the webview.
    pub generation: u64,
    /// Unix epoch milliseconds when the plan was produced.
    pub at: u64,
}

/// A read-only snapshot of the watch configuration file for the editor surface.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WatchConfigView {
    pub path: String,
    pub found: bool,
    pub revision: String,
    pub watch: Vec<String>,
    pub exclude: Vec<String>,
    pub error: Option<String>,
}

/// One applied configuration plan, emitted as `config-reloaded`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadResult {
    pub generation: u64,
    pub at: u64,
    pub path: String,
    pub found: bool,
    pub revision: String,
    pub watch: Vec<String>,
    pub exclude: Vec<String>,
    pub roots: Vec<String>,
    pub entries: Vec<InboxEntry>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub truncated: bool,
}

/// One precise validation message for the configuration surface.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

/// The outcome of an in-app configuration save.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
#[allow(dead_code)]
pub enum SaveOutcome {
    Applied { reload: ReloadResult },
    Conflict { current: WatchConfigView },
    Invalid {
        errors: Vec<FieldError>,
        warnings: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    IoError {
        message: String,
        not_writable: bool,
    },
}

/// Error codes the webview branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum CommandErrorCode {
    Invalid,
    Conflict,
    Io,
    NotWritable,
    Internal,
}

/// Typed command failure: never a bare string.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl CommandError {
    #[allow(dead_code)]
    pub fn new(code: CommandErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }
}

/// The result of adding a session watch from the CLI.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchAdded {
    pub roots: Vec<String>,
    pub entries: Vec<InboxEntry>,
    pub warnings: Vec<String>,
}

/// Builds an inbox row, or `None` when the path vanished before the stat.
pub(crate) fn entry_for(path: &Path, origin: Origin) -> Option<InboxEntry> {
    Some(InboxEntry {
        path: path.to_string_lossy().into_owned(),
        filename: path.file_name()?.to_string_lossy().into_owned(),
        modified_time: modified_millis(path)?,
        origin,
    })
}

/// Reads a document from disk and registers it with the file watcher.
///
/// Returns the absolute (canonicalized) path so the frontend can key its tab
/// state by a stable identifier regardless of how the file was opened.
#[tauri::command]
pub fn load_file(path_str: String, watcher: State<WatcherState>) -> Result<FilePayload, String> {
    let path = PathBuf::from(&path_str);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;

    let content = fs::read_to_string(&canonical).map_err(|e| format!("cannot read file: {e}"))?;
    let metadata = fs::metadata(&canonical).map_err(|e| format!("cannot stat file: {e}"))?;
    let modified_time = metadata
        .modified()
        .map_err(|e| format!("cannot read modification time: {e}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("invalid modification time: {e}"))?
        .as_millis() as u64;

    let filename = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    // Register with the debounced watcher so external writes are picked up.
    watcher
        .watch_file(&canonical)
        .map_err(|e| format!("cannot watch file: {e}"))?;

    Ok(FilePayload {
        path: canonical.to_string_lossy().to_string(),
        filename,
        content,
        modified_time,
    })
}

/// Result of resolving a relative link against the active document.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLink {
    pub path: String,
    pub is_dir: bool,
}

/// Opens an external URL with the OS default handler.
///
/// The frontend has already classified the link; re-checking the scheme here
/// keeps this command from becoming a general-purpose opener if the webview is
/// ever compromised.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|error| format!("invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => {}
        scheme => return Err(format!("blocked URL scheme: {scheme}")),
    }

    open_url(url, None::<&str>).map_err(|error| format!("cannot open URL: {error}"))
}

/// Opens an existing local file or directory with its default application.
#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("cannot resolve path: {error}"))?;

    open_path(canonical, None::<&str>).map_err(|error| format!("cannot open path: {error}"))
}

/// Resolves a document-relative link to a canonical absolute path.
#[tauri::command]
pub fn resolve_document_link(base_file: String, href: String) -> Result<ResolvedLink, String> {
    let resolved = crate::paths::resolve_link(Path::new(&base_file), &href)?;

    Ok(ResolvedLink {
        is_dir: resolved.is_dir(),
        path: resolved.to_string_lossy().into_owned(),
    })
}

/// Releases the `inotify` watch for a document once its tab is closed.
///
/// Config-pinned files keep their watch; `WatcherState::unwatch_file` owns
/// that rule.
#[tauri::command]
pub fn close_file(path_str: String, watcher: State<WatcherState>) -> Result<(), String> {
    let path = PathBuf::from(&path_str);
    let canonical = path.canonicalize().unwrap_or(path);
    watcher.unwatch_file(&canonical)
}

/// Loads the global config, scans its selectors and registers the watches.
///
/// The inventory is metadata-only: every matched document's mtime is read, but
/// no document content. Content is loaded lazily when a row is clicked.
///
/// The walk runs on a blocking worker: a deep selector over a large tree can
/// take minutes, and doing that on the main thread freezes the window (close
/// button included). Progress is streamed as `scan-progress` events.
#[tauri::command]
pub async fn load_watches(app: AppHandle) -> WatchLoad {
    let fallback_path = config::config_path().to_string_lossy().into_owned();
    match tauri::async_runtime::spawn_blocking(move || load_watches_blocking(&app)).await {
        Ok(result) => result,
        Err(error) => WatchLoad {
            config_path: fallback_path,
            config_found: true,
            roots: Vec::new(),
            entries: Vec::new(),
            warnings: Vec::new(),
            error: Some(format!("watch scan failed: {error}")),
            truncated: false,
            revision: String::new(),
            generation: config::next_generation(),
            at: config::now_millis(),
        },
    }
}

fn load_watches_blocking(app: &AppHandle) -> WatchLoad {
    let watcher = app.state::<WatcherState>();
    let path = config::config_path();
    let home = config::home_dir();
    let mut reporter = ScanReporter::new(app.clone());
    reporter.emit(&home);

    let generation = config::next_generation();
    let result = crate::config_watch::reconcile_config(
        &watcher,
        &path,
        &home,
        crate::config::Platform::current(),
        Limits::default(),
        generation,
        String::new(),
        &mut |p, is_dir, files| reporter.sample(p, is_dir, files),
    );

    WatchLoad {
        config_path: result.path,
        config_found: result.found,
        roots: result.roots,
        entries: result.entries,
        warnings: result.warnings,
        error: result.error,
        truncated: result.truncated,
        revision: result.revision,
        generation: result.generation,
        at: result.at,
    }
}

/// Reads the watch configuration for the in-app surface.
///
/// Read-only: it never creates or modifies the file.
#[tauri::command]
pub fn read_watch_config() -> WatchConfigView {
    crate::config_edit::read_view(&config::config_path())
}

/// Validates and saves an edited configuration, then applies it.
///
/// Nothing is written unless the draft is valid and the expected revision still
/// matches the file. A successful save runs the shared reconciliation and keeps
/// the reload generation monotonic.
#[tauri::command]
pub async fn save_watch_config(
    app: AppHandle,
    watch: Vec<String>,
    exclude: Vec<String>,
    expected_revision: String,
    create_from_example: Option<bool>,
) -> SaveOutcome {
    let worker_app = app.clone();
    let create_from_example = create_from_example.unwrap_or(false);
    match tauri::async_runtime::spawn_blocking(move || {
        save_watch_config_blocking(
            &worker_app,
            watch,
            exclude,
            expected_revision,
            create_from_example,
        )
    })
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => SaveOutcome::IoError {
            message: format!("config save failed: {error}"),
            not_writable: false,
        },
    }
}

fn save_watch_config_blocking(
    app: &AppHandle,
    watch: Vec<String>,
    exclude: Vec<String>,
    expected_revision: String,
    create_from_example: bool,
) -> SaveOutcome {
    let path = config::config_path();
    let request = crate::config_edit::SaveRequest {
        watch,
        exclude,
        expected_revision,
        create_from_example,
    };

    match crate::config_edit::save(&path, &request) {
        Ok(success) => {
            let watcher = app.state::<WatcherState>();
            let config_state = app.state::<crate::config_watch::ConfigWatchState>();
            let generation = config::next_generation();
            let reload = crate::config_watch::reconcile_config(
                &watcher,
                &path,
                &config::home_dir(),
                config::Platform::current(),
                Limits::default(),
                generation,
                success.revision.clone(),
                &mut |_, _, _| {},
            );
            let mut reload = reload;
            reload.warnings.extend(success.warnings);
            if reload.error.is_none() {
                config_state.record_applied(&reload.revision);
                config_state.remember_result(&reload);
            }
            SaveOutcome::Applied { reload }
        }
        Err(crate::config_edit::SaveFailure::Conflict(current)) => {
            SaveOutcome::Conflict { current }
        }
        Err(crate::config_edit::SaveFailure::Invalid { errors, warnings }) => {
            SaveOutcome::Invalid { errors, warnings }
        }
        Err(crate::config_edit::SaveFailure::Io {
            message,
            not_writable,
        }) => SaveOutcome::IoError {
            message,
            not_writable,
        },
    }
}

/// Forces one read/expand/reconcile pass.
///
/// When the bytes are unchanged since the last applied plan, the cached plan is
/// returned with a fresh generation instead of rescanning every selector.
#[tauri::command]
pub async fn reload_watch_config(app: AppHandle) -> ReloadResult {
    match tauri::async_runtime::spawn_blocking(move || reload_watch_config_blocking(&app)).await {
        Ok(result) => result,
        Err(error) => ReloadResult {
            generation: config::next_generation(),
            at: config::now_millis(),
            path: config::config_path().to_string_lossy().into_owned(),
            found: true,
            revision: String::new(),
            watch: Vec::new(),
            exclude: Vec::new(),
            roots: Vec::new(),
            entries: Vec::new(),
            warnings: Vec::new(),
            error: Some(format!("config reload failed: {error}")),
            truncated: false,
        },
    }
}

fn reload_watch_config_blocking(app: &AppHandle) -> ReloadResult {
    let path = config::config_path();
    let config_state = app.state::<crate::config_watch::ConfigWatchState>();
    let revision = config::revision_of_path(&path).unwrap_or_default();
    let generation = config::next_generation();

    if !config_state.revision_changed(&revision) {
        if let Some(mut cached) = config_state.cached_result() {
            cached.generation = generation;
            cached.at = config::now_millis();
            return cached;
        }
    }

    let watcher = app.state::<WatcherState>();
    let reload = crate::config_watch::reconcile_config(
        &watcher,
        &path,
        &config::home_dir(),
        config::Platform::current(),
        Limits::default(),
        generation,
        revision,
        &mut |_, _, _| {},
    );

    if reload.error.is_none() && reload.found {
        config_state.record_applied(&reload.revision);
        config_state.remember_result(&reload);
    }

    reload
}

/// Adds session watches for CLI folders and returns the documents they hold.
///
/// Uses the excludes already installed by `load_watches`, so a session folder
/// observes the same filter as the config. CLI file arguments do not come
/// through here: they open a tab directly and are not part of the registry.
/// Like `load_watches`, the walk runs off the main thread and streams progress.
#[tauri::command]
pub async fn add_watch(app: AppHandle, paths: Vec<String>) -> WatchAdded {
    match tauri::async_runtime::spawn_blocking(move || add_watch_blocking(&app, paths)).await {
        Ok(result) => result,
        Err(error) => WatchAdded {
            roots: Vec::new(),
            entries: Vec::new(),
            warnings: vec![format!("folder scan failed: {error}")],
        },
    }
}

fn add_watch_blocking(app: &AppHandle, paths: Vec<String>) -> WatchAdded {
    let watcher = app.state::<WatcherState>();
    let mut reporter = ScanReporter::new(app.clone());
    let excludes = watcher.excludes();
    let mut roots: Vec<String> = Vec::new();
    let mut entries: Vec<InboxEntry> = Vec::new();
    let mut warnings = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for raw in paths {
        let path = match PathBuf::from(&raw).canonicalize() {
            Ok(path) => path,
            Err(error) => {
                warnings.push(format!("{raw}: {error}"));
                continue;
            }
        };
        if !path.is_dir() {
            warnings.push(format!("{} is not a directory; ignored", path.display()));
            continue;
        }

        let remaining = MAX_FILES.saturating_sub(entries.len());
        reporter.emit(&path);
        match folder::scan_markdown_with_progress(
            &path,
            &excludes,
            remaining,
            MAX_SCAN_ENTRIES,
            &mut |p, is_dir, files| reporter.sample(p, is_dir, files),
        ) {
            Ok(outcome) => {
                if outcome.truncated {
                    warnings.push(format!(
                        "scan of {} truncated at the {MAX_FILES} file limit",
                        path.display()
                    ));
                }
                if outcome.entries_truncated {
                    warnings.push(format!(
                        "scan of {} stopped at the {MAX_SCAN_ENTRIES} entry limit; some documents may be missing (narrow the selector or add an exclude pattern)",
                        path.display()
                    ));
                }
                warnings.extend(outcome.warnings);
                roots.push(path.to_string_lossy().into_owned());
                if let Err(error) = watcher.watch_roots(std::slice::from_ref(&path)) {
                    warnings.push(format!("could not watch {}: {error}", path.display()));
                }
                watcher.remember_paths(&outcome.files);
                for file in outcome.files {
                    if seen.insert(file.clone()) {
                        if let Some(entry) = entry_for(&file, Origin::Session) {
                            entries.push(entry);
                        }
                    }
                }
            }
            Err(error) => warnings.push(error),
        }
    }

    WatchAdded {
        roots,
        entries,
        warnings,
    }
}
