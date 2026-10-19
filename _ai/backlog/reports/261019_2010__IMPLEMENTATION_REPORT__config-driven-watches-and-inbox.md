---
filename: "_ai/backlog/reports/261019_2010__IMPLEMENTATION_REPORT__config-driven-watches-and-inbox.md"
title: "Report: Config-driven watches and the Thunderbird-style file inbox"
createdAt: 2026-10-19 20:10
updatedAt: 2026-10-20 00:17
planFile: "_ai/backlog/active/261019_2010__IMPLEMENTATION_PLAN__config-driven-watches-and-inbox.md"
project: "docdeck"
status: completed
filesCreated: 10
filesModified: 18
filesDeleted: 4
tags: [config, watcher, inbox, unread, ux, glob]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Config-driven watches and the file inbox

## 1. Summary

Implemented the full config-driven watch registry and Thunderbird-style file
inbox:

- `~/.config/docdeck/config.toml` (XDG-aware, `$DOCDECK_CONFIG` override) with
  `watch` and `exclude` arrays, `~` expansion and `*`/`**` glob selectors,
  capped at 256 roots and 10,000 files.
- Matched directories become recursive Markdown watches; matched files are
  watched whatever their extension. Hidden entries, symlinks and build
  directories are skipped in both the scan and the event stream.
- A collapsible **Inbox** panel lists every matched document newest-first with
  project chip, compacted parent path and relative/exact time. Unread is
  session-scoped; new files never steal a tab; deleted files keep a
  struck-through row until recreated.
- The active document pulses its tab dot on a write instead of going unread;
  background tabs and their inbox rows stay bold until activated.
- The folder picker and file tree are removed. `docdeck <file>` opens a tab and
  `docdeck <folder>` adds a session watch that feeds the same inbox; nothing is
  auto-opened by the watcher.

All 11 acceptance criteria from the plan are covered by implementation and
automated tests. The interactive GUI checklist (section 6) still needs a human
walkthrough.

## 2. Files Changed

### Created (10)

| File | Purpose |
| --- | --- |
| `src-tauri/src/config.rs` | TOML config, `$DOCDECK_CONFIG`/XDG resolution, selector expansion, caps |
| `src-tauri/src/config_test.rs` | Parsing, override, tilde/glob expansion and cap tests |
| `src/project.ts` | `fileName`, `parentPath`, `compactPath`, `projectName`, `isUnderAny` |
| `src/project.test.ts` | Path helper tests |
| `src/relative-time.ts` | Relative time formatting and exact timestamps |
| `src/relative-time.test.ts` | Time formatting tests |
| `src/inbox-model.ts` | Pure session inbox state (merge/replace/upsert/markRead/markDeleted) |
| `src/inbox-model.test.ts` | Unread, delete and ordering tests |
| `src/inbox-panel.ts` | DOM rendering of the inbox, rows, hints and warnings |
| `src/inbox-panel.test.ts` | Panel rendering, chip/time/active/open tests |

### Modified (18)

- Backend: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/src/paths.rs`, `src-tauri/src/paths_test.rs`,
  `src-tauri/src/folder.rs`, `src-tauri/src/folder_test.rs`,
  `src-tauri/src/watcher.rs`, `src-tauri/src/watcher_test.rs`,
  `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.
- Frontend: `src/main.ts`, `src/preferences.ts`, `src/preferences.test.ts`,
  `index.html`, `src/style.css`.
- Documentation/harness: `README.md`, `CHANGELOG.md`,
  `scripts/simulate_folder_watch.sh`.

### Deleted (4)

- `src/folder-modal.ts`, `src/folder-modal.test.ts`, `src/file-tree.ts`,
  `src/file-tree.test.ts` (the picker UI and its tree).

## 3. Key Changes

### Config and expansion

- `config_path()` prefers a non-empty `$DOCDECK_CONFIG`, then
  `$XDG_CONFIG_HOME/docdeck/config.toml`, then `~/.config/docdeck/config.toml`.
- Missing config is a first-run state (setup hint); malformed/unreadable config
  is a non-fatal error surfaced in the panel.
- Literal selectors are canonicalized and classified as roots or files.
  Glob selectors walk from their longest literal base, with `*` limited to one
  path component (`literal_separator(true)`) and `**` allowed any depth;
  `**/` also matches zero components (pinned by a test).
