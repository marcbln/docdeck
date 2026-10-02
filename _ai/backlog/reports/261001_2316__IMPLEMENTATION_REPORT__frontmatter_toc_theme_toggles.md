---
filename: "_ai/backlog/reports/261001_2316__IMPLEMENTATION_REPORT__frontmatter_toc_theme_toggles.md"
title: "Report: Frontmatter Metadata Table, Table of Contents, Light/Dark Theme and View Toggles for docdeck"
createdAt: 2026-10-02 02:45
updatedAt: 2026-10-02 02:45
planFile: "_ai/backlog/active/261001_2316__IMPLEMENTATION_PLAN__frontmatter_toc_theme_toggles.md"
project: "docdeck"
status: completed
filesCreated: 16
filesModified: 9
filesDeleted: 0
tags: [typescript, vite, markdown, frontmatter, yaml, toc, theming, vitest]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Frontmatter Table, TOC, Theme and Toggles

## 1. Summary

YAML frontmatter now renders as a collapsible two-column metadata table instead
of a wall of `filename: "..." title: "..."` prose, an `h1`–`h4` outline occupies
a collapsible sidebar column with scroll-spy highlighting and click-to-jump, and
a light/dark theme toggle swaps the app chrome, the GitHub markdown styles,
syntax highlighting and Mermaid diagrams between Catppuccin Mocha and Latte.
All three toggles persist under `docdeck.preferences.v1`, and the frontend now
has a vitest + happy-dom suite (45 tests, 6 files) wired into `npm test`.

## 2. Files Changed

**New** (16):

| File | Purpose |
| --- | --- |
| `src/frontmatter.ts` | Split an anchored `---` block off the document, parse it with `yaml`, flatten to typed rows |
| `src/frontmatter.test.ts` | 13 tests — split edge cases, value formatting, malformed YAML |
| `src/toc.ts` | Heading extraction from marked tokens, GitHub-compatible Unicode slugs, duplicate disambiguation |
| `src/toc.test.ts` | 12 tests — slugging, depth cap, duplicates, inline html, link text |
| `src/preferences.ts` | Versioned `localStorage` read/write with per-field validation, debounced writer |
| `src/preferences.test.ts` | 6 tests — defaults, round-trip, corrupt JSON, per-field recovery |
| `src/toolbar.ts` | `createToggleButton` factory with `aria-pressed` |
| `src/toolbar.test.ts` | 3 tests — initial state, click, programmatic `setState` |
| `src/theme.ts` | Runtime `<link>` swapping for both palettes, Latte CSS vars, Mermaid Latte variables |
| `src/metadata-table.ts` | `createMetadataTable` — `<details>` + two-column table |
| `src/metadata-table.test.ts` | 6 tests — row rendering, nesting, empty values, malformed flag |
| `src/metadata-jump.ts` | `MetadataView` — owns folded state across reloads, `reveal()` |
| `src/metadata-jump.test.ts` | 5 tests — mount position, fold recording, fold survival, reveal |
| `src/toc-panel.ts` | `TocPanel` — outline render, `IntersectionObserver` scroll-spy, jump |
| `src/vite-env.d.ts` | `vite/client` types for the `?url` stylesheet imports |
| `vitest.config.ts` | happy-dom environment, `src/**/*.test.ts` |

**Modified** (9): `src/main.ts` (orchestrator rewrite), `src/markdown.ts`
(exported `marked`, heading-id stamping, theme-aware Mermaid init, exported
`isTailing`), `src/style.css` (Latte variable block, TOC grid area, metadata and
outline styles), `index.html` (TOC `<nav>`, three toolbar buttons),
`package.json` (+`yaml`, +vitest/happy-dom, `test` runs both suites),
`package-lock.json`, `README.md`, `CHANGELOG.md`,
`scripts/simulate_agent_writes.sh`.

**Deleted**: none.

## 3. Key Changes

- **Frontmatter split** uses an offset-0-anchored regex (`^---[ \t]*\r?\n…\r?\n---`),
  so a thematic break at line 40 is not mistaken for a header. CRLF tolerated.
- **Rows are typed** (`scalar` / `list` / `object` / `empty`) with a `depth`, so
  the table view can indent nested maps, inline lists and placeholder a
  valueless key without re-parsing anything.
- **Malformed YAML degrades** to one verbatim row instead of throwing. Verified
  against real `yaml@2.9.1`: `parseYaml("a: [unclosed")` raises `YAMLParseError`.
- **Slugs are computed once** by `extractHeadings` and used for both the ids
  stamped onto rendered headings and the outline's anchors, so the two cannot
  drift apart. `marked` emits no heading ids at all, so stamping is mandatory.
- **Outline headings are walked recursively**; `heading.text` keeps raw markdown
  (`## **Bold** and \`code\`` yields the literal string), and `html` tokens are
  skipped so inline markup never reaches a slug.
- **Theme swapping detaches the inactive `<link>`** rather than hiding it —
  the two `github-markdown-css` variants both define `.markdown-body`, so
  keeping both in the document would let the loser win on cascade order.
- **Folded state of the metadata table lives in `MetadataView`**, not on the
  element, because every live reload rebuilds the `<details>` from scratch.
