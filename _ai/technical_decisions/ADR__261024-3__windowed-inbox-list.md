---
title: Windowed inbox list instead of full DOM rebuilds
status: Accepted
date: 2026-10-24
deciders: docdeck maintainer
tags: [ui, inbox, performance, virtual-list, webview]
adrId: 261024-3
---

# Windowed inbox list instead of full DOM rebuilds

## Context

The inbox renders one row per watched Markdown document. A realistic config
(`~/devel/*/_ai`, `/topdata/**/_ai`, plus deep plugin selectors) produces
several thousand rows; at the time of measurement the user's inbox held roughly
7,000 documents across 195 `_ai` roots.

Every tab activation calls `renderInbox()`, and `InboxPanel.render()` replaces
the entire panel subtree with freshly created rows. Each row creates about nine
elements, two event listeners, an ISO timestamp and a locale-formatted tooltip.
Switching tabs therefore took multiple seconds.

The measurement below was made in the system WebKitGTK 2.52.6 — the engine
Tauri uses on this platform — with the real inbox CSS, a 280 px panel, a
1,280×900 window and 7,000 synthetic rows. Values are medians of 3–5 runs
unless noted.

| Operation | Time |
| --- | --- |
| Current `render()` (create + append 7,000 rows, force layout) | ~3,900–4,100 ms |
| Keyed reconcile over 7,000 rows, no DOM changes | 2–3 ms |
| Keyed reconcile with one changed row | ~20 ms |
| Patch one row's `active` class | ~2.6–4.6 ms |
| Reorder one row (`insertBefore`) | ~24 ms |
| `content-visibility: auto` + `contain-intrinsic-size` + full rebuild | ~5,200 ms |
| One `innerHTML` string + full rebuild | ~3,600 ms |
| Windowed render (~31 rows) + layout | ~16–47 ms |
| One `toLocaleString()` per row × 7,000 | ~1,100 ms |

The watcher is not the bottleneck. A recursive watch costs one inotify watch
per *directory* (1,379 at measurement time), far below the 1,048,576
`max_user_watches` limit; file-level watches exist only for open tabs. The cost
is the inbox DOM, not filesystem watching.

## Decision

The inbox is a fixed-height windowed list.

- Only the rows intersecting the panel viewport, plus a small overscan, exist in
  the DOM. Rows are absolutely positioned at `index * ROW_HEIGHT` inside a rail
  whose height is `entries.length * ROW_HEIGHT`.
- Row elements are pooled and recycled as the window moves. `ROW_HEIGHT` is an
  explicit constant shared by the range math and the inline row height; it is
  never inferred from rendered content.
- Click and keydown handlers are delegated to the list element. No listeners are
  attached per row.
- Tab activation patches the rendered active row and the header unread count.
  It never re-renders the list.
- A model change re-binds only the rendered rows; changes to offscreen rows live
  in `InboxModel` and are painted when they scroll into view.
- Panel chrome — header, scan progress, warnings, empty and error states — is a
  separate subtree. A `scan-progress` tick can never touch the list.
- `InboxPanel.render(entries, status, openPaths, activePath)` remains the single
  public rendering entry point, so call sites do not need to know about the
  window.

## Consequences

Positive:

- Initial inbox paint drops from roughly 4 s to tens of milliseconds, and the
  DOM node count stays constant (~30 rows) regardless of inbox size.
- Tab switches become a class toggle measured at a few milliseconds.
- Watcher bursts from an agent writing many files repaint only the visible
  window; the Rust event batch is applied once, then rendered once.
- The 10,000-file `MAX_FILES` cap is no longer a rendering concern.
- The list remains newest-first with the same unread, deleted, open and active
  semantics; no model change is required.

Negative:

- Row height becomes a layout invariant. A stylesheet change that alters row
  height must change `ROW_HEIGHT`; the implementation enforces the height
  inline from the constant and clips overflow.
- The browser's native find and the accessibility tree only see the rendered
  window. The inbox has no in-app find today; rows expose `aria-posinset` and
  `aria-setsize` so position is still announced.
- A focused row can be recycled while scrolling, so focus is dropped rather than
  moved to an arbitrary row.
- Scroll position is computed in index space from the scroll container's offset,
  which adds a small amount of geometry code and a test seam for happy-dom
  (which has no layout).

## Alternatives Considered

- **Full rebuild, but patch only the active row.** Rejected as the only fix: it
  removes the tab-switch cost (~2.6 ms) but leaves the ~4 s initial paint.
- **Keyed reconcile over all rows.** Rejected as the primary strategy: a no-op
  reconcile is 2–3 ms and a one-row change ~20 ms, but the first render still
  creates and lays out 7,000 rows (~4 s). The row-binding logic is reused inside
  the windowed pool.
- **`content-visibility: auto` with `contain-intrinsic-size`.** Rejected:
  measured ~5.2 s, *worse* than the plain rebuild in WebKitGTK. It skips paint
  for offscreen rows but this workload is dominated by style/layout setup.
- **Building one `innerHTML` string instead of `createElement`.** Rejected:
  ~3.6 s, no meaningful win, and it reintroduces HTML-escaping risk for paths.
- **Capping or paginating the inbox.** Rejected: hides documents the config says
  are watched and changes the product. The window keeps the full inventory.
- **Grouping rows by project with collapsible sections.** A legitimate future
  UX direction, but a separate feature with its own sorting and unread
  semantics; it is not required to fix rendering cost.
- **Server-side pagination or a smaller `MAX_FILES`.** Rejected: the data is
  already in memory and the renderer, not the scan, is the bottleneck.

## Related Decisions

- [261019-2](ADR__261019-2__session-scoped-unread-inbox.md) — unread and deleted
  state remain in `InboxModel`; the window only paints them.
- [261019-1](ADR__261019-1__config-driven-watch-registry.md) — the config can
  select thousands of documents, which is why the window has to scale.
