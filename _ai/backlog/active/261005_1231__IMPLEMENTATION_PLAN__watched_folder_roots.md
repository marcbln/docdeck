---
filename: "_ai/backlog/active/261005_1231__IMPLEMENTATION_PLAN__watched_folder_roots.md"
title: "Watched folder roots: recursive _ai monitoring with a selection modal"
createdAt: 2026-10-05 12:31
updatedAt: 2026-10-05 12:31
status: draft
priority: high
tags: [watcher, inotify, cli, modal, ux]
estimatedComplexity: complex
documentRevision: 1
sourceSpec: ""
sourceHandoff: ""
documentType: IMPLEMENTATION_PLAN
---

# Watched folder roots

## 1. Problem

Today docdeck only understands document arguments: `docdeck plan.md` opens a tab
and attaches an `inotify` watch to that single file. Passing a folder
(`docdeck ./_ai`) fails inside `load_file`, because `fs::read_to_string` cannot
read a directory.

Users who work with AI agents keep a whole `_ai` tree (plans, reports,
decisions) that agents create and rewrite continuously. They want to point
docdeck at that tree once and have **new and edited Markdown documents appear
automatically**, without re-running the CLI for every file, and without losing
updates caused by atomic write-to-temp-then-rename saves — a save pattern the
current per-file watch provably misses (documented in README *Known
limitations*).

## 2. Executive summary

docdeck gains **watched folder roots**:

- CLI arguments are classified into documents and folders. Documents behave
  exactly as before; folders open a **picker modal** listing every `*.md` file
  in a checkbox tree (dirs collapsible, hidden files and backups excluded).
- The modal's primary action — **"Watch folders + open selected files"** —
  starts one **recursive** watch per folder and opens the checked documents as
  tabs. **Cancel** abandons folder watching without affecting document
  arguments.
- Once watching, any created or modified `*.md` under a root is **opened as a
  background tab with the amber unread dot** — focus is never stolen. Edited
  files that already have a tab just reload.
- Deleted files keep their tab with a **"deleted on disk"** marker (content is
  preserved); the marker clears if the file reappears.
- Closing a tab is not sticky: the next edit reopens it in the background.
- Rerunning `docdeck <folder>` while an instance is running forwards the folder
  through the single-instance socket and reopens the picker in that window,
  pre-checking currently open tabs.

The change is split into pure, unit-testable primitives (`paths.rs`,
`folder.rs`, `file-tree.ts`) and thin IO/DOM adapters (`watcher.rs`,
`commands.rs`, `folder-modal.ts`, `main.ts`), keeping the existing architecture
intact: Rust owns OS concerns, the webview owns view orchestration.

### Acceptance criteria (derived from the agreed design)

- **AC-01** `docdeck <folder>` no longer fails; it shows a modal containing every
  `*.md` under the folder, recursively; several folder args work together.
- **AC-02** The modal tree has checkboxes; files with open tabs are pre-checked
  when the modal is shown again; files not open start unchecked.
- **AC-03** "Watch folders + open selected files" starts recursive watches and
  opens the checked files; "Cancel" leaves folder files unopened and unwatched;
  document arguments still open in both cases.
- **AC-04** A new `*.md` file in a watched root opens a background tab with the
  unread dot and does not steal focus.
- **AC-05** An edited `*.md` file reloads its tab if open; if not open —
  including after the user closed it — it opens as a background tab with the
  unread dot.
- **AC-06** A deleted file keeps its tab, content included, with a "deleted on
  disk" marker; the marker clears if the file reappears.
- **AC-07** Only `*.md` files under watched roots trigger folder events;
  explicitly opened files keep reloading whatever their extension. Hidden
  entries (`.git`, `.gitkeep`) and editor backups (`plan.md~`) are never listed
  or surfaced.
- **AC-08** Write-to-temp-then-rename saves are followed (the directory survives
  the inode swap).
- **AC-09** Rerunning `docdeck <folder>` in a second shell reopens the picker in
  the running window instead of starting a second process.
- **AC-10** Cancel only abandons folder watching; file arguments passed alongside
  the folder still open.

### Explicitly deferred (out of scope)

- **Rename following.** A rename surfaces as a remove plus a create; the old tab
  gets the deleted marker and the new path opens a new tab. Pairing
  `MOVED_FROM`/`MOVED_TO` is a v2 concern.
- **Persistence of roots/selection across restarts.** The tree only exists when
  a folder is passed on the CLI, so there is nothing to restore.
- **Opening non-Markdown files from the tree.** The tree lists `*.md` only.
- **Several windows.** Single-instance forwarding already covers multi-root use.

### Known constraint discovered during planning

`notify-debouncer-mini` 0.4 does not classify events (create/modify/remove); it
only reports settled paths. The plan therefore samples `Path::exists()` after
the debounce window and lets the frontend derive the action from its own tab
registry. This preserves every observable behavior above. If real event kinds
are ever needed (e.g. rename pairing), swapping to `notify-debouncer-full` is
the follow-up.

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
No new dependencies are introduced.
```

---

## Phase 1 — Backend primitives: path predicates, folder scanner, CLI classification

Pure logic, no Tauri types, so everything is unit-testable without an event
loop. Follows the existing `render.rs`/`render_test.rs` pattern: module plus a
sibling `*_test.rs` module registered in `lib.rs`.

**Files**

- `src-tauri/src/paths.rs` — [NEW FILE]
- `src-tauri/src/paths_test.rs` — [NEW FILE]
- `src-tauri/src/folder.rs` — [NEW FILE]
- `src-tauri/src/folder_test.rs` — [NEW FILE]
- `src-tauri/src/lib.rs` — [MODIFY] module declarations only (wiring comes in Phase 3)

### 1.1 `src-tauri/src/paths.rs` [NEW FILE]

```rust
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
```

### 1.2 `src-tauri/src/paths_test.rs` [NEW FILE]

```rust
#[cfg(test)]
mod tests {
    use crate::paths::{classify_args, is_ignored_name, is_markdown, is_relevant, is_under};
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

