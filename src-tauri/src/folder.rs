//! Recursive Markdown discovery below a watched folder root.

use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::{is_ignored_name, is_markdown};

/// Recursively lists every Markdown document under `root`, sorted by path.
///
/// Hidden entries (`.git`, `.gitkeep`) and editor backups (`plan.md~`) are
/// skipped. Symbolic links are skipped as well: following them risks cycles and
/// an agent workspace has no need for them.
pub fn scan_markdown(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let mut found = Vec::new();
    collect_dir(root, &mut found)?;
    found.sort();
    Ok(found)
}

fn collect_dir(dir: &Path, found: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("{}: {error}", dir.display()))?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored_name(&name) {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            collect_dir(&path, found)?;
        } else if file_type.is_file() && is_markdown(&path) {
            found.push(path);
        }
    }

    Ok(())
}
