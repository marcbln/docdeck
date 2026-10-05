//! Tauri command surface: disk reads, watch registration, folder discovery.

use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::folder;
use crate::watcher::WatcherState;

#[derive(serde::Serialize)]
pub struct FilePayload {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub modified_time: u64,
}

/// A watched root and every Markdown document discovered beneath it.
#[derive(serde::Serialize)]
pub struct FolderScan {
    pub root: String,
    pub files: Vec<String>,
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

/// Lists the Markdown documents under a folder so the picker can build its tree.
#[tauri::command]
pub fn scan_folder(path_str: String) -> Result<FolderScan, String> {
    let root = PathBuf::from(&path_str)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let files = folder::scan_markdown(&root)?
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();

    Ok(FolderScan {
        root: root.to_string_lossy().into_owned(),
        files,
    })
}

/// Starts one recursive watch per folder once the user confirms the picker.
#[tauri::command]
pub fn watch_folders(paths: Vec<String>, watcher: State<WatcherState>) -> Result<(), String> {
    let roots = paths
        .iter()
        .map(|path| {
            PathBuf::from(path)
                .canonicalize()
                .map_err(|e| format!("{path}: {e}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    watcher.watch_roots(&roots)
}
