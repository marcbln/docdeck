---
filename: "_ai/backlog/reports/261005_1231__IMPLEMENTATION_REPORT__watched_folder_roots.md"
title: "Report: Watched folder roots: recursive _ai monitoring with a selection modal"
createdAt: 2026-10-05 21:25
updatedAt: 2026-10-05 21:25
planFile: "_ai/backlog/active/261005_1231__IMPLEMENTATION_PLAN__watched_folder_roots.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 9
filesModified: 10
filesDeleted: 0
tags: [watcher, inotify, cli, modal, ux]
documentType: IMPLEMENTATION_REPORT
---

# Report: Watched folder roots

## 1. Summary

`docdeck <folder>` now works: instead of failing inside `read_to_string`, a folder
argument opens a checkbox picker of every `*.md` document beneath it, and
confirming starts one recursive watch per root. New and edited documents then
open themselves as background tabs with the unread dot, deleted files keep their
tab and content behind a "deleted on disk" marker, and rerunning the CLI on a
folder reopens the picker in the running window. The recursive directory watch
also fixes the write-to-temp-then-rename gap the previous per-file watch
documented as a known limitation. 19 new unit tests (9 Rust, 10 frontend) bring
the suites to 22 `cargo test` and 73 `vitest` tests.

## 2. Files Changed

**New** (9):

| File | Purpose |
| --- | --- |
| `src-tauri/src/paths.rs` | `CliEntry`, `is_markdown`, `is_under`, `is_under_any`, `is_relevant`, `is_ignored_name`, `classify_args` — the rules that decide what docdeck cares about, free of Tauri and watcher types |
| `src-tauri/src/paths_test.rs` | 5 tests — extension casing, whole-component containment, hidden/backup names, relevance precedence, CLI file/dir tagging |
| `src-tauri/src/folder.rs` | `scan_markdown`: recursive `*.md` discovery, sorted, skipping hidden entries, `~` backups and symlinks |
| `src-tauri/src/folder_test.rs` | 2 tests — recursive scan with noise, non-directory rejection |
| `src/file-tree.ts` | `buildTree`: flat absolute paths → nested picker tree (directories first, alphabetical) |
| `src/file-tree.test.ts` | 4 tests — nesting, sort order, out-of-root paths, files directly under the root |
| `src/folder-modal.ts` | `FolderModal`: checkbox tree, Cancel / "Watch folders + open selected files", escape and overlay dismissal, inline scan errors |
| `src/folder-modal.test.ts` | 5 tests — hidden-by-default, pre-check via `isOpen`, checked/known reporting, cancel, inline errors |
| `scripts/simulate_folder_watch.sh` | Folder-mode sibling of `simulate_agent_writes.sh`: throwaway `_ai` tree, agent create/edit loop, 8-point manual checklist |

**Modified** (10):

- `src-tauri/src/watcher.rs` — added a `watched_roots` registry beside
  `watched_paths`, a typed `PathChange { path, exists }` payload, batched
  `paths-changed` emission, and `watch_roots` using `RecursiveMode::Recursive`.
  The callback scopes its lock guards so no registry stays locked across the
  emit.
- `src-tauri/src/watcher_test.rs` — 3 tests for root idempotency, multiple roots
  and file/root registry independence (existing 4 kept).
- `src-tauri/src/commands.rs` — added `FolderScan`, `scan_folder` and
  `watch_folders`; `load_file`/`close_file` unchanged apart from the import block.
- `src-tauri/src/lib.rs` — `collect_paths`/`startup_paths` replaced by
  `paths::classify_args` returning typed `CliEntry` values; single-instance event
  renamed `open-file-cli` → `open-path-cli`; new commands registered.
- `src/main.ts` — `CliEntry`/`PathChange`/`FolderScan` payloads; `Tab.deletedOnDisk`;
  `openDocument` background mode; `applyPathChange`; `closeTabPath` extracted
  from `closeTab`; `showFolderModal`/`confirmFolders`; picker wiring in the
  constructor; `startup_paths` and both listeners switched to the new shapes.
