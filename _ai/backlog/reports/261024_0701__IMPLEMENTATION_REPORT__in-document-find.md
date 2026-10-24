---
filename: "_ai/backlog/reports/261024_0701__IMPLEMENTATION_REPORT__in-document-find.md"
title: "Report: In-document find with Chrome-style match highlighting"
createdAt: 2026-10-24 07:01
updatedAt: 2026-10-24 07:24
planFile: "_ai/backlog/active/261024_0701__IMPLEMENTATION_PLAN__in-document-find.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 5
filesModified: 4
filesDeleted: 0
tags: [find, search, highlighting, ux, webview]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: In-document find with Chrome-style match highlighting

## 1. Summary

Added a browser-style find to the active document: `Ctrl+F`/`Cmd+F` opens a
floating bar, every match is painted yellow and the active match orange through
the CSS Custom Highlight API, with an `n/m` counter, case toggle and
`Enter`/`Shift+Enter` navigation. Search state survives live reloads by
rebuilding ranges against the new DOM and selecting the nearest match to the
previous active offset; switching tabs closes the bar.

## 2. Files Changed

### Created (5)

| File | Purpose |
| --- | --- |
| `src/find-text.ts` | Visible-text flattening, text-node segment map, literal matching, DOM ranges |
| `src/find-text.test.ts` | Flattening, whitespace, folding, matching and range tests |
| `src/find-bar.ts` | Floating find bar, keyboard flow, match state, highlight sink |
| `src/find-bar.test.ts` | Open/close, counting, wraparound, case toggle, reload anchor, scrolling |
| `_ai/backlog/reports/261024_0701__IMPLEMENTATION_REPORT__in-document-find.md` | This report |

### Modified (4)

- `src/main.ts` — mounts the controller, closes it on tab switch and render
  failure, anchors/refreshes around every repaint, refreshes on metadata
  fold/unfold and on toolbar-driven table removal.
- `src/style.css` — find bar styles, zero-height sticky layer, theme variables
  and `::highlight()` rules for both palettes.
- `README.md` — feature bullet, keyboard controls and architecture entries.
- `CHANGELOG.md` — `Unreleased → Added` entry.

### Deleted

None. A temporary `find-smoke.html` page used for the WebKitGTK audit was
removed after verification and is not part of the change.

## 3. Key Changes

- **Text flattening and range mapping.** `flattenSearchableText()` walks the
  viewer, skips chrome/hidden/script content, inserts synthetic newlines at
  block boundaries and keeps a `{start, end, node}` map back to real text
  nodes. Newlines and tabs outside `<pre>` become spaces so a phrase wrapped
  across Markdown source lines still matches; inside `<pre>` line breaks remain
  boundaries.
- **Literal matching.** `findMatches()` escapes the query and uses a `g`/`gi`
  regex so the original UTF-16 offsets survive; `matchToRange()` maps an
  interval to a `Range`, returning null for a synthetic boundary.
- **Highlight sink.** Production uses `CSS.highlights` with
  `docdeck-find-match` for inactive matches and `docdeck-find-current` for the
  active one. The active range is excluded from the first set so the orange
  layer cannot be covered by paint order. Tests inject a `HighlightSink`; if
  `CSS.highlights` is unavailable, counts and navigation still work.
- **Keyboard flow.** `Ctrl+F`/`Cmd+F` opens (and refocuses) the bar with the
  query selected; `Enter`/`Shift+Enter` step with wraparound; `Esc` closes and
  clears; `Aa` re-runs the search case-sensitively.
- **Reload anchor.** `captureAnchor()` records the active match offset and
  whether it was visible. The app captures before `replaceChildren()` and calls
  `refresh()` after the metadata table and deletion banner are mounted; the
  nearest match becomes active and the view follows only if the old match was
  visible.
- **Styles.** The bar lives in a zero-height sticky layer inside the scroll
  pane, so it does not reflow the document and remains visible while scrolling.
  Marker colors come from theme variables and are resolved by `::highlight()`
  in both palettes.

## 4. Deviations from Plan

1. **Mermaid/SVG text is excluded.** In WebKitGTK 2.52.6 the registered range
   for an SVG `<text>` label is present in `CSS.highlights`, but
   `::highlight()` paints nothing over SVG text — verified with element
   screenshots (text pixels present, zero highlight-colored pixels). `SVG` is
   therefore in `SKIPPED_TAGS`, the Mermaid test now asserts exclusion, and the
   counter never includes an invisible match.
