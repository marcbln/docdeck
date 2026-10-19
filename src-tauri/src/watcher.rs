//! Debounced `inotify` watching of open documents and watched folder roots.

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

use crate::paths::{is_relevant, modified_millis, ExcludeSet};

/// Debounce window for filesystem events.
///
/// AI agents frequently write documents in rapid, chunked bursts. Without a
/// debounce window every `write()` would trigger a full document re-read and
/// re-render in the webview.
pub const DEBOUNCE_MS: u64 = 300;

/// A settled filesystem change forwarded to the webview.
///
/// `exists` is sampled after the debounce window closed, so it tells the
/// frontend how to treat the path *now*: reload it, or flag its tab as deleted.
/// `modifiedTime` is sampled at the same moment so the inbox can update its
/// ordering and relative time without re-reading document contents.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathChange {
    pub path: String,
    pub exists: bool,
    pub modified_time: Option<u64>,
}

/// Owns the registry of open documents, the watched roots, the excluded
/// patterns, and the single debounced `inotify` watcher that backs all three.
pub struct WatcherState {
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub watched_roots: Arc<Mutex<HashSet<PathBuf>>>,
    /// Files owned by a config selector: closing their tab must not drop the
    /// watch, or the next agent write would disappear from the inbox.
    pinned_paths: Arc<Mutex<HashSet<PathBuf>>>,
    /// Patterns applied to every settled event.
    excludes: Arc<Mutex<ExcludeSet>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            watched_roots: Arc::new(Mutex::new(HashSet::new())),
            pinned_paths: Arc::new(Mutex::new(HashSet::new())),
            excludes: Arc::new(Mutex::new(ExcludeSet::default())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher. Every settled, relevant event is batched
    /// into one `paths-changed` event carrying absolute paths.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let files = Arc::clone(&self.watched_paths);
        let roots = Arc::clone(&self.watched_roots);
        let excludes = Arc::clone(&self.excludes);

        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    // Lock guards are scoped so none of the registries stays
                    // locked while the event is emitted: the webview must never
                    // block watch registration.
                    let changes: Vec<PathChange> = {
                        let Ok(files) = files.lock() else { return };
                        let Ok(roots) = roots.lock() else { return };
                        let Ok(excludes) = excludes.lock() else {
                            return;
                        };

                        events
                            .into_iter()
                            .map(|event| event.path)
                            .filter(|path| is_relevant(path, &files, &roots, &excludes))
                            .map(|path| {
                                let exists = path.exists();
                                PathChange {
                                    modified_time: if exists {
                                        modified_millis(&path)
                                    } else {
                                        None
                                    },
                                    path: path.to_string_lossy().into_owned(),
                                    exists,
                                }
                            })
                            .collect()
                    };

                    if !changes.is_empty() {
                        let _ = app.emit("paths-changed", changes);
                    }
                }
                Err(err) => eprintln!("[docdeck] watch error: {err:?}"),
            },
        )
        .map_err(|e| e.to_string())?;

        *self.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
        Ok(())
    }

    /// Replaces the exclude patterns applied to watcher events.
    pub fn set_excludes(&self, excludes: ExcludeSet) -> Result<(), String> {
        *self.excludes.lock().map_err(|e| e.to_string())? = excludes;
        Ok(())
    }

    /// A snapshot of the current exclude patterns, for the session-folder scan.
    pub fn excludes(&self) -> ExcludeSet {
        self.excludes
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Starts watching `path` as a single document. Registering the same path
    /// twice is a no-op.
    pub fn watch_file(&self, path: &Path) -> Result<(), String> {
        let inserted = self
            .watched_paths
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());

        if inserted {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                debouncer
                    .watcher()
                    .watch(path, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Watches a config-selected file that must outlive its tab.
    pub fn pin_file(&self, path: &Path) -> Result<(), String> {
        self.pinned_paths
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());
        self.watch_file(path)
    }

    /// Registers `roots` and starts one recursive watch per directory.
    /// Registering the same root twice is a no-op.
    ///
    /// The directory watch survives atomic write-to-temp-then-rename saves that
    /// invalidate a file-level watch, and it is what lets brand-new documents
    /// be discovered without the user re-opening anything.
    pub fn watch_roots(&self, roots: &[PathBuf]) -> Result<(), String> {
        for root in roots {
            let inserted = self
                .watched_roots
                .lock()
                .map_err(|e| e.to_string())?
                .insert(root.clone());

            if inserted {
                let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
                if let Some(debouncer) = guard.as_mut() {
                    debouncer
                        .watcher()
                        .watch(root, RecursiveMode::Recursive)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }

    /// Stops watching `path` and drops it from the registry. Config-pinned
    /// files are kept: their watch is owned by the config, not the tab.
    pub fn unwatch_file(&self, path: &Path) -> Result<(), String> {
        let pinned = self
            .pinned_paths
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
                let _ = debouncer.watcher().unwatch(path);
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
