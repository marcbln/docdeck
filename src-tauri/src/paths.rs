//! Path predicates and CLI argument classification.
//!
//! Kept free of Tauri and watcher types so every rule that decides *what
//! docdeck cares about* can be unit tested without an event loop or a window.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// A CLI argument that resolved to a real path, tagged so the frontend can
/// branch between "open this document" and "show the folder picker".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CliEntry {
    pub path: String,
    pub is_dir: bool,
}

/// Whether a path's extension marks it as a Markdown document.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// Whether `path` lies inside `root` (or is `root` itself).
///
/// `Path::starts_with` compares whole components, so `/tmp/ab` is correctly
/// *not* treated as living under `/tmp/a`.
pub fn is_under(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

/// Whether any watched root contains `path`.
pub fn is_under_any(path: &Path, roots: &HashSet<PathBuf>) -> bool {
    roots.iter().any(|root| is_under(path, root))
}

/// Whether a settled filesystem event concerns something the UI cares about.
///
/// Explicitly opened files are always relevant, whatever their extension —
/// docdeck can render any document handed to it on the CLI. Inside a watched
/// root only existing Markdown files are relevant; anything else (`.gitkeep`,
/// editor droppings, directories) is background noise. The `is_file` check also
/// filters delete events for files that were never opened, which have nothing
/// to mark.
pub fn is_relevant(path: &Path, files: &HashSet<PathBuf>, roots: &HashSet<PathBuf>) -> bool {
    files.contains(path) || (path.is_file() && is_markdown(path) && is_under_any(path, roots))
}

/// Directory entries the folder scanner skips: hidden entries (`.git`,
/// `.gitkeep`) and editor backup files (`plan.md~`).
pub fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with('~')
}

/// Filters flag-style arguments and canonicalizes the rest.
///
/// Mirrors the old `collect_paths`: the executable is skipped, anything that
/// does not resolve to an existing path is dropped, and every survivor is
/// canonicalized so it matches the keys the frontend uses for tab state.
pub fn classify_args(args: &[String]) -> Vec<CliEntry> {
    args.iter()
        .skip(1)
        .map(|arg| arg.as_str())
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = PathBuf::from(arg).canonicalize().ok()?;
            Some(CliEntry {
                is_dir: path.is_dir(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}