2. **Whitespace-only text nodes between blocks are dropped.** `marked` emits a
   newline text node between every block (`</p>\n<p>`). Simple normalization
   turned each into a searchable space, so typing a space counted every block
   boundary as an invisible match. Whitespace-only runs after a block separator
   are now skipped outside `<pre>`; a unit test covers the indentation case.
   Markdown renderer output and templates add these nodes, so this was not
   visible in the plan's small fixtures.
3. **Toolbar-driven metadata removal refreshes the search.** The plan only
   covered the `<details>` `toggle` event. Turning off the frontmatter toggle
   removes the table directly in `bindControls`, which leaves stale ranges and
   phantom matches, so that path now calls `refresh()` as well.
4. **Small test-fixture adjustments.** The Escape test uses two matches
   (`<p>alpha alpha</p>`) so both highlight layers exist before the clear; the
   `openFind` helper no longer takes the controller because
   `noUnusedParameters` rejected the unused argument.
5. **No throttling added.** Measured in WebKitGTK: a 10,000-line document
   (2,000 blocks) recomputed in ~23–30 ms for normal terms and ~89 ms for the
   pathological single-character query `a`; a 3,000-block document took ~84 ms
   for `a`. Normal queries stay close to a frame, so the matching semantics
   were left synchronous.

## 5. Technical Decisions

- **CSS Custom Highlight API instead of DOM mutation** (ADR `261024-1`). The
  viewer is repainted wholesale by every live reload; ranges are cheap to
  rebuild and leave syntax spans, copy buttons, Mermaid SVGs and scroll
  restoration untouched.
- **The active range is excluded from the "all" set** rather than layered on top
  with `Highlight.priority`. This guarantees the orange marker is visible
  regardless of paint order or future UA behavior.
- **A zero-height sticky layer** positions the bar without fixed-position math
  tied to the header and without reflowing the document; `pointer-events: none`
  on the layer keeps the document clickable around the bar.
- **The highlight registry is behind an injectable sink.** happy-dom has no
  registry, and the real webview has one; the seam keeps tests deterministic and
  allows the feature to degrade to navigation-only when the API is absent.

## 6. Testing Notes

Automated, all green:

```bash
npm run typecheck
npm run test:web        # 14 files, 116 tests
```

Unit coverage includes inline matches, block separation, prose newline
normalization, `<pre>` preservation, hidden/folded/chrome/script/SVG exclusion,
regex metacharacters, non-overlapping matches, range construction across inline
elements, synthetic-boundary rejection, open/close, counters, wraparound, case
toggle, anchor/nearest refresh, scroll-into-view and listener teardown.

Real-webview audit (WebKitGTK 2.52.6 via WebKitWebDriver/MiniBrowser, temporary
harness since removed). All checks passed:

- `Ctrl+F` opens with focus and no layout shift (viewer top unchanged; layer
  height 0).
- Counts exclude folded, hidden, script and SVG text; both highlight layers are
  registered.
- Screenshot pixel checks confirmed yellow inactive matches and an orange active
  match, and the same after switching to the light palette (`::highlight()`
  resolved the theme variables).
- `Enter`, `Shift+Enter`, wraparound and `Aa` behave as designed.
- Clicking the metadata summary re-runs the search in both directions.
- A match below the viewport scrolls into view; a live repaint keeps the query
  and selects the nearest match (anchor `wasVisible: true`).
- `Esc` clears the query and both registry entries.
- Timing on the large-document check is recorded in section 4.

Not run: a human walkthrough of `npm run tauri dev -- ./README.md`.
`npm run check` (TypeScript, Rust tests, Vitest and a no-bundle Tauri build) was
run as the final gate.

## 7. Usage Examples

- `Ctrl+F` / `Cmd+F` — open find, focus the query field.
- Type `markdown` — all matches turn yellow, the first active match turns
  orange and the counter reads `1/n`.
- `Enter` / `Shift+Enter` — next / previous match, wrapping at the ends.
- `Aa` — toggle case-sensitive matching and re-run the search.
- `Esc` — close the bar, clear the query and remove every marker.

## 8. Documentation Updates

- `README.md`: added the **In-document find** feature bullet, four rows in the
  controls table, and `find-text.ts` / `find-bar.ts` in the architecture list.
- `CHANGELOG.md`: added the feature under `Unreleased → Added`.
- ADR `261024-1` already specified the SVG verification fallback; the outcome is
  recorded here as the implementation deviation.

## 9. Next Steps

- Add a small throttle or debounce only if real documents show perceptible
  input lag for pathological single-character queries; current measurements do
  not justify the extra state machine.
- If WebKitGTK later gains `::highlight()` painting for SVG text, remove `SVG`
  from `SKIPPED_TAGS`, restore the Mermaid-label test and re-check the counter.
