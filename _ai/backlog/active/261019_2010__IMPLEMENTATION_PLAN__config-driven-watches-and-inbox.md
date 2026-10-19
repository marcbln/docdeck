---
filename: "_ai/backlog/active/261019_2010__IMPLEMENTATION_PLAN__config-driven-watches-and-inbox.md"
title: "Config-driven watches and the Thunderbird-style file inbox"
createdAt: 2026-10-19 20:10
updatedAt: 2026-10-19 20:10
status: draft
priority: high
tags: [config, watcher, inbox, unread, ux, glob]
estimatedComplexity: complex
documentRevision: 1
sourceSpec: ""
sourceHandoff: "_ai/backlog/active/261019_2002__DESIGN_HANDOFF__config-driven-watches-and-inbox.md"
documentType: IMPLEMENTATION_PLAN
---

# Config-driven watches and the Thunderbird-style file inbox

## 1. Problem

docdeck watches documents only for the lifetime of the CLI invocation that
opened them. A folder argument opens a checkbox picker, and the confirmed
selection starts recursive watches that die with the session. Users who keep
agent workspaces in several projects must remember and repeat the same command
and the same confirmation on every launch, and a broad selection auto-opens a
tab for every changed file — unusable once selectors widen beyond one folder.

The request is (a) a persistent config listing watched directories and/or files
with wildcards, modelled on super-bin's `repos.toml`, and (b) a
Thunderbird-style inbox listing every matched file by modification time, newest
first, with files that changed since docdeck started in bold. The agreed design
(`_ai/backlog/active/261019_2002__DESIGN_HANDOFF__config-driven-watches-and-inbox.md`,
ADRs `261019-1` and `261019-2`) makes the inbox the single entry point and
removes both the picker and auto-open.

## 2. Executive summary

- **Global config, read once at startup.** `~/.config/docdeck/config.toml`
  (XDG-aware, `$DOCDECK_CONFIG` overrides) with two flat arrays: `watch` and
  optional `exclude`. No groups, no project-local config, no live reload.
- **Selector expansion in Rust.** `~` expands; `*` matches one path segment;
  `**` matches any depth. A matched directory becomes a recursive `*.md` root; a
  matched file is watched explicitly and may have any extension. Matches are
  canonicalized and deduped.
- **Safe by default.** Hidden entries, symlinks, and `node_modules`, `target`,
  `dist`, `build`, `.venv`, `venv` are always skipped; `exclude` globs apply on
  top. The exact same filter runs on the initial scan and on watcher events.
- **The folder picker is removed.** `folder-modal.ts`, `file-tree.ts`, their
  tests, `scan_folder`, `watch_folders` and the picker CSS go away. A CLI folder
  registers a session watch and feeds the inbox; a CLI file opens a tab.
  Nothing auto-opens.
- **Session-scoped unread inbox.** A persistent, collapsible left panel (header
  toggle, visible by default, persisted as `inboxVisible`) lists every matched
  file newest-first. Rows show an optional project chip, the filename, a muted
  compacted parent path, and a relative time with the exact timestamp in the
  tooltip.
- **Unread means "changed since docdeck started and not looked at".** Nothing is
  bold at startup. A create/write marks the file bold with an amber dot unless
  it is the active tab; clicking the row or activating the tab clears it;
  closing an unread tab does not. No persistence.
- **Active-tab feedback.** A write to the active document re-sorts its row but
  never bolds it; the tab's amber dot pulses briefly (~2.5 s) and fades.
- **New and deleted files.** A new file appears as a bold row without opening a
  tab. A deleted file keeps a struck-through, muted row with its last mtime
  until it reappears or the session ends.
- **Failures are visible, never fatal.** Invalid TOML shows a parse error and
  registers no watches; a missing file shows a setup hint with an example;
  unmatched selectors, vanished paths, permission errors and watch registration
  failures become panel warnings. Expansion caps at 256 roots and 10,000 files
  with the offending selector named.

### Acceptance criteria (derived from the agreed design)

- **AC-01 — Config loading.** `~/.config/docdeck/config.toml` is read once at
  startup; `$DOCDECK_CONFIG` overrides the location. A missing file yields a
  setup hint; malformed TOML yields an error message and no watches; other
  selectors are unaffected by one bad selector.
- **AC-02 — Selector semantics.** `~` expands; `*` stays within one segment;
  `**` crosses depth; directory matches contribute recursive `*.md` trees; file
  matches are watched whatever their extension; duplicates collapse.
- **AC-03 — Safe traversal.** Hidden entries, symlinks and the noise
  directories are never scanned or surfaced; `exclude` patterns remove files and
  whole subtrees from both the scan and watcher events.
- **AC-04 — Picker removed, CLI preserved.** No picker UI exists. `docdeck
  <folder>` adds a session watch and lists its files in the inbox; `docdeck
  <file>` opens a tab. No create/modify event opens a tab automatically.
- **AC-05 — Inbox panel.** A header toggle shows/hides the left panel, default
  visible, persisted across restarts. Rows are sorted by mtime descending (ties
  by path) and show project chip (only for `_ai` paths), filename, compacted
  parent path and relative time (exact timestamp in the tooltip). Open tabs get
  a subtle accent.
- **AC-06 — Session unread.** Nothing is bold at startup. A write while running
  bolds the row unless the file is active; clicking the row or activating the
  tab clears bold; closing an unread tab keeps it bold; restart clears all bold.
- **AC-07 — Active-tab activity.** A write to the active document updates its
  mtime and row order, does not mark it unread, and pulses the tab dot for
  ~2.5 s.
- **AC-08 — New and deleted files.** A new/recreated file appears bold at the
  top without opening a tab. A deleted file keeps a struck-through, muted row
  with its last mtime until it reappears or the session ends.
- **AC-09 — Caps and diagnostics.** Expansion is capped at 256 roots and 10,000
  files; the panel shows the warnings and the config path involved. No failure
  aborts the remaining watches.
- **AC-10 — Verification.** Rust and vitest suites cover config expansion, path
  filters, the inbox model/panel and preferences; the simulation script drives
  the real app through config creation, session folder addition, agent writes,
  deletes/recreates and restarts.

### Explicitly deferred (out of scope)

- Live config reload, config editing UI, named groups or profiles.
- Persisted read/unread state across restarts.
- Inbox search/filtering, notifications, sound.
- Rename tracking (a rename is still delete + create).
- Document editing and non-Markdown rendering changes.
- Windows/macOS support.

### Open handoff questions resolved by this plan

- **`glob` vs `globset`.** The handoff named the `glob` crate; this plan uses
  `globset` + `walkdir` instead, because expansion must *prune* excluded and
  noise subtrees while walking. `globset` gives the same `*`/`**` semantics
  with `GlobBuilder::literal_separator(true)` and a reusable `GlobSet` for
  watcher events. Selector semantics are unchanged; this is the only planned
  deviation from the handoff text.
- **`**` and root-level files.** A config test asserts that `~/notes/**/*.md`
  matches both `~/notes/top.md` and `~/notes/sub/deep.md`. `globset` treats `**/`
  as zero-or-more components; the test pins that behavior.
- **Loading state.** The panel renders a "Scanning watched paths…" line while
  `load_watches` is in flight, then fills with rows, hint or error.
- **Relative-time formatting.** A small custom formatter is used instead of
  `Intl.RelativeTimeFormat`, so tests are deterministic and locale-independent.

## 3. Project environment

```
Runtime      Linux (inotify + WebKitGTK); no Windows/macOS support required
Backend      Rust 1.80+, Tauri v2, notify 6.1, notify-debouncer-mini 0.4
Frontend     TypeScript (strict) + Vite, no framework, happy-dom + Vitest
Node         20+
Commands     npm run typecheck        tsc --noEmit
             npm run test:web         vitest run
             npm run test             cargo test + vitest run
             npm run lint:rs          cargo clippy --all-targets -- -D warnings
             npm run check            typecheck + tests + tauri build --no-bundle
             npm run tauri dev -- <args>
             ./scripts/simulate_folder_watch.sh
New deps     globset = "0.4" (new)
             toml = "0.8" and walkdir = "2" (already in Cargo.lock transitively)
```

`toml` 0.8.2 and `walkdir` 2.5.0 already resolve in `Cargo.lock`; only
`globset` adds new packages. `@tauri-apps/api` is already a dependency, so no
frontend packages change.

## Phase 1 — Config primitives: exclude filtering, parsing, selector expansion