        // An explicitly opened file reloads whatever its extension.
        assert!(is_relevant(&txt, &files, &roots));
        // Fresh Markdown under a root is relevant.
        assert!(is_relevant(&doc, &files, &roots));
        // A deleted/never-existing path has nothing to mark.
        assert!(!is_relevant(&root.join("missing.md"), &files, &roots));
        // Markdown outside every root is not.
        assert!(!is_relevant(Path::new("/elsewhere/a.md"), &files, &roots));
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

        let entries = classify_args(&argv);
        assert_eq!(entries.len(), 2);

        let dir_entry = entries.iter().find(|entry| entry.is_dir).unwrap();
        assert_eq!(
            dir_entry.path,
            dir.path().canonicalize().unwrap().to_string_lossy().into_owned()
        );

        let file_entry = entries.iter().find(|entry| !entry.is_dir).unwrap();
        assert_eq!(
            file_entry.path,
            file.canonicalize().unwrap().to_string_lossy().into_owned()
        );
    }
}
```

### 1.3 `src-tauri/src/folder.rs` [NEW FILE]

```rust
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
```

### 1.4 `src-tauri/src/folder_test.rs` [NEW FILE]

```rust
#[cfg(test)]
mod tests {
    use crate::folder::scan_markdown;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn scans_markdown_recursively_and_skips_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("backlog/active")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("README.md"), "# root").unwrap();
        fs::write(dir.path().join("backlog/active/plan.md"), "# plan").unwrap();
        fs::write(dir.path().join("backlog/report.MD"), "# report").unwrap();
        fs::write(dir.path().join("backlog/notes.txt"), "nope").unwrap();
        fs::write(dir.path().join(".git/HEAD.md"), "nope").unwrap();
        fs::write(dir.path().join("backlog/plan.md~"), "nope").unwrap();

        let files = scan_markdown(dir.path()).unwrap();
        let names: Vec<String> = files
            .iter()
            .map(|path| {
                path.strip_prefix(dir.path())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();

        assert_eq!(names.len(), 3);
        assert!(names.contains(&"README.md".to_string()));
        assert!(names.contains(&"backlog/active/plan.md".to_string()));
        assert!(names.contains(&"backlog/report.MD".to_string()));
    }

    #[test]
    fn rejects_a_non_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("plan.md");
        fs::write(&file, "# plan").unwrap();
        assert!(scan_markdown(&file).is_err());
    }
}
```

### 1.5 `src-tauri/src/lib.rs` [MODIFY] — declarations

```rust
mod commands;
mod folder;
mod paths;
mod render;
mod watcher;

#[cfg(test)]
mod folder_test;
#[cfg(test)]
mod paths_test;
#[cfg(test)]
mod render_test;
#[cfg(test)]
mod watcher_test;
```

**Verification**

```bash
cd src-tauri && cargo test
cargo clippy --all-targets -- -D warnings
```

---

## Phase 2 — Recursive root watches and batched change events

**Files**

- `src-tauri/src/watcher.rs` — [MODIFY]
- `src-tauri/src/watcher_test.rs` — [MODIFY]

### 2.1 `src-tauri/src/watcher.rs` [MODIFY] — full replacement

Add a root registry next to the file registry, a typed `PathChange` payload, and
recursive watching. Replace the whole file with:

```rust
use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

use crate::paths::is_relevant;

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
/// `notify-debouncer-mini` does not classify events, and for this UI the
/// existence check is all the classification that is needed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PathChange {
    pub path: String,
    pub exists: bool,
}

