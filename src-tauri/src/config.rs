//! Global watch configuration: TOML parsing, selector expansion, safety caps.
//!
//! Everything here is a pure function of its inputs plus the filesystem, so
//! expansion is unit-testable with temp directories and an explicit home
//! directory.

use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};

use globset::GlobBuilder;
use walkdir::{DirEntry, WalkDir};

use crate::folder::{ProgressSink, MAX_SCAN_ENTRIES};
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
    pub max_entries: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_roots: MAX_ROOTS,
            max_files: MAX_FILES,
            max_entries: MAX_SCAN_ENTRIES,
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
///
/// Glob selectors walk their literal base recursively; on a selector such as
/// `/projects/**/_ai` that walk is the expensive part of startup, so every
/// visited entry is reported to `progress`.
pub fn expand_with_limits_and_progress(
    config: &WatchConfig,
    home: &Path,
    limits: Limits,
    progress: ProgressSink<'_>,
) -> WatchPlan {
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
        expand_selector(selector, &expanded, &mut plan, limits, &mut *progress);
    }

    plan
}

fn expand_selector(
    selector: &str,
    pattern: &Path,
    plan: &mut WatchPlan,
    limits: Limits,
    progress: ProgressSink<'_>,
) {
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

    let max_depth = if contains_deep_glob(pattern) {
        None
    } else {
        Some(
            pattern
                .components()
                .count()
                .saturating_sub(base.components().count()),
        )
    };

    let mut matched_any = false;
    let mut cap_warned = false;
    let mut entries_truncated = false;
    let truncation_warning = || {
        format!(
            "selector \"{selector}\" truncated: scan entry limit ({}) reached; narrow the selector or add an exclude pattern",
            limits.max_entries
        )
    };

    if limits.max_entries == 0 {
        plan.truncated = true;
        plan.warnings.push(truncation_warning());
        return;
    }

    if contains_deep_glob(pattern) {
        // Walk breadth-first, not depth-first. Most `_ai` roots sit near the top
        // of a tree, while one deep project (a shop's `t2-app` or a huge clone)
        // can swallow the entry budget before a depth-first walk ever reaches
        // its siblings. Breadth-first visits every directory at a given depth
        // before descending, so shallow roots are found even when the cap is
        // hit.
        let mut pending: VecDeque<(PathBuf, usize)> = VecDeque::new();
        let base_is_symlink =
            fs::symlink_metadata(&base).is_ok_and(|metadata| metadata.file_type().is_symlink());

        progress(&base, true, plan.roots.len() + plan.files.len());
        let mut visited = 1usize;

        if !base_is_symlink {
            pending.push_back((base, 0));
        }

        'walk: while let Some((directory, depth)) = pending.pop_front() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) => {
                    plan.warnings.push(format!(
                        "selector \"{selector}\": {}: {error}",
                        directory.display()
                    ));
                    continue;
                }
            };

            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        plan.warnings
                            .push(format!("selector \"{selector}\": {error}"));
                        continue;
                    }
                };

                let file_name = entry.file_name();
                let name = file_name.to_string_lossy();
                if is_ignored_name(&name) || is_noise_name(&name) {
                    continue;
                }

                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(error) => {
                        plan.warnings.push(format!(
                            "selector \"{selector}\": {}: {error}",
                            entry.path().display()
                        ));
                        continue;
                    }
                };
                let path = entry.path();
                let is_dir = file_type.is_dir();

                if is_dir && excludes.is_excluded(&path) {
                    continue;
                }

                if visited >= limits.max_entries {
                    entries_truncated = true;
                    plan.truncated = true;
                    plan.warnings.push(truncation_warning());
                    break 'walk;
                }
                visited += 1;

                let entry_depth = depth + 1;
                consider_entry(
                    plan,
                    &path,
                    is_dir,
                    file_type.is_symlink(),
                    entry_depth,
                    &matcher,
                    &excludes,
                    selector,
                    limits,
                    &mut cap_warned,
                    &mut matched_any,
                    progress,
                );

                if is_dir && entry_depth < max_depth.unwrap_or(usize::MAX) {
                    pending.push_back((path, entry_depth));
                }
            }
        }
    } else {
        // Bounded selectors stay depth-first: for
        // `/shops/*/plugins/*/_ai` a breadth-first walk would enumerate every
        // file at each level before reaching the `_ai` leaf, while depth-first
        // walks straight down each branch. They also follow the pattern
        // segment by segment, so a sibling such as a shop's `vol/mariadb`
        // database is never entered.
        let Some(segments) = pattern_segments(pattern, &base) else {
            plan.warnings
                .push(format!("selector \"{selector}\" ignored: invalid glob"));
            return;
        };
        let mut walker = WalkDir::new(&base).follow_links(false);
        if let Some(limit) = max_depth {
            walker = walker.max_depth(limit);
        }

        for (visited, entry) in walker
            .into_iter()
            .filter_entry(|entry| should_descend_bounded(entry, &segments, &excludes))
            .enumerate()
        {
            if visited >= limits.max_entries {
                entries_truncated = true;
                plan.truncated = true;
                plan.warnings.push(truncation_warning());
                break;
            }

            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    plan.warnings
                        .push(format!("selector \"{selector}\": {error}"));
                    continue;
                }
            };

            consider_entry(
                plan,
                entry.path(),
                entry.file_type().is_dir(),
                entry.file_type().is_symlink(),
                entry.depth(),
                &matcher,
                &excludes,
                selector,
                limits,
                &mut cap_warned,
                &mut matched_any,
                progress,
            );
        }
    }

    if !matched_any && !entries_truncated {
        plan.warnings.push(format!(
            "selector \"{selector}\" matched no files or directories"
        ));
    }
}