- **Preferences are validated per field**, so one bad value costs the reader that
  preference rather than all three. Writes are debounced 250 ms.

## 4. Deviations from Plan

Four, all forced by defects or gaps in the plan text:

1. **`.layout-top` grid areas rewritten.** The plan's Step 7.3 block declared
   `"header"` on its own row above a two-column area set. CSS requires every row
   of `grid-template-areas` to have the same column count, so that declaration
   would have been dropped wholesale and the whole top layout lost its grid.
   Replaced with a valid three-row set (`header/tabs` spanning both columns,
   then `toc | content`), which also keeps the tab strip full-width as the name
   promises.
2. **Metadata table is mounted *after* `renderMarkdown`, not before.** The plan's
   Step 8.3 mounts the `<details>` first and then calls `renderMarkdown`, which
   owns `targetEl.innerHTML` and would wipe the table. §4.3 of the same plan gets
   the order right (render → mount → rebuild); the code sample contradicted it.
   Implemented in the §4.3 order.
3. **Tail re-pinning added to `main.ts`.** Because the table is mounted after the
   renderer has restored the scroll position, its height is not part of the
   renderer's own "was tailing" calculation — a reader parked at the bottom of a
   live agent log would end up ~250 px short of the end on every write. The
   renderer now exports `isTailing(scroller)` (its existing private constant,
   extracted) and `main.ts` re-pins after mounting.
4. **`ThemeController` uses an explicit field, not a parameter property.** The
   plan's own Appendix A flags this; repeated here for the record.

Everything else — module boundaries, interfaces, test files, CSS, README and
CHANGELOG copy — was implemented as written.

## 5. Technical Decisions

- `src/toc-panel.ts` and `src/theme.ts` use explicit field declarations instead
  of constructor parameter properties, matching `main.ts`.
- The metadata anchor id `doc-metadata` is defined in both `metadata-table.ts`
  (where the element is created) and `toc-panel.ts` (where the link targets it).
  Left as the plan specified; the two are asserted to agree by
  `metadata-jump.test.ts` mounting and `TocPanel` navigating to the same id.
- Recorded as `_ai/technical_decisions/ADR__261002-1__runtime-stylesheet-swapping-for-themes.md`:
  why the theme swaps `<link>` elements instead of toggling a class.

## 6. Testing Notes

Automated:

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean (strict, `noUnusedLocals`, `noUnusedParameters`) |
| `npm run test:web` | **45 passed, 0 failed** across 6 files |
| `npm test` | cargo suite ok + 45 vitest tests ok |
| `npm run lint:rs` | `cargo clippy -D warnings` clean |
| `npm run tauri build -- --no-bundle` | release binary built |
| `bash -n scripts/simulate_agent_writes.sh` | syntax ok |

Manual checklist (Step 8.6) executed against the release binary on
`:0.0`, driven with `xdotool` and captured with `import`:

| Check | Result |
| --- | --- |
| `---` block renders as a table, no stray `<hr>` | pass |
| `tags: [typescript, vite, …]` renders inline | pass |
| `createdAt: 2026-10-01 23:16` renders as a string | pass |
| `filename:` wraps instead of widening the table | pass |
| Outline lists `Problem Statement` … to depth 4, indented by depth | pass |
| Clicking an outline entry scrolls the heading to the pane top | pass |
| Clicking `Document metadata` expands a folded table and scrolls to it | pass |
| Theme toggle flips chrome, markdown surface and code colors | pass |
| Theme toggle re-renders Mermaid with the new palette | pass (verified with a diagram probe) |
| Scroll-spy highlights the current heading | pass |
| Folded table survives a background append | pass |
| All three toggles survive a restart | pass |
| Sidebar layout with and without the outline column | pass |

Deliberately **not** unit tested: the `IntersectionObserver` scroll-spy. happy-dom
does not implement it, so `TocPanel.observe()` guards with
`typeof IntersectionObserver === "undefined"` and only the highlight logic goes
uncovered — it was verified manually instead.

## 7. Usage Examples

Not applicable — no CLI surface changed. The three new controls are toolbar
buttons (`☰ Outline`, `⚙ Frontmatter`, `☀ Theme`).

## 8. Documentation Updates

- **README**: three feature bullets, three control-table rows, a Preferences
  subsection, the development script block and the architecture tree.
- **CHANGELOG**: `Unreleased` → `Added` and `Changed`.
- **ADR**: `_ai/technical_decisions/ADR__261002-1__runtime-stylesheet-swapping-for-themes.md`
  plus the directory README index.

## 9. Next Steps

- `MetadataView.reveal()` uses `scrollIntoView({ block: "start" })`, which puts
  the table flush under the sticky header. The outline's own `scrollTo` already
  subtracts a `SCROLL_OFFSET_PX`; doing the same in `reveal()` would align them.
- The docdeck webview's `localStorage` currently holds a light/outline-on state
  left over from live verification. Delete
  `~/.local/share/com.marc.docdeck/localstorage/` to fall back to the documented
  defaults.
- Consider extracting the sidebar-title into the frontmatter table's `<summary>`
  once a second metadata consumer exists; today `title` is accepted but unused.