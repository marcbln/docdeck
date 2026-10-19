//! Global watch configuration: TOML parsing, selector expansion, safety caps.
//!
//! Everything here is a pure function of its inputs plus the filesystem, so
//! expansion is unit-testable with temp directories and an explicit home
//! directory.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use globset::GlobBuilder;
use walkdir::{DirEntry, WalkDir};

use crate::paths::{expand_tilde, is_ignored_name, is_noise_name, ExcludeSet};

/// Hard ceiling on recursively watched roots per session.
pub const MAX_ROOTS: usize = 256;
/// Hard ceiling on inbox entries (explicit files plus scanned documents).
pub const MAX_FILES: usize = 10_000;

/// The parsed config file. Both keys are optional so an empty file is valid.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
pub struct WatchConfig {
    #[serde(default)]
    pub watch: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

/// Resolved selectors, ready for scanning and watch registration.
#[derive(Debug, Default)]
pub struct WatchPlan {
    pub roots: Vec<PathBuf>,
    pub files: Vec<PathBuf>,
    pub excludes: ExcludeSet,
    pub warnings: Vec<String>,
    pub truncated: bool,
}

/// Expansion ceilings, injectable so tests can force the cap paths.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_roots: usize,
    pub max_files: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_roots: MAX_ROOTS,
            max_files: MAX_FILES,
        }
    }
}

/// A loaded config plus whether the file existed at all.
#[derive(Debug)]
pub struct LoadedConfig {
    pub path: PathBuf,
    pub found: bool,
    pub config: WatchConfig,
}

/// Where the config lives. `$DOCDECK_CONFIG` wins outright (tests, alternate
/// profiles); otherwise XDG semantics apply.
pub fn config_path() -> PathBuf {
    if let Some(path) = std::env::var_os("DOCDECK_CONFIG").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(base) = std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(base).join("docdeck").join("config.toml");
    }
    home_dir()
        .join(".config")
        .join("docdeck")
        .join("config.toml")
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Reads and parses the config. A missing file is not an error — it is the
/// first-run state the panel turns into a setup hint. Unreadable or malformed
/// files return `Err` with a message fit for the panel.
pub fn load(path: &Path) -> Result<LoadedConfig, String> {
    match fs::read_to_string(path) {
        Ok(raw) => toml::from_str::<WatchConfig>(&raw)
            .map(|config| LoadedConfig {
                path: path.to_path_buf(),
                found: true,
                config,
            })
            .map_err(|error| format!("{}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LoadedConfig {
            path: path.to_path_buf(),
            found: false,
            config: WatchConfig::default(),
        }),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

/// Expands every selector into roots and explicit files.
///
/// `home` is a parameter instead of an env read so tests control tilde and
/// relative resolution. Warnings never abort expansion: one bad selector must
/// not take down the rest of the config.
pub fn expand_with_limits(config: &WatchConfig, home: &Path, limits: Limits) -> WatchPlan {
    let mut plan = WatchPlan::default();
    let (excludes, mut warnings) = ExcludeSet::build_lenient(&config.exclude, home);
    plan.excludes = excludes;
    plan.warnings.append(&mut warnings);

    let mut seen: HashSet<PathBuf> = HashSet::new();
    for selector in &config.watch {
        let expanded = expand_tilde(selector, home);
        if !seen.insert(expanded.clone()) {
            continue; // duplicate selector, not worth a warning
        }
        expand_selector(selector, &expanded, &mut plan, limits);
    }

    plan
}

fn expand_selector(selector: &str, pattern: &Path, plan: &mut WatchPlan, limits: Limits) {
    if is_literal(pattern) {
        match fs::symlink_metadata(pattern) {
            Err(_) => plan.warnings.push(format!(
                "selector \"{selector}\" matched nothing: {} does not exist",
                pattern.display()
            )),
            Ok(metadata) if metadata.file_type().is_symlink() => plan.warnings.push(format!(
                "selector \"{selector}\" skipped: {} is a symlink",
                pattern.display()
            )),
            Ok(_) => match pattern.canonicalize() {
                Ok(path) => {
                    let mut cap_warned = false;
                    if !add_match(plan, &path, selector, limits, &mut cap_warned) {
                        plan.warnings.push(format!(
                            "selector \"{selector}\" matched neither a file nor a directory"
                        ));
                    }
                }
                Err(error) => plan
                    .warnings
                    .push(format!("selector \"{selector}\": {error}")),
            },
        }
        return;
    }

    let matcher = match GlobBuilder::new(&pattern.to_string_lossy())
        .literal_separator(true)
        .build()
    {
        Ok(glob) => glob.compile_matcher(),
        Err(error) => {
            plan.warnings
                .push(format!("selector \"{selector}\" ignored: {error}"));
            return;
        }
    };

    let base = literal_base(pattern);
    if !base.is_dir() {
        plan.warnings.push(format!(
            "selector \"{selector}\" matched nothing: {} is not a directory",
            base.display()
        ));
        return;
    }

    // `filter_entry` holds the exclude set for the whole walk, so it is cloned
    // out of the plan before any warning can be pushed.
    let excludes = plan.excludes.clone();

    let mut walker = WalkDir::new(&base).follow_links(false);
    if !contains_deep_glob(pattern) {
        let remaining = pattern
            .components()
            .count()
            .saturating_sub(base.components().count());
        walker = walker.max_depth(remaining);
    }

    let mut matched_any = false;
    let mut cap_warned = false;

    for entry in walker
        .into_iter()
        .filter_entry(|entry| should_descend(entry, &excludes))
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                plan.warnings
                    .push(format!("selector \"{selector}\": {error}"));
                continue;
            }
        };

        if entry.depth() == 0 || !matcher.is_match(entry.path()) {
            continue;
        }
        // Symlinks are skipped by policy; canonicalizing one would silently
        // turn it into its target.
        if entry.file_type().is_symlink() {
            continue;
        }

        let path = match entry.path().canonicalize() {
            Ok(path) => path,
            Err(error) => {
                plan.warnings.push(format!(
                    "selector \"{selector}\": {}: {error}",
                    entry.path().display()
                ));
                continue;
            }
        };

        if excludes.is_excluded(&path) {
            continue;
        }

        if add_match(plan, &path, selector, limits, &mut cap_warned) {
            matched_any = true;
        }
    }

    if !matched_any {
        plan.warnings.push(format!(
            "selector \"{selector}\" matched no files or directories"
        ));
    }
}