/// Owns the set of documents currently open in the UI, the set of recursively
/// watched folders, and the single debounced `inotify` watcher that backs both.
pub struct WatcherState {
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub watched_roots: Arc<Mutex<HashSet<PathBuf>>>,
    debouncer: Arc<Mutex<Option<Debouncer<RecommendedWatcher>>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            watched_roots: Arc::new(Mutex::new(HashSet::new())),
            debouncer: Arc::new(Mutex::new(None)),
        }
    }

    /// Spins up the debounced watcher. Every settled, relevant event is batched
    /// into one `paths-changed` event carrying absolute paths.
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        let app = app_handle.clone();
        let files = Arc::clone(&self.watched_paths);
        let roots = Arc::clone(&self.watched_roots);

        let debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    // Lock guards are scoped so neither registry stays locked
                    // while the event is emitted: the webview must never block
                    // watch registration.
                    let changes: Vec<PathChange> = {
                        let Ok(files) = files.lock() else { return };
                        let Ok(roots) = roots.lock() else { return };

                        events
                            .into_iter()
                            .map(|event| event.path)
                            .filter(|path| is_relevant(path, &files, &roots))
                            .map(|path| PathChange {
                                exists: path.exists(),
                                path: path.to_string_lossy().into_owned(),
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

    /// Stops watching `path` and drops it from the registry.
    pub fn unwatch_file(&self, path: &Path) -> Result<(), String> {
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

Lock-order note (no deadlock): command threads take `watched_paths` (or
`watched_roots`) and release it before taking `debouncer`; the event callback
takes `watched_paths` then `watched_roots` but never `debouncer`.

### 2.2 `src-tauri/src/watcher_test.rs` [MODIFY] — append tests

Keep the existing four tests and add:

```rust
    #[test]
    fn watch_roots_registers_directories_idempotently() {
        let dir = tempdir().unwrap();
        let state = WatcherState::new();

        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();
        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();

        assert_eq!(state.watched_roots.lock().unwrap().len(), 1);
        assert!(state.watched_roots.lock().unwrap().contains(dir.path()));
    }

    #[test]
    fn tracks_several_roots() {
        let first = tempdir().unwrap();
        let second = tempdir().unwrap();
        let state = WatcherState::new();

        state
            .watch_roots(&[first.path().to_path_buf(), second.path().to_path_buf()])
            .unwrap();

        assert_eq!(state.watched_roots.lock().unwrap().len(), 2);
    }

    #[test]
    fn file_and_root_registries_are_independent() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("plan.md");
        File::create(&file_path).unwrap();

        let state = WatcherState::new();
        state.watch_file(&file_path).unwrap();
        state.watch_roots(&[dir.path().to_path_buf()]).unwrap();

        assert_eq!(state.watched_paths.lock().unwrap().len(), 1);
        assert_eq!(state.watched_roots.lock().unwrap().len(), 1);
    }
```

**Verification**

```bash
cd src-tauri && cargo test
cargo clippy --all-targets -- -D warnings
```

---

## Phase 3 — Command surface and app wiring

**Files**

- `src-tauri/src/commands.rs` — [MODIFY]
- `src-tauri/src/lib.rs` — [MODIFY]

### 3.1 `src-tauri/src/commands.rs` [MODIFY] — full replacement

Adds `scan_folder` (builds the picker tree) and `watch_folders` (starts the
recursive watches on confirm). `load_file` and `close_file` are unchanged apart
from the new import.

```rust
use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::folder;
use crate::watcher::WatcherState;

#[derive(serde::Serialize)]
pub struct FilePayload {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub modified_time: u64,
}

/// A watched root and every Markdown document discovered beneath it.
#[derive(serde::Serialize)]
pub struct FolderScan {
    pub root: String,
    pub files: Vec<String>,
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
#[tauri::command]
pub fn close_file(path_str: String, watcher: State<WatcherState>) -> Result<(), String> {
    let path = PathBuf::from(&path_str);
    let canonical = path.canonicalize().unwrap_or(path);
    watcher.unwatch_file(&canonical)
}

/// Lists the Markdown documents under a folder so the picker can build its tree.
#[tauri::command]
pub fn scan_folder(path_str: String) -> Result<FolderScan, String> {
    let root = PathBuf::from(&path_str)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let files = folder::scan_markdown(&root)?
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();

    Ok(FolderScan {
        root: root.to_string_lossy().into_owned(),
        files,
    })
}

/// Starts one recursive watch per folder once the user confirms the picker.
#[tauri::command]
pub fn watch_folders(paths: Vec<String>, watcher: State<WatcherState>) -> Result<(), String> {
    let roots = paths
        .iter()
        .map(|path| {
            PathBuf::from(path)
                .canonicalize()
                .map_err(|e| format!("{path}: {e}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    watcher.watch_roots(&roots)
}
```

### 3.2 `src-tauri/src/lib.rs` [MODIFY]

Replace `collect_paths`/`startup_paths` with the classifier; switch the
single-instance event to a typed `open-path-cli` payload; register the new
commands. The old `use std::path::PathBuf;` import goes away.

```rust
use std::env;
use std::io;
use tauri::{Emitter, Manager};

use paths::CliEntry;
use watcher::WatcherState;

/// Returns the document and folder paths this process was launched with.
///
/// The frontend pulls these once it has registered its event listeners. An
/// emitted event would race the webview's mount and be dropped on slow
/// machines; a command the frontend calls at the right moment cannot.
#[tauri::command]
fn startup_paths() -> Vec<CliEntry> {
    paths::classify_args(&env::args().collect::<Vec<_>>())
}

pub fn run() {
    let argv: Vec<String> = env::args().collect();

    // Must happen before any window exists: WebKitGTK reads these once, while
    // it initialises, so setting them later has no effect.
    render::configure(&argv);

    let watcher_state = WatcherState::new();

    let mut builder = tauri::Builder::default();

    // Must be registered first so the IPC socket exists before anything else.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // Forward `docdeck path/to/doc.md` or `docdeck ./_ai` from a second
        // shell into the running window.
        for entry in paths::classify_args(&argv) {
            let _ = app.emit("open-path-cli", entry);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        .manage(watcher_state)
        .setup(|app| {
            app.state::<WatcherState>()
                .init(app.handle().clone())
                .map_err(io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file,
            commands::close_file,
            commands::scan_folder,
            commands::watch_folders,
            startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running docdeck application");
}
```

**Verification**

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

---

## Phase 4 — Frontend picker: tree builder, modal, styles

**Files**

- `src/file-tree.ts` — [NEW FILE]
- `src/file-tree.test.ts` — [NEW FILE]
- `src/folder-modal.ts` — [NEW FILE]
- `src/folder-modal.test.ts` — [NEW FILE]
- `src/style.css` — [MODIFY]

### 4.1 `src/file-tree.ts` [NEW FILE]

```ts
/** A Markdown document row in the folder picker. */
export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}

/** A collapsible directory row in the folder picker. */
export interface TreeDirectory {
  kind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDirectory;

/**
 * Builds a nested tree from absolute file paths beneath `root`.
 *
 * The scanner returns a flat, sorted list; the picker wants folders. Keeping
 * the transform pure makes the awkward cases — a file directly under the root,
 * a path outside it — unit-testable without a DOM. Files outside the root are
 * ignored: the scanner cannot produce them, and guessing a home for them would
 * corrupt the tree's paths.
 */
export function buildTree(root: string, files: string[]): TreeDirectory {
  const rootNode: TreeDirectory = {
    kind: "directory",
    name: root,
    path: root,
    children: [],
  };

  for (const file of files) {
    if (!file.startsWith(`${root}/`)) continue;

    const relative = file.slice(root.length + 1);
    const segments = relative.split("/");
    let directory = rootNode;

    for (const segment of segments.slice(0, -1)) {
      let child = directory.children.find(
        (candidate): candidate is TreeDirectory =>
          candidate.kind === "directory" && candidate.name === segment,
      );
      if (!child) {
        child = {
          kind: "directory",
          name: segment,
          path: `${directory.path}/${segment}`,
          children: [],
        };
        directory.children.push(child);
      }
      directory = child;
    }

    const name = segments[segments.length - 1];
    if (name !== undefined) {
      directory.children.push({ kind: "file", name, path: file });
    }
  }

  sortChildren(rootNode);
  return rootNode;
}

/** Directories first, then files, each alphabetical. */
function sortChildren(node: TreeDirectory): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of node.children) {
    if (child.kind === "directory") sortChildren(child);
  }
}
```

### 4.2 `src/file-tree.test.ts` [NEW FILE]

```ts
import { describe, expect, it } from "vitest";

import { buildTree } from "./file-tree";

describe("buildTree", () => {
  it("nests files under their directories", () => {
    const tree = buildTree("/ai", [
      "/ai/backlog/active/plan.md",
      "/ai/backlog/reports/status.md",
      "/ai/README.md",
    ]);

    expect(tree.children.map((child) => child.name)).toEqual([
      "backlog",
      "README.md",
    ]);

    const backlog = tree.children[0];
    if (backlog?.kind !== "directory") throw new Error("expected a directory");
    expect(backlog.children.map((child) => child.name)).toEqual([
      "active",
      "reports",
    ]);
  });

  it("sorts directories before files at every level", () => {
    const tree = buildTree("/ai", ["/ai/zebra.md", "/ai/alpha/one.md"]);
    expect(tree.children.map((child) => child.kind)).toEqual([
      "directory",
      "file",
    ]);
    expect(tree.children.map((child) => child.name)).toEqual([
      "alpha",
      "zebra.md",
    ]);
  });

  it("ignores paths outside the root", () => {
    const tree = buildTree("/ai", ["/elsewhere/plan.md"]);
    expect(tree.children).toHaveLength(0);
  });

  it("handles files directly under the root", () => {
    const tree = buildTree("/ai", ["/ai/plan.md"]);
    expect(tree.children).toEqual([
      { kind: "file", name: "plan.md", path: "/ai/plan.md" },
    ]);
  });
});
```

### 4.3 `src/folder-modal.ts` [NEW FILE]

Owns only DOM and selection state; scanning, watching and tab opening stay with
the caller. That keeps this class free of Tauri imports and testable in a plain
DOM.

```ts
import { buildTree, type TreeNode } from "./file-tree";

export interface FolderModalCallbacks {
  /** Whether a path already has an open tab, so it starts checked. */
  isOpen(path: string): boolean;
  /**
   * Confirmed: `selected` is every checked path. `known` is every path the
   * picker displayed, so the caller can close tabs that were unchecked.
   */
  onConfirm(selected: string[], known: string[]): void | Promise<void>;
  /** Cancelled: nothing should change. */
  onCancel(): void;
}

/**
 * The folder picker: one collapsible checkbox tree per watched root, with
 * "watch + open" and "cancel" actions.
 *
 * A file's checkbox reflects whether it has an open tab. Checking it on confirm
 * opens it; unchecking closes it — the modal shows and edits one bit of truth
 * rather than inventing a second selection model.
 */
export class FolderModal {
  private readonly callbacks: FolderModalCallbacks;
  private readonly overlay: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly selection = new Map<string, boolean>();
  private readonly knownPaths = new Set<string>();

  constructor(callbacks: FolderModalCallbacks) {
    this.callbacks = callbacks;

    const overlay = document.createElement("div");
    overlay.className = "folder-modal-overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Choose documents to watch");

    const dialog = document.createElement("div");
    dialog.className = "folder-modal";

    const header = document.createElement("div");
    header.className = "folder-modal-header";
    const title = document.createElement("h2");
    title.textContent = "Watch folders";
    const hint = document.createElement("p");
    hint.textContent =
      "Select the documents to open. New and updated Markdown files will open in the background as agents write them.";
    header.append(title, hint);

    const body = document.createElement("div");
    body.className = "folder-modal-body";

    const footer = document.createElement("div");
    footer.className = "folder-modal-footer";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "folder-modal-cancel";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "folder-modal-confirm";
    confirm.textContent = "Watch folders + open selected files";
    footer.append(cancel, confirm);

    dialog.append(header, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    cancel.addEventListener("click", () => {
      this.hide();
      this.callbacks.onCancel();
    });
    confirm.addEventListener("click", () => {
      void this.confirm();
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.hide();
        this.callbacks.onCancel();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen) {
        this.hide();
        this.callbacks.onCancel();
      }
    });

    this.overlay = overlay;
    this.body = body;
  }

  public get isOpen(): boolean {
    return !this.overlay.classList.contains("hidden");
  }

  /** Opens the picker and resets its contents. */
  public show(): void {
    this.selection.clear();
    this.knownPaths.clear();
    this.body.replaceChildren();
    this.overlay.classList.remove("hidden");
  }

  public hide(): void {
    this.overlay.classList.add("hidden");
  }

  /** Appends a root's tree once its scan resolves. */
  public addRoot(root: string, files: string[]): void {
    for (const file of files) {
      this.knownPaths.add(file);
      if (!this.selection.has(file)) {
        this.selection.set(file, this.callbacks.isOpen(file));
      }
    }

    const section = document.createElement("section");
    section.className = "folder-root";

    const heading = document.createElement("div");
    heading.className = "folder-root-path";
    heading.textContent = root;

    section.append(heading, this.renderChildren(buildTree(root, files).children));
    this.body.append(section);
  }

  /** Reports a scan failure inline, without hiding the rest of the picker. */
  public setRootError(root: string, message: string): void {
    const error = document.createElement("p");
    error.className = "folder-error";
    error.textContent = `${root}: ${message}`;
    this.body.append(error);
  }

  private renderChildren(nodes: TreeNode[]): HTMLUListElement {
    const list = document.createElement("ul");
    list.className = "folder-tree";

    for (const node of nodes) {
      const item = document.createElement("li");

      if (node.kind === "directory") {
        item.className = "folder-dir";
        const details = document.createElement("details");
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = node.name;
        details.append(summary, this.renderChildren(node.children));
        item.append(details);
      } else {
        item.className = "folder-file";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.selection.get(node.path) ?? false;
        checkbox.addEventListener("change", () => {
          this.selection.set(node.path, checkbox.checked);
        });
        const name = document.createElement("span");
        name.textContent = node.name;
        name.title = node.path;
        label.append(checkbox, name);
        item.append(label);
      }

      list.append(item);
    }

    return list;
  }

  private async confirm(): Promise<void> {
    const selected = [...this.selection.entries()]
      .filter(([, checked]) => checked)
      .map(([path]) => path);
    await this.callbacks.onConfirm(selected, [...this.knownPaths]);
  }
}
```

### 4.4 `src/folder-modal.test.ts` [NEW FILE]

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderModal } from "./folder-modal";

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(".folder-file input")];
}

describe("FolderModal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("starts hidden and shows on demand", () => {
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(modal.isOpen).toBe(false);
    modal.show();
    expect(modal.isOpen).toBe(true);
  });

  it("pre-checks files that already have open tabs", () => {
    const modal = new FolderModal({
      isOpen: (path) => path === "/ai/plan.md",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    modal.show();
    modal.addRoot("/ai", ["/ai/plan.md", "/ai/report.md"]);

    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
  });

  it("reports checked and known paths on confirm", () => {
    const onConfirm = vi.fn();
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm,
      onCancel: vi.fn(),
    });

    modal.show();
    modal.addRoot("/ai", ["/ai/a.md", "/ai/b.md"]);

    const second = boxes()[1];
    if (!second) throw new Error("expected a second checkbox");
    second.checked = true;
    second.dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>(".folder-modal-confirm")?.click();

    expect(onConfirm).toHaveBeenCalledWith(
      ["/ai/b.md"],
      ["/ai/a.md", "/ai/b.md"],
    );
  });

  it("cancels via the cancel button and hides", () => {
    const onCancel = vi.fn();
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel,
    });

    modal.show();
    document.querySelector<HTMLButtonElement>(".folder-modal-cancel")?.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(modal.isOpen).toBe(false);
  });

  it("shows scan failures inline", () => {
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });
    modal.show();
    modal.setRootError("/nope", "Could not scan this folder.");
    expect(document.querySelector(".folder-error")?.textContent).toContain(
      "/nope",
    );
  });
});
```

### 4.5 `src/style.css` [MODIFY] — append

```css
/* --------------------------------------------------------------------------
   Folder picker modal
   -------------------------------------------------------------------------- */

