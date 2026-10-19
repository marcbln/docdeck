//! Tauri command surface: disk reads, config loading, watch registration.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::config::{self, Limits, MAX_FILES};
use crate::folder;
use crate::paths::modified_millis;
use crate::watcher::WatcherState;

#[derive(serde::Serialize)]
pub struct FilePayload {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub modified_time: u64,
}

/// One inbox row: a watched file and its last modification time.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEntry {
    pub path: String,
    pub filename: String,
    pub modified_time: u64,
}

/// The result of loading the global config at startup.
///
/// `error` is set for an unreadable or malformed file, in which case no
/// watches are registered. Warnings never abort the remaining selectors.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLoad {
    pub config_path: String,
    pub config_found: bool,
    pub roots: Vec<String>,
    pub entries: Vec<InboxEntry>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub truncated: bool,
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
fn entry_for(path: &Path) -> Option<InboxEntry> {
    Some(InboxEntry {
        path: path.to_string_lossy().into_owned(),
        filename: path.file_name()?.to_string_lossy().into_owned(),
        modified_time: modified_millis(path)?,
    })
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
#[tauri::command]
pub fn load_watches(watcher: State<WatcherState>) -> WatchLoad {
    let path = config::config_path();
    let config_path = path.to_string_lossy().into_owned();

    let loaded = match config::load(&path) {
        Ok(loaded) => loaded,
        Err(error) => {
            return WatchLoad {
                config_path,
                config_found: true,
                roots: Vec::new(),
                entries: Vec::new(),
                warnings: Vec::new(),
                error: Some(error),
                truncated: false,
            };
        }
    };

    let home = config::home_dir();
    let plan = config::expand_with_limits(&loaded.config, &home, Limits::default());

    let mut warnings = plan.warnings;
    let mut truncated = plan.truncated;
    let mut entries: Vec<InboxEntry> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    // Explicit file selectors first: they are cheap and must survive a root
    // scan that hits the global cap.
    for file in &plan.files {
        if entries.len() >= MAX_FILES {
            truncated = true;
            warnings.push(format!(
                "file limit ({MAX_FILES}) reached; remaining file selectors skipped"
            ));
            break;
        }
        if seen.insert(file.clone()) {
            match entry_for(file) {
                Some(entry) => entries.push(entry),
                None => warnings.push(format!(
                    "{} vanished before it could be listed",
                    file.display()
                )),
            }
        }
    }

    // Scan roots for Markdown, respecting the remaining global file budget.
    for root in &plan.roots {
        let remaining = MAX_FILES.saturating_sub(entries.len());
        match folder::scan_markdown(root, &plan.excludes, remaining) {
            Ok(outcome) => {
                if outcome.truncated {
                    truncated = true;
                    warnings.push(format!(
                        "scan of {} truncated at the {MAX_FILES} file limit",
                        root.display()
                    ));
                }
                warnings.extend(outcome.warnings);
                for file in outcome.files {
                    if seen.insert(file.clone()) {
                        if let Some(entry) = entry_for(&file) {
                            entries.push(entry);
                        }
                    }
                }
            }
            Err(error) => warnings.push(error),
        }
    }

    // Register watchers after the inventory. The exclude set must be in place
    // before the first event can be filtered, or excluded files leak into the
    // inbox.
    if let Err(error) = watcher.set_excludes(plan.excludes.clone()) {
        warnings.push(format!("could not apply exclude patterns: {error}"));
    }
    for root in &plan.roots {
        if let Err(error) = watcher.watch_roots(std::slice::from_ref(root)) {
            warnings.push(format!("could not watch {}: {error}", root.display()));
        }
    }
    for file in &plan.files {
        if let Err(error) = watcher.pin_file(file) {
            warnings.push(format!("could not watch {}: {error}", file.display()));
        }
    }

    WatchLoad {
        config_path: loaded.path.to_string_lossy().into_owned(),
        config_found: loaded.found,
        roots: plan
            .roots
            .iter()
            .map(|root| root.to_string_lossy().into_owned())
            .collect(),
        entries,
        warnings,
        error: None,
        truncated,
    }
}

/// Adds session watches for CLI folders and returns the documents they hold.
///
/// Uses the excludes already installed by `load_watches`, so a session folder
/// observes the same filter as the config. CLI file arguments do not come
/// through here: they open a tab directly and are not part of the registry.
#[tauri::command]
pub fn add_watch(paths: Vec<String>, watcher: State<WatcherState>) -> WatchAdded {
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
        match folder::scan_markdown(&path, &excludes, remaining) {
            Ok(outcome) => {
                if outcome.truncated {
                    warnings.push(format!(
                        "scan of {} truncated at the {MAX_FILES} file limit",
                        path.display()
                    ));
                }
                warnings.extend(outcome.warnings);
                roots.push(path.to_string_lossy().into_owned());
                if let Err(error) = watcher.watch_roots(std::slice::from_ref(&path)) {
                    warnings.push(format!("could not watch {}: {error}", path.display()));
                }
                for file in outcome.files {
                    if seen.insert(file.clone()) {
                        if let Some(entry) = entry_for(&file) {
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
