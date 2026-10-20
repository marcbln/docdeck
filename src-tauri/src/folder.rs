//! Recursive Markdown discovery below a watched folder root.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::paths::{is_ignored_name, is_markdown, is_noise_name, ExcludeSet};

/// Sink for live scan progress: the path just visited, whether it is a
/// directory, and the number of matching documents found so far.
pub type ProgressSink<'a> = &'a mut dyn FnMut(&Path, bool, usize);

/// Safety ceiling on entries visited by one walk.
///
/// A deep selector over a content store can contain millions of directories
/// without matching a single document. The cap keeps startup bounded; hitting
/// it sets `entries_truncated` so the caller can warn instead of pretending the
/// inventory is complete.
pub const MAX_SCAN_ENTRIES: usize = 100_000;

/// Documents found below a root, plus the diagnostics the scan could not
/// silently swallow.
#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub files: Vec<PathBuf>,
    pub warnings: Vec<String>,
    /// The document cap was reached.
    pub truncated: bool,
    /// The walk stopped at `MAX_SCAN_ENTRIES` before visiting the whole tree.
    pub entries_truncated: bool,
}

/// Recursively lists every Markdown document under `root`, sorted by path.
///
/// Hidden entries (`.git`, `.gitkeep`), editor backups (`plan.md~`), symlinks
/// and the built-in noise directories are skipped; `excludes` removes matches
/// on top. Unreadable subdirectories become warnings rather than failing the
/// whole root. `max_files` caps the return value and `max_entries` bounds the
/// work spent walking; both report truncation. Every visited entry is reported
/// to `progress`.
pub fn scan_markdown_with_progress(
    root: &Path,
    excludes: &ExcludeSet,
    max_files: usize,
    max_entries: usize,
    progress: ProgressSink<'_>,
) -> Result<ScanOutcome, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let mut outcome = ScanOutcome::default();

    let entries = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if is_ignored_name(&name) || is_noise_name(&name) {
                return false;
            }
            if entry.file_type().is_dir() && excludes.is_excluded(entry.path()) {
                return false;
            }
            true
        });

    for (visited, entry) in entries.enumerate() {
        if visited >= max_entries {
            outcome.entries_truncated = true;
            break;
        }

        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                outcome
                    .warnings
                    .push(format!("{}: {error}", root.display()));
                continue;
            }
        };

        if !entry.file_type().is_file() {
            progress(
                entry.path(),
                entry.file_type().is_dir(),
                outcome.files.len(),
            );
            continue;
        }
        let path = entry.path();
        if !is_markdown(path) || excludes.is_excluded(path) {
            progress(path, false, outcome.files.len());
            continue;
        }
        if outcome.files.len() >= max_files {
            outcome.truncated = true;
            break;
        }
        outcome.files.push(path.to_path_buf());
        progress(path, false, outcome.files.len());
    }

    outcome.files.sort();
    Ok(outcome)
}