.folder-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgba(17, 17, 27, 0.6);
}

.folder-modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(70vh, 720px);
  overflow: hidden;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.folder-modal-header {
  padding: 16px 20px 8px;
  border-bottom: 1px solid var(--border-color);
}

.folder-modal-header h2 {
  margin-bottom: 4px;
  font-size: 15px;
}

.folder-modal-header p {
  font-size: 12px;
  color: var(--text-muted);
}

.folder-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 12px;
}

.folder-root + .folder-root {
  margin-top: 12px;
}

.folder-root-path {
  padding: 8px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.folder-tree {
  margin: 0;
  padding: 0;
  list-style: none;
}

.folder-tree .folder-tree {
  padding-left: 18px;
}

.folder-dir > details > summary {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  list-style-position: inside;
}

.folder-dir > details > summary:hover {
  background-color: var(--bg-secondary);
}

.folder-file label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
}

.folder-file label:hover {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.folder-file input[type="checkbox"] {
  flex: 0 0 auto;
  accent-color: var(--accent-color);
}

.folder-error {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--danger-color);
}

.folder-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-secondary);
}

.folder-modal-footer button {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.folder-modal-cancel {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.folder-modal-cancel:hover {
  background: var(--border-color);
}

.folder-modal-confirm {
  background: var(--accent-color);
  color: var(--bg-primary);
  font-weight: 600;
}

.folder-modal-confirm:hover {
  filter: brightness(1.1);
}

/* --------------------------------------------------------------------------
   Deleted-on-disk documents
   -------------------------------------------------------------------------- */

.tab-item.deleted .tab-title {
  text-decoration: line-through;
  opacity: 0.6;
}

.tab-item.deleted .tab-title::after {
  content: " ⚠";
  text-decoration: none;
}

.deleted-banner {
  margin: 0 0 16px;
  padding: 8px 12px;
  border: 1px solid var(--danger-color);
  border-radius: 6px;
  background-color: var(--bg-secondary);
  font-size: 12px;
  color: var(--danger-color);
}
```

**Verification**

```bash
npm run typecheck
npm run test:web
```

---

## Phase 5 — Frontend integration: picker flow, background tabs, deleted marker

**Files**

- `src/main.ts` — [MODIFY]
- `index.html` — [MODIFY] (empty-state copy)

### 5.1 Payload types and imports

```ts
import { FolderModal } from "./folder-modal";

/** A CLI argument the backend resolved: a document or a folder to watch. */
interface CliEntry {
  path: string;
  is_dir: boolean;
}

/** A settled filesystem change for one path. */
interface PathChange {
  path: string;
  exists: boolean;
}

/** A watched root and the Markdown documents found beneath it. */
interface FolderScan {
  root: string;
  files: string[];
}
```

### 5.2 `Tab` gains the deleted marker

```ts
interface Tab {
  path: string;
  filename: string;
  content: string;
  modifiedTime: number;
  hasUnreadUpdate: boolean;
  deletedOnDisk: boolean;
}
```

### 5.3 Fields and constructor wiring

```ts
  /** Roots shown in the picker but not yet confirmed; reset on cancel/confirm. */
  private readonly pendingRoots = new Set<string>();
  private readonly folderModal: FolderModal;
```

In the constructor, after `this.theme = ...`:

```ts
    this.folderModal = new FolderModal({
      isOpen: (path) => this.tabs.has(path),
      onConfirm: (selected, known) => this.confirmFolders(selected, known),
      onCancel: () => this.pendingRoots.clear(),
    });
```

### 5.4 Startup classification

```ts
  private async loadStartupPaths(): Promise<void> {
    try {
      const entries = await invoke<CliEntry[]>("startup_paths");
      const folders = entries
        .filter((entry) => entry.is_dir)
        .map((entry) => entry.path);

      for (const entry of entries) {
        if (!entry.is_dir) await this.openDocument(entry.path);
      }

      if (folders.length > 0) void this.showFolderModal(folders);
    } catch (error) {
      console.error("Failed to read startup paths", error);
    }
  }
```

### 5.5 Backend listeners

```ts
      // A second `docdeck <path>` in another shell. Folders reopen the picker.
      await listen<CliEntry>("open-path-cli", (event) => {
        if (event.payload.is_dir) void this.showFolderModal([event.payload.path]);
        else void this.openDocument(event.payload.path);
      });

      // A batch of settled writes from the debounced inotify watcher.
      await listen<PathChange[]>("paths-changed", (event) => {
        for (const change of event.payload) void this.applyPathChange(change);
      });
```

### 5.6 `openDocument` gains a background mode

```ts
  public async openDocument(
    rawPath: string,
    options: { background?: boolean } = {},
  ): Promise<void> {
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
          hasUnreadUpdate: options.background === true,
          deletedOnDisk: false,
        });
      }

      if (options.background && this.activePath !== null) {
        // Never steal focus from the document being read.
        this.renderTabs();
        if (this.activePath === data.path) await this.renderActiveContent();
      } else {
        this.setActiveTab(data.path);
      }
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      // A background auto-open can lose the race against a delete; that is
      // routine, not an error worth interrupting the reader for.
      if (!options.background) this.showMessage(`Could not open ${rawPath}`);
    }
  }
