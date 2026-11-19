# Phase 1 Data Model: Document and Section Bookmarks

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

The durable data is the bookmark collection plus one boolean preference. Section
resolution status is session-only; availability, unread and the notification path
set are derived. No backend model stores headings or bookmark anchors.

## Entity: BookmarkCollection (persisted)

The root of `docdeck.bookmarks.v1`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | `1` | yes | Any other value discards the payload and starts empty |
| `documents` | `DocumentBookmark[]` | yes | One entry per canonical path; duplicates collapse |
| `sections` | `SectionBookmark[]` | yes | One entry per bookmark id; duplicates drop the later entry |

**Invariants**
- A document path appears at most once in `documents`.
- A section id appears at most once in `sections`.
- A document bookmark is **not** implied by section bookmarks; a document with
  only sections is a container in the view and is not marked as document-bookmarked.
- Removing a document bookmark never removes its section bookmarks.
- The collection contains no document content, no unread flags, no resolution
  status and no notification preference.

**Lifecycle**

```text
absent key ──load──> empty collection (valid, first run)
valid v1   ──load──> collection (valid entries only)
corrupt    ──load──> empty collection (app starts; no crash)
mutation   ──debounced 250 ms──> whole collection written
pagehide/beforeunload ──flush──> whole collection written
```

## Entity: DocumentBookmark

A reader-chosen marker on one document.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `path` | `string` | yes | Non-empty canonical absolute path as produced by `load_file`/the watcher |
| `addedAt` | `number` | yes | Finite epoch milliseconds from the injected clock |

**Operations**
- `add(path, at)` — no-op if already present; otherwise appends.
- `remove(path)` — removes only the document marker; returns the removed value
  for undo.
- `toggle(path, at)` — add when absent, remove when present.
- `rename(oldPath, newPath)` — re-keys the marker; if a marker already exists at
  `newPath`, it is kept once (the earlier `addedAt` wins) and the duplicate is
  discarded.
- `has(path)` — drives every document star and the header toggle.

**Derived view fields** (not stored): `filename`, `project`, `modifiedTime`,
`available`, `unread`, `sectionCount`.

## Entity: SectionBookmark

A reader-chosen marker on one heading occurrence.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string` | yes | Non-empty, unique within the collection; generated at creation |
| `path` | `string` | yes | Non-empty canonical absolute document path |
| `addedAt` | `number` | yes | Finite epoch milliseconds |
| `anchor` | `SectionAnchor` | yes | See below |

**Operations**
- `add(path, anchor, at, id)` — deduplicates by identical anchor identity for the
  same path; a duplicate toggle instead removes the existing entry.
- `remove(id)` — returns the removed section for undo.
- `forPath(path)` — sections of one document in anchor/view order.
- `rename(oldPath, newPath)` — rewrites `path`; ids and anchors are unchanged.
- `reanchor(id, anchor)` — replaces the anchor after a picker choice or a
  confirmed context resolution; preserves `id` and `addedAt`.

## Entity: SectionAnchor

The minimum information needed to find the same heading after edits.

| Field | Type | Required | Validation | Purpose |
|-------|------|----------|------------|---------|
| `text` | `string` | yes | Any string; normalized by trim + whitespace collapse for comparison; may be empty for an image-only heading | Primary identity |
| `depth` | `1…4` | yes | Integer in the outline range | Context score / prevents matching a different level |
| `before` | `string[]` | yes | Up to 2 previous outline heading texts, nearest first; empty when none | Distinguishes duplicate text |
| `after` | `string[]` | yes | Up to 2 next outline heading texts, nearest first; empty when none | Distinguishes duplicate text |
| `ordinal` | `number` | yes | Non-negative integer | Occurrence among equal texts, last resort |
| `order` | `number` | yes | Non-negative integer, outline index at capture | Fallback display order for unverified sections |

**Capture** (`captureAnchor(headings, index)`):
- `text`/`depth` from `headings[index]`;
- `before` = up to two heading texts before `index`, nearest first;
- `after` = up to two heading texts after `index`, nearest first;
- `ordinal` = count of earlier headings with the same normalized text;
- `order` = `index`.

**Anchor identity** for dedupe: `path + text + depth + before + after + ordinal`.
`order` is not part of identity (it changes with insertions).

## Entity: HeadingResolution (session only)

Produced by the pure resolver when a document is rendered or a bookmark is
activated. Never persisted.

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"resolved" \| "stale"` | Closed union |
| `index` | `number` | Resolved only: outline index in the current document |
| `slug` | `string` | Resolved only: current DOM id for scrolling |
| `text` | `string` | Resolved only: current heading text |
| `depth` | `number` | Resolved only: current depth |
| `via` | `"text" \| "context" \| "occurrence" \| "picker"` | How it was found; `picker` is a session override after re-anchoring |
| `reason` | `"missing" \| "ambiguous"` | Stale only |

