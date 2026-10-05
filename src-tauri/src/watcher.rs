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

use crate::paths::is_relevant;

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
/// `notify-debouncer-mini` does not classify events, and for this UI the
/// existence check is all the classification that is needed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PathChange {
    pub path: String,
    pub exists: bool,
}

/// Owns the set of documents currently open in the UI, the set of recursively
/// watched folders, and the single debounced `inotify` watcher that backs both.
pub struct WatcherState {
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub watched_roots: Arc<Mutex<HashSet<PathBuf>>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            watched_roots: Arc::new(Mutex::new(HashSet::new())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher. Every settled, relevant event is batched
    /// into one `paths-changed` event carrying absolute paths.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let files = Arc::clone(&self.watched_paths);
        let roots = Arc::clone(&self.watched_roots);

        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    // Lock guards are scoped so neither registry stays locked
                    // while the event is emitted: the webview must never block
                    // watch registration.
                    let changes: Vec<PathChange> = {
                        let Ok(files) = files.lock() else { return };
                        let Ok(roots) = roots.lock() else { return };

                        events
                            .into_iter()
                            .map(|event| event.path)
                            .filter(|path| is_relevant(path, &files, &roots))
                            .map(|path| PathChange {
                                exists: path.exists(),
                                path: path.to_string_lossy().into_owned(),
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

    /// Stops watching `path` and drops it from the registry.
    pub fn unwatch_file(&self, path: &Path) -> Result<(), String> {
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
