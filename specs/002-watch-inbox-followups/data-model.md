# Phase 1 Data Model: Watch Configuration and Inbox Follow-ups

**Feature**: `002-watch-inbox-followups` | **Date**: 2026-11-01

This feature keeps the existing in-memory view model and adds one persisted
webview entity (acknowledgements), one persisted file contract (the watch
configuration), and backend-only watch/rename state. Document content remains
unpersisted.

## Entity: WatchConfiguration (persisted file)

The TOML file at the platform-standard configuration path
(`$DOCDECK_CONFIG` overrides it). It remains the source of truth for watches.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Resolved absolute path; shown in the config surface |
| `found` | boolean | `false` on first run |
| `revision` | string | FNV-1a 64-bit hash of the raw bytes, used for conflict detection |
| `watch` | string[] | Managed by the in-app surface |
| `exclude` | string[] | Managed by the in-app surface |
| `tray` | table | Unmanaged by the surface; preserved on save |
| unknown keys | any | Preserved on save |
| comments / formatting | text | Preserved on save |

**Validation rules**

- The file must parse as TOML and deserialize into the existing `WatchConfig`.
- `$DOCDECK_CONFIG` wins over platform defaults.
- On Windows, selectors and excludes normalize `\` to `/` before expansion.
- Duplicate selectors are folded (exact string match) and reported.
- Unmatched/nonexistent selectors and nonexistent exclude bases are warnings,
  not save errors, matching current startup behavior.
- An invalid glob in a selector is a validation error for an in-app save (it
  cannot be made meaningful) and remains a startup warning for hand-edited
  files.
- If the existing file cannot be parsed, the surface shows the parse error and
  offers to open the file externally; structural save is disabled. A broken
  hand-written file is never silently overwritten.
- The only file docdeck writes is this one; watched documents are never written.

**State transitions**

```text
absent --create from example--> present(valid)
present(valid) --save with same/current revision--> present(valid, new revision)
present(any) --save with stale revision--> conflict (no write)
present(any) --save with invalid selectors/TOML--> validation error (no write)
present(valid) --external edit/deletion--> reload attempted
present(valid) --external invalid edit--> previous watches stay active + error
absent/unreadable --recreate/fix--> reload applies when valid
```

## Entity: WatchedDocument (inventory entry, in-memory)

Extends `InboxEntry` with an origin so reload can reconcile without disturbing
open tabs or session/manual documents.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Canonical absolute path; unique key |
| `filename` | string | Display name |
| `modifiedTime` | number | Filesystem mtime, epoch ms |
| `changedAt` | number | Session observation time; `0` for inventory-only rows |
| `unread` | boolean | Unread under the rules below |
| `deleted` | boolean | Missing on disk and retained as a struck row (ordinary delete) |
| `origin` | `"config"` \| `"session"` \| `"manual"` | Provenance for reload reconciliation |

**Invariants**

- One entry per canonical path.
- `origin = "manual"` entries are never removed by a config reload.
- `origin = "session"` entries survive config reloads but are rescanned so new
  excludes apply.
- A config entry no longer matched by the new config is removed on reload even
  when its tab is open (the tab itself stays open).
- A rename moves an entry instead of creating a second one.
- `changedAt` never decreases except through Clear/Undo.
- Reload never changes `unread` for a path that survived the reload (FR-004).

**Reload reconciliation**

```text
new config valid:
  for each new config entry:
    if path exists: update filename/mtime, keep unread/changedAt/origin
    else: add as unread (new work), origin=config
  for each old config/session entry not in the new result:
    remove from inventory (open tabs unaffected)
  rescan session roots with the new excludes
  keep manual entries
  prune acknowledgements for paths that left all watches
```

## Entity: ReaderAcknowledgement (persisted in `localStorage`)

Stored under `docdeck.acknowledgements.v1`:

| Field | Type | Notes |
|-------|------|-------|
| `version` | `1` | Schema version; a different value is treated as a first launch |
| `entries` | `Record<string, { mtime: number; at: number }>` | One entry per watched path |
| `mtime` | number | The document mtime observed when the reader reviewed it |
| `at` | number | Wall-clock observation time (diagnostics only; not used for unread) |

**Unread rule**

```text
unread(path) = entry exists && document.modifiedTime > entry.mtime
no entry + store exists        -> unread (new/re-added document)
no entry + no store (first run)-> read; seed entry.mtime = document.modifiedTime
```

**Write points**

- Activating a document (row click or tab activation).
- Opening a document (it becomes active).
- A watcher write while the document is active (Q1 clarification): refresh the
  entry to the new mtime without producing unread.
- A successful reload that discovers a path already present keeps its entry.
- A rename moves the entry from the old path to the new path; a move out of all
  watches prunes it.

**Pruning / recovery**

- The store is created only after the first successful inventory load. An
  invalid/unreadable configuration at startup leaves no store, so the next
  successful start establishes the baseline rather than marking everything
  unread.
- Entries whose path is no longer watched are removed on startup and on every
  successful reload.
- Corrupt JSON, wrong version, or a malformed entry is ignored; valid entries
  are kept and unread is derived per the rule above.
- Writes are debounced and flushed on `pagehide`/`beforeunload`.
- `Recently Changed` (`changedAt`, `clearedAt`, `ClearSnapshot`) stays
  session-scoped and is not persisted.

## Entity: PathChange (backend event)

Replaces the current `{path, exists, modifiedTime}` shape while remaining
backward-compatible for the tray notification body.

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"created"` \| `"modified"` \| `"deleted"` \| `"renamed"` \| `"movedOut"` | Event classification |
| `path` | string | New/current path for `renamed`; old path for `movedOut`/`deleted` |
| `fromPath` | string? | Previous path when `kind = "renamed"` |
| `exists` | boolean | Sampled after debounce (existing field) |
| `modifiedTime` | number? | Sampled after debounce when the path exists |