**Resolution rules** (full algorithm in
[contracts/section-resolution.md](./contracts/section-resolution.md)):
1. Exact normalized text; one match wins.
2. Duplicate text: score each candidate against the two-heading context window
   (nearest neighbour +2, second +1 per side; an empty anchor side matching an
   empty candidate side +2; depth +1). A unique best wins; occurrence is used
   only when every candidate scores zero and the stored `ordinal` candidate
   exists.
3. No text match: same-depth headings with consistent evidence on both sides of
   the window (an empty matching side counts); a unique best wins as a re-anchor
   (`via: "context"`). Ties/misses are stale. Both sides are required so a
   deleted heading cannot hand its context to a neighbour.
4. A stale bookmark never yields a slug.

## Entity: BookmarkDocumentView (derived)

One container row in the Bookmarks view.

| Field | Type | Notes |
|-------|------|-------|
| `path` | `string` | Identity |
| `filename` | `string` | Inbox filename, else `fileName(path)` |
| `project` | `string \| null` | `projectName(path)` |
| `modifiedTime` | `number` | Inbox mtime; `0` when unavailable/unknown |
| `available` | `boolean` | In inventory and not `deleted` |
| `unread` | `boolean` | Available inbox row's unread; always `false` when unavailable |
| `documentBookmarked` | `boolean` | Document marker exists |
| `sections` | `BookmarkSectionView[]` | Only this document's bookmarks |
| `sectionCount` | `number` | Convenience count for the row |

**Availability resolution**

```text
entry = inbox.get(path)
available = entry !== undefined && entry.deleted === false
filename  = entry?.filename ?? fileName(path)
unread    = available ? entry.unread : false
```

## Entity: BookmarkSectionView (derived)

One nested row.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Section id |
| `path` | `string` | Parent document |
| `text` | `string` | Resolved current text, else stored anchor text |
| `depth` | `number` | Resolved depth, else stored depth |
| `order` | `number` | Resolved index, else stored `order` |
| `status` | `SectionStatus` | See below |
| `sharedWith` | `number` | Count of bookmarks resolving to the same slug (0 when none) |
| `headingSlug` | `string \| null` | Present only when resolved and activatable |

**SectionStatus**

| Status | Condition | Behavior |
|--------|-----------|----------|
| `unavailable` | Parent document unavailable | No activation; `Remove` only |
| `stale` | Resolver returned `stale` | No scroll; `Re-anchor` and `Remove`; reason in title |
| `unverified` | No session resolution for this id | Activation opens/focuses then validates |
| `re-anchored` | Resolved with `via: "context"` or `via: "picker"` | Normal activation; `Moved` badge |
| `current` | Resolved with `via: "text"` or `"occurrence"` | Normal activation; no badge |
| `shared` annotation | Resolved slug shared by >1 section bookmark | Both rows stay visible; `Shared` badge; activation still targets the heading |

Status precedence when several apply: `unavailable` > `stale` > `shared`
annotation > `re-anchored` > `current` > `unverified`.

## Entity: BookmarkRow (derived, virtualized)

Discriminated union used by the Bookmarks `VirtualList`.

```ts
type BookmarkRow =
  | { kind: "document"; document: BookmarkDocumentView }
  | { kind: "section"; section: BookmarkSectionView };
```

Flattening: each included document is followed immediately by its included
sections. Row height stays the existing 48 px; section rows are single-line and
indented by depth.

**Ordering**
1. Available documents by `modifiedTime` descending, then `path.localeCompare`.
2. Unavailable documents after available ones, by `filename`, then `path`.
3. Sections within a document by `order`, then `addedAt`, then `id`.

**Filtering** (literal, case-insensitive, trimmed, matching
`filterEntries` vocabulary):
- document fields: `filename`, full `path`, `project`;
- section field: `text`.
- A matching document keeps all of its sections.
- A non-matching document is included only with matching sections (container
  rule).
- Ordering is preserved and no state changes.

**Counts**
- `documentCount` = documents represented (with or without a document marker);
- `sectionCount` = section bookmarks represented;
- `totalCount` = document markers + section markers (the accessible mode badge).

## Entity: BookmarkNotificationsPreference (persisted)

Stored in `docdeck.preferences.v1` alongside the existing UI preferences.

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `bookmarkNotificationsOnly` | `boolean` | `false` | Non-boolean → default; other fields unaffected |
| `browseMode` | `"all" \| "recent" \| "bookmarks"` | `"recent"` | Unknown value → default |

**Derived notification filter**

```ts
{
  enabled: preferences.bookmarkNotificationsOnly,
  paths: sortedUnique([
    ...collection.documents.map((d) => d.path),
    ...collection.sections.map((s) => s.path),
  ]),
}
```

The filter is sent to Rust on startup and after every mutation that changes
either field or the path set (add/remove/undo/rename). Rust keeps it in memory
only; the preference and collection remain the source of truth.

## Entity: RemovedBookmark (session only)

