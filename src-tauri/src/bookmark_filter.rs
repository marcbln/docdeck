//! In-memory notification filter for bookmarked documents.
//!
//! The webview owns the bookmark collection and sends only a validated path
//! set. This module never reads, stats or canonicalizes a path: it compares
//! strings so a compromised webview cannot turn the filter into a filesystem
//! probe. OS notification delivery, focus and throttling stay in `tray`.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use tauri::State;

use crate::commands::{CommandError, CommandErrorCode};
use crate::watcher::PathChange;

/// Maximum number of paths accepted from the webview.
pub const MAX_PATHS: usize = 10_000;
/// Maximum byte length of one path.
pub const MAX_PATH_BYTES: usize = 4096;

/// Request payload from the webview.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBookmarkFilterInput {
    pub enabled: bool,
    pub paths: Vec<String>,
}

/// Validated filter held in memory. `paths` is a set so duplicates collapse.
#[derive(Debug, Clone, Default)]
pub struct NotificationBookmarkFilter {
    pub enabled: bool,
    pub paths: HashSet<String>,
}

/// Shared filter state registered with `app.manage`.
pub struct BookmarkFilterState {
    inner: Mutex<NotificationBookmarkFilter>,
}

impl BookmarkFilterState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(NotificationBookmarkFilter::default()),
        }
    }

    /// Replaces the filter after validation. On error the previous filter is
    /// untouched.
    pub fn replace(&self, input: NotificationBookmarkFilterInput) -> Result<(), CommandError> {
        let paths = validate_paths(&input.paths)?;
        let mut guard = self.inner.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::Internal,
                "bookmark notification filter is unavailable",
            )
        })?;
        *guard = NotificationBookmarkFilter {
            enabled: input.enabled,
            paths,
        };
        Ok(())
    }

    /// Candidates eligible for a popup, preserving the input order.
    ///
    /// Disabled filters pass the full batch. Enabled filters keep a change when
    /// either its current path or its rename source is bookmarked.
    pub fn candidates(&self, changes: &[PathChange]) -> Vec<PathChange> {
        let Ok(guard) = self.inner.lock() else {
            return changes.to_vec();
        };
        filter_candidates(&guard, changes)
    }

    /// Current filter, for diagnostics and tests.
    #[allow(dead_code)]
    pub fn snapshot(&self) -> NotificationBookmarkFilter {
        self.inner
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }
}

impl Default for BookmarkFilterState {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_paths(paths: &[String]) -> Result<HashSet<String>, CommandError> {
    if paths.len() > MAX_PATHS {
        return Err(CommandError::new(
            CommandErrorCode::Invalid,
            format!("at most {MAX_PATHS} bookmark paths are allowed"),
        ));
    }

    let mut validated = HashSet::with_capacity(paths.len());
    for path in paths {
        if path.is_empty() {
            return Err(CommandError::new(
                CommandErrorCode::Invalid,
                "bookmark path must not be empty",
            ));
        }
        if path.len() > MAX_PATH_BYTES {
            return Err(CommandError::new(
                CommandErrorCode::Invalid,
                "bookmark path is too long",
            ));
        }
        if path.contains('\0') {
            return Err(CommandError::new(
                CommandErrorCode::Invalid,
                "bookmark path must not contain NUL",
            ));
        }
        if !Path::new(path).is_absolute() {
            return Err(CommandError::new(
                CommandErrorCode::Invalid,
                format!("bookmark path must be absolute: {path}"),
            ));
        }
        validated.insert(path.clone());
    }
    Ok(validated)
}

/// Pure candidate filter shared by the tray and its tests.
pub fn filter_candidates(
    filter: &NotificationBookmarkFilter,
    changes: &[PathChange],
) -> Vec<PathChange> {
    if !filter.enabled {
        return changes.to_vec();
    }
    changes
        .iter()
        .filter(|change| {
            filter.paths.contains(&change.path)
                || change
                    .from_path
                    .as_ref()
                    .is_some_and(|from| filter.paths.contains(from))
        })
        .cloned()
        .collect()
}

/// Replaces the in-memory filter atomically.
#[tauri::command]
pub fn set_bookmark_notification_filter(
    filter: NotificationBookmarkFilterInput,
    state: State<'_, BookmarkFilterState>,
) -> Result<(), CommandError> {
    state.replace(filter)
}
