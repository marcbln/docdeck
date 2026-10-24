---
filename: "_ai/backlog/reports/261024_2226__IMPLEMENTATION_REPORT__mermaid-diagram-pan-zoom.md"
title: "Report: Mermaid diagram pan/zoom with persistent view state"
createdAt: 2026-10-24 22:26
updatedAt: 2026-10-24 23:20
planFile: "_ai/backlog/active/261024_2226__IMPLEMENTATION_PLAN__mermaid-diagram-pan-zoom.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 5
filesModified: 6
filesDeleted: 0
tags: [mermaid, diagrams, pan-zoom, ux, rendering]
documentType: IMPLEMENTATION_REPORT
---

# Report: Mermaid diagram pan/zoom with persistent view state

## Summary

Mermaid diagrams now render inside an interactive viewport: large graphs open
at fit-width, can be dragged or zoomed toward the pointer, fit from a hover
toolbar or double-click, and open in a fullscreen overlay. Views are keyed by
diagram source and survive live reloads and theme switches, while an edited
diagram, a document switch or a pruned render resets them. The work adds no
runtime dependencies.

## Files Changed

### Created

- `src/mermaid-zoom-math.ts` — pure fit/zoom/pan geometry and scale limits.
- `src/mermaid-zoom-math.test.ts` — 14 geometry unit tests.
- `src/mermaid-zoom.ts` — viewport controller, source-keyed registry,
  fullscreen overlay and renderer entry point.
- `src/mermaid-zoom.test.ts` — 13 controller tests using the `measure` seam.
- `_ai/backlog/reports/261024_2226__IMPLEMENTATION_REPORT__mermaid-diagram-pan-zoom.md`
  — this report.

### Modified

- `src/markdown.ts` — clear/close Mermaid state per render, stamp diagram source
  on each container, enhance diagrams after `mermaid.run()`.
- `src/markdown.test.ts` — regression test that the source stamp is set.
- `src/main.ts` — close the fullscreen overlay before replacing rendered
  content.
- `src/style.css` — viewport/stage/toolbar/placeholder/overlay styles; unscoped
  the Mermaid geometry rules so a fullscreen move keeps them.
- `README.md` — feature bullet, controls table and architecture map.
- `CHANGELOG.md` — `[Unreleased]` entry.

### Deleted

None.

## Key Changes

- **Viewport/stage transform.** Each enhanced `.mermaid` becomes a clipped
  viewport with a `.mermaid-stage` holding the original SVG at its natural
  `viewBox` size. Pan and zoom update one
  `translate(x, y) scale(scale)` transform; the percentage badge derives from
  the scale.
- **Fit modes and clamping.** Views are `fit-width`, `fit-whole` or `custom`.
  Short diagrams open at fit-width without upscaling; tall diagrams keep a
  70vh cap and pan internally. `clampTranslation` centres content that fits and
  edge-locks content larger than the viewport.
- **Input model.** Pointer drags pan after a 4px threshold (so links still
  work), `Ctrl`/`Cmd` + wheel zooms toward the pointer, plain wheel scrolls the
  document, double-click fits the whole diagram, and focused diagrams support
  `+`/`-`/`0` plus arrow-key panning (`Shift` = 120px steps). The toolbar shows
  `−`, the percentage, `+`, fit and fullscreen, appearing on hover, focus or a
  custom view.
- **Source-keyed persistence.** Views are stored under normalized source text
  plus occurrence index. `enhanceMermaidDiagrams` prunes keys that disappeared
  from the render, restores surviving keys, and disposes controllers whose DOM
  was replaced. `renderMarkdown` clears state when a different document is
  rendered and closes an open overlay before replacing content; changing a
  diagram's source produces a new key and therefore a fresh fit view.
- **Fullscreen without rebuilding.** Opening fullscreen moves the live viewport
  node into a fixed overlay, leaves a height-matched placeholder behind, marks
  `#app` inert, moves focus into the diagram, and restores focus on close.
  `Escape` and backdrop clicks close it. Untouched diagrams open fit-whole to
  use the larger space; custom views keep their scale and requested centre,
  subject to the normal clamp.
- **Styling.** The moved node needs the viewport/stage rules outside
  `.markdown-body`, so `.mermaid`/`.mermaid-stage` geometry, drag cursor, focus
  ring and SVG sizing are unscoped. The overlay itself supplies the backdrop,
  padding and border radius.
- **Test seam.** `enhanceMermaidDiagrams` accepts a `measure` function; the
  production default uses `clientWidth`/`clientHeight`, while tests inject
  fixed sizes because happy-dom has no layout engine.

## Deviations from Plan