### 1.1 `src-tauri/Cargo.toml` [MODIFY] — dependencies

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notify = "6.1"
notify-debouncer-mini = "0.4"
tokio = { version = "1", features = ["full"] }
globset = "0.4"
toml = "0.8"
walkdir = "2"
```

### 1.2 `src-tauri/src/paths.rs` [MODIFY] — full replacement

Adds the noise-directory list, the reusable `ExcludeSet`, `~`/relative
expansion, the mtime helper, and a root-relative noise check so a deliberately
hidden root (`~/.notes`) still delivers events for its children.

```rust
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
pub const NOISE_DIRS: &[&str] = &["node_modules", "target", "dist", "build", ".venv", "venv"];

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
        if self.matcher.is_empty() {
            return false;
        }
        path.ancestors().any(|candidate| self.matcher.is_match(candidate))
    }
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
/// Explicitly opened or config-pinned files are always relevant, whatever
/// their extension. Inside a watched root only existing Markdown files are
/// relevant, and only when no component *below the root* is hidden, a backup
/// or a noise directory and no exclude pattern matches. Checking noise below
/// the root (not over the absolute path) keeps a deliberately hidden root such
/// as `~/.notes` watchable.
pub fn is_relevant(
    path: &Path,
    files: &HashSet<PathBuf>,
    roots: &HashSet<PathBuf>,
    excludes: &ExcludeSet,
) -> bool {
    if files.contains(path) {
        return true;
    }
    if !path.is_file() || !is_markdown(path) {
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
    NOISE_DIRS.contains(&name)
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
```

### 1.3 `src-tauri/src/paths_test.rs` [MODIFY] — full replacement

Existing tests keep their names; the `is_relevant` signature gains the
`ExcludeSet`, and new tests cover excludes, noise-below-root, tilde expansion
and mtime.

```rust
#[cfg(test)]
mod tests {
    use crate::paths::{
        ExcludeSet, classify_args, expand_tilde, has_ignored_component_below, is_ignored_name,
        is_markdown, is_noise_name, is_relevant, is_under, modified_millis,
    };
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    #[test]
    fn markdown_extension_is_case_insensitive() {
        assert!(is_markdown(Path::new("plan.md")));
        assert!(is_markdown(Path::new("PLAN.MD")));
        assert!(!is_markdown(Path::new("plan.markdown")));
        assert!(!is_markdown(Path::new("plan.md~")));
        assert!(!is_markdown(Path::new("plan")));
    }

    #[test]
    fn under_compares_whole_components() {
        assert!(is_under(Path::new("/tmp/a/plan.md"), Path::new("/tmp/a")));
        assert!(is_under(Path::new("/tmp/a"), Path::new("/tmp/a")));
        assert!(!is_under(Path::new("/tmp/ab/plan.md"), Path::new("/tmp/a")));
    }

    #[test]
    fn hidden_and_backup_names_are_ignored() {
        assert!(is_ignored_name(".git"));
        assert!(is_ignored_name(".gitkeep"));
        assert!(is_ignored_name("plan.md~"));
        assert!(!is_ignored_name("plan.md"));
    }

    #[test]
    fn noise_names_are_recognized() {
        assert!(is_noise_name("node_modules"));
        assert!(is_noise_name("target"));
        assert!(is_noise_name(".venv"));
        assert!(!is_noise_name("src"));
    }

    #[test]
    fn relevance_prefers_open_files_then_root_markdown() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(&root).unwrap();
        let doc = root.join("a.md");
        fs::write(&doc, "# doc").unwrap();
        let txt = root.join("a.txt");
        fs::write(&txt, "text").unwrap();

        let files: HashSet<PathBuf> = [txt.clone()].into();
        let roots: HashSet<PathBuf> = [root.clone()].into();
        let excludes = ExcludeSet::default();

        // An explicitly opened file reloads whatever its extension.
        assert!(is_relevant(&txt, &files, &roots, &excludes));
        // Fresh Markdown under a root is relevant.
        assert!(is_relevant(&doc, &files, &roots, &excludes));
        // A deleted/never-existing path has nothing to mark.
        assert!(!is_relevant(&root.join("missing.md"), &files, &roots, &excludes));
        // Markdown outside every root is not.
        assert!(!is_relevant(Path::new("/elsewhere/a.md"), &files, &roots, &excludes));
    }

    #[test]
    fn relevance_rejects_noise_and_excluded_paths() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join("drafts")).unwrap();
        let noise = root.join("node_modules/dep.md");
        let draft = root.join("drafts/old.md");
        let keep = root.join("keep.md");
        fs::write(&noise, "# dep").unwrap();
        fs::write(&draft, "# old").unwrap();
        fs::write(&keep, "# keep").unwrap();

        let files: HashSet<PathBuf> = HashSet::new();
        let roots: HashSet<PathBuf> = [root.clone()].into();
        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/drafts/**".to_string()], dir.path());
        assert!(warnings.is_empty());

        assert!(!is_relevant(&noise, &files, &roots, &excludes));
        assert!(!is_relevant(&draft, &files, &roots, &excludes));
        assert!(is_relevant(&keep, &files, &roots, &excludes));
    }

    #[test]
    fn noise_check_ignores_components_above_the_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".notes");
        fs::create_dir_all(&root).unwrap();
        let doc = root.join("plan.md");
        fs::write(&doc, "# plan").unwrap();

        assert!(has_ignored_component_below(&doc, &root) == false);
        assert!(is_under(&doc, &root));
    }

    #[test]
    fn exclude_set_matches_directories_and_subtrees() {
        let dir = tempdir().unwrap();
        let (excludes, warnings) =
            ExcludeSet::build_lenient(&[dir.path().join("legacy").to_string_lossy().into_owned()], dir.path());
        assert!(warnings.is_empty());
        assert!(excludes.is_excluded(&dir.path().join("legacy")));
        assert!(excludes.is_excluded(&dir.path().join("legacy/deep/old.md")));
        assert!(!excludes.is_excluded(&dir.path().join("current/plan.md")));
    }

    #[test]
    fn empty_exclude_set_matches_nothing() {
        let excludes = ExcludeSet::default();
        assert!(excludes.is_empty());
        assert!(!excludes.is_excluded(Path::new("/tmp/anything.md")));
    }

    #[test]
    fn invalid_exclude_pattern_becomes_a_warning() {
        let (excludes, warnings) = ExcludeSet::build_lenient(&["[".to_string()], Path::new("/tmp"));
        assert!(excludes.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("exclude pattern"));
    }

    #[test]
    fn expand_tilde_handles_home_root_absolute_and_relative() {
        let home = Path::new("/home/tester");
        assert_eq!(expand_tilde("~", home), home);
        assert_eq!(expand_tilde("~/notes", home), home.join("notes"));
        assert_eq!(expand_tilde("/etc/notes", home), PathBuf::from("/etc/notes"));
        assert_eq!(expand_tilde("notes", home), home.join("notes"));
    }

    #[test]
    fn modified_millis_reads_a_real_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(modified_millis(&file).unwrap() > 0);
        assert!(modified_millis(&dir.path().join("missing.md")).is_none());
    }

    #[test]
    fn classify_args_tags_files_and_dirs() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();

        let argv = vec![
            "docdeck".to_string(),
            "--accelerated".to_string(),
            dir.path().to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            "/does/not/exist.md".to_string(),
        ];

        let entries = classify_args(&argv, dir.path());
        assert_eq!(entries.len(), 2);

        let dir_entry = entries.iter().find(|entry| entry.is_dir).unwrap();
        assert_eq!(
            dir_entry.path,
            dir.path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        );

        let file_entry = entries.iter().find(|entry| !entry.is_dir).unwrap();
        assert_eq!(
            file_entry.path,
            file.canonicalize().unwrap().to_string_lossy().into_owned()
        );
    }

    #[test]
    fn classify_args_resolves_relative_paths_against_cwd() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();

        let argv = vec!["docdeck".to_string(), "plan.md".to_string()];

        // A forwarded command line resolves against the shell that sent it...
        let entries = classify_args(&argv, dir.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].path,
            file.canonicalize().unwrap().to_string_lossy().into_owned()
        );
        assert!(!entries[0].is_dir);

        // ...not against whatever directory the running app happens to have.
        let elsewhere = tempdir().unwrap();
        assert!(classify_args(&argv, elsewhere.path()).is_empty());
    }
}
```

### 1.4 `src-tauri/src/config.rs` [NEW FILE]

The whole config pipeline: location, tolerant parse, selector expansion with
pruning, caps and human-readable warnings. Traversal starts at the longest
literal prefix of a selector and matches candidates with a `globset` matcher,
so `*` never crosses a separator and `**` does.

```rust
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

use crate::paths::{ExcludeSet, expand_tilde, is_ignored_name, is_noise_name};

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
    home_dir().join(".config").join("docdeck").join("config.toml")
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
            Ok(metadata) if metadata.file_type().is_symlink() => plan
                .warnings
                .push(format!("selector \"{selector}\" skipped: {} is a symlink", pattern.display())),
            Ok(_) => match pattern.canonicalize() {
                Ok(path) => {
                    let mut cap_warned = false;
                    if !add_match(plan, &path, selector, limits, &mut cap_warned) {
                        plan.warnings.push(format!(
                            "selector \"{selector}\" matched neither a file nor a directory"
                        ));
                    }
                }
                Err(error) => plan.warnings.push(format!("selector \"{selector}\": {error}")),
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
            plan.warnings.push(format!("selector \"{selector}\" ignored: {error}"));
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
                plan.warnings.push(format!("selector \"{selector}\": {error}"));
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
```

### 1.5 `src-tauri/src/config_test.rs` [NEW FILE]

```rust
#[cfg(test)]
mod tests {
    use crate::config::{Limits, WatchConfig, expand_with_limits, load};
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    fn config(watch: &[&str], exclude: &[&str]) -> WatchConfig {
        WatchConfig {
            watch: watch.iter().map(|value| value.to_string()).collect(),
            exclude: exclude.iter().map(|value| value.to_string()).collect(),
        }
    }

    fn names(paths: &[PathBuf]) -> Vec<String> {
        let mut names: Vec<String> = paths
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn expand(config: &WatchConfig, home: &Path) -> crate::config::WatchPlan {
        expand_with_limits(config, home, Limits::default())
    }

    // -- loading -------------------------------------------------------------

    #[test]
    fn missing_config_reports_not_found() {
        let dir = tempdir().unwrap();
        let loaded = load(&dir.path().join("config.toml")).unwrap();
        assert!(!loaded.found);
        assert!(loaded.config.watch.is_empty());
        assert!(loaded.config.exclude.is_empty());
    }

    #[test]
    fn parses_watch_and_exclude_arrays() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [\"~/notes\"]\nexclude = [\"**/drafts/**\"]\n").unwrap();

        let loaded = load(&path).unwrap();
        assert!(loaded.found);
        assert_eq!(loaded.config.watch, vec!["~/notes"]);
        assert_eq!(loaded.config.exclude, vec!["**/drafts/**"]);
    }

    #[test]
    fn empty_config_is_valid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "").unwrap();
        let loaded = load(&path).unwrap();
        assert!(loaded.found);
        assert!(loaded.config.watch.is_empty());
    }

    #[test]
    fn malformed_toml_is_an_error_naming_the_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "watch = [\"unterminated\n").unwrap();

        let error = load(&path).unwrap_err();
        assert!(error.contains("config.toml"), "error was: {error}");
    }

    // -- expansion -----------------------------------------------------------

    #[test]
    fn literal_directory_becomes_a_root() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(&config(&["~/notes"], &[]), home.path());

        assert_eq!(plan.roots, vec![home.path().join("notes").canonicalize().unwrap()]);
        assert!(plan.files.is_empty());
        assert!(plan.warnings.is_empty());
        assert!(!plan.truncated);
    }

    #[test]
    fn relative_selector_resolves_against_home() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(&config(&["notes"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["notes"]);
    }

    #[test]
    fn single_star_matches_one_segment_only() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("projects/alpha")).unwrap();
        fs::create_dir_all(home.path().join("projects/beta/nested")).unwrap();

        let plan = expand(&config(&["~/projects/*"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["alpha", "beta"]);
        assert!(plan.roots.iter().all(|root| root.file_name().unwrap() != "nested"));
    }

    #[test]
    fn deep_glob_matches_files_at_the_root_and_nested() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/sub")).unwrap();
        fs::write(home.path().join("notes/top.md"), "# top").unwrap();
        fs::write(home.path().join("notes/sub/deep.md"), "# deep").unwrap();
        fs::write(home.path().join("notes/sub/skip.txt"), "nope").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["deep.md", "top.md"]);
    }

    #[test]
    fn explicit_file_selector_accepts_any_extension() {
        let home = tempdir().unwrap();
        fs::write(home.path().join("todo.txt"), "task").unwrap();

        let plan = expand(&config(&["~/todo.txt"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["todo.txt"]);
        assert!(plan.roots.is_empty());
    }

    #[test]
    fn noise_directories_are_pruned() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/node_modules")).unwrap();
        fs::create_dir_all(home.path().join("notes/target")).unwrap();
        fs::create_dir_all(home.path().join("notes/sub")).unwrap();
        fs::write(home.path().join("notes/node_modules/dep.md"), "# dep").unwrap();
        fs::write(home.path().join("notes/target/out.md"), "# out").unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();
        fs::write(home.path().join("notes/sub/deep.md"), "# deep").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &[]), home.path());

        assert_eq!(names(&plan.files), vec!["deep.md", "keep.md"]);
    }

    #[test]
    fn symlinked_directories_are_skipped() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/real")).unwrap();
        symlink(home.path().join("notes/real"), home.path().join("notes/link")).unwrap();

        let plan = expand(&config(&["~/notes/*"], &[]), home.path());

        assert_eq!(names(&plan.roots), vec!["real"]);
    }

    // -- excludes ------------------------------------------------------------

    #[test]
    fn exclude_pattern_removes_files_and_subtrees() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes/drafts")).unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();
        fs::write(home.path().join("notes/drafts/old.md"), "# old").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &["~/notes/drafts"]), home.path());

        assert_eq!(names(&plan.files), vec!["keep.md"]);
        assert!(plan.excludes.is_excluded(&home.path().join("notes/drafts/old.md")));
    }

    #[test]
    fn invalid_exclude_pattern_warns_but_keeps_the_rest() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();
        fs::write(home.path().join("notes/keep.md"), "# keep").unwrap();

        let plan = expand(&config(&["~/notes/**/*.md"], &["["]), home.path());

        assert_eq!(names(&plan.files), vec!["keep.md"]);
        assert_eq!(plan.warnings.len(), 1);
        assert!(plan.warnings[0].contains("exclude pattern"));
    }

    // -- caps and warnings ---------------------------------------------------

    #[test]
    fn unmatched_selector_warns() {
        let home = tempdir().unwrap();

        let plan = expand(&config(&["~/nowhere/**/*.md"], &[]), home.path());

        assert!(plan.roots.is_empty());
        assert!(plan.files.is_empty());
        assert_eq!(plan.warnings.len(), 1);
        assert!(plan.warnings[0].contains("matched nothing"));
    }

    #[test]
    fn duplicate_selectors_do_not_duplicate_roots() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();

        let plan = expand(&config(&["~/notes", "~/notes", "~/notes/"], &[]), home.path());

        assert_eq!(plan.roots.len(), 1);
    }

    #[test]
    fn root_cap_truncates_with_a_warning() {
        let home = tempdir().unwrap();
        for name in ["a", "b", "c"] {
            fs::create_dir_all(home.path().join("projects").join(name)).unwrap();
        }

        let plan = expand_with_limits(
            &config(&["~/projects/*"], &[]),
            home.path(),
            Limits { max_roots: 2, max_files: 10 },
        );

        assert_eq!(plan.roots.len(), 2);
        assert!(plan.truncated);
        assert!(plan.warnings.iter().any(|warning| warning.contains("watch root limit")));
    }

    #[test]
    fn file_cap_truncates_with_a_warning() {
        let home = tempdir().unwrap();
        fs::create_dir_all(home.path().join("notes")).unwrap();
        fs::write(home.path().join("notes/a.md"), "# a").unwrap();
        fs::write(home.path().join("notes/b.md"), "# b").unwrap();

        let plan = expand_with_limits(
            &config(&["~/notes/**/*.md"], &[]),
            home.path(),
            Limits { max_roots: 10, max_files: 1 },
        );

        assert_eq!(plan.files.len(), 1);
        assert!(plan.truncated);
        assert!(plan.warnings.iter().any(|warning| warning.contains("file limit")));
    }
}
```

### 1.6 `src-tauri/src/lib.rs` [MODIFY] — module declarations

Add the config module and its test module to the declaration block at the top
of `lib.rs` (command registration is handled in Phase 3).

```rust
mod commands;
mod config;
mod folder;
mod paths;
mod render;
mod watcher;

