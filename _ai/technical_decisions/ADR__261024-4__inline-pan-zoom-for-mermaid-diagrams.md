---
title: Inline pan/zoom for Mermaid diagrams with source-keyed view state
status: Accepted
date: 2026-10-24
deciders: docdeck maintainer
tags: [mermaid, diagrams, pan-zoom, rendering, webview, state]
adrId: 261024-4
---

# Inline pan/zoom for Mermaid diagrams with source-keyed view state

## Context

Mermaid diagrams are rendered at fit-width inside a bordered container. Large
graphs are scaled down until labels are unreadable, and the only escape is
horizontal scrolling. Readers need to zoom into a dense region and pan around
it, with an interaction that feels close to a modern diagram viewer.

Two properties of docdeck constrain the solution:

- The document is repainted wholesale whenever an agent writes to the file, and
  also on every light/dark theme switch. Any per-diagram view state would be
  destroyed on every repaint unless it is captured outside the DOM.
- The renderer already owns a post-processing pipeline (heading ids, task-list
  tagging, Mermaid promotion, copy buttons). The interaction layer has to slot
  in after `mermaid.run()` without taking over Markdown parsing.

`ADR 261024-1` also records that in-document find deliberately skips SVG text,
so diagram interaction does not have to coexist with highlight painting inside
the SVG.

## Decision

Rendered Mermaid SVGs are enhanced in place with a viewport/stage transform
model implemented in `src/mermaid-zoom.ts` (`enhanceMermaidDiagrams`).

- The existing `.mermaid` container becomes a clipped viewport. A
  `.mermaid-stage` child holds the SVG at its natural size and receives
  `translate(x, y) scale(s)` with a top-left origin. No new dependency.
- The SVG keeps its natural dimensions from the `viewBox`; `100%` means natural
  size. Neither the initial fit-width view nor the fit-whole reset ever
  upscales past 100%.
- Initial view is fit-width with the viewport height derived from the diagram's
  aspect ratio and capped in CSS at `70vh`. Tall diagrams therefore pan
  internally instead of stretching the document.
- Interaction: drag to pan (4px threshold so links still click), `Ctrl`/`Cmd` +
  wheel zooms toward the pointer, plain wheel scrolls the document, double-click
  and the toolbar `fit` button fit the whole diagram, and `+`/`-`/`0`/arrow
  keys work while the viewport has focus. Touch and pinch gestures are out of
  scope.
- The hover/focus toolbar contains zoom out, the zoom percentage, zoom in,
  fit and fullscreen. It stays visible while the view is in a custom
  zoom/pan state.
- Fullscreen moves the same viewport node into a fixed overlay (with a
  same-height placeholder left in the document) instead of creating a second
  instance. Untouched diagrams open at fit-whole; a custom view keeps its
  scale and content centre. Closing restores the pre-fullscreen inline view.
- View state lives in a module-level registry keyed by normalized diagram
  source plus occurrence index. It is saved on every transform change,
  restored when `renderMarkdown` repaints the same document, recomputed for
  fit modes, cleared when a different document opens, and pruned to the
  diagrams of the current render. A changed diagram source therefore gets a
  fresh view, while theme switches and unrelated live writes keep the
  reader's zoom.

The pure geometry (fit scales, cursor-anchored zoom, translation clamping) is
isolated in `src/mermaid-zoom-math.ts` so it is testable without layout.

## Amendment (2026-10-26): per-diagram inline toggle

The zoom viewport is useful for dense graphs but heavier than necessary for
diagrams that read well at document scale. The hover toolbar therefore gained an
inline toggle per diagram.

- `ViewMode` gains `inline`. The controller stays mounted so the same toolbar
  can switch back, but `.mermaid--inline` neutralises the stage transform and
  puts the stage back into flow. The SVG keeps its natural aspect and is capped
  at the column width (`max-width: 100%`), so the document scrollbar scrolls the
  page as it did before the zoom layer existed.
- While inline, pan/zoom/fit/fullscreen input and controls are suppressed; only
  the inline toggle stays in the toolbar.
- Inline is a saved view state. It survives live reloads and theme switches, and
  the pre-inline fit/custom view is remembered so toggling back restores it.
  It is still cleared when a different document opens, like every other saved
  view.

## Consequences

Positive:
- Large diagrams become readable without changing the document layout for
  normal-sized graphs.
- View state survives live reloads and theme switches, which matters because
  the viewer is repainted on every agent write.
- No new dependency; the interaction surface stays in one module and the
  geometry in another.
- The same viewport node is reused for fullscreen, so the overlay inherits the
  active theme, CSS and event listeners.

Negative:
- The viewer now has an interactive layer whose layout depends on measured
  pixels, which happy-dom cannot provide; tests need an injected measurement
  seam.
- The `.mermaid` DOM shape changes from "container holding an SVG" to
  "viewport > stage > SVG", so CSS and future diagram features must use the new
  contract. Unenhanced containers keep a fallback style.
- CSS transforms are used instead of mutating the SVG `viewBox`. If a webview
  rasterises the stage during scaling, labels can look soft; this must be
  verified in WebKitGTK and the stage strategy is the fallback point.
- Fit-width reflows when the pane width changes, while a custom view is only
  clamped. A reader who zooms and then resizes keeps their scale and may need
  to press fit.
- View state is tied to diagram source text. Editing a diagram resets its
  view; two identical diagrams at different positions are tracked separately.

## Alternatives Considered

- **`svg-pan-zoom` or `@panzoom/panzoom`.** Rejected: both own the SVG or
  wrapper lifecycle, and docdeck's renderer replaces Mermaid output on every
  reload. Coordinating their state with the source-keyed registry and the
  overlay would add more coupling than the ~150 lines of interaction code this
  design needs.
- **Mutate the SVG `viewBox` instead of CSS transforms.** Rejected for the
  first cut: it guarantees crisp re-rasterisation but has to account for
  `preserveAspectRatio` letterboxing and Mermaid's own sizing attributes, which
  makes the geometry and tests substantially harder. It remains the fallback
  if CSS transforms render softly in WebKitGTK.
- **Always reset the diagram to fit on every repaint.** Rejected: an agent
  writing elsewhere in the file would repeatedly evict the reader from a
  zoomed view.
- **Reconcile the document and leave unchanged diagrams' DOM untouched.**
  Rejected as out of scope: it changes the render pipeline more broadly, and
  source-keyed state already gives the required behaviour.
- **Always-visible controls.** Rejected: every diagram would carry chrome and
  busy documents would look noisier. Hover/focus keeps discoverability without
  permanent clutter.
- **Native `Element.requestFullscreen()`.** Rejected: it takes over the whole
  display and varies by platform/webview. A themed in-app overlay keeps the
  diagram framed by docdeck and is easier to close with `Escape`/backdrop.
- **Touch and pinch gestures.** Deferred: docdeck is a desktop Tauri app and
  the gesture bookkeeping would add scope without a current use case.

## Related Decisions

- [261002-1](ADR__261002-1__runtime-stylesheet-swapping-for-themes.md) — theme
  switches re-render Mermaid; source-keyed state is what makes the zoom survive
  that re-render.
- [261024-1](ADR__261024-1__css-custom-highlight-api-for-in-document-find.md) —
  the wholesale repaint contract and the decision to leave SVG text out of find.
