---
title: Session-scoped unread inbox with an active-tab flash
status: Accepted
date: 2026-10-19
deciders: docdeck maintainer
tags: [inbox, unread, ux, watcher, tabs]
adrId: 261019-2
---

# Session-scoped unread inbox with an active-tab flash

## Context

The config-driven watch registry can match many files across projects. docdeck's
existing behavior — auto-open every new or changed file as a background tab —
does not scale to that, and it gives no overview of what changed. The requested
replacement is a Thunderbird-like list of all watched files, newest first, with
files changed since docdeck started shown in bold.

That leaves the unread lifecycle to define. The existing tab dot already means
"this background tab changed and you have not looked at it"; the inbox needs to
agree with that notion rather than invent a second one.

## Decision

A persistent, collapsible left inbox panel lists every matched file sorted by
mtime descending. Each row shows a project chip (parent of the deepest `_ai`
segment, omitted otherwise), the filename, the muted full parent path, and a
relative time with the exact timestamp in a tooltip. Rows for open tabs carry a
subtle accent.

Unread is session-scoped. Nothing is bold at startup. A create or write while
docdeck runs marks the file unread — bold filename plus amber dot — unless it is
the active tab. Clicking the row or activating the tab clears unread. Closing an
unread tab does **not** clear it. No read state is written to disk; a restart
resets all bold.

Writes to the active document update its mtime and row position without marking
it unread; its tab briefly pulses the amber dot and fades. New files appear as
bold rows without opening a tab. Deleted files keep a struck-through row with
their last mtime until they reappear or the session ends.

## Consequences

Positive:
- The inbox is a triage surface, not a tab factory; broad selectors stay usable.
- Unread has one definition shared by the inbox and the tab dot.
- The active document gives feedback without pretending the reader missed
  something they are watching live.
- No persistence means no schema, no migration and no stale read state.

Negative:
- Restarting clears all unread markers, even if a document was never read.
- The panel, tab state and inbox unread set must be kept in sync; a single
  change path is required to avoid one view disagreeing with the other.
- The active-tab fade is time-based UI, which needs a deterministic test seam.
- Deleted rows remain until session end, so a long session accumulates noise in
  the inbox.

## Alternatives Considered

- **Persist last-viewed timestamps.** Rejected: the requirement is explicitly
  "since docdeck started"; persistence adds state and migration surface.
- **Bold every never-opened file at startup.** Rejected: turns the inbox into a
  todo list of everything watched rather than a session activity feed.
- **Mark the active document unread too.** Rejected: the content repaints in
  front of the reader, so bold carries no information.
- **Only untabbed files become unread.** Rejected: a changed background tab
  would go unnoticed.
- **Keep auto-open and add the inbox.** Rejected: tab spam on broad selectors.
- **Modal overlay or list only in the empty state.** Rejected: the list must
  remain visible while reading.
- **Directory-grouped sections.** Rejected: loses the requested global
  newest-first ordering.
- **Project-label fallback to the watch-root basename.** Rejected: produces
  misleading labels such as `devel`.

## Related Decisions

- [261019-1](ADR__261019-1__config-driven-watch-registry.md) — the config and
  scan rules that populate this inbox.
