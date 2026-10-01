use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::watcher::WatcherState;

#[derive(serde::Serialize)]
pub struct FilePayload {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub modified_time: u64,
}

/// Reads a document from disk and registers it with the file watcher.
///
/// Returns the absolute (canonicalized) path so the frontend can key its tab
/// state by a stable identifier regardless of how the file was opened.
#[tauri::command]
pub fn load_file(path_str: String, watcher: State<WatcherState>) -> Result<FilePayload, String> {
    let path = PathBuf::from(&path_str);
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;

    let content = fs::read_to_string(&canonical).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    let modified_time = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;

    let filename = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    // Register with the debounced watcher so external writes are picked up.
    watcher.watch_file(&canonical)?;

    Ok(FilePayload {
        path: canonical.to_string_lossy().to_string(),
        filename,
        content,
        modified_time,
    })
}

/// Releases the `inotify` watch for a document once its tab is closed.
#[tauri::command]
pub fn close_file(path_str: String, watcher: State<WatcherState>) -> Result<(), String> {
    let path = PathBuf::from(&path_str);
    let canonical = path.canonicalize().unwrap_or(path);
    watcher.unwatch_file(&canonical)
}
