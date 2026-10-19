//! Recursive Markdown discovery below a watched folder root.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::paths::{is_ignored_name, is_markdown, is_noise_name, ExcludeSet};

/// Documents found below a root, plus the diagnostics the scan could not
/// silently swallow.
#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub files: Vec<PathBuf>,
    pub warnings: Vec<String>,
    pub truncated: bool,
}

/// Recursively lists every Markdown document under `root`, sorted by path.
///
/// Hidden entries (`.git`, `.gitkeep`), editor backups (`plan.md~`), symlinks
/// and the built-in noise directories are skipped; `excludes` removes matches
/// on top. Unreadable subdirectories become warnings rather than failing the
/// whole root. `max_files` caps the return value and reports truncation.
pub fn scan_markdown(
    root: &Path,
    excludes: &ExcludeSet,
    max_files: usize,
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

    for entry in entries {
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
            continue;
        }
        let path = entry.path();
        if !is_markdown(path) || excludes.is_excluded(path) {
            continue;
        }
        if outcome.files.len() >= max_files {
            outcome.truncated = true;
            break;
        }
        outcome.files.push(path.to_path_buf());
    }

    outcome.files.sort();
    Ok(outcome)
}
