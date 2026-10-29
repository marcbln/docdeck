//! Path predicates and CLI argument classification.
//!
//! Kept free of Tauri and watcher types so every rule that decides *what
//! docdeck cares about* can be unit tested without an event loop or a window.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

/// A CLI argument that resolved to a real path, tagged so the frontend can
/// branch between "open this document" and "watch this folder".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CliEntry {
    pub path: String,
    pub is_dir: bool,
}

/// Directory names that are never traversed or surfaced, whatever a selector
/// says. `~/devel/*` would otherwise walk every build tree on a fresh config.
///
/// The runtime-data entries (`vendor`, `cache`, `media`, `thumbnail`,
/// `thumbnails`, `bundles`, `sitemap`, `uploads`, `storage`, `var`, `logs`)
/// matter most for broad `**` selectors: content stores such as a Shopware 6
/// media/thumbnail tree can hold millions of directories but never documents.
/// Python bytecode/cache and coverage output (`__pycache__`, `htmlcov`) are
/// non-hidden, so they need an explicit entry; `.git`, `.venv` and the other
/// dot-directories are already covered by the hidden-name rule.
pub const NOISE_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "vendor",
    "cache",
    "media",
    "thumbnail",
    "thumbnails",
    "bundles",
    "sitemap",
    "uploads",
    "storage",
    "var",
    "logs",
    "__pycache__",
    "htmlcov",
];

/// Compiled `exclude` patterns. An empty set matches nothing; an invalid
/// pattern is dropped with a warning rather than failing the whole config.
#[derive(Debug, Clone)]
pub struct ExcludeSet {
    matcher: GlobSet,
}

impl Default for ExcludeSet {
    fn default() -> Self {
        Self {
            matcher: GlobSet::empty(),
        }
    }
}

impl ExcludeSet {
    /// Compiles every valid pattern and reports the rest.
    ///
    /// Relative patterns resolve against `home`, matching the `watch` array, so
    /// a config can use `exclude = ["**/archive/**"]` without repeating `~`.
    pub fn build_lenient(patterns: &[String], home: &Path) -> (Self, Vec<String>) {
        let mut builder = GlobSetBuilder::new();
        let mut warnings = Vec::new();
        let mut any = false;

        for pattern in patterns {
            let expanded = expand_tilde(pattern, home);
            match GlobBuilder::new(&expanded.to_string_lossy())
                .literal_separator(true)
                .build()
            {
                Ok(glob) => {
                    builder.add(glob);
                    any = true;
                }
                Err(error) => {
                    warnings.push(format!("exclude pattern \"{pattern}\" ignored: {error}"));
                }
            }
        }

        let matcher = if any {
            builder.build().unwrap_or_else(|_| GlobSet::empty())
        } else {
            GlobSet::empty()
        };

        (Self { matcher }, warnings)
    }

    pub fn is_empty(&self) -> bool {
        self.matcher.is_empty()
    }

    /// Whether `path` or any ancestor matches an exclude pattern.
    ///
    /// The ancestor check is what makes `exclude = ["~/devel/legacy"]` exclude
    /// the whole subtree from both the scan and watcher events, not just the
    /// directory entry itself.
    pub fn is_excluded(&self, path: &Path) -> bool {
        if self.is_empty() {
            return false;
        }
        path.ancestors()
            .any(|candidate| self.matcher.is_match(candidate))
    }
}

/// Whether a path's extension marks it as a Markdown document.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// Resolves a document-relative link against the directory of `base_file`.
///
/// The caller supplies an already percent-decoded target. Canonicalization
/// normalizes `..` segments and proves the target exists.
pub fn resolve_link(base_file: &Path, raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("empty link target".to_string());
    }

    let candidate = Path::new(raw);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        let parent = base_file
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", base_file.display()))?;
        parent.join(candidate)
    };

    joined
        .canonicalize()
        .map_err(|error| format!("cannot resolve {}: {error}", joined.display()))
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
/// Explicitly opened or config-pinned files are always relevant, whatever
/// their extension. Inside a watched root only Markdown paths are relevant, and
/// only when no component *below the root* is hidden, a backup or a noise
/// directory and no exclude pattern matches. Checking noise below the root
/// (not over the absolute path) keeps a deliberately hidden root such as
/// `~/.notes` watchable.
///
/// A Markdown path that no longer exists is still relevant: it may have been
/// an inbox row that was never opened, and the frontend needs the delete event
/// to strike that row through. The frontend ignores deletes for paths it is not
/// tracking.
pub fn is_relevant(
    path: &Path,
    files: &HashSet<PathBuf>,
    roots: &HashSet<PathBuf>,
    excludes: &ExcludeSet,
) -> bool {
    if files.contains(path) {
        return true;
    }
    if !is_markdown(path) || !is_under_any(path, roots) {
        return false;
    }
    roots.iter().any(|root| {
        is_under(path, root)
            && !has_ignored_component_below(path, root)
            && !excludes.is_excluded(path)
    })
}

/// Directory entries the scanner always skips: hidden entries (`.git`,
/// `.gitkeep`) and editor backup files (`plan.md~`).
pub fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with('~')
}

/// Built-in noise directories (`node_modules`, `target`, ...).
pub fn is_noise_name(name: &str) -> bool {
    NOISE_DIRS.contains(&name) || name.ends_with(".egg-info")
}

/// Whether any component below `root` is hidden, a backup or a noise
/// directory. The root itself is never inspected, so the rule that hides
/// `.git` does not make an explicitly configured hidden root unwatchable.
pub fn has_ignored_component_below(path: &Path, root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    relative.components().any(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            is_ignored_name(&name) || is_noise_name(&name)
        }
        _ => false,
    })
}

/// Expands a leading `~` and resolves relative selectors against `home`.
///
/// `home` is passed in instead of read from the environment so expansion is a
/// pure function and tests control both the home directory and the filesystem.
pub fn expand_tilde(selector: &str, home: &Path) -> PathBuf {
    if selector == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = selector.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = Path::new(selector);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        home.join(path)
    }
}

/// Modification time in milliseconds since the Unix epoch.
///
/// Used by the inventory and by watcher events; `None` means the path vanished
/// between the event and the stat, which the frontend treats as a delete.
pub fn modified_millis(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

/// Filters flag-style arguments and canonicalizes the rest.
///
/// Mirrors the old `collect_paths`: the executable is skipped, anything that
/// does not resolve to an existing path is dropped, and every survivor is
/// canonicalized so it matches the keys the frontend uses for tab state.
///
/// Relative arguments are resolved against `cwd` — the directory of the
/// process that received them. That is this process's own directory on a first
/// launch, but the *second* shell's directory when the single-instance plugin
/// forwards a command line, so `docdeck README.md` opens the file the caller
/// meant instead of one relative to the already-running window.
pub fn classify_args(args: &[String], cwd: &Path) -> Vec<CliEntry> {
    args.iter()
        .skip(1)
        .map(|arg| arg.as_str())
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let arg_path = Path::new(arg);
            let candidate = if arg_path.is_absolute() {
                arg_path.to_path_buf()
            } else {
                cwd.join(arg_path)
            };
            let path = candidate.canonicalize().ok()?;
            Some(CliEntry {
                is_dir: path.is_dir(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}