- **Arrow-key pan direction.** The plan's snippet mapped `ArrowLeft` to
  `panBy(-step, 0)`. Implementation uses scroll-viewport semantics instead:
  `ArrowLeft` reveals content to the left (`panBy(+step, 0)`), `ArrowRight`
  reveals content to the right, and vertical arrows follow the same rule. The
  unit test and README describe the shipped behaviour.
- **Mermaid CSS scoping.** Phase 4 exposed a real bug: viewport/stage rules were
  scoped under `.markdown-body`, so moving the viewport into `.mermaid-overlay`
  left it `position: static`, with visible overflow and no background. The
  geometry rules are now unscoped, and Chromium checks assert the computed
  `position`, `overflow`, background and transform origin in fullscreen.
- **Fullscreen centre assertion.** A diagram shorter than the fullscreen
  viewport is vertically re-centred by `clampTranslation` by design. The browser
  check therefore verifies horizontal centre preservation and vertical centring
  for a fitting diagram instead of requiring the pre-fullscreen centre on both
  axes.
- **Wheel test construction.** happy-dom ignores `ctrlKey`, `clientX` and
  `clientY` passed to the `WheelEvent` constructor, so the unit helper defines
  those properties explicitly before dispatch. This is test-only.
- **WebKitGTK crispness.** No viewBox fallback was needed: rendered labels
  stayed crisp at 305% in the real WebKitGTK window, including after the
  fullscreen CSS fix.
- **File counts.** Five files created (including this report) and six modified,
  matching the plan.

## Technical Decisions

- **CSS transforms over SVG `viewBox` manipulation.** A single stage transform
  keeps Mermaid's generated SVG, accessibility structure and event targets
  intact, and every engine used here re-rasterises SVG under scale.
- **`100%` means natural size.** Fit scales never exceed 1, so short diagrams
  are shown at their designed size and the badge remains truthful.
- **Store fit modes, not just a transform.** On repaint or resize, `fit-width`
  must refit the new width and `fit-whole` the new box; a frozen transform would
  break both. Custom views keep their exact scale/offset and are re-clamped.
- **Registry keyed by source + occurrence.** A wholesale repaint destroys the
  DOM but not the source, so this restores views without leaking controllers;
  changing the source naturally resets the view.
- **Move the live node for fullscreen.** Moving instead of cloning preserves the
  controller, listeners, transform and rendered SVG; the placeholder prevents
  the document from jumping when the node leaves the flow.

## Testing Notes

- `npm run typecheck` — passed.
- `npm run test:web` — 18 files, 176 tests passed, including the new
  `mermaid-zoom-math.test.ts` (14) and `mermaid-zoom.test.ts` (13).
- `npm run check` — passed: TypeScript, 60 Rust tests, 176 Vitest tests, and a
  release Tauri build (`--no-bundle`).
- **Chromium end-to-end harness** (`/tmp/opencode/phase4-check.mjs`, Playwright
  with a stubbed Tauri IPC backend) — all checks passed. Coverage included:
  fit-width/70vh sizing, short-diagram centring, toolbar hover, button zoom/fit,
  pointer-anchored `Ctrl`+wheel zoom to 400%, plain-wheel document scrolling,
  drag panning without text selection, double-click fit, fullscreen
  open/Escape/focus/inert/placeholder lifecycle, custom-scale hand-off,
  live-reload and theme-switch persistence, repaint cleanup, identical-diagram
  independence, resize refit, source-change reset, tab-switch reset and absence
  of page errors.
- **WebKitGTK manual check** — real app launched with
  `dbus-run-session -- ./src-tauri/target/debug/docdeck /tmp/opencode/mermaid-zoom-check.md`;
  screenshots confirmed fit-width, the 70vh cap, hover toolbar, 125% steps,
  crisp text at 305%, and correct fullscreen clipping after the CSS fix.
- The Phase 4 checklist was re-run after the final CSS change.

## Usage Examples

- Drag a diagram to pan; a drag under 4px still activates links.
- Hold `Ctrl`/`Cmd` and use the wheel over a diagram to zoom toward the pointer.
- Double-click a diagram, click the fit button, or press `0` to fit the whole
  diagram.
- Focus a diagram and use `+`/`-` to zoom, arrows to pan, or `Shift`+arrow for
  larger steps.
- Hover a diagram and click the fullscreen button; press `Escape` or click the
  backdrop to return.

## Documentation Updates

- `README.md` — added the diagram feature bullet, seven diagram control rows
  and the two frontend modules in the architecture map.
- `CHANGELOG.md` — added the feature under `[Unreleased]` → `### Added`.
- ADR `261024-4` (`_ai/technical_decisions/ADR__261024-4__inline-pan-zoom-for-mermaid-diagrams.md`)
  and its index row were already recorded with the plan.

## Next Steps

- No functional follow-ups are required. If screen-reader testing finds the
  continuously updating percentage noisy, remove `aria-live` from the badge
  while keeping the visual readout.