- Duplicate selectors are skipped; per-selector warnings never abort the rest.
- `ExcludeSet` is built leniently (bad patterns warn, don't fail) and applied
  to scans, CLI folder additions and watcher events.

### Safety and limits

- Hidden entries, `*.md~` backups, `node_modules`, `target`, `dist`, `build`,
  `.venv`, `venv` and symlinks are pruned during walks and ignored for events.
- The root cap (256) and file cap (10,000) set `truncated` and emit warnings
  instead of failing; remaining budgets carry across roots and explicit files.

### Watcher and commands

- `WatcherState` now tracks pinned paths (config files and open tabs) and roots,
  applies excludes, still suppresses `Access(Close(Write))` noise, and emits
  `PathChange { path, exists, modifiedTime }`.
- `load_watches` scans config roots/files, pins explicit files and returns
  `WatchLoad { configPath, configFound, roots, entries, warnings, error,
  truncated }`. `add_watch` handles CLI folders separately so session rows
  survive (`merge`) after the startup inventory (`replace`).
- `load_file`/`close_file` keep pinned files watched after the tab closes.

### Frontend

- `InboxModel` is the single unread writer: inventory is plain, events upsert
  unread unless the path is the active document, activation marks read, delete
  marks deleted and recreate clears both flags.
- `applyPathChange` reloads only open tabs, uses per-path reload tokens so a
  stale read cannot win, and never opens a tab.
- The active document updates in place and pulses its tab dot for 2.5 s;
  background tabs get the amber unread dot.
- Inbox rows show a project chip for `_ai` paths, compacted parent path,
  relative time with the exact timestamp in the tooltip, open/active accents,
  and a struck-through deleted state.
- Header toggle `✉ Inbox` persists `inboxVisible` (default on) alongside the
  existing outline/frontmatter/theme preferences.

## 4. Deviations from Plan

1. **`globset` + `walkdir` instead of `glob`** — agreed during the handoff and
   documented in the plan: `glob` has no clean literal-separator control or
   directory filtering here, and `**/` zero-depth behavior is pinned by tests.
2. **Delete events for unopened inbox rows** — the planned `is_relevant`
   required `path.is_file()`, which suppressed delete events for files that
   existed at startup but were never opened, contradicting AC-08 (strikethrough
   for deleted rows). `is_relevant` now accepts a missing Markdown path under a
   watched root; the plan's original `missing.md` assertion and doc comment were
   updated accordingly. The watcher still rejects noise, hidden, excluded and
   out-of-root paths, and the frontend ignores deletes for untracked paths.
3. **`cargo fmt` applied to the new/modified Rust files** — formatting-only.

No ADR was added: the two architectural decisions for this work already exist
(`ADR__261019-1__config-driven-watch-registry.md`,
`ADR__261019-2__session-scoped-unread-inbox.md`).

## 5. Technical Decisions

- Canonical paths everywhere (config expansion, scan, watcher, tabs, inbox) so
  HashSet/Map keys and UI lookups always agree.
- The backend remains the single source of watched paths and inbox inventory;
  the frontend never infers a scan and only trusts `load_watches`/`add_watch`.
- Exclusions are enforced twice (walk pruning and event filtering) so writes to
  ignored paths cannot create row flicker.
- Session unread is intentionally memory-only; the persisted inventory is
  freshness, not read state.
- Config is read once at startup per the agreed scope; restart is the reload
  mechanism.

## 6. Testing Notes

Commands run from the repository root:

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint:rs` (`cargo clippy --all-targets -- -D warnings`) | passed |
| `cargo fmt --check` | passed (after `cargo fmt`) |
| `npm test` | Rust: 53 tests passed; vitest: 12 files / 91 tests passed |
| `npm run check` | passed, including Vite build and release `tauri build --no-bundle` |
| `./scripts/simulate_folder_watch.sh` (30 s timeout) | launch + all simulated writes/deletes/recreates completed; window opened on `DISPLAY=:0.0` |
| Release binary smoke | stayed alive 8 s with a temp config, empty stderr |

Covered by automated tests: config parsing/malformed paths/override, tilde and
glob expansion (including `**/` at root and nested), root/file caps, exclude
sets, noise/hidden filtering, deleted-path relevance, folder scanning with
limits, watcher pinning/filtering/classification, CLI arg classification,
inbox model transitions/ordering, panel rendering (chips, times, unread/open/
active/deleted, setup hint, warnings), relative-time boundaries and preferences
round-trips.

The GUI checklist from the plan (bold at launch, active-write pulse, row click
clearing bold, struck-through delete, toggle persistence across restart,
missing/broken config hints in a real window) remains a manual walkthrough.

## 7. Usage Examples

```toml
# ~/.config/docdeck/config.toml
watch = [
  "~/devel/*/_ai",
  "~/notes/**/*.md",
  "~/journal/today.txt",
]
exclude = [
  "**/archive/**",
  "**/templates/**",
]
```

```bash
docdeck README.md                     # open a tab
docdeck ~/devel/project/_ai           # session watch feeding the inbox
DOCDECK_CONFIG=/tmp/alt.toml docdeck  # alternate config
./scripts/simulate_folder_watch.sh    # end-to-end inbox simulation
```

Inbox usage: click `✉ Inbox` to show/hide; click a row to open or activate its
tab (which clears bold); restart to clear all session unread marks.

## 8. Documentation Updates

- `README.md`: features, "Watching folders on every launch" config reference,
  inbox behavior, controls table (`✉ Inbox`), preferences text, backend
  commands/events and known limitations.
- `CHANGELOG.md`: Added/Changed/Removed entries under `[Unreleased]`, including
  the new commands, event payload and removal of the picker.
- `scripts/simulate_folder_watch.sh`: rewritten to create a throwaway config and
  workspace, then drive writes, deletes, recreates and ignored paths.

## 9. Next Steps

1. Run the app once and walk the 11-point visual checklist from the simulation
   script (the only unverified part).
2. Commit the change set (excluding generated build artifacts) and push/PR when
   approved.
3. Future scope: live config reload (currently restart-only), per-selector
   depth controls and inbox file grouping if lists grow large.