- `src/style.css` — 174 lines for the picker overlay, tree, footer, and the
  deleted-on-disk tab/tab-strikethrough/banner styles, all on existing Catppuccin
  variables so light and dark both work.
- `index.html` — empty-state copy now mentions `docdeck <folder>`.
- `package.json` — `simulate:folder` script.
- `README.md` — watched-folders feature bullet, folder usage examples, "closing a
  tab does not stop the folder watch" note in the controls table, module list,
  the two-event contract table, and a rewritten *Known limitations*.
- `CHANGELOG.md` — folder-roots and simulation entries under Added, the new event
  payloads under Changed.

**Deleted**: none.

## 3. Key Changes

**Backend.** `paths.rs` centralises three decisions that used to be implicit:
what counts as Markdown, what lies under a watched root, and whether a settled
event is worth forwarding. `is_relevant` is the interesting one — an explicitly
opened file is relevant whatever its extension (docdeck renders anything the CLI
hands it), while inside a watched root only *existing* Markdown counts, which is
what makes `.gitkeep`, editor droppings and directories fall through as noise and
suppresses delete events for files that were never opened.

`watcher.rs` now owns two registries over one debouncer. `watch_roots` registers
each root once and attaches `RecursiveMode::Recursive`; because the directory
inode survives an atomic save, the tab keeps reloading through rename-replace,
which is the limitation the README used to carry.

**Frontend.** `buildTree` is a pure transform so the picker's awkward cases are
tested without a DOM. `FolderModal` owns DOM and selection only — scanning,
watching and tab opening stay with the caller, which is why it imports no Tauri
module. A checkbox reflects "does this path have a tab", so the modal edits one
bit of truth instead of a parallel selection model; unchecking on confirm closes
the tab, checking opens it.

`applyPathChange` derives the action from the tab registry and the sampled
`exists`: mark deleted if gone, reload if open, otherwise open in the background.
`openDocument`'s background mode never calls `setActiveTab`, so an agent writing
four reports while you read a plan cannot steal focus, and it suppresses the
error toast for the create/delete race.

## 4. Deviations from Plan

1. **Phase 1's clippy gate could not pass as written.** `cargo clippy -D warnings`
   runs after Phase 1, but `paths.rs` is wired into the app only in Phase 3, so
   every new function trips `dead_code`. Rather than sprinkle `#[allow(dead_code)]`
   attributes that Phase 3 would have to remove, verification was run at the end of
   Phase 3, which the plan also specifies. `cargo test` was green from Phase 1.
2. **`cargo fmt` was run** (not in the plan). The plan's Rust snippets are not
   rustfmt-clean — two call sites in `paths_test.rs` exceed the width and
   `lib.rs` was missing its trailing newline — so formatting was normalised once
   before the final clippy/test pass.
3. **A checklist item was added** to the simulation script (step 8, a rename via
   `mv`) to exercise the delete marker on the path users actually hit, per the
   phase's `mv`-based verification note.
4. **README gained an event-contract table** instead of a prose sentence: there
   are now two events with structured payloads, and the table states the
   `exists`-sampling rationale that replaces the old one-line mention.

## 5. Technical Decisions

- **Lock ordering.** Command threads take `watched_paths` (or `watched_roots`),
  release it, then take `debouncer`. The event callback takes `watched_paths`,
  then `watched_roots`, and never `debouncer`. No cycle exists, and the emit
  happens outside every guard so the webview can never block watch registration.
- **Directory watch over file watch for roots.** Watching the directory is what
  makes new-file discovery possible at all, and it is what survives
  write-to-temp-then-rename. Root watches are not released when a tab closes —
  closing a tab is deliberately non-sticky, since the next agent edit should
  reopen it in the background.
- **Existence sampling instead of event classification.**
  `notify-debouncer-mini` 0.4 does not classify create/modify/remove, only
  reports settled paths. Sampling `Path::exists()` after the debounce window plus
  the frontend's own tab registry reproduces every required behaviour. Swapping to
  `notify-debouncer-full` is the follow-up if real event kinds are ever needed —
  chiefly rename pairing, which is the one deferred feature.
