# Contract: Bookmark Storage

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

This contract covers the durable bookmark collection. It is a `localStorage`
payload, not a network API. The collection is owned by the webview; Rust never
reads or writes it.

## Key and envelope

```text
Key: docdeck.bookmarks.v1
```

```json
{
  "version": 1,
  "documents": [
    { "path": "/abs/doc.md", "addedAt": 1763200000000 }
  ],
  "sections": [
    {
      "id": "sec-1763200000000-1",
      "path": "/abs/doc.md",
      "addedAt": 1763200000000,
      "anchor": {
        "text": "Risks",
        "depth": 2,
        "before": ["Timeline", "Scope"],
        "after": ["Open questions", "Appendix"],
        "ordinal": 0,
        "order": 7
      }
    }
  ]
}
```

- `version` must be exactly the number `1`.
- `documents` and `sections` must both be arrays. A missing/non-array field is
  treated as an empty array.
- The writer always emits this exact shape. It never emits resolution status,
  unread flags, notification paths or document content.
- The notification preference is **not** part of this payload; it lives in
  `docdeck.preferences.v1` (see [ui-interactions.md](./ui-interactions.md)).

## Decoding and validation

`decode(raw: string | null): BookmarkCollection | null`

| Input condition | Result |
|-----------------|--------|
| Key absent (`null`) | `null`; caller starts with an empty collection (valid first run) |
| Invalid JSON | `null`; caller starts empty |
| Non-object envelope | `null`; caller starts empty |
| `version !== 1` | `null`; caller starts empty |
| `documents`/`sections` missing or not arrays | Treated as `[]`; the other valid field survives |
| Document element invalid | Dropped; valid siblings survive |
| Section element invalid | Dropped; valid siblings survive |
| Duplicate document path | First valid entry wins |
| Duplicate section id | First valid entry wins |

**Document element validation**
- `path` is a non-empty string.
- `addedAt` is a finite number.

**Section element validation**
- `id` is a non-empty string.
- `path` is a non-empty string.
- `addedAt` is a finite number.
- `anchor` is an object with:
  - `text`: string (empty allowed; an image-only heading still has an anchor);
  - `depth`: integer `1…4`;
  - `before`: array of 0–2 strings, nearest first;
  - `after`: array of 0–2 strings, nearest first;
  - `ordinal`: integer `>= 0`;
  - `order`: integer `>= 0`.

A single bad entry must never discard the whole collection (FR-031). A corrupt
key must never prevent startup.

## Mutations and invariants

| Operation | Invariant |
|-----------|-----------|
| Add document bookmark | At most one document marker per path |
| Remove document bookmark | Section bookmarks for that path are untouched |
| Add section bookmark | Section ids unique; identical anchor identity for the same path is not duplicated |
| Remove section bookmark | Document marker untouched |
| Rename path | Document marker and every matching section path are rewritten in one in-memory pass; a pre-existing document marker at the target is deduped |
| Re-anchor | `id`, `path` and `addedAt` stay; only `anchor` changes |
| Undo | Restores the exact removed entry/entries, including ids, anchors and `addedAt` |

Document bookmarks and section bookmarks are independent: a document with only
sections is a container row and is **not** treated as document-bookmarked.

## Write policy

- One trailing debounce of **250 ms** for all mutations.
- `flush()` writes immediately (called from `pagehide` and `beforeunload`).
- A `localStorage` write failure (quota, restricted webview) is ignored; the
  in-memory collection keeps working for the session (best effort, matching the
  acknowledgement store).
- A read failure at startup yields an empty collection; the app starts normally.
- Writes are whole-collection. The collection is bounded by the spec's "few
  hundred" assumption and by UI behaviour; no partial/file-based storage is
  introduced.

## Rename transaction

On a settled `renamed` watcher event carrying `fromPath → path`:

1. Rewrite the document marker (if any) and every section `path` in memory.
2. Move session resolutions keyed by section id to the new path (or clear them).
3. Persist through the normal debounce.
4. Re-send the notification filter (the path set changed).

No watched file is read or written. If the target path already has a document
marker, the earlier `addedAt` is kept; the duplicate is discarded.

## Removal and undo

- Every removal produces a `RemovedBookmark` snapshot in `BookmarksController`.
- A new removal replaces the previous snapshot.
- Undo restores the snapshot and re-syncs notifications.
- The snapshot is session-only; it is never persisted.

## Test seams

Pure/injectable, no real `localStorage` or wall clock:

- `decode()` with absent/corrupt/wrong-version/partial payloads.
- Collection operations with an injected clock and id generator.
- Storage writer with a memory storage: debounce coalescing, flush, read/write
  failure tolerance.
- Rename and undo round-trips.

DOM/OS behavior (restart, quota, private mode) is covered by the manual
quickstart.