#[cfg(test)]
mod config_test;
#[cfg(test)]
mod folder_test;
#[cfg(test)]
mod paths_test;
#[cfg(test)]
mod render_test;
#[cfg(test)]
mod watcher_test;
```

## Phase 2 — Folder scanning and watcher changes

### 2.1 `src-tauri/src/folder.rs` [MODIFY] — full replacement

Replaces the hand-rolled recursion with `walkdir` so excludes and noise
directories prune subtrees, and returns diagnostics instead of a bare list.

```rust
//! Recursive Markdown discovery below a watched folder root.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::paths::{ExcludeSet, is_ignored_name, is_markdown, is_noise_name};

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
                outcome.warnings.push(format!("{}: {error}", root.display()));
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
```

### 2.2 `src-tauri/src/folder_test.rs` [MODIFY] — full replacement

```rust
#[cfg(test)]
mod tests {
    use crate::folder::scan_markdown;
    use crate::paths::ExcludeSet;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use tempfile::tempdir;

    fn scan(root: &Path) -> (Vec<String>, bool) {
        let outcome = scan_markdown(root, &ExcludeSet::default(), 1000).unwrap();
        let mut names: Vec<String> = outcome
            .files
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        (names, outcome.truncated)
    }

    #[test]
    fn scans_markdown_recursively_and_skips_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("backlog/active")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::create_dir_all(dir.path().join("target")).unwrap();
        fs::write(dir.path().join("README.md"), "# root").unwrap();
        fs::write(dir.path().join("backlog/active/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("backlog/report.MD"), "# report").unwrap();
        fs::write(dir.path().join("backlog/notes.txt"), "nope").unwrap();
        fs::write(dir.path().join(".git/HEAD.md"), "nope").unwrap();
        fs::write(dir.path().join("node_modules/dep.md"), "nope").unwrap();
        fs::write(dir.path().join("target/out.md"), "nope").unwrap();
        fs::write(dir.path().join("backlog/plan.md~"), "nope").unwrap();

        let (names, truncated) = scan(dir.path());

        assert!(!truncated);
        assert_eq!(
            names,
            vec![
                "README.md".to_string(),
                "backlog/active/plan.md".to_string(),
                "backlog/report.MD".to_string(),
            ]
        );
    }

    #[test]
    fn rejects_a_non_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(scan_markdown(&file, &ExcludeSet::default(), 1000).is_err());
    }

    #[test]
    fn honors_exclude_patterns() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("drafts")).unwrap();
        fs::write(dir.path().join("keep.md"), "# keep").unwrap();
        fs::write(dir.path().join("drafts/old.md"), "# old").unwrap();

        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/drafts/**".to_string()], dir.path());
        assert!(warnings.is_empty());

        let outcome = scan_markdown(dir.path(), &excludes, 1000).unwrap();
        assert_eq!(outcome.files.len(), 1);
        assert!(outcome.files[0].ends_with("keep.md"));
    }

    #[test]
    fn skips_symlinked_directories() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("real")).unwrap();
        fs::write(dir.path().join("real/plan.md"), "# plan").unwrap();
        symlink(dir.path().join("real"), dir.path().join("link")).unwrap();

        let (names, _) = scan(dir.path());
        assert_eq!(names, vec!["real/plan.md".to_string()]);
    }

    #[test]
    fn truncates_at_max_files() {
        let dir = tempdir().unwrap();
        for index in 0..5 {
            fs::write(dir.path().join(format!("doc_{index}.md")), "# doc").unwrap();
        }

        let outcome = scan_markdown(dir.path(), &ExcludeSet::default(), 3).unwrap();
        assert_eq!(outcome.files.len(), 3);
        assert!(outcome.truncated);
    }
}
```

### 2.3 `src-tauri/src/watcher.rs` [MODIFY] — full replacement

`PathChange` gains a post-debounce `modifiedTime`; the state gains pinned files
(watches owned by config selectors that survive their tab closing) and the
exclude set applied on every settled event.

```rust
//! Debounced `inotify` watching of open documents and watched folder roots.

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

use crate::paths::{ExcludeSet, is_relevant, modified_millis};

/// Debounce window for filesystem events.
///
/// AI agents frequently write documents in rapid, chunked bursts. Without a
/// debounce window every `write()` would trigger a full document re-read and
/// re-render in the webview.
pub const DEBOUNCE_MS: u64 = 300;

/// A settled filesystem change forwarded to the webview.
///
/// `exists` is sampled after the debounce window closed, so it tells the
/// frontend how to treat the path *now*: reload it, or flag its tab as deleted.
/// `modifiedTime` is sampled at the same moment so the inbox can update its
/// ordering and relative time without re-reading document contents.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathChange {
    pub path: String,
    pub exists: bool,
    pub modified_time: Option<u64>,
}

/// Owns the registry of open documents, the watched roots, the excluded
/// patterns, and the single debounced `inotify` watcher that backs all three.
pub struct WatcherState {
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub watched_roots: Arc<Mutex<HashSet<PathBuf>>>,
    /// Files owned by a config selector: closing their tab must not drop the
    /// watch, or the next agent write would disappear from the inbox.
    pinned_paths: Arc<Mutex<HashSet<PathBuf>>>,
    /// Patterns applied to every settled event.
    excludes: Arc<Mutex<ExcludeSet>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            watched_roots: Arc::new(Mutex::new(HashSet::new())),
            pinned_paths: Arc::new(Mutex::new(HashSet::new())),
            excludes: Arc::new(Mutex::new(ExcludeSet::default())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher. Every settled, relevant event is batched
    /// into one `paths-changed` event carrying absolute paths.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let files = Arc::clone(&self.watched_paths);
        let roots = Arc::clone(&self.watched_roots);
        let excludes = Arc::clone(&self.excludes);

        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    // Lock guards are scoped so none of the registries stays
                    // locked while the event is emitted: the webview must never
                    // block watch registration.
                    let changes: Vec<PathChange> = {
                        let Ok(files) = files.lock() else { return };
                        let Ok(roots) = roots.lock() else { return };
                        let Ok(excludes) = excludes.lock() else { return };

                        events
                            .into_iter()
                            .map(|event| event.path)
                            .filter(|path| is_relevant(path, &files, &roots, &excludes))
                            .map(|path| {
                                let exists = path.exists();
                                PathChange {
                                    modified_time: if exists {
                                        modified_millis(&path)
                                    } else {
                                        None
                                    },
                                    path: path.to_string_lossy().into_owned(),
                                    exists,
                                }
                            })
                            .collect()
                    };

                    if !changes.is_empty() {
                        let _ = app.emit("paths-changed", changes);
                    }
                }
                Err(err) => eprintln!("[docdeck] watch error: {err:?}"),
            },
        )
        .map_err(|e| e.to_string())?;

        *self.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
        Ok(())
    }

    /// Replaces the exclude patterns applied to watcher events.
    pub fn set_excludes(&self, excludes: ExcludeSet) -> Result<(), String> {
        *self.excludes.lock().map_err(|e| e.to_string())? = excludes;
        Ok(())
    }

    /// A snapshot of the current exclude patterns, for the session-folder scan.
    pub fn excludes(&self) -> ExcludeSet {
        self.excludes
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Starts watching `path` as a single document. Registering the same path
    /// twice is a no-op.
    pub fn watch_file(&self, path: &Path) -> Result<(), String> {
        let inserted = self
            .watched_paths
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());

        if inserted {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                debouncer
                    .watcher()
                    .watch(path, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Watches a config-selected file that must outlive its tab.
    pub fn pin_file(&self, path: &Path) -> Result<(), String> {
        self.pinned_paths
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.to_path_buf());
        self.watch_file(path)
    }

    /// Registers `roots` and starts one recursive watch per directory.
    /// Registering the same root twice is a no-op.
    ///
    /// The directory watch survives atomic write-to-temp-then-rename saves that
    /// invalidate a file-level watch, and it is what lets brand-new documents
    /// be discovered without the user re-opening anything.
    pub fn watch_roots(&self, roots: &[PathBuf]) -> Result<(), String> {
        for root in roots {
            let inserted = self
                .watched_roots
                .lock()
                .map_err(|e| e.to_string())?
                .insert(root.clone());

            if inserted {
                let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
                if let Some(debouncer) = guard.as_mut() {
                    debouncer
                        .watcher()
                        .watch(root, RecursiveMode::Recursive)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }

    /// Stops watching `path` and drops it from the registry. Config-pinned
    /// files are kept: their watch is owned by the config, not the tab.
    pub fn unwatch_file(&self, path: &Path) -> Result<(), String> {
        let pinned = self
            .pinned_paths
            .lock()
            .map_err(|e| e.to_string())?
            .contains(path);
        if pinned {
            return Ok(());
        }

        let removed = self
            .watched_paths
            .lock()
            .map_err(|e| e.to_string())?
            .remove(path);

        if removed {
            let mut guard = self.debouncer.lock().map_err(|e| e.to_string())?;
            if let Some(debouncer) = guard.as_mut() {
                // Best effort: the watch may already be gone if the file was removed.
                let _ = debouncer.watcher().unwatch(path);
            }
        }
        Ok(())
    }
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}
```

### 2.4 `src-tauri/src/watcher_test.rs` [MODIFY] — append two tests

Add `use crate::paths::ExcludeSet;` to the imports and append:

```rust
    #[test]
    fn pinned_file_survives_tab_close() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("config_notes.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.pin_file(&file_path).unwrap();
        state.unwatch_file(&file_path).unwrap();

        assert!(state.watched_paths.lock().unwrap().contains(&file_path));
    }

    #[test]
    fn excludes_are_stored_and_returned() {
        let state = WatcherState::new();
        let (excludes, warnings) =
            ExcludeSet::build_lenient(&["**/archive/**".to_string()], std::path::Path::new("/tmp"));
        assert!(warnings.is_empty());

        state.set_excludes(excludes).unwrap();

        assert!(state
            .excludes()
            .is_excluded(std::path::Path::new("/tmp/archive/x.md")));
        assert!(!state
            .excludes()
            .is_excluded(std::path::Path::new("/tmp/current/x.md")));
    }
```

## Phase 3 — Command surface

### 3.1 `src-tauri/src/commands.rs` [MODIFY] — full replacement

`scan_folder` and `watch_folders` are removed. `load_watches` reads the config,
scans roots, registers pinned files and recursive roots, and returns the inbox
inventory plus diagnostics. `add_watch` does the same for CLI folder
arguments, reusing the excludes already applied by `load_watches`.

```rust
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
            warnings.push(format!("file limit ({MAX_FILES}) reached; remaining file selectors skipped"));
            break;
        }
        if seen.insert(file.clone()) {
            match entry_for(file) {
                Some(entry) => entries.push(entry),
                None => warnings.push(format!("{} vanished before it could be listed", file.display())),
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
                    warnings.push(format!("scan of {} truncated at the {MAX_FILES} file limit", root.display()));
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
        config_path,
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
                    warnings.push(format!("scan of {} truncated at the {MAX_FILES} file limit", path.display()));
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

    WatchAdded { roots, entries, warnings }
}
```

### 3.2 `src-tauri/src/lib.rs` [MODIFY] — command registration

```rust
.invoke_handler(tauri::generate_handler![
    commands::load_file,
    commands::close_file,
    commands::load_watches,
    commands::add_watch,
    startup_paths
])
```

The single-instance forwarding callback is unchanged: it still emits
`open-path-cli` with `{path, is_dir}` and the frontend routes folders to
`add_watch` and files to `openDocument`.

## Phase 4 — Frontend helpers: paths, time, inbox model

All three modules are DOM-free and unit-tested with vitest.

### 4.1 `src/project.ts` [NEW FILE]

```ts
/**
 * Path helpers shared by the inbox panel and the watcher integration.
 *
 * The backend canonicalizes paths, so these compare plain absolute strings;
 * component-awareness (not `startsWith`) keeps `/ab` from being treated as
 * under `/a`.
 */

