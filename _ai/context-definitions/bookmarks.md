---
id: bookmarks
title: Document and section bookmarks
type: context
updated: 2026-11-19
related:
  - ADR__261115-1__webview-owned-bookmarks-with-context-anchors
  - watch-reload-and-acknowledgements
---

# Document and section bookmarks

## Store

- Key: `docdeck.bookmarks.v1` in `localStorage`.
- Shape: `{ version: 1, documents: DocumentBookmark[], sections: SectionBookmark[] }`.
- `DocumentBookmark`: `{ path, addedAt }`.
- `SectionBookmark`: `{ id, path, addedAt, anchor }`.
- `SectionAnchor`: `{ text, depth, before[≤2], after[≤2], ordinal, order }`.
- Decoding validates each entry independently. A corrupt key starts empty; a
  bad entry is dropped while valid siblings survive. Duplicate paths/ids keep
  the first entry.
- Writes are a trailing 250 ms debounce of the whole collection, flushed on
  `pagehide`/`beforeunload`. A write failure is ignored; the session continues.
- Section resolution status is session-only and is never written to the key.
- The two preferences (`browseMode: "bookmarks"`, `bookmarkNotificationsOnly`)
  remain in `docdeck.preferences.v1`; they are not part of this payload.

Implementation: `src/bookmarks-model.ts` (types and pure operations),
`src/bookmarks-storage.ts` (codec and writer), `src/bookmarks-controller.ts`
(persistence, undo, session resolutions, notification sync).

## Resolution states

`src/bookmark-anchors.ts` captures and resolves anchors against the active
document's `Heading[]` only.

| State | Meaning | Activation |
|-------|---------|------------|
| `unverified` | No resolution computed this session | Open/focus, then validate |
| `current` | Resolved by exact text or occurrence | Scroll |
| `re-anchored` | Resolved by context or the picker | Scroll |
| `shared` | Two or more bookmarks resolve to the same slug | Both rows stay; scroll |
| `stale` | Missing or ambiguous | Never scroll; offer Re-anchor and Remove |
| `unavailable` | Parent document absent/deleted | Remove only |

Resolution order is exact text, context disambiguation, occurrence last. The
context fallback requires the same depth and consistent evidence on both sides,
so deleting a heading cannot hand its context to an unrelated neighbour. A tie
is stale and carries no slug. An activation that resolves commits the current
anchor, so later edits resolve from the confirmed heading.

The re-anchor picker (`src/bookmark-picker.ts`) lists the active outline,
restores focus on Escape/overlay/close, and offers **Remove bookmark** when the
outline is empty. `src/toc-panel.ts` exposes one star per heading and a mixed
state when several bookmarks share a target.

## View

`src/bookmarks-view.ts` composes the collection, the inventory and the session
resolutions into `BookmarkRow[]`:

- availability from the inventory (`absent` or `deleted` is unavailable);
- available documents ordered by `modifiedTime` descending, then path;
  unavailable documents last by filename, then path;
- sections nested under their document in resolved/current document order;
- the shared filter matches filename/path/project (keeping all sections) or
  heading text (keeping the document as a container with matching sections);
- counts: `documentCount`, `sectionCount`, and the mode badge's `totalCount`
  (all markers, independent of the filter).

`src/sidebar-panel.ts` renders a third **Bookmarks** mode with its own virtual
list, empty/filtered-empty states, document stars and section status badges.
`src/sidebar-rows.ts` provides the shared main-button + sibling-star anatomy.
`src/tab-menu.ts` adds the dynamic **Bookmark document / Remove bookmark** item.
`index.html` and `src/main.ts` own the header toggle and `Ctrl`/`Cmd`+`D`.

Unread is the existing document-level rule from
`docdeck.acknowledgements.v1`; the view takes an injected resolver and suppresses
the marker for unavailable documents. Sections never have their own unread
state.

## Bookmark-only notifications

- Preference: `bookmarkNotificationsOnly` in `docdeck.preferences.v1` (default
  false).
- Payload: `{ enabled, paths }`, where `paths` is the sorted unique union of
  document and section bookmark paths, sent through
  `set_bookmark_notification_filter`.
- Rust stores it in memory (`src-tauri/src/bookmark_filter.rs`), validates every
  path (absolute, non-empty, no NUL, ≤ 4096 bytes, ≤ 10,000 entries), and never
  touches the filesystem.
- `src-tauri/src/tray.rs` filters popup candidates before the throttle check;
  the presence dot still reflects the full batch. A rename matches source or
  target. An empty candidate set returns before consuming the throttle.
- The webview re-sends the filter at startup and after add/remove/undo/rename and
  preference changes. A failed sync is logged/toasted and never blocks the
  bookmark action.

## Lifecycle

- Rename re-keys document markers and every section path; a pre-existing target
  document marker is deduped (earlier `addedAt` wins).
- Move-out/delete retains bookmarks and shows them as unavailable.
- Undo restores the exact removed entry/entries (ids, anchors, timestamps); the
  snapshot is session-only and replaced by the next removal.
- Restart loads the collection and starts with no resolutions.

## Validation notes

- **Performance (2026-11-19)**: composing and filtering a view with 500 markers
  took **2.87 ms** best-of-five in the Vitest/happy-dom environment, well under
  the 100 ms budget. Rendering stays windowed (~22 rows in the DOM), so row count
  does not grow with the collection.
- **Read-only (2026-11-19)**: the bookmark path performs no filesystem writes or
  reads. The only persistence is `localStorage`; the Rust command validates
  strings and stores a `HashSet` in memory. Watched documents are untouched by
  starring, resolving, re-anchoring, undo and notification sync. The new command
  has no path read, stat, write or canonicalization call.