```

### 5.7 Change handling and deleted state

```ts
  /**
   * Handles one settled watcher event.
   *
   * Deleted files keep their tab (content included) and get a marker, so a
   * document replaced mid-read does not silently vanish. Everything that
   * exists is either reloaded or opened in the background — focus is never
   * taken.
   */
  private async applyPathChange(change: PathChange): Promise<void> {
    const tab = this.tabs.get(change.path);

    if (!change.exists) {
      if (!tab || tab.deletedOnDisk) return;
      tab.deletedOnDisk = true;
      this.renderTabs();
      if (this.activePath === change.path) await this.renderActiveContent();
      return;
    }

    if (tab) {
      await this.reloadDocument(change.path);
    } else {
      await this.openDocument(change.path, { background: true });
    }
  }
```

In `reloadDocument`, clear the marker after a successful read:

```ts
      tab.content = data.content;
      tab.modifiedTime = data.modified_time;
      tab.deletedOnDisk = false;
```

### 5.8 Folder modal flow and tab-close extraction

Extract the body of `closeTab` so the picker can close unchecked tabs without a
synthetic `MouseEvent`:

```ts
  private async closeTabPath(path: string): Promise<void> {
    try {
      await invoke("close_file", { pathStr: path });
    } catch (error) {
      console.error(`Failed to release watch for ${path}`, error);
    }

    this.tabs.delete(path);
    this.reloadTokens.delete(path);

    if (this.activePath === path) {
      const remaining = [...this.tabs.keys()];
      this.activePath = remaining[remaining.length - 1] ?? null;
    }

    this.renderTabs();
    await this.renderActiveContent();
  }

  private async closeTab(path: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.closeTabPath(path);
  }