Single-slot undo record owned by `BookmarksController`.

```ts
type RemovedBookmark =
  | { kind: "document"; bookmark: DocumentBookmark }
  | { kind: "section"; bookmark: SectionBookmark }
  | { kind: "sections"; bookmarks: SectionBookmark[] }; // outline multi-removal
```

- Replaced by the next removal.
- Restores the exact entries (including ids, anchors and `addedAt`).
- Discarded on restart and not persisted.
- `canUndo` drives the toast action; the toast is not the only copy of the data.

## Entity: BookmarkPickerState (ephemeral UI)

| Field | Type | Notes |
|-------|------|-------|
| `path` | `string` | Document being re-anchored |
| `sectionId` | `string` | Bookmark being repaired |
| `headings` | `Heading[]` | Current outline of the open document |
| `open` | `boolean` | Dialog mounted |
| `returnFocus` | `HTMLElement \| null` | Re-anchor button for focus restoration |

Selecting a heading captures a new anchor from the current headings and commits
it to the section bookmark. Escape/overlay/close cancels without changing the
anchor. An empty outline shows an explicit empty state with `Remove bookmark`.

## Entity: NotificationBookmarkFilter (Rust, in memory)

Managed by `BookmarkFilterState` in `src-tauri/src/bookmark_filter.rs`.

| Field | Type | Notes |
|-------|------|-------|
| `enabled` | `bool` | Default `false` |
| `paths` | `HashSet<String>` | Default empty; deduplicated on set |

**Validation on set**
- `paths.len() <= 10_000`;
- each path is non-empty, ≤ 4096 bytes, contains no NUL, and is absolute;
- duplicates are collapsed;
- invalid input returns a typed `CommandError` and leaves the previous filter
  unchanged.

**Batch filtering**

```text
candidates = enabled
  ? changes where set.contains(change.path)
              or change.from_path is Some and set.contains(from_path)
  : changes
```

The tray presence dot is updated from the original batch. An empty candidate
list returns before the throttle check. Title/body use candidates only.

## Cross-entity flow

```text
star / Ctrl+D / outline star / context menu
        └──> BookmarksController ──> BookmarkCollection ──> debounced storage
                                  ├──> RemovedBookmark (session undo)
                                  └──> notification filter ──> Rust command

document render (active only)
        └──> extractHeadings ──> resolver ──> session resolutions ──> Bookmarks view rows
                                           └──> TOC star state

watcher renamed/movedOut/deleted/created
        └──> inbox + acks (existing) ──> availability/unread ──> Bookmarks view
        └──> BookmarksController.rename / retain ──> storage + notification sync

activation of a document row
        └──> openDocument / setActiveTab (existing unread acknowledgement)

activation of a section row
        └──> open/focus ──> resolve against current headings
                          ├── resolved ──> scrollToAnchor + commit anchor
                          └── stale ──> show stale (no scroll)

re-anchor
        └──> BookmarkPicker (current headings) ──> commit anchor + persist
```

## State transitions

```text
document not bookmarked --toggle--> document bookmarked
document bookmarked     --toggle/remove--> removed (sections retained) --undo--> bookmarked
heading unbookmarked    --outline star--> section bookmarked
section bookmarked      --text edit + unique context--> re-anchored (activation commits anchor)
section bookmarked      --heading missing / ambiguous--> stale
stale                   --pick heading--> re-anchored (anchor replaced)
stale/unavailable       --remove--> removed (undo snapshot)
document path           --rename--> path rewritten (document + sections + resolutions)
document path           --move-out/delete--> unavailable (retained)
document path           --return--> available (sections remain unverified until checked)
collection              --corrupt key--> empty collection, startup continues
```

## Boundary conditions covered by tests

- Empty collection, absent key, corrupt JSON, wrong version, malformed document
  and section entries, duplicate paths/ids, empty section arrays.
- Document toggle add/remove/undo; document removal keeps sections; container
  with only sections.
- One heading, unique duplicate text, identical neighbours, insertion of a new
  duplicate before the target, reordering, heading rename with/without context,
  deletion, ambiguous tie, depth change, empty heading text, depth > 4 excluded.
- Section statuses: unverified, current, re-anchored, stale missing, stale
  ambiguous, shared target, unavailable.
- Filter: document match keeps sections; section-only match keeps container with
  only matching sections; empty/whitespace term; cross-project matches.
- Availability: inventory present, deleted, removed by reload, moved out and
  back, manual document after restart.
- Unread: first launch baseline, changed-while-closed, activated clears,
  unavailable suppresses.
- Rename: document + sections re-keyed; existing target deduped; notification
  filter re-sent.
- Notifications: disabled pass-through, enabled with empty set, enabled mixed
  batch, rename source/target, empty filtered batch does not consume throttle.
- Rust validation: relative, empty, NUL, oversized, too many, duplicates.
- Storage writes: debounce coalesces, flush writes immediately, quota failure is
  ignored without breaking a toggle.
