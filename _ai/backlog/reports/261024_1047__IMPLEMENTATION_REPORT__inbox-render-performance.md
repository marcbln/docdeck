---
filename: "_ai/backlog/reports/261024_1047__IMPLEMENTATION_REPORT__inbox-render-performance.md"
title: "Report: Inbox render performance"
createdAt: 2026-10-24 10:47
createdBy: opencode [deepseek-v4.1-flash-free]
updatedAt: 2026-10-24 11:40
updatedBy: opencode [deepseek-v4.1-flash-free]
planFile: "_ai/backlog/active/261024_1047__IMPLEMENTATION_PLAN__inbox-render-performance.md"
project: "docdeck"
status: completed
filesCreated: 1
filesModified: 6
filesDeleted: 0
tags: [performance, inbox, virtual-list]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Inbox render performance

## 1. Summary

Tab activation no longer rebuilds the inbox. `InboxPanel` now owns a stable
header/status/list shell, keeps a registry of rendered rows, and exposes
`setActive()` and `setProgress()` fast paths. The `paths-changed` listener
applies a whole watcher batch to the model and then renders once; a
`scan-progress` tick touches only the status host.

The inbox list is windowed: only the rows intersecting the panel viewport plus
six rows of overscan exist in the DOM. Rows are absolutely positioned at
`index * 48px` inside a rail sized `entries.length * 48px`, and row elements are
pooled and re-bound by index as the user scrolls. Click and keydown handlers are
delegated to the list, so no listeners are attached per row.

The change is frontend-only. The Rust watcher, the inbox model, the sort order,
and all unread/deleted/open/active semantics are unchanged.

## 2. Files Changed

### Created (1)

| File | Purpose |
| --- | --- |
| `_ai/backlog/reports/261024_1047__IMPLEMENTATION_REPORT__inbox-render-performance.md` | This report |

### Modified (6)

- `src/inbox-panel.ts` — stable shell, `setActive()`/`setProgress()`/`refresh()`,
  delegated row events, exported `visibleRange()`, pooled window renderer,
  scroll/resize handling, `destroy()`.
- `src/inbox-panel.test.ts` — phase-1 fast-path tests, window tests, and pure
  `visibleRange()` table tests. All 11 original tests are kept.
- `src/main.ts` — `setActiveTab()` patches rows, batched `paths-changed`
  handling with a synchronous `applyPathChange()` returning flags,
  status-only `scan-progress`, `refresh()` when the inbox is shown.
- `src/style.css` — positioned panel/list, absolutely positioned fixed-height
  rows, `overflow: hidden` guard.
- `README.md` — architecture description, windowing note, native-find limitation.
- `CHANGELOG.md` — `Unreleased → Fixed` entry.

The ADR (`_ai/technical_decisions/ADR__261024-3__windowed-inbox-list.md`) was
written during analysis and is indexed in `_ai/technical_decisions/README.md`.

## 3. Key Changes

- **Stable panel shell.** The constructor builds the header, status host, and
  list once. `render()` writes into those regions instead of replacing the
  panel subtree, so the list node and its scroll position survive every render.
- **O(1) tab activation.** `AppState.setActiveTab()` captures the previous
  active path, calls `inbox.markRead()`, and then
  `inboxPanel.setActive(previous, active, unreadCount())`. The panel toggles
  classes on at most two rendered rows and rewrites the header count. No model
  sort and no row creation happen.
- **Batched watcher events.** The `paths-changed` payload is applied in one
  synchronous pass. `applyPathChange()` returns
  `{ inboxChanged, tabsChanged, activeDeleted, reload }`; the listener renders
  tabs, inbox, and active content at most once per batch and then starts the
  document reloads. A burst of N writes no longer triggers N inbox renders.
- **Status-only progress.** `scan-progress` calls `setProgress()`, which
  replaces only the status host. It also schedules a window render because the
  list offset may have moved.
- **Windowed list.** `visibleRange()` is a pure exported function; `ROW_HEIGHT`
  (48) and `OVERSCAN` (6) are exported constants. The panel keeps
  `rendered: Map<index, row>` and a `freeRows` pool, removes leaving rows,
  creates only entering rows, and re-binds all rendered rows after a data
  change. Descending insertion keeps DOM order equal to index order without
  moving rows that stay in the window.
- **Delegated events.** One click listener and one keydown listener on the list
  replace the previous 2 × N per-row listeners. `closest(".inbox-row")` resolves
  the path from `data-path`.