```

Picker orchestration:

```ts
  /** Scans each root and opens the picker; safe to call repeatedly. */
  private async showFolderModal(roots: string[]): Promise<void> {
    for (const root of roots) this.pendingRoots.add(root);
    this.folderModal.show();

    for (const root of roots) {
      try {
        const scan = await invoke<FolderScan>("scan_folder", { pathStr: root });
        this.folderModal.addRoot(scan.root, scan.files);
      } catch (error) {
        console.error(`Failed to scan folder ${root}`, error);
        this.folderModal.setRootError(root, "Could not scan this folder.");
      }
    }
  }

  private async confirmFolders(selected: string[], known: string[]): Promise<void> {
    const roots = [...this.pendingRoots];

    try {
      await invoke("watch_folders", { paths: roots });
    } catch (error) {
      console.error("Failed to start folder watch", error);
      return; // Keep the modal open so the user can retry or cancel.
    }

    this.pendingRoots.clear();

    // Unchecking closes; checking opens. Tabs outside the picker are untouched
    // because `known` only ever contains files the modal displayed.
    const selectedSet = new Set(selected);
    for (const path of known) {
      if (!selectedSet.has(path) && this.tabs.has(path)) {
        await this.closeTabPath(path);
      }
    }

    let first = true;
    for (const path of selected) {
      if (!this.tabs.has(path)) {
        await this.openDocument(path, { background: !first });
        first = false;
      }
    }

    this.folderModal.hide();
  }