export function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : "";
  return path.slice(0, index);
}

export function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix);
}

export function isUnderAny(path: string, roots: Iterable<string>): boolean {
  for (const root of roots) {
    if (isUnder(path, root)) return true;
  }
  return false;
}

/**
 * The project a path belongs to: the component directly above the deepest
 * `_ai` segment, or null when no `_ai` exists.
 *
 * `~/devel/docdeck/_ai/backlog/plan.md` → `docdeck`. The fallback of using a
 * watch-root basename is deliberately absent: labels such as `devel` or
 * `reports` would be misleading.
 */
export function projectName(path: string): string | null {
  const parts = path.split("/");
  let deepest = -1;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "_ai") deepest = index;
  }
  if (deepest <= 0) return null;
  return parts[deepest - 1] || null;
}

/** Shortens a path for display, keeping the tail segments. */
export function compactPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;

  const parts = path.split("/");
  const tail: string[] = [];
  let length = 0;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    const addition = tail.length === 0 ? part.length : part.length + 1;
    if (length + addition > maxLength - 2) break;
    tail.unshift(part);
    length += addition;
  }

  if (tail.length === 0 || tail.length === parts.length) return path;
  return `…/${tail.join("/")}`;
}
```

### 4.2 `src/project.test.ts` [NEW FILE]

```ts
import { describe, expect, it } from "vitest";

import {
  compactPath,
  fileName,
  isUnder,
  isUnderAny,
  parentPath,
  projectName,
} from "./project";

describe("path helpers", () => {
  it("splits file names and parents", () => {
    expect(fileName("/home/u/devel/plan.md")).toBe("plan.md");
    expect(fileName("plan.md")).toBe("plan.md");
    expect(parentPath("/home/u/devel/plan.md")).toBe("/home/u/devel");
    expect(parentPath("/plan.md")).toBe("/");
    expect(parentPath("plan.md")).toBe("");
  });

  it("compares whole components", () => {
    expect(isUnder("/a/b.md", "/a")).toBe(true);
    expect(isUnder("/a", "/a")).toBe(true);
    expect(isUnder("/ab/b.md", "/a")).toBe(false);
    expect(isUnderAny("/a/b.md", ["/x", "/a"])).toBe(true);
    expect(isUnderAny("/a/b.md", ["/ab", "/b"])).toBe(false);
  });

  it("finds a project chip only when an _ai segment exists", () => {
    expect(projectName("/home/u/devel/docdeck/_ai/backlog/plan.md")).toBe("docdeck");
    expect(projectName("/home/u/devel/x/_ai/notes/_ai/z.md")).toBe("notes");
    expect(projectName("/home/u/notes/plan.md")).toBeNull();
    expect(projectName("_ai/plan.md")).toBeNull();
  });

  it("compacts long paths from the middle", () => {
    const long = "/home/user/devel/project/_ai/backlog/deep/file.md";
    const compacted = compactPath(long, 24);
    expect(compacted).toBe("…/backlog/deep/file.md");
    expect(compactPath("/tmp/a.md", 48)).toBe("/tmp/a.md");
  });
});
```

### 4.3 `src/relative-time.ts` [NEW FILE]

```ts
/**
 * Short deterministic relative times ("4m ago").
 *
 * Custom rather than `Intl.RelativeTimeFormat` so tests do not depend on ICU
 * data or a locale, and so the wording stays stable across platforms.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(modifiedTime: number, now: number): string {
  const elapsed = Math.max(0, now - modifiedTime);

  if (elapsed < 10 * SECOND) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Exact timestamp for the row tooltip. */
export function formatExactTime(modifiedTime: number): string {
  return new Date(modifiedTime).toLocaleString();
}
```

### 4.4 `src/relative-time.test.ts` [NEW FILE]

```ts
import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const NOW = 1_800_000_000_000;

describe("formatRelativeTime", () => {
  it("uses just now for the last ten seconds", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("just now");
  });

  it("clamps future timestamps", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("just now");
  });

  it("renders every unit boundary", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("30s ago");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(formatRelativeTime(NOW - 10 * 86_400_000, NOW)).toBe("1w ago");
    expect(formatRelativeTime(NOW - 60 * 86_400_000, NOW)).toBe("2mo ago");
    expect(formatRelativeTime(NOW - 400 * 86_400_000, NOW)).toBe("1y ago");
  });
});
```

### 4.5 `src/inbox-model.ts` [NEW FILE]

```ts
/**
 * Session-scoped inbox state.
 *
 * Pure and DOM-free: `main.ts` owns the transitions, the panel renders it, and
 * tests read it directly. One row per canonical path.
 */

export interface InboxEntry {
  path: string;
  filename: string;
  modifiedTime: number;
  /** Changed since docdeck started and not looked at. */
  unread: boolean;
  /** Deleted on disk; kept visible until it reappears or the session ends. */
  deleted: boolean;
}

export interface InboxSeed {
  path: string;
  filename: string;
  modifiedTime: number;
}

export class InboxModel {
  private readonly entries = new Map<string, InboxEntry>();

  /** Inventory (startup or a session folder): unseen rows stay plain. */
  merge(seeds: Iterable<InboxSeed>): boolean {
    let changed = false;
    for (const seed of seeds) {
      const existing = this.entries.get(seed.path);
      if (!existing) {
        this.entries.set(seed.path, { ...seed, unread: false, deleted: false });
        changed = true;
        continue;
      }
      if (
        existing.filename !== seed.filename ||
        existing.modifiedTime !== seed.modifiedTime ||
        existing.deleted
      ) {
        existing.filename = seed.filename;
        existing.modifiedTime = seed.modifiedTime;
        existing.deleted = false;
        changed = true;
      }
    }
    return changed;
  }

  /** Replaces the whole inventory and clears all session unread state. */
  replace(seeds: Iterable<InboxSeed>): void {
    this.entries.clear();
    this.merge(seeds);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): InboxEntry | undefined {
    return this.entries.get(path);
  }

  /**
   * A settled create/write. `markUnread` is false for the active document,
   * whose change is already on screen.
   */
  upsert(seed: InboxSeed, markUnread = true): boolean {
    const existing = this.entries.get(seed.path);
    if (!existing) {
      this.entries.set(seed.path, { ...seed, unread: markUnread, deleted: false });
      return true;
    }

    const changed =
      existing.filename !== seed.filename ||
      existing.modifiedTime !== seed.modifiedTime ||
      existing.deleted ||
      (markUnread && !existing.unread);
    if (!changed) return false;

    existing.filename = seed.filename;
    existing.modifiedTime = seed.modifiedTime;
    existing.deleted = false;
    if (markUnread) existing.unread = true;
    return true;
  }

  markRead(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry || !entry.unread) return false;
    entry.unread = false;
    return true;
  }

  markDeleted(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry || entry.deleted) return false;
    entry.deleted = true;
    return true;
  }

  /** Newest first; ties broken by path so the order is total and stable. */
  entriesSorted(): InboxEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => b.modifiedTime - a.modifiedTime || a.path.localeCompare(b.path),
    );
  }

  unreadCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.unread) count += 1;
    }
    return count;
  }

  size(): number {
    return this.entries.size;
  }
}
```

### 4.6 `src/inbox-model.test.ts` [NEW FILE]

```ts
import { describe, expect, it } from "vitest";