/// Adds one match, deduplicating and enforcing the caps.
///
/// Returns true when the path was already present or successfully added, and
/// false when it is neither a file nor a directory (so the caller can decide
/// whether the selector "matched" anything).
fn add_match(
    plan: &mut WatchPlan,
    path: &Path,
    selector: &str,
    limits: Limits,
    cap_warned: &mut bool,
) -> bool {
    if path.is_dir() {
        if plan.roots.iter().any(|root| root == path) {
            return true;
        }
        if plan.roots.len() >= limits.max_roots {
            plan.truncated = true;
            if !*cap_warned {
                plan.warnings.push(format!(
                    "selector \"{selector}\" truncated: watch root limit ({}) reached",
                    limits.max_roots
                ));
                *cap_warned = true;
            }
            return true;
        }
        plan.roots.push(path.to_path_buf());
        true
    } else if path.is_file() {
        if plan.files.iter().any(|file| file == path) {
            return true;
        }
        if plan.files.len() >= limits.max_files {
            plan.truncated = true;
            if !*cap_warned {
                plan.warnings.push(format!(
                    "selector \"{selector}\" truncated: file limit ({}) reached",
                    limits.max_files
                ));
                *cap_warned = true;
            }
            return true;
        }
        plan.files.push(path.to_path_buf());
        true
    } else {
        false
    }
}

/// Whether the whole selector contains no glob metacharacter.
fn is_literal(pattern: &Path) -> bool {
    !pattern.components().any(|component| match component {
        Component::Normal(name) => has_glob(name),
        _ => false,
    })
}

fn has_glob(component: &std::ffi::OsStr) -> bool {
    component
        .to_string_lossy()
        .chars()
        .any(|character| matches!(character, '*' | '?' | '['))
}

fn contains_deep_glob(pattern: &Path) -> bool {
    pattern.components().any(|component| match component {
        Component::Normal(name) => name.to_string_lossy().contains("**"),
        _ => false,
    })
}

/// The longest leading run of non-glob components: the directory the walk
/// starts from. `/home/u/devel/*/docs/*.md` walks from `/home/u/devel`.
fn literal_base(pattern: &Path) -> PathBuf {
    let mut base = PathBuf::new();
    for component in pattern.components() {
        match component {
            Component::RootDir | Component::Prefix(_) => base.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => base.push(".."),
            Component::Normal(name) => {
                if has_glob(name) {
                    break;
                }
                base.push(name);
            }
        }
    }
    if base.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        base
    }
}

/// Subtree pruning shared by the walk: hidden entries, backups, noise
/// directories and excluded directories are never descended into.
fn should_descend(entry: &DirEntry, excludes: &ExcludeSet) -> bool {
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
}