```

### 5.9 Render the deleted marker

In `renderTabs`, after the unread class assignment:

```ts
      if (tab.deletedOnDisk) item.classList.add("deleted");
```

Replace the existing `title.title = tab.path;` line with:

```ts
      title.title = tab.deletedOnDisk
        ? `${tab.path} (deleted on disk)`
        : tab.path;
```

In `renderActiveContent`, after the metadata block and before
`this.tocPanel.rebuild(headings)`:

```ts
      if (tab.deletedOnDisk) {
        const banner = document.createElement("p");
        banner.className = "deleted-banner";
        banner.textContent = "This file was deleted on disk.";
        this.viewer.prepend(banner);
        if (wasTailing) {
          this.contentContainer.scrollTop = this.contentContainer.scrollHeight;
        }
      }
```

### 5.10 `index.html` [MODIFY] — empty-state copy

```html
        <div id="empty-state" class="empty-placeholder">
          <p>
            No document loaded. Run <code>docdeck &lt;file.md&gt;</code> or
            <code>docdeck &lt;folder&gt;</code> to watch a Markdown tree.
          </p>
        </div>
```

**Verification**

```bash
npm run typecheck
npm run test:web
npm run test          # Rust + frontend
npm run lint:rs
```

---

## Phase 6 — End-to-end verification

**Files**

- `scripts/simulate_folder_watch.sh` — [NEW FILE]

A folder-mode sibling of `scripts/simulate_agent_writes.sh`: creates a throwaway
`_ai`-style workspace, launches docdeck on the folder, then an agent loop
creates a new Markdown file and edits an existing one.

```bash
#!/usr/bin/env bash
#
# End-to-end smoke test for docdeck's folder-watch mode.
#
# Creates a throwaway _ai-style workspace, launches docdeck on the folder, then
# simulates an agent creating and editing Markdown files inside it.
#
# Usage:
#   ./scripts/simulate_folder_watch.sh [path-to-docdeck-binary]

set -euo pipefail

WORKSPACE="/tmp/docdeck_folder_sim"
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

rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE/backlog/active" "$WORKSPACE/backlog/reports"
printf '# Active plan\n\n- [ ] Step pending\n' > "$WORKSPACE/backlog/active/plan.md"

APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT

if [[ -n "$BINARY" ]]; then
  printf 'Launching docdeck (%s) on %s...\n' "$BINARY" "$WORKSPACE"
  "$BINARY" "$WORKSPACE" &
  APP_PID=$!
else
  printf 'No prebuilt binary found — falling back to `npm run tauri dev`.\n'
  npm run tauri dev -- "$WORKSPACE" &
  APP_PID=$!
fi

sleep 5
printf 'Simulating an agent writing under %s (%s steps)...\n' "$WORKSPACE" "$STEPS"

for i in $(seq 1 "$STEPS"); do
  sleep "$STEP_DELAY"
  printf -- '- [x] Step %s executed at %s\n' "$i" "$(date +%T)" \
    >> "$WORKSPACE/backlog/active/plan.md"
  printf '# Report %s\n\nGenerated at %s\n' "$i" "$(date +%T)" \
    > "$WORKSPACE/backlog/reports/report_$i.md"
  printf '  step %s/%s: edited plan.md, created report_%s.md\n' \
    "$i" "$STEPS" "$i"
done

cat <<'EOF'

Verification checklist:
  1. At launch, the folder picker lists backlog/active/plan.md and no reports.
  2. Confirming opens plan.md and the picker closes; the folder stays watched.
  3. Every new report_<n>.md opens as a background tab with an amber dot,
     without stealing focus from plan.md.
  4. Switching to a report tab clears its dot; edits keep reloading plan.md.
  5. In a second terminal, `docdeck <workspace>` reopens the picker in THIS
     window with plan.md and the reports pre-checked.
  6. Cancel leaves all folder files open/unopened exactly as they were.
  7. Delete a report file: its tab stays with a strikethrough and the deleted
     banner; recreating the file clears both.
EOF

printf 'Press Ctrl+C to stop docdeck.\n'
wait "$APP_PID"
```

Then run the manual pass:

```bash
chmod +x scripts/simulate_folder_watch.sh
npm run simulate:folder   # add to package.json scripts in Phase 7
```

**Verification**

- All checklist items above pass by hand against a built binary.
- `echo >> "$WORKSPACE/backlog/active/plan.md"` from a shell repaints the
  active tab; `mv "$WORKSPACE/backlog/reports/report_1.md" ...` marks the tab
  deleted.

---

## Phase 7 — Documentation, housekeeping, and implementation report

### 7.1 `README.md` [MODIFY]

- Features: add a **Watched folders** bullet describing `docdeck ./_ai`, the
  picker modal, background auto-open of new/edited files, and the deleted-file
  marker.
- Usage: add examples and a short paragraph on reopening the picker:

  ```bash
  # Watch a whole agent workspace: pick files, stay subscribed
  docdeck ./_ai

  # Mix folders and documents
  docdeck ./_ai notes.md

  # Reopen the picker in the running window (folder forwarded via single-instance)
  docdeck ./_ai
  ```

- Controls table: no new toolbar button; note that closing a tab does not stop
  folder watching and that an agent edit reopens it in the background.
- Development: add `npm run simulate:folder`.
- Architecture: add `paths.rs`, `folder.rs`, `file-tree.ts`, `folder-modal.ts`
  to the module list and describe the `paths-changed` event next to
  `open-path-cli`.
- Known limitations: replace *"Watches files, not directories"* with the new
  reality: renames surface as delete + create (marker + new tab); a file written
  into a directory created in the same inotify beat may be missed until its next
  write; roots/selection are not persisted across restarts.

### 7.2 `package.json` [MODIFY]

```json
    "simulate:folder": "./scripts/simulate_folder_watch.sh",
