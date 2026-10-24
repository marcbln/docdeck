---
title: CSS Custom Highlight API for in-document find
status: Accepted
date: 2026-10-24
deciders: docdeck maintainer
tags: [find, search, highlighting, rendering, webview]
adrId: 261024-1
---

# CSS Custom Highlight API for in-document find

## Context

docdeck needs a browser-style find in the active document: `Ctrl+F` opens a
bar, every match is painted yellow, the active match is orange, and the counter
reads `n/m`. The document is not a plain text block. It is rendered Markdown
containing syntax-highlighted spans, task-list inputs, tables, collapsible
frontmatter, copy buttons and Mermaid SVGs, and it is repainted wholesale
whenever an agent writes to the file.

Any highlighting approach therefore has to preserve the rendered DOM and be
cheap to discard and rebuild on a live reload. It also has to match text that
crosses inline element boundaries, such as `**foo** bar`, and it must not
interfere with the existing copy-code buttons or Mermaid output.

## Decision

In-document find is implemented with the CSS Custom Highlight API.

A search flattens the viewer's visible text nodes into one string, with a
character-index-to-`{node, offset}` map and synthetic newlines at block
boundaries. A case-aware, regex-escaped literal query finds non-overlapping
intervals in that string; each interval becomes a `Range`. Two highlights are
registered: `docdeck-find-match` for every non-active match and
`docdeck-find-current` for the active one. The active range is excluded from the
"all" set rather than layered on top, so paint order cannot hide the orange
marker.

The `Highlight` objects are replaced on every query change and after every
document repaint; no `<mark>` elements or other DOM mutations are introduced.
The search belongs to the active document, closes on tab switch, and is
recomputed after a live reload. A reload anchor — the active match's flattened
text offset plus whether it was visible — chooses the nearest match in the new
content and decides whether the view follows it.

If `CSS.highlights` is unavailable, matching, the counter and next/previous
navigation still work; only the paint is skipped.

## Consequences

Positive:
- The rendered document is never mutated, so syntax spans, copy buttons,
  Mermaid SVGs and scroll preservation keep working.
- Matches across inline elements are natural, because `Range`s address text
  across element boundaries.
- Repainting matches is cheap: rebuild ranges and replace two registry entries.
- `::highlight()` colors live in CSS and can follow the light/dark theme
  variables.

Negative:
- The approach depends on modern engines (WebKit 17.2+/WebKitGTK 2.42+,
  Chromium 105+). docdeck's supported Linux and Windows webviews meet this,
  but older systems degrade to navigation without visible markers.
- `::highlight()` supports only a small set of properties; markers cannot have
  padding, borders or rounded corners.
- Ranges become stale when the viewer is repainted, so every render path must
  refresh the search explicitly.
- happy-dom has no highlight registry, so tests need a stub and cannot verify
  the actual paint.
- Text inside Mermaid SVG must be verified in the real webview; if the engine
  cannot paint highlights on SVG text, those matches should be excluded so the
  counter never includes an invisible match.

## Alternatives Considered

- **Wrap matches in `<mark>` elements.** Rejected: mutates the rendered DOM on
  every keystroke, needs unwrapping before each repaint, complicates inline
  boundaries and risks breaking copy buttons and diagrams.
- **`window.find()` / native webview find.** Rejected: non-standard, selects a
  single match, and offers no highlight-all or count.
- **Re-render the Markdown with match markers injected into the source.**
  Rejected: destroys and rebuilds Mermaid diagrams, scroll position and copy
  buttons on every query change.
- **Use the document `Selection` for the active match.** Rejected: replaces the
  reader's selection and clipboard state, and still highlights only one match.

## Related Decisions

- [261002-1](ADR__261002-1__runtime-stylesheet-swapping-for-themes.md) — the
  theme variables the highlight colors are defined against.
