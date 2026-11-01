# Phase 0 Research: Watch Configuration and Inbox Follow-ups

**Feature**: `002-watch-inbox-followups` | **Date**: 2026-11-01

All unknowns from the Technical Context are resolved below. No `NEEDS
CLARIFICATION` remains.

## R1 — How to detect and apply configuration changes while running

**Decision**: Add a Rust `config_watch` module that watches the *parent
directory* of the config path with a debounced watcher (300 ms, matching the
document debounce). On a relevant event it re-reads the config, expands it, and
runs one shared `reconcile_config` function used by startup, save, and external
edits. Each run carries a monotonically increasing generation number; results
from a superseded generation are discarded. Valid results emit `config-reloaded`
with the new inventory, roots, warnings, error, revision, and generation.
Invalid or unreadable results emit the same event with `error`/`found=false`
and **no inventory replacement**. The previous watches stay registered.

Watching the parent directory (not the file) is required: editors and agents
save atomically by writing a temporary file and renaming it over the original,
which invalidates a file-level watch.

If the re-read revision equals the last successfully applied revision, the
reload skips expansion and only refreshes the status line. This prevents an
in-app save from causing a second, duplicate rescan when the file watcher also
fires (FR-007).

**Rationale**: The backend already owns config parsing, expansion, excludes, and
watch registration. Keeping reload there preserves the constitution boundary and
lets invalid configs preserve the last valid watch plan. A generation token is
the smallest mechanism that makes rapid saves settle on the last valid result
without duplicate or flickering rows (FR-007).