/// Records one visited entry: matches are canonicalized and added, then the
/// progress sink is told about the path.
#[allow(clippy::too_many_arguments)]
fn consider_entry(
    plan: &mut WatchPlan,
    path: &Path,
    is_dir: bool,
    is_symlink: bool,
    depth: usize,
    matcher: &globset::GlobMatcher,
    excludes: &ExcludeSet,
    selector: &str,
    limits: Limits,
    cap_warned: &mut bool,
    matched_any: &mut bool,
    progress: &mut dyn FnMut(&Path, bool, usize),
) {
    if depth != 0 && matcher.is_match(path) && !is_symlink {
        // Symlinks are skipped by policy; canonicalizing one would silently
        // turn it into its target.
        match path.canonicalize() {
            Ok(path) => {
                if !excludes.is_excluded(&path)
                    && add_match(plan, &path, selector, limits, cap_warned)
                {
                    *matched_any = true;
                }
            }
            Err(error) => plan.warnings.push(format!(
                "selector \"{selector}\": {}: {error}",
                path.display()
            )),
        }
    }

    progress(path, is_dir, plan.roots.len() + plan.files.len());
}

/// One path segment of a bounded selector, after the literal base.
enum Segment {
    Literal(std::ffi::OsString),
    Glob(globset::GlobMatcher),
}

impl Segment {
    fn matches(&self, name: &std::ffi::OsStr) -> bool {
        match self {
            Self::Literal(expected) => expected.as_os_str() == name,
            Self::Glob(matcher) => matcher.is_match(Path::new(name)),
        }
    }
}

/// The selector's components after the literal base, with glob components
/// compiled individually. Returns `None` only if a component glob is invalid,
/// which the full-pattern matcher already ruled out.
fn pattern_segments(pattern: &Path, base: &Path) -> Option<Vec<Segment>> {
    pattern
        .components()
        .skip(base.components().count())
        .map(|component| match component {
            Component::Normal(name) => {
                if has_glob(name) {
                    let text = name.to_string_lossy();
                    GlobBuilder::new(&text)
                        .literal_separator(true)
                        .build()
                        .ok()
                        .map(|glob| Segment::Glob(glob.compile_matcher()))
                } else {
                    Some(Segment::Literal(name.to_os_string()))
                }
            }
            _ => None,
        })
        .collect()
}

/// Pattern-guided pruning for bounded, depth-first walks: only entries whose
/// name matches the segment at their depth are descended into (and therefore
/// only those are yielded and matched). Hidden, backup, noise and excluded
/// entries are pruned first.
fn should_descend_bounded(entry: &DirEntry, segments: &[Segment], excludes: &ExcludeSet) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name();
    let text = name.to_string_lossy();
    if is_ignored_name(&text) || is_noise_name(&text) {
        return false;
    }
    if entry.file_type().is_dir() && excludes.is_excluded(entry.path()) {
        return false;
    }
    segments
        .get(entry.depth() - 1)
        .is_some_and(|segment| segment.matches(name))
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