**Rules**

- `renamed`: one event, `path = new`, `fromPath = old`; identity matched within
  2 seconds.
- `movedOut`: a rename `From` with no `To` after 2 seconds; remove the inventory
  row and mark any open tab unavailable (FR-026).
- `deleted`: an ordinary removal; keep the existing struck-through row and
  deleted-tab banner (SC-009).
- `created`: a `To`/create with no matching `From`; add as unread (FR-027).
- Rapid renames produce one final `renamed` transition (FR-029).
- Case-only renames on case-insensitive platforms match by identity and update
  the existing entry (FR-030).

## Entity: FileIdentity (backend-only)

| Field | Type | Notes |
|-------|------|-------|
| `volume` | u64 | Unix `dev`; Windows `volume_serial_number` |
| `index` | u64 | Unix `ino`; Windows `file_index` |
| `path` | string | Cache key |
| `modifiedTime` | number | Last observed mtime |
| `pendingFrom` | `{path, identity, at}`? | Held for up to 2 seconds while pairing |

The cache is seeded by inventory scans and `load_file`; it is not sent to the
webview and is dropped with the process.

## Entity: ConfigReload (backend event + status)

| Field | Type | Notes |
|-------|------|-------|
| `generation` | number | Monotonic; the webview ignores older results |
| `at` | number | Epoch ms |
| `path` | string | Config path |
| `found` | boolean | File exists |
| `revision` | string | Hash of the applied bytes |
| `watch` | string[] | Parsed selectors |
| `exclude` | string[] | Parsed excludes |
| `roots` | string[] | Config + session roots after reconciliation |
| `entries` | WatchedDocumentSeed[] | `{path, filename, modifiedTime, origin}` |
| `warnings` | string[] | Same meaning as today |
| `error` | string? | Invalid/unreadable/non-writable state |
| `truncated` | boolean | Expansion cap reached |

**Invariants**

- An `error` result never replaces the inventory or watch registrations.
- Only the newest generation updates the UI.
- `roots` and `entries` include session origins, so a reload cannot drop a CLI
  folder (FR-006).

## Entity: BrowseFilter (session-only)

| Field | Type | Notes |
|-------|------|-------|
| `term` | string | Trimmed, lower-cased for matching; never persisted |
| `matches` | derived | Literal substring of filename, full path, or project name |

**Rules**

- Applies to the selected browse list and the pop-out inventory.
- Survives mode switches and watcher events; cleared by one action or `Escape`.
- Does not alter order, unread, open, active, or deleted state.
- An empty result renders an explanatory empty state with a clear action.
- Newly discovered matching documents appear; non-matches stay hidden.

## Entity: ConfigEditorDraft (in-memory, modal)

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Effective config path |
| `revision` | string | Revision loaded into the draft |
| `watch` | string[] | Draft selectors |
| `exclude` | string[] | Draft excludes |
| `dirty` | boolean | Draft differs from the loaded revision |
| `createFromExample` | boolean | No file existed when the surface opened |
| `invalidFile` | boolean | Existing file could not be parsed; structural save disabled |
| `errors` | `{ field, message }[]` | Validation/save errors |
| `conflict` | `{ currentRevision, currentWatch, currentExclude }`? | Outside edit detected |
| `lastReload` | `{ at, ok, error, warnings, truncated }`? | Shown in the header |
| `saving` | boolean | Disables duplicate submits |

**Invariants**

- Saving never discards the draft on failure.
- A stale revision produces `conflict`, not a write.
- An unparseable existing file disables Save and offers **Open config file**;
  it is never overwritten without an explicit destructive confirmation.
- Closing with unsaved changes requires confirmation.
- The modal is reachable from the header regardless of browse visibility.

## Derived view state

`SidebarViewState` gains:

| Field | Type | Notes |
|-------|------|-------|
| `filterTerm` | string | For input value and empty-state copy |
| `filterActive` | boolean | Derived |
| `inventory` / `recent` | filtered arrays | Already ordered; never re-sorted by filtering |
| `lastReload` | status row data | Shown near the config status |

## Validation rules (cross-cutting)

- No list renders a row for an empty path.
- A deleted document remains visually distinct; a renamed document must not
  appear deleted.
- Clear/undo remains idempotent and session-scoped.
- A reload that removes an open document's location keeps the tab and its
  content; only inventory membership ends.
- Acknowledgement history contains at most one entry per currently watched
  document and none for unwatched documents.
- Any new persisted state is versioned, validated per entry, and documented in
  `README.md`/`_ai/`.