```

### 7.3 `CHANGELOG.md` [MODIFY]

Under `## [Unreleased]` → `### Added`:

```markdown
- Watched folder roots: `docdeck ./_ai` opens a checkbox picker of every
  Markdown document in the tree, then starts a recursive watch. New and edited
  files open in background tabs with the unread dot; deleted files keep their
  tab with a "deleted on disk" marker that clears when the file reappears.
  Directory watches also follow atomic write-to-temp-then-rename saves that
  the previous per-file watch missed. Multiple folder arguments are supported
  and rerunning the CLI on a watched folder reopens the picker.
- `scripts/simulate_folder_watch.sh` end-to-end harness for folder mode.
```

Under `### Changed`:

```markdown
- Watcher events are now batched and typed (`paths-changed` carrying
  `{path, exists}`); the single-instance event is `open-path-cli` carrying
  `{path, is_dir}`.
```

### 7.4 `.gitignore`

No new file types, directories, or build artifacts are introduced — no change
required. Confirm this explicitly rather than touching the file.

### 7.5 Full regression pass

```bash
npm run check         # typecheck + cargo test + vitest + tauri build --no-bundle
npm run lint:rs
./scripts/simulate_agent_writes.sh   # file-mode smoke test still passes
./scripts/simulate_folder_watch.sh   # new folder-mode smoke test
```

### 7.6 Write the implementation report

Create
`_ai/backlog/reports/261005_1231__IMPLEMENTATION_REPORT__watched_folder_roots.md`:

```markdown
---
filename: "_ai/backlog/reports/261005_1231__IMPLEMENTATION_REPORT__watched_folder_roots.md"
title: "Report: Watched folder roots: recursive _ai monitoring with a selection modal"
createdAt: <YYYY-MM-DD HH:mm>
updatedAt: <YYYY-MM-DD HH:mm>
planFile: "_ai/backlog/active/261005_1231__IMPLEMENTATION_PLAN__watched_folder_roots.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 0
filesModified: 0
filesDeleted: 0
tags: [watcher, inotify, cli, modal, ux]
documentType: IMPLEMENTATION_REPORT
---

# Report: Watched folder roots

## 1. Summary
<2-3 sentences: what was built and verified.>

## 2. Files Changed
<New files with descriptions; modified files with summaries; deleted files.>

## 3. Key Changes
<Backend: roots registry, recursive watch, paths-changed batching. Frontend:
picker modal, background auto-open, deleted marker, single-instance fold.>

## 4. Deviations from Plan
<Any deviation, especially the mini-debouncer existence-sampling constraint
and anything that surfaced during implementation.>

## 5. Technical Decisions
<Lock ordering; directory watch fixing rename-replace; pure/IO split.>

## 6. Testing Notes
<cargo test / vitest coverage added; exact manual checklist run.>

## 7. Usage Examples
<docdeck ./_ai, mixing files, reopening the picker.>

## 8. Documentation Updates
<README, CHANGELOG, package.json script.>

## 9. Next Steps
<Rename pairing (notify-debouncer-full), root persistence, per-root exclusions.>
```

Also update `git status` check: only intended files are staged when the user
asks to commit.

---

## Traceability

No spec exists (`sourceSpec`/`sourceHandoff` empty); the acceptance criteria in
Section 2 were agreed in the design discussion and are the binding contract for
this plan.

| Phase | Satisfies | How |
| --- | --- | --- |
| 1 | AC-01 (scan basis), AC-07 | `scan_markdown` lists only `*.md`, skips hidden/backup/symlinks; `is_relevant`/`classify_args` encode the file-vs-folder rules |
| 2 | AC-01, AC-04–AC-08 | `watched_roots` registry plus `RecursiveMode::Recursive`; batched `{path, exists}` events; open-file relevance keeps non-md tabs reloading |
| 3 | AC-01, AC-03, AC-09, AC-10 | `scan_folder`/`watch_folders` commands; `startup_paths` and `open-path-cli` classify folders vs documents |
| 4 | AC-01, AC-02 | Tree builder and modal with checkboxes, pre-check through `isOpen`, Cancel/Confirm buttons |
| 5 | AC-02–AC-06, AC-09, AC-10 | Startup and single-instance picker flow; background `openDocument`; `applyPathChange` reload/auto-open/deleted-marker logic |
| 6 | AC-04–AC-08 | Folder-mode simulation with an agent loop verifying create/edit/delete behavior |
| 7 | all | Docs, changelog, regression pass, and the implementation report |

## Execution order

Phases are strictly ordered: 1 → 2 → 3 → 4 → 5 → 6 → 7. Each phase ends with its
own verification commands; do not start the next phase until the current one is
green. The only external contract change is the two Tauri event payloads, both
internal to the app; no persisted schema changes, so no migration or
backward-compatibility window is required.


