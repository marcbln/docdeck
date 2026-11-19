---
title: Webview-owned bookmarks with context anchors and a metadata-only notification filter
status: Accepted
date: 2026-11-15
deciders: docdeck maintainer
tags: [bookmarks, persistence, anchors, notifications, tauri]
adrId: 261115-1
---

# Webview-owned bookmarks with context anchors and a metadata-only notification filter

## Context

docdeck watches documents that agents rewrite continuously. Readers need a
small, deliberate set of documents and headings that stays close at hand without
tracking filenames in a list that changes under them. Whole-document bookmarks
are straightforward; heading bookmarks are not, because the heading text and its
position can change between the moment a bookmark is created and the moment it
is activated.

Three decisions had to be made together: where bookmarks live, how a heading is
identified after edits, and how an opt-in "bookmark only" notification setting
can compose with the existing Rust tray without duplicating the collection or
turning the filter into a filesystem interface.

## Decision

**Bookmarks are webview state with one versioned key.** The collection lives in
`localStorage` under `docdeck.bookmarks.v1` as
`{ version: 1, documents: [...], sections: [...] }`. Documents store a path and
`addedAt`; sections add an id and a `SectionAnchor`. Decoding validates the
envelope once and each entry independently: a corrupt key starts empty, a
malformed entry is dropped while its siblings survive. Section resolution status
is session-only and never written. The two preference fields
(`browseMode: "bookmarks"` and `bookmarkNotificationsOnly`) extend the existing
`docdeck.preferences.v1` key rather than creating a second preference store.
Writes are debounced 250 ms and flushed on `pagehide`/`beforeunload`. The
collection contains no document content and no unread flags.

**A heading is identified by text plus a bounded context window.** A
`SectionAnchor` stores normalized text, depth, up to two previous and two next
outline headings (nearest first), the occurrence among identical texts, and the
outline index at capture. Resolution is pure and tries exact text first; with
several identical texts it scores the two-heading context window (nearest +2,
second +1 per side, depth +1) and accepts only a unique best. Occurrence is used
only when every duplicate candidate has zero context evidence. If the text was
edited, the context fallback requires the depth and **both** window sides to be
consistent; a deleted heading therefore becomes stale instead of handing its
context to a neighbouring heading. A tie is stale, and a stale resolution has no
slug, so it cannot scroll anywhere. Stale bookmarks can be re-anchored from the
document's current outline. Resolution runs only against the active rendered
document; closed documents stay "not checked" and are never read just to paint
the sidebar.

**Rust receives a validated, metadata-only notification filter.** The webview
sends `{ enabled, paths }` through the new `set_bookmark_notification_filter`
command. Paths are the sorted, deduplicated union of document and section
bookmark paths. Rust re-validates every path (non-empty, absolute, no NUL,
≤ 4096 bytes, at most 10,000 entries), stores the set in memory only, and never
reads, stats or canonicalizes anything. The tray filters popup candidates before
the throttle check; the presence dot still reflects the full batch. A rename
matches either its source or target path, and an empty candidate set returns
before consuming the throttle window. The command is custom, so no capability
permission is added.

## Consequences

Positive:
- Bookmarks survive restarts without moving view state into Rust, and a corrupt
  record costs one entry rather than the collection.
- Context anchors survive insertions, reorderings and most edits; the resolver
  never guesses when evidence ties, so activation cannot silently land on the
  wrong section.
- The notification filter is small, testable as a pure Rust function, and cannot
  become a filesystem probe.
- Removing the document bookmark keeps its section bookmarks; undo restores the
  exact entries including ids, anchors and timestamps.
- The webview never reads a closed document to resolve sections, keeping
  activation responsive and I/O bounded.

Negative:
- A heading deleted next to a context-matching heading is a genuine ambiguity;
  the stricter both-sides rule favours stale over a risky re-anchor.
- Section status is only known after the document has been rendered at least
  once in the session; closed documents show "not checked".
- The collection is bounded by the feature's "few hundred" assumption and is
  rewritten whole on each debounced mutation.
- A short startup window exists before the webview sends its first filter; until
  then the tray behaves as if the filter were disabled.

## Alternatives Considered

- **Store bookmarks in `docdeck.preferences.v1`**: mixes document metadata with
  UI toggles and makes per-entry corruption recovery impossible.
- **Persist a DOM id or slug**: every heading rename changes it, and duplicate
  headings gain ordinal suffixes, so insertion also changes it.
- **Store an absolute line number**: any insertion above the heading moves it,
  and agents rewrite constantly.
- **Resolve by occurrence first**: risks a silent jump to a different duplicate
  heading, which the specification explicitly forbids.
- **Read every bookmarked document to resolve headings**: unbounded I/O and a
  new content-read command for a sidebar status.
- **Move notifications into the webview**: duplicates tested Rust mode, focus,
  throttle and body composition, and needs a web notification permission.
- **Persist paths in Rust**: creates a second source of truth and a second
  storage lifecycle.

## Related Decisions

- Extends the unread acknowledgement model in
  [ADR 261101-1](ADR__261101-1__file-identity-renames-and-persisted-acknowledgements.md).
- Reuses the windowed row model from
  [ADR 261024-3](ADR__261024-3__windowed-inbox-list.md).
- The tray keeps ownership of notifications from the config-driven watch model
  in [ADR 261019-1](ADR__261019-1__config-driven-watch-registry.md).
