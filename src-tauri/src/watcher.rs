use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

/// Debounce window for filesystem events.
///
/// AI agents frequently write documents in rapid, chunked bursts. Without a
/// debounce window every `write()` would trigger a full document re-read and
/// re-render in the webview.
pub const DEBOUNCE_MS: u64 = 300;

/// Owns the set of documents currently open in the UI and the single debounced
/// `inotify` watcher that backs them.
pub struct WatcherState {
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher. Every settled event is forwarded to the
    /// webview as a `file-updated` event carrying the absolute path.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    for event in events {
                        let path = event.path.to_string_lossy().to_string();
                        let _ = app.emit("file-updated", path);
                    }
                }
                Err(err) => eprintln!("[docdeck] watch error: {err:?}"),
            },
        )
        .map_err(|e| e.to_string())?;

        *self.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
        Ok(())
    }

    /// Starts watching `path`. Registering the same path twice is a no-op.
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