import { InboxModel, type InboxSeed } from "./inbox-model";

function seed(path: string, modifiedTime: number): InboxSeed {
  return { path, filename: path.split("/").pop() ?? path, modifiedTime };
}

describe("InboxModel", () => {
  it("starts every seeded row plain", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.get("/a/plan.md")).toMatchObject({ unread: false, deleted: false });
    expect(inbox.unreadCount()).toBe(0);
  });

  it("marks settled writes unread and reports changes", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.upsert(seed("/a/plan.md", 2_000))).toBe(true);
    expect(inbox.get("/a/plan.md")?.unread).toBe(true);
    expect(inbox.unreadCount()).toBe(1);

    // A duplicate event for the same state is not a change.
    expect(inbox.upsert(seed("/a/plan.md", 2_000))).toBe(false);
  });

  it("adds unseen files as unread", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/new.md", 1_000));

    expect(inbox.get("/a/new.md")).toMatchObject({ unread: true, deleted: false });
  });

  it("can update the active document without marking it unread", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    inbox.upsert(seed("/a/plan.md", 2_000), false);

    expect(inbox.get("/a/plan.md")).toMatchObject({ unread: false, modifiedTime: 2_000 });
  });

  it("clears unread on read and on markDeleted keeps the row", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    expect(inbox.markRead("/a/plan.md")).toBe(true);
    expect(inbox.unreadCount()).toBe(0);

    expect(inbox.markDeleted("/a/plan.md")).toBe(true);
    expect(inbox.get("/a/plan.md")?.deleted).toBe(true);
    expect(inbox.markDeleted("/a/plan.md")).toBe(false);
  });

  it("revives a deleted row on the next write", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));
    inbox.markDeleted("/a/plan.md");

    inbox.upsert(seed("/a/plan.md", 2_000));

    expect(inbox.get("/a/plan.md")).toMatchObject({ deleted: false, unread: true });
  });

  it("sorts newest first with path as the tie-breaker", () => {
    const inbox = new InboxModel();
    inbox.replace([
      seed("/a/old.md", 1_000),
      seed("/a/b.md", 2_000),
      seed("/a/a.md", 2_000),
    ]);

    expect(inbox.entriesSorted().map((entry) => entry.filename)).toEqual([
      "a.md",
      "b.md",
      "old.md",
    ]);
  });

  it("merge leaves existing unread state intact", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    inbox.merge([seed("/a/plan.md", 1_000), seed("/b/new.md", 2_000)]);

    expect(inbox.get("/a/plan.md")?.unread).toBe(true);
    expect(inbox.get("/b/new.md")?.unread).toBe(false);
  });

  it("replace clears previous unread state", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.unreadCount()).toBe(0);
    expect(inbox.size()).toBe(1);
  });
});
```

## Phase 5 — Inbox panel and application shell

### 5.1 `src/inbox-panel.ts` [NEW FILE]

Renders the whole panel — rows plus the config/scan diagnostics — from plain
data. The clock is injectable so relative times are deterministic in tests.

```ts
import type { InboxEntry } from "./inbox-model";
import { compactPath, parentPath, projectName } from "./project";
import { formatExactTime, formatRelativeTime } from "./relative-time";

/** Everything the panel needs to explain the current watch state. */
export interface InboxStatus {
  configPath: string;
  configFound: boolean;
  error: string | null;
  warnings: string[];
  truncated: boolean;
  loading: boolean;
}

export interface InboxPanelOptions {
  onOpen(path: string): void;
  /** Injectable clock so relative times are deterministic in tests. */
  now?: () => number;
}