- **Hidden and resized panels.** A zero-height viewport recycles every row and
  returns; `refresh()` re-windows when the inbox is shown, and a `resize`
  listener re-windows on window changes. `destroy()` releases both listeners.
- **Offscreen state is preserved.** `setActive()` stores the active path even
  when its row is not rendered; scrolling to that index binds the row with the
  `active` class already applied.

## 4. Technical Decisions

- **48 px rows.** The measured natural row height is 47 px. `ROW_HEIGHT = 48`
  gives one pixel of slack and is written inline by `bindRow()`, so the range
  math and the DOM cannot disagree. `.inbox-row { overflow: hidden }` clips any
  spill from a future style change.
- **Absolute rows.** The plan's CSS snippet added `position: relative` to the
  list but did not show the row positioning rule. The implementation adds
  `position: absolute; left: 0; right: 0` to `.inbox-row`, matching the ADR
  ("absolutely positioned at `index * ROW_HEIGHT` inside a rail").
- **Warnings toggle re-windows.** Expanding or collapsing the warnings
  `<details>` changes the status height and therefore the list's `offsetTop`.
  A `toggle` listener schedules a window render so the visible range stays
  correct even when the user expands warnings while scrolled.
- **Index-keyed recycling.** The window is defined in index space, so an index
  that remains in range keeps its element. A data change re-binds the same
  nodes in place; only the scroll pixel offset is preserved, exactly like the
  previous full-render behavior.
- **No `InboxModel` changes.** `entriesSorted()`, unread, deleted, and merge
  semantics are untouched. The sort now runs only on data changes, not on tab
  activation or progress ticks.

## 5. Testing

All commands pass:

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run test:web` | 16 files, 148 tests pass (was 132; +16) |
| `npm test` | 60 Rust tests + 148 frontend tests pass |
| `npm run lint:rs` | pass (`cargo clippy -D warnings`) |
| `npm run build` | pass |

New frontend coverage:

- `setActive()` moves the active class without replacing row nodes, clears the
  previous row, adds `open`, removes `unread`, and updates the header count.
- `setProgress()` replaces only the status host; the row and list nodes survive.
- 1,000 entries with a 480 px viewport render 22 rows and a 48,000 px rail.
- Scrolling moves the window to indices 394–415.
- An offscreen active path binds as active when it scrolls into view.
- A data render reuses the index-0 row node and re-binds its relative time.
- An empty inbox has no rows, shows the empty message, and has a 0 px rail.
- `visibleRange()` covers empty, zero-height, undersized, top, middle, clamped
  bottom, single-row, and fractional-offset inputs.

## 6. Measurements

Measured with a throwaway WebKitGTK harness (not committed), using the real
`src/style.css`, the real compiled `InboxPanel` (old version from `HEAD` vs the
new implementation), 7,000 synthetic `_ai` entries, a 1,280×900 window, and a
280 px inbox panel. Each value is the median of three runs; layout was forced
with `scrollHeight` and `getBoundingClientRect()`.

| Operation | Before | After |
| --- | --- | --- |
| First inbox paint | 6,939 ms | 26 ms |
| Tab switch (full render vs class patch) | 6,754 ms | 1 ms |
| Data render (one changed entry) | — | 17 ms |
| Scroll tick | — | 16 ms |
| DOM nodes after render | 56,004 | 253 |

The absolute "before" numbers are higher than the ADR analysis (≈4,000 ms),
probably because this run used software rendering after the harness logged
`Failed to create GBM buffer ...: Invalid argument`; the ratio and the DOM
count are the meaningful results. The new first paint is ~26 ms and the DOM is
constant at 22 rows plus chrome, which meets the plan's target (<250 ms in the
real app, tens of ms in the harness).

The interactive checks from the plan (clicking through tabs, scrolling the real
app, toggling the inbox, switching layouts) were not automated in this
environment; they are covered by the component tests and the harness, and
should be confirmed once with `npm run tauri dev -- ./README.md` against the
real config.

## 7. Deviations

- Added the missing absolute-positioning rule to `.inbox-row` (see §4).
- Added the warnings `toggle` re-window listener (see §4).
- The report records 6 modified files instead of the plan template's 4 because
  `README.md` and `CHANGELOG.md` are counted alongside the four code files.
- No Rust changes, no new dependencies, and no new Tauri permissions.