**Alternatives rejected**:
- Polling the config from the webview — violates P-V ("use backend events
  instead of polling") and duplicates parsing.
- Re-invoking `load_watches` on a timer — same problems, plus it cannot
  distinguish a stale result from a current one.
- Restarting the process — the requirement being replaced.

## R2 — How reload reconciles inventory without disturbing view state

**Decision**: Tag every backend inventory entry with an origin:
`config` (matched by the current config) or `session` (a CLI folder). The
webview keeps a third origin, `manual` (a document opened directly or from a
link outside every watch). On reload the webview:

- replaces all `config` entries with the new config entries;
- rescans `session` entries through the backend result, so new excludes apply to
  them too;
- keeps `manual` entries;
- preserves `changedAt`, `unread`, and open/active state for paths that survive;
- removes rows for config entries no longer matched **even if their tab is
  open** (FR-003 keeps the tab, not the row);
- adds newly matched paths as unread (new work, consistent with a move-in and a
  re-added watch);
- leaves `Recently Changed` session-scoped and untouched by reload.

Open tabs are never closed; the active path is unchanged. Removed config
selectors therefore end watch membership only.

A reload that overlaps the initial scan is ordered by the same generation token:
the webview applies only the newest result, and inventory entries are keyed by
path, so an overlapping scan can neither duplicate rows nor move a document into
the wrong list.

**Rationale**: A full `inbox.replace()` currently wipes session rows and any
unread state. Origin-aware replacement is the smallest change that satisfies
FR-002–FR-007 and the spec's edge case where a reload removes an open document's
location. The rule for newly matched paths follows FR-027 and the clarification
that a re-added document enters as new.

**Alternatives rejected**:
- Diff by watched roots only — misses explicit-file selectors and exclude
  changes.
- Derive config membership from `isUnderAny(roots)` in the webview — explicit
  file selectors are not under a root.
- Keep every previously seen path — removed selectors would never leave the
  list.

## R3 — How to detect renames and moves

**Decision**: Replace `notify-debouncer-mini` with `notify-debouncer-full`, which
preserves `notify::EventKind` (`Modify(Name(From|To|Both))`, `Remove`, `Create`,
`Modify(Data)`). Add a pure `rename` pairing module and a
`FileIdentity { volume, index }` cache in `WatcherState`:

- Seed the cache from every inventory entry (`load_watches`, `add_watch`) and
  every opened file.
- On `From`/removal-of-name, hold the old path and its cached identity for up to
  2 seconds.
- On `To`/appearance, stat the new path and pair it with the oldest pending
  `From` that has the same identity; emit one `renamed` change
  (`path = new`, `fromPath = old`, `modifiedTime`).
- A `From` with no `To` after 2 seconds is a move-out: emit `movedOut`.
- A plain `Remove` is a delete and keeps the existing struck-through behavior.
- A `To`/`Create` with no matching `From` is a new document: emit `created`
  (unread).
- If identity is unavailable (zero/unsupported), fall back to the spec's
  delete-plus-create behavior.

Identity uses `std::os::unix::fs::MetadataExt` (`dev`, `ino`) on Unix/macOS and
`std::os::windows::fs::MetadataExt` (`volume_serial_number`, `file_index`) on
Windows; no dependency is needed.

**Rationale**: `notify-debouncer-mini` deliberately collapses every event to
`Any`, so a move-out cannot be distinguished from a delete. FR-026 requires the
move-out row to leave the list while ordinary deletes keep the existing
struck-through row (SC-009). File identity also makes rapid renames
(FR-029) and case-only renames on case-insensitive platforms (FR-030) resolve to
one row.

**Alternatives rejected**:
- Pair `exists=false` with `exists=true` by filename or by mtime only — false
  pairs on unrelated delete/create bursts and cannot detect a move-out.
- Hash file contents — reads every changed document, violates the
  metadata-only inventory rule, and is slow.
- A custom `notify` debouncer — reimplements a tested crate for no gain.
- `notify-debouncer-full` alone without identity pairing — emits From and To
  separately and does not attach identity.

## R4 — How to persist unread acknowledgements across restarts

**Decision**: Add `src/acknowledgements.ts`, a pure module over a versioned
`localStorage` key `docdeck.acknowledgements.v1`:

```text
{ version: 1, entries: { "<path>": { "mtime": <number>, "at": <number> } } }
```

- `mtime` is the document's observed filesystem modification time at review
  time, not the wall-clock review time.
- A document is unread on startup when `entry.modifiedTime > ack.mtime`.
- Reviewing a document (activating it, opening it, or a write while it is
  active) sets `ack.mtime = tab.modifiedTime` and persists.
- First launch with no valid store: seed an acknowledgement for every current
  inventory entry (baseline) and persist. Nothing is unread (FR-012). The store
  is created only after the first **successful** inventory load; an invalid or
  unreadable configuration leaves no store behind, so the next successful start
  establishes the baseline instead of treating every document as new.
- Once a store exists, a watched path with no acknowledgement is unread (new or
  re-added work, consistent with FR-027 and the clarification).
- A rename moves the acknowledgement from the old path to the new path; a move
  out of all watches prunes it.
- Prune entries whose path is no longer watched on every successful reload and
  at startup (FR-014, SC-008).
- Corrupt JSON, a wrong version, or a wrong entry shape is treated as a first
  launch; one bad entry is dropped rather than failing the whole store
  (FR-015).
- Writes are debounced like preferences and flushed on `pagehide`/`beforeunload`
  (FR-011). `Recently Changed` remains session-scoped (FR-016).

**Rationale**: Storing the observed mtime makes unread immune to wall-clock
changes, future mtimes, and timezone shifts: a document is unread only when its
mtime actually advances past the value seen at review. `localStorage` keeps view
state in the webview per P-I and reuses the existing versioned, per-field
validation pattern. Seeding a baseline on the first launch is required, because
without it the first later write would be compared with an absent history and
FR-012/SC-002 could not both hold.

**Alternatives rejected**:
- Wall-clock review timestamps — break when the clock moves backwards or a file
  has a future mtime (spec edge case).
- A Rust-owned JSON file — moves view state out of the webview and adds IPC for
  every acknowledgement; the unread set is explicitly view state (P-I).
- Session-only unread — the behavior this feature replaces.

## R5 — How the in-app surface writes the config without destroying hand edits

**Decision**: Add `config_edit.rs` plus two commands:

- `read_watch_config` → `{ path, found, revision, watch[], exclude[], error }`.
  `revision` is a stable FNV-1a 64-bit hash of the raw bytes (implemented
  locally, no crypto dependency).
- `save_watch_config({ watch[], exclude[] }, expectedRevision)` → either an
  applied reload result, a conflict, a validation error, or an I/O error.

The save path:

1. Re-read the file and compare `revision`; mismatch → `conflict` with the
   current selectors/revision and **no write**.
2. If the file is missing and the surface chose "create from example", start
   from a small valid template.
3. Parse with `toml_edit::DocumentMut`, replace only the `watch` and `exclude`
   arrays, and leave every other key, comment, and formatting choice intact
   (FR-036). Unknown keys and `[tray]` survive. Mutate the existing array items
   in place (add/remove/retain) so per-item comments and decor on retained
   selectors are preserved; only the changed selector entries are reformatted.
4. Re-parse the edited text with the existing typed `WatchConfig` loader and
   expand it; malformed TOML or an invalid selector blocks the write with a
   precise message (FR-035). Duplicate selectors (exact string match) are folded
   and reported; non-existent paths and unmatched selectors remain warnings, as
   today, because they are valid configuration.
5. Write atomically: create the config directory if needed, write a temporary
   file in the same directory, flush/sync, then rename over the target. On
   Windows, remove-then-rename inside a short critical section (std `rename`
   does not replace an existing file).
6. Trigger the same `reconcile_config` used by the file watcher and return its
   result.

If the existing file is present but cannot be parsed, structural editing is
disabled: the surface shows the parse error and offers **Open config file** in
the OS editor. It never silently replaces a broken hand-written file; a
destructive "replace with a fresh file" action would require its own explicit
confirmation and is not part of the normal save path.

A failed save leaves the previous config bytes and active watches untouched and
keeps the draft in the surface (FR-037). A conflict lets the reader reload the
file or explicitly overwrite after seeing the difference (FR-038).

**Rationale**: `toml_edit` is the only practical way to satisfy the accepted
clarification to preserve comments/formatting/unknown keys. Revision-based
conflict detection prevents silently clobbering an external edit. Validation and
the write happen on one side of the boundary, so the webview never writes files
(P-III).

**Alternatives rejected**:
- Serialize `WatchConfig` with `toml` — destroys comments and unknown keys.
- Edit TOML line-by-line in TypeScript — reimplements TOML parsing and cannot
  validate atomically; also moves file writes into the webview.
- Only open an external editor — fails the in-app-surface requirement.

## R6 — Platform configuration paths and selector normalization

**Decision**: Make path resolution pure and injectable. A `Platform` enum
(`Linux`, `MacOs`, `Windows`, `Other`) is chosen from `cfg!(target_os)` in
production, while tests pass an explicit platform and environment map:

- `$DOCDECK_CONFIG` always wins.
- Linux/other Unix: `$XDG_CONFIG_HOME/docdeck/config.toml`, else
  `$HOME/.config/docdeck/config.toml` (current behavior).
- macOS: `$HOME/Library/Application Support/docdeck/config.toml`.
- Windows: `%APPDATA%\docdeck\config.toml`, else
  `%USERPROFILE%\AppData\Roaming\docdeck\config.toml`.

On Windows, every selector and exclude pattern is normalized from `\` to `/`
before tilde expansion and glob compilation (backslash is an escape character in
`toml` basic strings, so native paths are usually written as single-quoted
literal strings). On Unix a backslash remains a literal filename character, so
normalization is platform-gated and covered by tests for both platforms.

**Rationale**: The spec requires the platform-standard user configuration
location (FR-040) and equivalent selector behavior with native separators
(FR-041, accepted clarification). Injecting the platform keeps the logic
deterministic on the Linux CI machine.

**Alternatives rejected**:
- The `dirs` crate — one more dependency for a dozen lines; also hides the
  mapping from tests.
- Tauri's `app_config_dir` — requires an `AppHandle`, so pure config tests would
  need a running app.
- `~/.config` on every platform — not native on macOS/Windows.

## R7 — Filtering behavior and placement

**Decision**: Add `src/filter-documents.ts` with
`filterEntries(entries, term): InboxEntry[]`. The term is trimmed,
lower-cased once, and matched as a literal substring against `filename`, the
full `path`, and `projectName(path)`. Because paths contain both parent folders
and the `_ai` project segment, this covers every documented match dimension.
Ordering is preserved by filtering in place (no re-sort). Filtering never
mutates entries.

The sidebar browse toolbar gets a search input. Its value lives in `main.ts`
session state (never in `Preferences`, because the filter is session-scoped).
`SidebarPanel` owns the input element and re-applies only counts/list data on
render, so typing focus and caret survive watcher events. The selected list
(All or Recently Changed) is filtered; the term survives mode switches; the
pop-out inventory receives the filtered inventory. An empty result renders
"No documents match “term”" with a Clear button (FR-021). Clearing is one click
or `Escape` in the input.

**Rationale**: O(n) substring matching over 10,000 entries is far below the
100 ms target; the existing virtual list keeps rendering proportional to the
viewport. Keeping the term out of `Preferences` satisfies the session-only
assumption, and one shared filter function gives All Documents and Recently
Changed identical rules.

**Alternatives rejected**:
- Row-level DOM filtering — breaks virtualization and scroll math.
- Persisting the filter — contradicts the session-scoped assumption (and would
  surprise after restart).
- Fuzzy matching — the spec treats punctuation as literal text and asks for
  name/location/project substring matching.

## R8 — Configuration surface placement and states

**Decision**: Add a header control "Watches" (keyboard reachable, visible even
when the browse section is hidden) that opens a modal dialog. The dialog shows:

- the effective config path, whether it exists, and the current validity;
- the outcome of the most recent reload (success time, warnings, truncation, or
  error);
- editable `watch` and `exclude` lists with add/remove rows and Enter-to-add;
- "Create from example" when no file exists;
- Save, Reload, and Cancel actions;
- an outside-edit conflict banner with "Reload from disk" and "Overwrite";
- inline field errors; save failures keep the dialog and draft open.

A pure `ConfigEditorModel` holds the draft, original revision, dirty flag,
validation messages, conflict state, and the create-from-example flag. `Esc`
closes only when the draft is clean or after an explicit discard confirmation.

**Rationale**: A modal matches the existing pop-out pattern (`InboxBrowser`),
keeps the document reader visible behind it, and is reachable regardless of
sidebar visibility. Separating the draft model from the DOM keeps validation and
conflict handling testable.

**Alternatives rejected**:
- A sidebar-only button — unreachable when the browse section is hidden and
  cramped for two selector lists.
- A separate native window — extra window lifecycle and state for a small form.
- Editing the raw file in a text area — makes the "add/remove selectors" flow
  and precise per-field errors harder, though it remains the fallback for
  fixing malformed TOML outside the app.

## R9 — Reload performance and the 2-second target

**Decision**: Run each reload off the main thread (reusing the blocking-worker
pattern), debounce bursts, and stream existing `scan-progress` events. Apply the
new excludes and watch registrations as soon as the file is valid; stream newly
discovered entries in the reload result when the scan finishes. For ordinary
selectors the browse list reflects a save within 2 seconds; for a deep selector
the panel shows live progress and the result lands as soon as the scan
completes.

**Rationale**: SC-001 cannot mean "fully expand an arbitrarily deep wildcard in
2 seconds" on a 100,000-entry tree; the existing product already streams scan
progress for that case. Reflecting the accepted configuration and the resulting
inventory for normal selectors in 2 seconds is the achievable reading, and
progress covers the rest. A full rescan is simpler and correct for excludes,
session folders, and duplicate/rapid saves.

**Alternatives rejected**:
- Incremental per-selector inventories — needs a provenance map, still must
  rescan for excludes, and risks stale rows (the exact failure FR-007 forbids).
- Blocking the webview until the scan finishes — freezes document switching.

## R10 — Dependency and build-parity decisions

**Decision**: Two new Rust runtime dependencies:

- `notify-debouncer-full` for event kinds and debouncing (R3).
- `toml_edit` for comment/format-preserving edits (R5).

Both are small, widely used, and replace hand-written logic that would need its
own tests. No frontend dependency is added.

Platform build audit:

- Gate `config_test.rs`/`folder_test.rs` symlink tests with `#[cfg(unix)]` or use
  a Windows symlink helper, so `cargo test` compiles on Windows.
- `detach.rs` already no-ops off Unix; `render.rs` only sets a WebKitGTK
  variable (harmless elsewhere) and should be cfg-gated to Linux for clarity.
- Verify `tauri.conf.json` bundle targets and the identifier on macOS/Windows.
- `tray.rs`, the notification plugin, and `tauri-plugin-single-instance` support
  all three desktops; no capability change is needed.
- Update `README.md` requirements/paths and `CHANGELOG.md`; note platform paths
  in `_ai/` context.

**Alternatives rejected**:
- Linux-only implementation with a documented gap — fails FR-042/SC-007.
- Adding `dirs`, `atomicwrites`, or a hashing crate — each would duplicate a few
  lines; the local FNV-1a helper and temp-file rename cover the need.