export class InboxPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly options: InboxPanelOptions,
  ) {}

  render(
    entries: InboxEntry[],
    status: InboxStatus,
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): void {
    const scrollTop = this.root.scrollTop;
    const fragment = document.createDocumentFragment();
    fragment.append(this.renderHeader(entries));

    if (status.loading) {
      fragment.append(this.message("Scanning watched paths…", "inbox-loading"));
    } else {
      if (status.error) {
        fragment.append(this.message(`Config error: ${status.error}`, "inbox-error"));
      } else if (!status.configFound) {
        fragment.append(this.setupHint(status.configPath));
      }

      if (status.warnings.length > 0) {
        fragment.append(this.warningList(status.warnings));
      }
      if (status.truncated) {
        fragment.append(
          this.message(
            "Some paths were skipped at the configured limits; see the warnings.",
            "inbox-truncated",
          ),
        );
      }

      if (entries.length === 0) {
        fragment.append(this.message("No documents match the configured watches.", "inbox-empty"));
      } else {
        const list = document.createElement("ul");
        list.className = "inbox-list";
        for (const entry of entries) {
          list.append(this.renderRow(entry, openPaths, activePath));
        }
        fragment.append(list);
      }
    }

    this.root.replaceChildren(fragment);
    this.root.scrollTop = scrollTop;
  }

  private renderHeader(entries: InboxEntry[]): HTMLElement {
    const header = document.createElement("div");
    header.className = "inbox-header";

    const title = document.createElement("span");
    title.className = "inbox-title";
    title.textContent = "Inbox";

    const total = `${entries.length} ${entries.length === 1 ? "file" : "files"}`;
    const unread = entries.filter((entry) => entry.unread).length;
    const count = document.createElement("span");
    count.className = "inbox-count";
    count.textContent = unread > 0 ? `${total} · ${unread} new` : total;

    header.append(title, count);
    return header;
  }

  private renderRow(
    entry: InboxEntry,
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): HTMLElement {
    const item = document.createElement("li");
    item.className = "inbox-row";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.dataset.path = entry.path;
    if (entry.unread) item.classList.add("unread");
    if (entry.deleted) item.classList.add("deleted");
    if (openPaths.has(entry.path)) item.classList.add("open");
    if (entry.path === activePath) item.classList.add("active");

    const open = (): void => this.options.onOpen(entry.path);
    item.addEventListener("click", open);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    const top = document.createElement("div");
    top.className = "inbox-row-top";

    const project = projectName(entry.path);
    if (project !== null) {
      const chip = document.createElement("span");
      chip.className = "inbox-project";
      chip.textContent = project;
      top.append(chip);
    }

    const name = document.createElement("span");
    name.className = "inbox-filename";
    name.textContent = entry.filename;
    name.title = entry.deleted ? `${entry.path} (deleted on disk)` : entry.path;
    top.append(name);

    const dot = document.createElement("span");
    dot.className = "inbox-dot";
    top.append(dot);

    const bottom = document.createElement("div");
    bottom.className = "inbox-row-bottom";

    const fullParent = parentPath(entry.path);
    const parent = document.createElement("span");
    parent.className = "inbox-parent";
    parent.textContent = compactPath(fullParent);
    parent.title = fullParent;
    bottom.append(parent);

    const now = this.options.now?.() ?? Date.now();
    const time = document.createElement("time");
    time.className = "inbox-time";
    time.dateTime = new Date(entry.modifiedTime).toISOString();
    time.textContent = formatRelativeTime(entry.modifiedTime, now);
    time.title = formatExactTime(entry.modifiedTime);
    bottom.append(time);

    item.append(top, bottom);
    return item;
  }

  private setupHint(configPath: string): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "inbox-hint";

    const message = document.createElement("p");
    message.textContent = `No config found at ${configPath}. Create it to watch files on every launch:`;

    const example = document.createElement("code");
    example.textContent = 'watch = ["~/devel/*/_ai"]\nexclude = ["**/archive/**"]';

    hint.append(message, example);
    return hint;
  }

  private warningList(warnings: string[]): HTMLElement {
    const details = document.createElement("details");
    details.className = "inbox-warnings";

    const summary = document.createElement("summary");
    summary.textContent = `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;

    const list = document.createElement("ul");
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.append(item);
    }

    details.append(summary, list);
    return details;
  }

  private message(text: string, className: string): HTMLElement {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  }
}
```

### 5.2 `src/inbox-panel.test.ts` [NEW FILE]

```ts
import { describe, expect, it, vi } from "vitest";

import type { InboxEntry } from "./inbox-model";
import { InboxPanel, type InboxStatus } from "./inbox-panel";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path: "/home/u/devel/docdeck/_ai/backlog/plan.md",
    filename: "plan.md",
    modifiedTime: NOW - 60_000,
    unread: false,
    deleted: false,
    ...overrides,
  };
}

function status(overrides: Partial<InboxStatus> = {}): InboxStatus {
  return {
    configPath: "/home/u/.config/docdeck/config.toml",
    configFound: true,
    error: null,
    warnings: [],
    truncated: false,
    loading: false,
    ...overrides,
  };
}

function mount(onOpen = vi.fn()): { root: HTMLElement; onOpen: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  const panel = new InboxPanel(root, { onOpen, now: () => NOW });
  panel.render([entry()], status(), new Set(), null);
  return { root, onOpen };
}

function render(
  entries: InboxEntry[],
  panelStatus: InboxStatus,
  openPaths: Set<string> = new Set(),
  activePath: string | null = null,
  onOpen = vi.fn(),
): HTMLElement {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  new InboxPanel(root, { onOpen, now: () => NOW }).render(
    entries,
    panelStatus,
    openPaths,
    activePath,
  );
  return root;
}

describe("InboxPanel", () => {
  it("renders the row anatomy: project chip, filename, parent, relative time", () => {
    const root = mount().root;

    expect(root.querySelector(".inbox-project")?.textContent).toBe("docdeck");
    expect(root.querySelector(".inbox-filename")?.textContent).toBe("plan.md");
    expect(root.querySelector(".inbox-parent")?.textContent).toBe(
      "/home/u/devel/docdeck/_ai/backlog",
    );
    expect(root.querySelector(".inbox-time")?.textContent).toBe("1m ago");
  });

  it("renders rows in the order given and counts unread files", () => {
    const root = render(
      [
        entry({ path: "/a/old.md", filename: "old.md", modifiedTime: NOW - 90_000 }),
        entry({ path: "/a/new.md", filename: "new.md", modifiedTime: NOW - 60_000, unread: true }),
      ],
      status(),
    );

    const names = [...root.querySelectorAll(".inbox-filename")].map((node) => node.textContent);
    expect(names).toEqual(["old.md", "new.md"]);
    expect(root.querySelector(".inbox-count")?.textContent).toBe("2 files · 1 new");
    expect(root.querySelectorAll(".inbox-row.unread").length).toBe(1);
  });

  it("marks open and active rows", () => {
    const path = "/home/u/devel/docdeck/_ai/backlog/plan.md";
    const root = render([entry()], status(), new Set([path]), path);

    expect(root.querySelector(".inbox-row")?.classList.contains("open")).toBe(true);
    expect(root.querySelector(".inbox-row")?.classList.contains("active")).toBe(true);
  });

  it("marks deleted rows", () => {
    const root = render([entry({ deleted: true })], status());
    expect(root.querySelector(".inbox-row")?.classList.contains("deleted")).toBe(true);
  });

  it("opens on click and on Enter", () => {
    const onOpen = vi.fn();
    const root = render([entry()], status(), new Set(), null, onOpen);
    const row = root.querySelector(".inbox-row") as HTMLElement;

    row.click();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith("/home/u/devel/docdeck/_ai/backlog/plan.md");
  });

  it("shows a loading line before the scan resolves", () => {
    const root = render([], status({ loading: true }));
    expect(root.querySelector(".inbox-loading")?.textContent).toContain("Scanning");
  });

  it("shows a config parse error", () => {
    const root = render([], status({ error: "config.toml: expected `=`" }));
    expect(root.querySelector(".inbox-error")?.textContent).toContain("Config error");
  });

  it("shows the setup hint with the config path when the file is missing", () => {
    const root = render([], status({ configFound: false }));
    expect(root.querySelector(".inbox-hint")?.textContent).toContain(
      "/home/u/.config/docdeck/config.toml",
    );
  });

  it("collapses warnings into a details list and flags truncation", () => {
    const root = render(
      [],
      status({ warnings: ["first warning", "second warning"], truncated: true }),
    );

    expect(root.querySelector(".inbox-warnings summary")?.textContent).toBe("2 warnings");
    expect(root.querySelectorAll(".inbox-warnings li").length).toBe(2);
    expect(root.querySelector(".inbox-truncated")).not.toBeNull();
  });

  it("shows an empty message when nothing matches", () => {
    const root = render([], status());
    expect(root.querySelector(".inbox-empty")).not.toBeNull();
  });
});
```

### 5.3 `index.html` [MODIFY]

Add the inbox toggle between Auto-Sort and Outline, add the panel element, and
rewrite the empty state.

```html
      <header id="header-bar">
        <div class="header-controls">
          <button id="toggle-layout-btn" title="Toggle Sidebar/Top Tabs">
            &#8644; Layout
          </button>
          <button id="toggle-autosort-btn" title="Toggle Auto-sort by Last Modified">
            &#9889; Auto-Sort: OFF
          </button>
          <button id="toggle-inbox-btn" title="Toggle File Inbox">
            &#9993; Inbox: ON
          </button>
          <button id="toggle-toc-btn" title="Toggle Table of Contents">
            &#9776; Outline: OFF
          </button>
          <button id="toggle-frontmatter-btn" title="Toggle Document Metadata">
            &#9881; Frontmatter: ON
          </button>
          <button id="toggle-theme-btn" title="Toggle Light/Dark Theme">
            &#9788; Theme: Dark
          </button>
        </div>
      </header>

      <nav id="tabs-bar" class="tabs-container"></nav>
      <aside id="inbox-panel" aria-label="File inbox"></aside>
      <nav id="toc-panel" hidden aria-label="Table of contents"></nav>

      <main id="content-container">
        <div id="empty-state" class="empty-placeholder">
          <p>
            No document loaded. Pick one from the Inbox, watch folders via
            <code>~/.config/docdeck/config.toml</code>, or run
            <code>docdeck &lt;file.md&gt;</code>.
          </p>
        </div>
        <article id="markdown-viewer" class="markdown-body hidden"></article>
      </main>
```

### 5.4 `src/style.css` [MODIFY]

**Change 1 — grid areas, both layouts.** The inbox is a new column in sidebar
layout and a new row-spanning cell in top layout.

```css
.app-layout {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    "header header header header"
    "inbox  tabs   toc    content";
  height: 100vh;
  width: 100vw;
}

.layout-top {
  grid-template-columns: auto auto minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    "header  header header"
    "tabs    tabs   tabs"
    "inbox   toc    content";
}
```

**Change 2 — panel container.** Insert after the `#toc-panel[hidden]` rule:

```css
#inbox-panel {
  grid-area: inbox;
  width: 280px;
  min-width: 0;
  overflow-y: auto;
  padding: 8px 0;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
}

#inbox-panel[hidden] {
  display: none;
}

.layout-top #inbox-panel {
  border-bottom: 1px solid var(--border-color);
}
```

**Change 3 — active-tab flash.** Insert after the `.tab-item.has-update
.tab-dot` rule:

```css
/* A write to the document being read: acknowledge it without pretending it is
   unread. `main.ts` removes the class after 2.5 s; the fade runs once. */
.tab-item.active-update .tab-dot {
  display: inline-block;
  animation: active-flash 2.5s ease-out forwards;
}

@keyframes active-flash {
  0% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(250, 179, 135, 0.7);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: scale(0.8);
    box-shadow: 0 0 0 8px rgba(250, 179, 135, 0);
  }
}
```

**Change 4 — inbox styles.** Insert a new section before the
"Deleted-on-disk documents" section:

```css
/* --------------------------------------------------------------------------
   Inbox panel — session unread list, newest first
   -------------------------------------------------------------------------- */

.inbox-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4px 12px 8px;
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.inbox-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.inbox-row {
  padding: 6px 12px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease-in-out;
}

.inbox-row:hover {
  background-color: var(--bg-elevated);
}

.inbox-row.open {
  border-left-color: var(--border-color);
}

.inbox-row.active {
  border-left-color: var(--accent-color);
  background-color: var(--bg-elevated);
}

.inbox-row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.inbox-project {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 3px;
  background-color: var(--bg-elevated);
  color: var(--accent-color);
  font-size: 10px;
}

.inbox-filename {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inbox-row.unread .inbox-filename {
  font-weight: 700;
}

.inbox-dot {
  display: none;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--dot-color);
}

.inbox-row.unread .inbox-dot {
  display: inline-block;
}

.inbox-row-bottom {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
}

.inbox-parent {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inbox-time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}

.inbox-row.deleted .inbox-filename,
.inbox-row.deleted .inbox-parent {
  text-decoration: line-through;
  opacity: 0.6;
}

.inbox-row.deleted .inbox-dot {
  display: none;
}

.inbox-hint,
.inbox-error,
.inbox-empty,
.inbox-loading,
.inbox-truncated,
.inbox-warnings {
  padding: 8px 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.inbox-error {
  color: var(--danger-color);
}

.inbox-hint code {
  display: block;
  margin-top: 6px;
  padding: 6px;
  border-radius: 4px;
  background-color: var(--bg-elevated);
  white-space: pre;
  overflow-x: auto;
}

.inbox-warnings summary {
  cursor: pointer;
}

.inbox-warnings ul {
  margin: 6px 0 0;
  padding-left: 16px;
}
```

**Change 5 — delete the folder picker styles.** Remove the entire
`/* Folder picker modal */` banner section, starting at
`.folder-modal-overlay` and ending with `.folder-modal-confirm:hover`,
including `.folder-root`, `.folder-tree`, `.folder-dir`, `.folder-file` and
`.folder-error` rules. Nothing else references those class names after
Phase 6.

## Phase 6 — Main integration and picker removal

### 6.1 `src/preferences.ts` [MODIFY] and `src/preferences.test.ts` [MODIFY]

Add `inboxVisible` to the interface, the frozen defaults and the per-field
decoder; old stored objects stay valid and get `true`.

```ts
export interface Preferences {
  themeMode: ThemeMode;
  tocVisible: boolean;
  frontmatterVisible: boolean;
  inboxVisible: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  themeMode: "dark",
  tocVisible: false,
  frontmatterVisible: true,
  inboxVisible: true,
});
```

Decoder addition:

```ts
    inboxVisible:
      typeof record.inboxVisible === "boolean"
        ? record.inboxVisible
        : DEFAULT_PREFERENCES.inboxVisible,
```

`preferences.test.ts`: add `inboxVisible` to the round-trip fixture and its
expectation, and add one test for a legacy payload without the field:

```ts
  it("defaults inboxVisible to true for stored objects from before the field", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "dark",
        tocVisible: false,
        frontmatterVisible: true,
      }),
    );
    expect(loadPreferences().inboxVisible).toBe(true);
  });
```

### 6.2 `src/main.ts` [MODIFY] — integration patches

Apply these patches in order; the file keeps its overall structure
(`AppState`, rendering helpers, bootstrap).

**6.2.1 Imports.**

```ts
import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import { InboxModel, type InboxSeed } from "./inbox-model";
import { InboxPanel, type InboxStatus } from "./inbox-panel";
import {
  applyMermaidTheme,
  isTailing,
  marked,
  renderMarkdown,
} from "./markdown";
import { MetadataView } from "./metadata-jump";
import {
  createPreferenceWriter,
  loadPreferences,
  type Preferences,
  type ThemeMode,
} from "./preferences";
import { fileName, isUnderAny } from "./project";
import { createToggleButton } from "./toolbar";
import { extractHeadings } from "./toc";
import { TocPanel } from "./toc-panel";
import { ThemeController } from "./theme";
```

**6.2.2 Payload types.** Replace the `PathChange` + `FolderScan` block:

```ts
/** A settled filesystem change for one path. */
interface PathChange {
  path: string;
  exists: boolean;
  modifiedTime?: number;
}

/** One inbox row as returned by `load_watches` / `add_watch`. */
interface InboxEntryPayload {
  path: string;
  filename: string;
  modifiedTime: number;
}

/** The startup config result. `error` means no watches were registered. */
interface WatchLoad {
  configPath: string;
  configFound: boolean;
  roots: string[];
  entries: InboxEntryPayload[];
  warnings: string[];
  error: string | null;
  truncated: boolean;
}

/** The result of adding session watches for CLI folders. */
interface WatchAdded {
  roots: string[];
  entries: InboxEntryPayload[];
  warnings: string[];
}

function toSeed(entry: InboxEntryPayload): InboxSeed {
  return {
    path: entry.path,
    filename: entry.filename,
    modifiedTime: entry.modifiedTime,
  };
}
```

**6.2.3 Fields.** Replace the `pendingRoots` + `folderModal` pair:

```ts
  /** Roots registered from the config or a CLI folder for this session. */
  private readonly watchRoots = new Set<string>();
  private readonly inbox = new InboxModel();
  private inboxStatus: InboxStatus = {
    configPath: "",
    configFound: true,
    error: null,
    warnings: [],
    truncated: false,
    loading: true,
  };
  /** The tab currently playing the brief active-write pulse, if any. */
  private activeUpdatePath: string | null = null;
  private activeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly inboxPanelEl = must<HTMLElement>("inbox-panel");
  private readonly inboxPanel: InboxPanel;
```

**6.2.4 Constructor.** Replace the `FolderModal` construction:

```ts
    this.inboxPanel = new InboxPanel(this.inboxPanelEl, {
      onOpen: (path) => {
        if (this.tabs.has(path)) this.setActiveTab(path);
        else void this.openDocument(path);
      },
    });
```

and append `this.renderInbox();` after `this.theme.apply(...)`, before
`void this.start();`.

**6.2.5 `applyPreferencesToUi`.**

```ts
  private applyPreferencesToUi(): void {
    this.tocPanelEl.hidden = !this.preferences.tocVisible;
    this.inboxPanelEl.hidden = !this.preferences.inboxVisible;
  }
```

**6.2.6 Inbox toggle.** Add next to the other `createToggleButton` calls in
`bindControls`:

```ts
    createToggleButton({
      element: must<HTMLButtonElement>("toggle-inbox-btn"),
      icon: "✉",
      label: "Inbox",
      tooltip: "Toggle File Inbox",
      initialState: this.preferences.inboxVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.inboxVisible = next;
        this.inboxPanelEl.hidden = !next;
        this.persist();
      },
    });
```

**6.2.7 Startup order.** Replace `loadStartupPaths`:

```ts
  private async loadStartupPaths(): Promise<void> {
    try {
      const entries = await invoke<CliEntry[]>("startup_paths");
      const folders = entries.filter((entry) => entry.is_dir).map((entry) => entry.path);

      // Config first: its excludes must be installed before a session folder
      // is scanned, or the two sources would disagree about what is noise.
      await this.loadWatchConfig();
      if (folders.length > 0) await this.addWatch(folders);

      for (const entry of entries) {
        if (!entry.is_dir) await this.openDocument(entry.path);
      }
    } catch (error) {
      console.error("Failed to read startup paths", error);
    }
  }
```

**6.2.8 Backend listeners.** Replace the `open-path-cli` handler:

```ts
      // A second `docdeck <path>` in another shell. Folders join the session
      // watch registry; files open a tab.
      await listen<CliEntry>("open-path-cli", (event) => {
        if (event.payload.is_dir) void this.addWatch([event.payload.path]);
        else void this.openDocument(event.payload.path);
      });
```

**6.2.9 Watch registry and inbox section.** Replace the whole
`// -- folder watching ---` section (`showFolderModal` and `confirmFolders`)
with:

```ts
  // -- watch registry and inbox ---------------------------------------------

  /** Loads the global config and turns it into watches plus inbox rows. */
  private async loadWatchConfig(): Promise<void> {
    this.renderInbox();
    try {
      const result = await invoke<WatchLoad>("load_watches");
      for (const root of result.roots) this.watchRoots.add(root);
      this.inbox.replace(result.entries.map(toSeed));
      this.inboxStatus = {
        configPath: result.configPath,
        configFound: result.configFound,
        error: result.error,
        warnings: result.warnings,
        truncated: result.truncated,
        loading: false,
      };
    } catch (error) {
      console.error("Failed to load watch config", error);
      this.inboxStatus = {
        configPath: "",
        configFound: false,
        error: String(error),
        warnings: [],
        truncated: false,
        loading: false,
      };
    }
    this.renderInbox();
  }

  /** Registers session watches for CLI folder arguments. */
  private async addWatch(paths: string[]): Promise<void> {
    try {
      const result = await invoke<WatchAdded>("add_watch", { paths });
      for (const root of result.roots) this.watchRoots.add(root);
      this.inbox.merge(result.entries.map(toSeed));
      this.inboxStatus.warnings = [...this.inboxStatus.warnings, ...result.warnings];
    } catch (error) {
      console.error("Failed to add watch", error);
      this.inboxStatus.warnings = [
        ...this.inboxStatus.warnings,
        `Could not watch folder: ${String(error)}`,
      ];
    }
    this.renderInbox();
  }

  private renderInbox(): void {
    this.inboxPanel.render(
      this.inbox.entriesSorted(),
      this.inboxStatus,
      new Set(this.tabs.keys()),
      this.activePath,
    );
  }
```

**6.2.10 `openDocument` loses its background mode.** Replace the method:

```ts
  public async openDocument(rawPath: string): Promise<void> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      const existing = this.tabs.get(data.path);
      if (existing) {
        existing.filename = data.filename;
        existing.content = data.content;
        existing.modifiedTime = data.modified_time;
        existing.deletedOnDisk = false;
      } else {
        this.tabs.set(data.path, {
          path: data.path,
          filename: data.filename,
          content: data.content,
          modifiedTime: data.modified_time,
          hasUnreadUpdate: false,
          deletedOnDisk: false,
        });
      }

      this.setActiveTab(data.path);
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      // A row can lose the race against a delete; that is routine, not an
      // error worth interrupting the reader for.
      this.showMessage(`Could not open ${rawPath}`);
    }
  }
```

**6.2.11 `applyPathChange`.** Replace the method:

```ts
  /**
   * Handles one settled watcher event.
   *
   * Deleted files keep their tab (content included) and get a marker; their
   * inbox row is struck through until the file reappears. Existing files
   * reload their tab when one is open and update the inbox row. Nothing is
   * ever opened automatically: the inbox is the triage surface.
   */
  private async applyPathChange(change: PathChange): Promise<void> {
    const tab = this.tabs.get(change.path);
    const isActive = this.activePath === change.path;
    const tracked =
      this.inbox.has(change.path) || isUnderAny(change.path, this.watchRoots);

    if (!change.exists) {
      if (tab && !tab.deletedOnDisk) {
        tab.deletedOnDisk = true;
        this.renderTabs();
        if (isActive) await this.renderActiveContent();
      }
      if (tracked && this.inbox.markDeleted(change.path)) this.renderInbox();
      return;
    }

    if (tracked) {
      const seed: InboxSeed = {
        path: change.path,
        filename: fileName(change.path),
        modifiedTime: change.modifiedTime ?? Date.now(),
      };
      // The active document is on screen already: update its mtime and order
      // without pretending the reader missed something.
      this.inbox.upsert(seed, !isActive);
      this.renderInbox();
    }

    if (tab) await this.reloadDocument(change.path);
  }
```

**6.2.12 `reloadDocument` and `flashActiveTab`.** Replace the unread-marking
block inside `reloadDocument`:

```ts
      if (this.activePath === path) {
        // Reading this tab: paint it straight away and acknowledge with the
        // brief pulse instead of the unread dot.
        tab.hasUnreadUpdate = false;
        this.flashActiveTab(path);
      } else {
        tab.hasUnreadUpdate = true;
      }

      this.renderTabs();
      if (this.activePath === path) {
        await this.renderActiveContent();
      }
```

and add below `reloadDocument`:

```ts
  /** Pulses a tab's dot once for an active-document write, then clears it. */
  private flashActiveTab(path: string): void {
    if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
    this.activeUpdatePath = path;
    this.renderTabs();
    this.activeUpdateTimer = setTimeout(() => {
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
      this.renderTabs();
    }, 2500);
  }
```

**6.2.13 `setActiveTab`.** Replace the method:

```ts
  public setActiveTab(path: string): void {
    this.activePath = path;
    const tab = this.tabs.get(path);
    if (tab) tab.hasUnreadUpdate = false;

    if (this.activeUpdatePath !== null && this.activeUpdatePath !== path) {
      if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
    }

    this.inbox.markRead(path);

    this.renderTabs();
    this.renderInbox();
    void this.renderActiveContent();
  }
```

**6.2.14 `closeTabPath`.** Extend the tail, after `this.reloadTokens.delete(path);`:

```ts
    if (this.activeUpdatePath === path && this.activeUpdateTimer !== null) {
      clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
    }
```

and after `this.renderTabs();` add `this.renderInbox();` before
`await this.renderActiveContent();`. Closing a tab never changes inbox unread
state — the row stays bold if it was bold.

**6.2.15 `renderTabs`.** Add the pulse class:

```ts
      if (tab.path === this.activePath) item.classList.add("active");
      if (tab.hasUnreadUpdate) item.classList.add("has-update");
      if (tab.path === this.activeUpdatePath) item.classList.add("active-update");
      if (tab.deletedOnDisk) item.classList.add("deleted");
```

### 6.3 Picker removal

- **Delete** `src/folder-modal.ts` and `src/folder-modal.test.ts`.
- **Delete** `src/file-tree.ts` and `src/file-tree.test.ts`.
- **Verify** no references remain:
  `rg -n "folder-modal|FolderModal|file-tree|FileTree|scan_folder|watch_folders|FolderScan|pendingRoots" src src-tauri/src`
  must return nothing.
- `src/style.css` picker rules were already removed in Phase 5.4.

## Phase 7 — Simulation, documentation, housekeeping

### 7.1 `scripts/simulate_folder_watch.sh` [MODIFY] — full replacement

Drives the real app through a config file (`DOCDECK_CONFIG` points at a
throwaway location), session-folder addition, agent writes, deletes,
recreates, and ignored paths.

```bash
#!/usr/bin/env bash
#
# End-to-end smoke test for docdeck's config-driven watches and inbox.
#
# Creates a throwaway workspace and config, launches docdeck with
# DOCDECK_CONFIG pointing at it, then simulates an agent writing, deleting and
# recreating documents.
#
# Usage:
#   ./scripts/simulate_folder_watch.sh [path-to-docdeck-binary]
#
# With no argument the script prefers a release build, then a debug build, and
# finally falls back to `npm run tauri dev`.

set -euo pipefail

WORKSPACE="/tmp/docdeck_watch_sim"
CONFIG_DIR="/tmp/docdeck_watch_sim_config"
STEPS="${STEPS:-4}"
STEP_DELAY="${STEP_DELAY:-1}"

cd "$(dirname "$0")/.."

resolve_binary() {
  if [[ $# -ge 1 && -x "$1" ]]; then
    printf '%s' "$1"
    return
  fi
  for candidate in \
    src-tauri/target/release/docdeck \
    src-tauri/target/debug/docdeck; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  printf ''
}

BINARY="$(resolve_binary "${1:-}")"

rm -rf "$WORKSPACE" "$CONFIG_DIR"
mkdir -p \
  "$WORKSPACE/projects/alpha/_ai/backlog" \
  "$WORKSPACE/projects/alpha/_ai/archive" \
  "$WORKSPACE/projects/alpha/node_modules" \
  "$WORKSPACE/projects/beta/_ai/backlog" \
  "$CONFIG_DIR/docdeck"
printf '# Alpha plan\n\n- [ ] Step pending\n' \
  > "$WORKSPACE/projects/alpha/_ai/backlog/plan.md"
printf '# Beta notes\n' \
  > "$WORKSPACE/projects/beta/_ai/backlog/notes.md"
printf 'must never appear\n' \
  > "$WORKSPACE/projects/alpha/node_modules/skip.md"
printf 'must never appear\n' \
  > "$WORKSPACE/projects/alpha/_ai/archive/old.md"

cat > "$CONFIG_DIR/docdeck/config.toml" <<'TOML'
watch = ["/tmp/docdeck_watch_sim/projects/*/_ai"]
exclude = ["**/archive/**"]
TOML

APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE" "$CONFIG_DIR"
}
trap cleanup EXIT

if [[ -n "$BINARY" ]]; then
  printf 'Launching docdeck (%s) with %s...\n' "$BINARY" "$CONFIG_DIR/docdeck/config.toml"
  DOCDECK_CONFIG="$CONFIG_DIR/docdeck/config.toml" "$BINARY" &
  APP_PID=$!
else
  printf 'No prebuilt binary found — falling back to `npm run tauri dev`.\n'
  DOCDECK_CONFIG="$CONFIG_DIR/docdeck/config.toml" npm run tauri dev &
  APP_PID=$!
fi

sleep 5
printf 'Simulating an agent writing under %s (%s steps)...\n' "$WORKSPACE" "$STEPS"

for i in $(seq 1 "$STEPS"); do
  sleep "$STEP_DELAY"
  printf -- '- [x] Step %s executed at %s\n' "$i" "$(date +%T)" \
    >> "$WORKSPACE/projects/alpha/_ai/backlog/plan.md"
  printf '# Report %s\n\nGenerated at %s\n' "$i" "$(date +%T)" \
    > "$WORKSPACE/projects/beta/_ai/backlog/report_$i.md"
  printf '  step %s/%s: edited alpha plan.md, created beta report_%s.md\n' \
    "$i" "$STEPS" "$i"
done

# Deleted row, then recreate: both transitions must be visible in the inbox.
rm "$WORKSPACE/projects/beta/_ai/backlog/report_1.md"
sleep "$STEP_DELAY"
printf '# Report 1\n\nRecreated at %s\n' "$(date +%T)" \
  > "$WORKSPACE/projects/beta/_ai/backlog/report_1.md"

# Excluded and noise paths: write them and confirm they never show up.
printf 'ignored\n' > "$WORKSPACE/projects/alpha/_ai/archive/old.md"
printf 'ignored\n' > "$WORKSPACE/projects/alpha/node_modules/skip.md"

cat <<'EOF'

Verification checklist:
  1. At launch the inbox lists beta notes.md and alpha plan.md, newest first,
     with the project chips `alpha` and `beta`; nothing is bold.
  2. Editing plan.md moves its row to the top and the active tab pulses its
     dot briefly; the row never goes bold.
  3. Each new report_<n>.md appears bold at the top WITHOUT opening a tab.
  4. Clicking a bold row opens that document and clears its bold.
  5. Editing a document that is open but not active makes its row and tab bold.
  6. Closing an unread tab leaves the row bold.
  7. Deleting report_1.md strikes its row through; recreating it clears the
     strike and makes it bold again without opening a tab.
  8. `archive/old.md` and `node_modules/skip.md` never appear, at launch or
     after being written.
  9. In a second terminal,
     `DOCDECK_CONFIG=/tmp/docdeck_watch_sim_config/docdeck/config.toml \
      docdeck /tmp/docdeck_watch_sim/projects/alpha`
     adds the session root and lists its files in the same inbox.
 10. Toggling Inbox off hides the panel; restarting docdeck restores the
     toggle state and clears every bold mark.
 11. Renaming the config away and restarting shows the setup hint with the
     exact path; putting a broken TOML there shows the parse error instead.
EOF

printf 'Press Ctrl+C to stop docdeck.\n'
wait "$APP_PID"
```

### 7.2 `README.md` [MODIFY]

Replace the first two feature bullets and the folder-picker usage section.

Features section:

```md
- **Config-driven watch registry** — `~/.config/docdeck/config.toml` lists
  folders and files with wildcards (`~/devel/*/_ai`, `~/notes/**/*.md`).
  Matching folders become recursive Markdown watches; matching files are watched
  whatever their extension. Hidden entries, symlinks and build directories are
  skipped; `exclude` patterns refine the set.
- **File inbox** — every matched document in one list, newest first, with a
  project chip, compacted parent path and relative time. Files changed since
  docdeck started are bold until opened; deleted files keep a struck-through
  row until they reappear. New files appear bold without stealing a tab.
- **Unread tab indicator** — a background tab touched by an agent keeps its
  amber pulsing dot until activated; writing to the active tab pulses the dot
  briefly and fades.
```

Usage: replace the `docdeck ./_ai` picker paragraphs with a "Watching folders
on every launch" section:

````md
## Watching folders on every launch

Create `~/.config/docdeck/config.toml` (`$DOCDECK_CONFIG` overrides the path):

```toml
watch = [
  "~/devel/*/_ai",        # every project's agent workspace
  "~/notes/**/*.md",      # every Markdown file under notes
  "~/journal/today.txt",  # an explicit file, any extension
]
exclude = [
  "**/archive/**",
  "**/templates/**",
]
```

- `~` expands to your home directory; `*` matches one path segment; `**`
  matches any depth. Relative paths resolve against your home directory.
- A matched directory contributes its recursive `*.md` tree; a matched file is
  watched explicitly.
- Hidden entries, symlinks and `node_modules`, `target`, `dist`, `build`,
  `.venv`, `venv` are always skipped. `exclude` globs apply on top.
- The config is read once at startup; restart docdeck after editing it.
- Expansion is capped at 256 watched roots and 10,000 files; the inbox names
  any selector that was truncated.

The **Inbox** panel lists every matched file newest-first. Bold filenames with
an amber dot changed since docdeck started; opening the row or activating its
tab clears the mark. New files appear bold without opening a tab; deleted files
keep a struck-through row with their last modification time until they
reappear or the app restarts. Unread is session-scoped: a restart clears all
bold, and closing an unread tab does not.

Running `docdeck <folder>` adds that folder as a **session watch** alongside
the config and lists its files in the same inbox; `docdeck <file>` opens a tab.
Nothing is opened automatically when a file changes — the inbox is the triage
surface.
````

Controls table additions/changes:

```md
| `✉ Inbox` | Show or hide the file inbox |
```

and the paragraph after the table: clicking a row opens the document (like
clicking its tab).

Preferences paragraph:

```md
Theme, outline, frontmatter and inbox visibility are stored under the
`docdeck.preferences.v1` key in `localStorage`, so docdeck reopens the way you
left it. Clear that key to reset to defaults (dark theme, outline hidden,
frontmatter shown, inbox shown).
```

### 7.3 `CHANGELOG.md` [MODIFY]

Add under `## [Unreleased]`:

```md
### Added
- Config-driven watch registry: `~/.config/docdeck/config.toml` (XDG-aware,
  `$DOCDECK_CONFIG` overrides) with `watch` and `exclude` arrays. Selectors
  support `~`, `*` (one segment) and `**` (any depth); matched directories
  contribute recursive `*.md` trees and matched files are watched whatever
  their extension. Hidden entries, symlinks, `node_modules`, `target`, `dist`,
  `build`, `.venv` and `venv` are always skipped; expansion is capped at 256
  roots and 10,000 files with visible warnings.
- Thunderbird-style **Inbox** panel: collapsible left panel (header toggle,
  visible by default, persisted as `inboxVisible`) listing every matched file
  newest-first with a project chip for `_ai` paths, compacted parent path and
  relative time. Session-scoped unread: files changed since startup are bold
  with an amber dot until opened or activated; new files appear bold without
  opening a tab; deleted files keep a struck-through row until they reappear.
  Writes to the active document pulse the tab dot briefly without going bold.
- `load_watches` and `add_watch` commands; watcher events now carry
  `modifiedTime`, and the watcher applies exclude patterns to every event.
  CLI folder arguments add session watches that feed the inbox.

### Changed
- CLI folder arguments no longer open a picker or auto-open tabs: a folder adds
  a session watch and its files appear in the inbox; a file argument opens a
  tab. New and modified files are never opened automatically.

### Removed
- Folder picker modal and file tree (`folder-modal`, `file-tree`), the
  `scan_folder` and `watch_folders` commands, and their CSS.
```

### 7.4 `.gitignore`

No new artifact class is introduced: the config lives under XDG and the
simulation writes to `/tmp`. Verify with `git status --porcelain` during the
regression pass; only intended files should appear.

### 7.5 Full regression pass

```bash
npm run typecheck
npm run lint:rs
npm run test            # cargo test + vitest run
npm run check           # typecheck + tests + tauri build --no-bundle
./scripts/simulate_folder_watch.sh
```

Then walk the simulation checklist (7.1) against the running app, including:
nothing bold at launch, active-write pulse, new-file bold without tab,
deleted-row strikethrough, excluded/noise invisibility, session folder
addition, toggle persistence and the missing/broken config hints.

### 7.6 Implementation report and plan archival

Write `_ai/backlog/reports/261019_2010__IMPLEMENTATION_REPORT__config-driven-watches-and-inbox.md`:

```md
---
filename: "_ai/backlog/reports/261019_2010__IMPLEMENTATION_REPORT__config-driven-watches-and-inbox.md"
title: "Report: Config-driven watches and the Thunderbird-style file inbox"
createdAt: 2026-10-19 20:10
updatedAt: <end time>
planFile: "_ai/backlog/active/261019_2010__IMPLEMENTATION_PLAN__config-driven-watches-and-inbox.md"
project: "docdeck"
status: completed
filesCreated: <count>
filesModified: <count>
filesDeleted: 4
tags: [config, watcher, inbox, unread, ux, glob]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Config-driven watches and the file inbox

## 1. Summary
## 2. Files Changed
## 3. Key Changes
## 4. Deviations from Plan
## 5. Technical Decisions
## 6. Testing Notes
## 7. Usage Examples
## 8. Documentation Updates
## 9. Next Steps
```

Finally mark the plan `status: completed`, set `completedAt`, and move it to
`_ai/backlog/archive/` (the `finish-plan` flow).

## Traceability

| Acceptance criterion | Handoff decision | Phases |
| --- | --- | --- |
| AC-01 config loading, override, hints/errors | D1, D9 | 1.4, 1.5, 3.1, 5.1 |
| AC-02 selector semantics | D2 | 1.4, 1.5 |
| AC-03 noise/exclude filtering in scan and events | D2, D9 | 1.2, 2.1, 2.3 |
| AC-04 picker removed, CLI preserved, no auto-open | D4 | 3.1, 6.2, 6.3 |
| AC-05 inbox panel, sorting, chips, times, accent | D5 | 4.1–4.4, 5.1–5.4, 6.2 |
| AC-06 session unread lifecycle | D6 | 4.5, 4.6, 6.2 |
| AC-07 active-tab pulse without unread | D7 | 5.4, 6.2 |
| AC-08 new and deleted rows | D8 | 4.5, 6.2 |
| AC-09 caps and non-fatal diagnostics | D9 | 1.4, 2.1, 3.1, 5.1 |
| AC-10 tests, simulation, docs | scope boundary | 1.3, 1.5, 2.2, 2.4, 4.2, 4.4, 4.6, 5.2, 7.1–7.6 |

Risks and mitigations:

- **`globset` `**` zero-component behavior** (handoff open question): pinned by
  `deep_glob_matches_files_at_the_root_and_nested` in Phase 1.5. If it ever
  regresses, the fallback is to compile an extra matcher per non-empty suffix.
- **inotify watch exhaustion on broad selectors**: built-in noise pruning,
  user excludes and the 256-root cap are all enforced before registration.
- **Inbox and tab disagreeing about unread**: a single mutation path in
  `main.ts` (`applyPathChange` → `InboxModel.upsert`/`markDeleted`, plus
  `setActiveTab` → `markRead`) is the only writer; the model is unit-tested.
- **`replace` wiping session rows**: `load_watches` runs before `add_watch`, and
  `add_watch` uses `merge`, so session folders survive and stay plain.

