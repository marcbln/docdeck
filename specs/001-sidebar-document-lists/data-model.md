# Phase 1 Data Model: Left Sidebar Document Navigation

**Feature**: `001-sidebar-document-lists` | **Date**: 2026-10-31

This feature is entirely webview-side. No persistent schema or backend model
changes. The entities below describe in-memory state and the derived view rows.

## Entity: OpenDocument

A document with a live tab. Source of truth remains the existing `tabs` map in
`main.ts`; this entity is the view-row projection.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Canonical absolute path; unique key |
| `filename` | string | Display name |
| `modifiedTime` | number | Epoch ms, from the file read / watcher event |
| `hasUnreadUpdate` | boolean | Background change not yet acknowledged |
| `deletedOnDisk` | boolean | File disappeared; content retained |
| `active` | boolean | Derived from `activePath` |
| `order` | number | Map insertion order, or `modifiedTime` when Auto-Sort is on |

**Invariants**
- One row per canonical path.
- Active row is always a member of the list.
- `active` is true for at most one row.

**Derivation**: `buildOpenRows(tabs, activePath, autoSort)` — pure, no DOM.

## Entity: WatchedDocument (inventory entry)

Existing `InboxEntry`, extended with one field.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Canonical absolute path; unique key |
| `filename` | string | Display name |
| `modifiedTime` | number | Filesystem mtime, epoch ms |
| `changedAt` | number | **NEW** — session observation time (epoch ms) |
| `unread` | boolean | Changed since launch and not acknowledged |
| `deleted` | boolean | Missing on disk; retained until reappears or session ends |

**Invariants**
- One entry per canonical path (existing map guarantees this).
- `changedAt` never decreases for an entry.
- `changedAt` is set when an entry is created, upserted with a new mtime, or
  marked deleted; inventory merges that do not change the document do not bump
  it.

**Transitions**

```text
(absent) --merge/upsert--> present, changedAt=now, unread per caller
present --upsert(new mtime)--> changedAt=now, unread per caller
present --markDeleted--> deleted=true, changedAt=now
present --reappears (merge)--> deleted=false
present --markRead--> unread=false
```

## Entity: RecentChange

A projection of `WatchedDocument`, not a separate store.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Unique within the list |
| `filename` | string | Display name |
| `changedAt` | number | Ordering key, newest first |
| `unread` | boolean | Copied from the entry |
| `deleted` | boolean | Copied from the entry |

**Selection rule**: `changedAt > clearedAt`, ordered by `changedAt` descending,
ties broken by path. Deleted entries are included. One row per path.

**Invariants**
- The list is a subset of the inventory; it never contains an unknown path.
- A document can also be an `OpenDocument` (duplication across lists is allowed).
- Repeated writes update `changedAt` instead of adding a row.

## Entity: ClearSnapshot (undo)

| Field | Type | Notes |
|-------|------|-------|
| `clearedAt` | number | The `clearedAt` value before this clear |
| `paths` | string[] | Paths that were visible in Recently Changed |
| `unread` | Record<string, boolean> | Unread flag for each snapshotted path |
| `takenAt` | number | When the clear happened (for the undo window) |

**Invariants**
- At most one snapshot lives at a time; a second clear replaces it.
- Undo restores `clearedAt` to `snapshot.clearedAt` and restores the snapshotted
  unread flags. It never resurrects entries that were deleted from the inventory
  in the meantime (they simply no longer exist).
- The snapshot is not persisted; a restart discards it.

## Entity: SidebarState

Pure, derived rendering input for `SidebarPanel`.

| Field | Type | Notes |
|-------|------|-------|
| `openRows` | OpenDocument[] | Ordered per current sort mode |
| `browseMode` | `"all"` \| `"recent"` | Persisted preference |
| `inventory` | WatchedDocument[] | Sorted for All Documents |
| `recent` | RecentChange[] | Selected by `changedAt > clearedAt` |
| `openPaths` | Set<string> | For open-state markers in browse rows |
| `activePath` | string \| null | Highlight |
| `status` | InboxStatus | Scan progress, errors, warnings, truncation |
| `openCollapsed` | boolean | Persisted |
| `browseCollapsed` | boolean | Persisted |
| `canUndo` | boolean | True while a `ClearSnapshot` exists |
| `now` | number | Injected clock for relative times and tests |

## Entity: SidebarPreferences (persisted)

Extends `Preferences` in `src/preferences.ts`.

| Field | Type | Default |
|-------|------|---------|
| `browseMode` | `"all"` \| `"recent"` | `"recent"` |
| `openSectionCollapsed` | boolean | `false` |
| `browseSectionCollapsed` | boolean | `false` |
| *(existing)* `themeMode`, `tocVisible`, `frontmatterVisible`, `inboxVisible` | | unchanged |

`inboxVisible` is reinterpreted as `browseVisible` at the UI level: it hides the
browse section only, never Open Documents. The stored key stays the same to
avoid a migration.

## Ordering rules

- **Open Documents, manual**: tab insertion order (Map iteration order).
- **Open Documents, Auto-Sort**: `modifiedTime` descending, path as tiebreaker.
- **All Documents**: `filename` ascending within project groups, then full path;
  or `modifiedTime` descending — the plan keeps the existing
  `entriesSorted()` (mtime desc, path tiebreak) initially to avoid changing
  behavior beyond the feature scope. Grouping is a follow-up, not required.
- **Recently Changed**: `changedAt` descending, path as tiebreaker.

## Validation rules

- No list renders a row for an empty path.
- A deleted document must be visually distinguishable in every list where it
  appears.
- Clear/undo must be idempotent from the UI's perspective: a second undo with no
  snapshot is a no-op.
- `clearedAt` must never move backwards except through undo.