- **Pure/IO split.** Every rule that decides *what matters* lives in `paths.rs` and
  `file-tree.ts` with no Tauri import, and each has a sibling `*_test.rs` /
  `*.test.ts` registered in `lib.rs` / picked up by the vitest glob. Only
  `watcher.rs`, `commands.rs`, `folder-modal.ts` and `main.ts` touch IO or the DOM.

## 6. Testing Notes

Automated:

```
cargo test        22 passed (5 paths, 2 folder, 3 new watcher, 4 render, 8 pre-existing)
vitest run        73 passed / 10 files (10 new: 4 file-tree, 5 folder-modal, 1 pre-existing set)
tsc --noEmit      clean
cargo clippy --all-targets -- -D warnings   clean
cargo fmt --check clean
npm run check     typecheck + cargo test + vitest + tauri build --no-bundle → release binary built
```

Coverage worth naming: `is_relevant` is tested against all four branches
(open non-Markdown file, fresh Markdown under a root, never-existing path,
Markdown outside every root), and `folder.rs` is tested against a tree
containing hidden directories, a `~` backup, a `.txt` file and a `.MD` file to
prove the filter is extension-casing aware.

Not automated, by nature: the GUI end-to-end pass. `npm run simulate:folder`
builds the workspace, launches the release binary on it, drives four
create/edit rounds and prints an 8-point checklist for a human against a real
window. Every item is a visual or focus assertion that no headless test in this
repo's stack can make. The checklist covers picker contents, confirm/cancel
semantics, background auto-open without focus theft, single-instance forwarding,
and the delete marker appearing and clearing.

## 7. Usage Examples

```bash
# Watch a whole agent workspace: pick files, stay subscribed
docdeck ./_ai

# Mix folders and documents — the file opens immediately, the picker follows
docdeck ./_ai notes.md

# Later, from any shell: reopen the picker in the running window,
# with every currently open document pre-checked
docdeck ./_ai
```

Inside the picker, checking a file opens it and unchecking it closes the tab.
Closing a tab by hand is not sticky while a root is watched — the next agent edit
reopens it in the background.

## 8. Documentation Updates

- `README.md`: watched-folders feature bullet; folder examples in Usage; the
  controls-table note on non-sticky closes; `simulate:folder` in Development;
  `paths.rs`, `folder.rs`, `file-tree.ts`, `folder-modal.ts` in the module list;
  a two-row event-contract table; *Known limitations* rewritten — the old
  "Watches files, not directories" entry is replaced by rename tracking, tree
  persistence and the just-created-directory caveat.
- `CHANGELOG.md`: folder roots + simulation under Added, the typed event payloads
  under Changed, both under `## [Unreleased]`.
- `package.json`: `simulate:folder`.
- `.gitignore`: unchanged, confirmed rather than edited — no new file types,
  directories or build artifacts are introduced.
- No ADR written. The two candidate decisions (directory-level watches, existence
  sampling) are constraint-driven, forward-compatible and already recorded with
  their rationale in the README and in this report; the Tauri event payload
  change is internal to a single binary and trivially reversible.

## 9. Next Steps

- **Rename pairing.** Pair `MOVED_FROM`/`MOVED_TO` so a rename moves the tab
  instead of leaving a deleted marker and opening a duplicate. Requires
  `notify-debouncer-full` — the one reason to leave `notify-debouncer-mini`.
- **Root persistence.** Restore watched roots and the last selection on relaunch,
  so `docdeck` with no arguments reattaches to the tree from last time. Needs a
  settings file alongside the existing `localStorage` preferences.
- **Per-root exclusions.** `.gitkeep` and `~` are filtered globally; a
  workspace-specific ignore list (e.g. `archive/`) would help large trees.
- **Watch scope control.** A "stop watching this folder" affordance next to the
  picker's cancel, since roots currently live for the whole session.