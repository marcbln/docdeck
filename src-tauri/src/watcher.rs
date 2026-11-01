//! Debounced filesystem watching with event kinds and rename pairing.
//!
//! The debouncer preserves `notify::EventKind`, so a rename is emitted as one
//! transition instead of a delete plus a create. A small identity cache lets a
//! `From` without a matching `To` settle as `movedOut` rather than `deleted`.

use notify_debouncer_full::{
    new_debouncer,
    notify::{
        event::{ModifyKind, RenameMode},
        EventKind, RecommendedWatcher, RecursiveMode,
    },
    DebounceEventResult, Debouncer, RecommendedCache,
};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

use crate::paths::{file_identity, is_relevant, modified_millis, ExcludeSet, FileIdentity};
use crate::rename::{RenameOutcome, RenamePairer};

/// Debounce window for filesystem events.
///
/// AI agents frequently write documents in rapid, chunked bursts. Without a
/// debounce window every `write()` would trigger a full document re-read and
/// re-render in the webview.
pub const DEBOUNCE_MS: u64 = 300;

/// How often the flusher looks for `From` events that never got a `To`.
const RENAME_FLUSH_INTERVAL: Duration = Duration::from_millis(200);

/// How a settled change should be interpreted by the webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathChangeKind {
    Created,
    Modified,
    Deleted,
    Renamed,
    MovedOut,
}

/// A settled filesystem change forwarded to the webview.
///
/// `renamed` carries the new path in `path` and the old path in `fromPath`.
/// `movedOut` and `deleted` carry the path that disappeared.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathChange {
    pub kind: PathChangeKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_path: Option<String>,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_time: Option<u64>,
}

impl PathChange {
    fn new(kind: PathChangeKind, path: &Path) -> Self {
        let exists = path.exists();
        Self {
            kind,
            path: path.to_string_lossy().into_owned(),
            from_path: None,
            exists,
            modified_time: if exists {
                modified_millis(path)
            } else {
                None
            },
        }
    }
}

/// Owns the registry of open documents, config- and session-owned watches, the
/// excluded patterns, the rename identity cache and one debounced watcher.
pub struct WatcherState {
    /// Every watched file (open tabs plus config-pinned files).
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    /// Every watched root (config plus session folders).
    pub watched_roots: Arc<Mutex<HashSet<PathBuf>>>,
    /// Files owned by a config selector: closing their tab must not drop the
    /// watch, and a reload replaces them.
    config_files: Arc<Mutex<HashSet<PathBuf>>>,
    /// Files owned by an open tab.
    open_files: Arc<Mutex<HashSet<PathBuf>>>,
    /// Roots owned by the config file; a reload replaces exactly these.
    config_roots: Arc<Mutex<HashSet<PathBuf>>>,
    /// Roots added from the command line; they survive config reloads.
    session_roots: Arc<Mutex<HashSet<PathBuf>>>,
    /// Patterns applied to every settled event.
    excludes: Arc<Mutex<ExcludeSet>>,
    /// Path → identity, seeded by scans and opened files.
    identities: Arc<Mutex<HashMap<PathBuf, FileIdentity>>>,
    pairer: Arc<Mutex<RenamePairer>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            watched_roots: Arc::new(Mutex::new(HashSet::new())),
            config_files: Arc::new(Mutex::new(HashSet::new())),
            open_files: Arc::new(Mutex::new(HashSet::new())),
            config_roots: Arc::new(Mutex::new(HashSet::new())),
            session_roots: Arc::new(Mutex::new(HashSet::new())),
            excludes: Arc::new(Mutex::new(ExcludeSet::default())),
            identities: Arc::new(Mutex::new(HashMap::new())),
            pairer: Arc::new(Mutex::new(RenamePairer::new())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher and the rename flusher. Every settled,
    /// relevant event is batched into one `paths-changed` event.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let files = Arc::clone(&self.watched_paths);
        let roots = Arc::clone(&self.watched_roots);
        let excludes = Arc::clone(&self.excludes);
        let identities = Arc::clone(&self.identities);
        let pairer = Arc::clone(&self.pairer);

        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            None,
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    let changes = classify_events(
                        events, &files, &roots, &excludes, &identities, &pairer,
                    );
                    if !changes.is_empty() {
                        let _ = app.emit("paths-changed", changes);
                    }
                }
                Err(errors) => {
                    for error in errors {
                        eprintln!("[docdeck] watch error: {error:?}");
                    }
                }
            },
        )
        .map_err(|e| e.to_string())?;

        *self.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);

        // A `From` with no `To` is only knowable after the hold expires, and no
        // further event is guaranteed to arrive. One background flusher emits
        // those `movedOut` transitions.
        let flusher_app = app_handle;
        let flusher_pairer = Arc::clone(&self.pairer);
        std::thread::spawn(move || loop {
            std::thread::sleep(RENAME_FLUSH_INTERVAL);
            let due = {
                let Ok(mut guard) = flusher_pairer.lock() else {
                    return;
                };
                guard.flush_due(Instant::now())
            };
            let changes: Vec<PathChange> = due
                .into_iter()
                .filter_map(|outcome| match outcome {
                    RenameOutcome::MovedOut { from } => {
                        Some(PathChange::new(PathChangeKind::MovedOut, &from))
                    }
                    _ => None,
                })
                .collect();
            if !changes.is_empty() {
                let _ = flusher_app.emit("paths-changed", changes);
            }
        });

        Ok(())
    }

    /// Replaces the exclude patterns applied to watcher events.
    pub fn set_excludes(&self, excludes: ExcludeSet) -> Result<(), String> {
        *self.excludes.lock().map_err(|e| e.to_string())? = excludes;
        Ok(())
    }

    /// A snapshot of the current exclude patterns, for session-folder scans.
    pub fn excludes(&self) -> ExcludeSet {
        self.excludes
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// A snapshot of every registered root, config- and session-owned.
    pub fn all_roots(&self) -> Vec<PathBuf> {
        self.watched_roots
            .lock()
            .map(|guard| guard.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// A snapshot of the session roots added from the command line.
    pub fn session_roots(&self) -> Vec<PathBuf> {
        self.session_roots
            .lock()
            .map(|guard| guard.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Remembers the current identity of `path` for rename pairing.
    pub fn remember_identity(&self, path: &Path) {
        if let (Some(identity), Ok(mut cache)) = (file_identity(path), self.identities.lock()) {
            cache.insert(path.to_path_buf(), identity);
        }
    }

    /// Seeds the identity cache from an inventory without reading contents.
    pub fn remember_paths(&self, paths: &[PathBuf]) {
        for path in paths {
            self.remember_identity(path);
        }
    }

    /// Starts watching `path` as a single document. Registering the same path
    /// twice is a no-op.
    pub fn watch_file(&self, path: &Path) -> Result<(), String> {
        self.open_files
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());
        self.register_file(path)
    }

    /// Watches a config-selected file that must outlive its tab.
    pub fn pin_file(&self, path: &Path) -> Result<(), String> {
        self.config_files
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());
        self.register_file(path)
    }

    fn register_file(&self, path: &Path) -> Result<(), String> {
        self.remember_identity(path);
        let inserted = self
            .watched_paths
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());

        if inserted {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                debouncer
                    .watch(path, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Registers session roots (CLI folders) and starts one recursive watch per
    /// directory. Registering the same root twice is a no-op.
    pub fn watch_roots(&self, roots: &[PathBuf]) -> Result<(), String> {
        for root in roots {
            self.session_roots
                .lock()
                .map_err(|e| e.to_string())?
                .insert(root.clone());
            self.register_root(root)?;
        }
        Ok(())
    }

    /// Registers one root if it is not already watched.
    fn register_root(&self, root: &Path) -> Result<(), String> {
        let inserted = self
            .watched_roots
            .lock()
            .map_err(|e| e.to_string())?
            .insert(root.to_path_buf());

        if inserted {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                debouncer
                    .watch(root, RecursiveMode::Recursive)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Replaces the config-owned watches without touching session roots or open
    /// tabs. Added roots/files are registered; departed ones are released.
    pub fn replace_config_watches(
        &self,
        roots: &[PathBuf],
        files: &[PathBuf],
    ) -> Result<(), String> {
        let new_roots: HashSet<PathBuf> = roots.iter().cloned().collect();
        let new_files: HashSet<PathBuf> = files.iter().cloned().collect();

        let departed_roots: Vec<PathBuf> = {
            let mut config_roots = self.config_roots.lock().map_err(|e| e.to_string())?;
            let departed = config_roots
                .iter()
                .filter(|root| !new_roots.contains(*root))
                .cloned()
                .collect();
            config_roots.retain(|root| new_roots.contains(root));
            departed
        };
        let departed_files: Vec<PathBuf> = {
            let mut config_files = self.config_files.lock().map_err(|e| e.to_string())?;
            let departed = config_files
                .iter()
                .filter(|file| !new_files.contains(*file))
                .cloned()
                .collect();
            config_files.retain(|file| new_files.contains(file));
            departed
        };

        for root in departed_roots {
            let still_session = self
                .session_roots
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&root);
            if still_session {
                continue;
            }
            self.watched_roots
                .lock()
                .map_err(|e| e.to_string())?
                .remove(&root);
            if let Ok(mut guard) = self.debouncer.lock() {
                if let Some(debouncer) = guard.as_mut() {
                    let _ = debouncer.unwatch(&root);
                }
            }
        }

        for file in departed_files {
            let still_open = self
                .open_files
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&file);
            if still_open {
                continue;
            }
            self.watched_paths
                .lock()
                .map_err(|e| e.to_string())?
                .remove(&file);
            if let Ok(mut guard) = self.debouncer.lock() {
                if let Some(debouncer) = guard.as_mut() {
                    let _ = debouncer.unwatch(&file);
                }
            }
        }

        for root in roots {
            self.config_roots
                .lock()
                .map_err(|e| e.to_string())?
                .insert(root.clone());
            self.register_root(root)?;
        }
        for file in files {
            self.pin_file(file)?;
        }

        Ok(())
    }

    /// Stops watching `path` and drops it from the open-file registry.
    /// Config-pinned files are kept: their watch is owned by the config.
    pub fn unwatch_file(&self, path: &Path) -> Result<(), String> {
        self.open_files
            .lock()
            .map_err(|e| e.to_string())?
            .remove(path);

        let pinned = self
            .config_files
            .lock()
            .map_err(|e| e.to_string())?
            .contains(path);
        if pinned {
            return Ok(());
        }

        let removed = self
            .watched_paths
            .lock()
            .map_err(|e| e.to_string())?
            .remove(path);

        if removed {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                // Best effort: the watch may already be gone if the file was removed.
                let _ = debouncer.unwatch(path);
            }
        }
        Ok(())
    }
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// Turns one debounced batch into the webview's transition list.
///
/// The closure-style parameters keep the event handler free of `self` borrows
/// and make the logic straightforward to follow.
fn classify_events(
    events: Vec<notify_debouncer_full::DebouncedEvent>,
    files: &Arc<Mutex<HashSet<PathBuf>>>,
    roots: &Arc<Mutex<HashSet<PathBuf>>>,
    excludes: &Arc<Mutex<ExcludeSet>>,
    identities: &Arc<Mutex<HashMap<PathBuf, FileIdentity>>>,
    pairer: &Arc<Mutex<RenamePairer>>,
) -> Vec<PathChange> {
    let (Ok(files), Ok(roots), Ok(excludes)) = (files.lock(), roots.lock(), excludes.lock()) else {
        return Vec::new();
    };
    let Ok(mut identities) = identities.lock() else {
        return Vec::new();
    };
    let Ok(mut pairer) = pairer.lock() else {
        return Vec::new();
    };

    let relevant = |path: &Path| is_relevant(path, &files, &roots, &excludes);
    let mut changes: Vec<PathChange> = Vec::new();
    let now = Instant::now();

    for debounced in events {
        let event = debounced.event;
        match event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
                let from = &event.paths[0];
                let to = &event.paths[1];
                if !relevant(from) && !relevant(to) {
                    continue;
                }
                // Drop any pending `From` for the same source so it cannot
                // later settle as a spurious move-out.
                pairer.forget(from);
                if let Some(identity) = file_identity(to) {
                    identities.insert(to.clone(), identity);
                }
                identities.remove(from);
                let mut change = PathChange::new(PathChangeKind::Renamed, to);
                change.from_path = Some(from.to_string_lossy().into_owned());
                changes.push(change);
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for path in &event.paths {
                    if !relevant(path) {
                        continue;
                    }
                    let identity = identities.get(path).copied().or_else(|| file_identity(path));
                    pairer.on_from(path.clone(), identity, now);
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for path in &event.paths {
                    if !relevant(path) {
                        continue;
                    }
                    let identity = file_identity(path);
                    if let Some(identity) = identity {
                        identities.insert(path.clone(), identity);
                    }
                    changes.push(match pairer.on_to(path.clone(), identity, now) {
                        RenameOutcome::Renamed { from, to } => {
                            let mut change = PathChange::new(PathChangeKind::Renamed, &to);
                            change.from_path = Some(from.to_string_lossy().into_owned());
                            change
                        }
                        RenameOutcome::Created { path } => {
                            PathChange::new(PathChangeKind::Created, &path)
                        }
                        RenameOutcome::MovedOut { from } => {
                            PathChange::new(PathChangeKind::MovedOut, &from)
                        }
                    });
                }
            }
            EventKind::Remove(_) => {
                for path in &event.paths {
                    if !relevant(path) {
                        continue;
                    }
                    identities.remove(path);
                    changes.push(PathChange::new(PathChangeKind::Deleted, path));
                }
            }
            EventKind::Create(_) => {
                for path in &event.paths {
                    if !relevant(path) {
                        continue;
                    }
                    let identity = file_identity(path);
                    if let Some(identity) = identity {
                        identities.insert(path.clone(), identity);
                    }
                    changes.push(match pairer.on_to(path.clone(), identity, now) {
                        RenameOutcome::Renamed { from, to } => {
                            let mut change = PathChange::new(PathChangeKind::Renamed, &to);
                            change.from_path = Some(from.to_string_lossy().into_owned());
                            change
                        }
                        RenameOutcome::Created { path } => {
                            PathChange::new(PathChangeKind::Created, &path)
                        }
                        RenameOutcome::MovedOut { from } => {
                            PathChange::new(PathChangeKind::MovedOut, &from)
                        }
                    });
                }
            }
            EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
                for path in &event.paths {
                    if !relevant(path) {
                        continue;
                    }
                    changes.push(PathChange::new(PathChangeKind::Modified, path));
                }
            }
            _ => {}
        }
    }

    // Overflowing `From` events settle as moved-out once the hold expires.
    for outcome in pairer.flush_due(now) {
        if let RenameOutcome::MovedOut { from } = outcome {
            changes.push(PathChange::new(PathChangeKind::MovedOut, &from));
        }
    }

    changes
}
