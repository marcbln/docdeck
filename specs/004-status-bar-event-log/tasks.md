---

description: "Task list for Status Bar, Event Log, Window Title, and Resizable Panes"
---

# Tasks: Status Bar, Event Log, Window Title, and Resizable Panes

**Input**: Design documents from `/specs/004-status-bar-event-log/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included. Although the feature spec does not mandate TDD, `plan.md`
(Technical Context and Project Structure) and `research.md` R12 explicitly
require the Vitest suites listed below. Write each test task first and confirm it
fails before the matching implementation task.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Desktop app with a flat webview module layout under `src/` and a Rust service
  layer under `src-tauri/`.
- Tests live beside the module they cover: `src/<module>.test.ts`.
- No new directories are created for source or tests.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the baseline and add the shared chrome skeleton used by
the status bar, event log, and resize boundaries.

- [X] T001 Verify the baseline quality gates in `package.json` (`npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`) and record the results before changing any file
- [X] T002 Extend `index.html` with the app-shell skeleton: a full-width `#event-log` row (hidden by default, directly above the status bar), a one-line `#status-bar` with a status-text segment and warning-chip slot, and mount points for the four resize handles
- [X] T003 [P] Extend `src/style.css` app shell: `grid-template-rows: auto minmax(0, 1fr) auto auto`, `grid-template-areas` for header/sidebar/toc/content/log/status, root custom properties `--sidebar-width`, `--toc-width`, `--event-log-height`, `--sidebar-split`, and base styles for the status bar, event log, separators, and focus-visible states

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The session event store and backend lifecycle recording are shared
by User Story 1 (status bar) and User Story 3 (event log). No user-story UI work
can begin until these are complete.

**⚠️ CRITICAL**: Complete this phase before starting any user story.

- [X] T004 Write `src/event-log.test.ts` first: injected clock, monotonic ids that are never reused after `clear()`, oldest-first ordering, 500-entry capacity plus the 501st-entry eviction, `warnings()` severity filter, `clear()` empties entries but keeps the id counter and capacity, `size` stays `0 … 500`, and non-empty trimmed `message`
- [X] T005 Implement `src/event-log.ts`: `EventSeverity` (`info` · `warning` · `error`), `EventKind` (`scan-start` · `scan-complete` · `reload` · `watch-added` · `watch-removed` · `warning` · `truncated` · `error`), `StatusEvent`, and `EventLog` with fixed `capacity = 500`, `record`, `entries`, `warnings`, `clear`, and `size`; never read or write `localStorage` (FR-015, FR-016)
- [X] T006 Record backend lifecycle events into the new `EventLog` in `src/main.ts` per research R10: `loadWatchConfig` start/success/warnings/truncated/error, `applyReloadResult` reload/warnings/truncation/error plus root added/removed, and `addWatch` start/success/warnings/error; do **not** record document opens, tab activity, link handling, copy actions, summary requests, watcher document ticks, or `scan-progress` ticks (FR-012, FR-014)

**Checkpoint**: The shared event pipeline exists and can be populated from real backend signals; user-story UI work can now begin.

---

## Phase 3: User Story 1 - Quiet left navigation, status moved to a one-line footer (Priority: P1) 🎯 MVP

**Goal**: The sidebar shows only document navigation plus the actionable setup
hint, and a single full-width status line at the bottom reports scan progress,
the most recent watch event, and a warning count.

**Independent Test**: Launch docdeck with at least one watch and let the initial
scan finish. The left sidebar must contain only document lists (plus the setup
hint when no configuration exists), while the bottom line shows live scanning
and afterwards the most recent event with a warning chip.

### Tests for User Story 1

- [X] T007 [P] [US1] Write `src/status-view.test.ts`: scanning with progress, scanning before any progress arrives, newest-event rendering, warning count zero (no chip) and non-zero (chip), idle `Ready` / `Watching N folders`, location shortened before counts, and a single-line `text` value
- [X] T008 [P] [US1] Write `src/status-bar.test.ts` under `happy-dom`: renders derived text and severity; warning chip hidden at zero and visible above zero; chip click calls the warnings-filter callback; clicking the rest of the bar calls the toggle-log callback; the bar never steals focus and never intercepts document scrolling or link activation
- [X] T009 [P] [US1] Extend `src/sidebar-panel.test.ts`: after render the sidebar contains no scan progress, reload summary, warning list, truncation notice, or watch-error text; the setup hint still renders `~/.config/docdeck/config.toml` and the example TOML when the config is missing; the hint is suppressed when a load error exists

### Implementation for User Story 1

- [X] T010 [P] [US1] Implement `src/status-view.ts`: a pure `deriveStatusBar(...)` producing `{ phase, location, directories, files, event, warningCount, severity, text }` with precedence live scan progress > newest event > idle; shorten `location` with `compactPath` before hiding counts (FR-006 – FR-009)
- [X] T011 [P] [US1] Implement `src/status-bar.ts`: a thin one-line DOM controller with `render(view)`, a warning-chip callback, and a toggle-log callback; render all text with `textContent`, keep the bar on a single non-wrapping row, and never intercept document events (FR-005, FR-022)
- [X] T012 [P] [US1] Extend `src/sidebar-panel.ts`: remove the `status` field, `setProgress()`, and all `renderStatus` / scan / reload / warning / truncation / error rendering; retain only `configHintPath` rendering the actionable setup hint (path plus example TOML) when the config is missing and there is no load error (FR-010, FR-011, R11)
- [X] T013 [US1] Update `src/main.ts` status wiring: forward `scan-progress` to the status bar instead of `sidebarPanel.setProgress`; re-derive and render the status line after every recorded event; pass only `configHintPath` to the sidebar; ensure a scan tick never calls `renderSidebar()` or `renderActiveContent()`
- [X] T014 [P] [US1] Add status-bar visual rules to `src/style.css`: single full-width row that never disappears, location `flex: 1 1 auto` with ellipsis, counts `flex: 0 0 auto`, warning chip, severity text/icon for both themes, and no wrapping at narrow widths (FR-009)

**Checkpoint**: User Story 1 is fully functional and testable on its own.

---

## Phase 4: User Story 2 - Window title identifies the project and document (Priority: P1)

**Goal**: The OS window title reads `project — filename — docdeck`, omits the
project for paths outside `_ai`, and is exactly `docdeck` when no document is
active.

**Independent Test**: Open a document under `…/ruleman/_ai/…/README.md` and
confirm `ruleman — README.md — docdeck`; open a file with no `_ai` segment and
confirm `filename — docdeck`; close the last tab and confirm `docdeck`.

### Tests for User Story 2

- [X] T015 [P] [US2] Write `src/window-title.test.ts`: `null` → `docdeck`; project path → `project — file — docdeck`; no `_ai` → `file — docdeck`; multiple `_ai` segments → deepest one; `_ai` at the path root → no project; a file named `_ai.md` → no project; Windows `C:\work\_ai\spec.md` → `work — spec.md — docdeck`; long/Unicode filenames preserved verbatim

### Implementation for User Story 2

- [X] T016 [US2] Implement `src/window-title.ts`: `composeWindowTitle(activePath: string | null): string` using the existing `projectName` and `fileName` helpers from `src/project.ts`, with exactly one U+2014 em dash surrounded by single spaces (FR-001 – FR-003, R2)
- [X] T017 [P] [US2] Add exactly one permission, `core:window:allow-set-title`, to `src-tauri/capabilities/default.json` for the existing `main` window; keep `core:default` and add no other window permission
- [X] T018 [US2] Update `src/main.ts` title wiring: set `document.title` synchronously, then call `getCurrentWindow().setTitle(title)` fire-and-forget with a logged catch; invoke on initial mount, `setActiveTab`, `openDocument`, `closeTabPath`, `closeAllTabs`, and `applyRename` so title updates happen before Markdown rendering (FR-004, R1)
- [X] T019 [P] [US2] Document the Linux Wayland `setTitle` limitation in `README.md`: the taskbar title and `document.title` update, while some compositor-drawn header bars may not repaint (Tauri #13749)

**Checkpoint**: User Story 2 is fully functional and independent of the status/log work.

---

## Phase 5: User Story 3 - Inspect watch history in an event log pane (Priority: P2)

**Goal**: A PhpStorm-style docked event log opens above the status line, shows
timestamped severity-tagged lifecycle entries with full warning text, supports a
warnings filter and clear, follows new entries without stealing scroll position,
and closes on Escape.

**Independent Test**: Trigger a configuration reload with warnings, open the log
from the status line, confirm timestamped entries with severity and full warning
text; filter to warnings, clear the log, and close it again.

**Dependency**: Depends on Phase 2 (EventLog) and Phase 3 (status-bar click and
warning-chip source).

### Tests for User Story 3

- [X] T020 [P] [US3] Write `src/event-log-panel.test.ts` under `happy-dom`: explicit empty state; `All` / `Warnings` filter; clear empties entries and keeps the panel open; following at/near the bottom (within 24 px) appends without jumping; scrolling up pauses following and shows an `N new events` indicator; returning to the bottom clears the indicator and resumes; Escape closes only the panel; closing returns focus to the opener

### Implementation for User Story 3

- [X] T021 [US3] Implement `src/event-log-panel.ts`: docked controller reading `EventLog`, owning open/closed, `All`/`Warnings` filter, clear, follow/pause, and Escape focus return; append one row incrementally per new entry without re-rendering the whole list; render timestamp, severity, one-line message, and full `detail` with `textContent` only (FR-017 – FR-022, R5)
- [X] T022 [US3] Update `src/main.ts` log wiring: status-bar click toggles the panel; the warning chip opens it with the `Warnings` filter selected; `Ctrl+\`` toggles the panel and is ignored while typing in an input/textarea/contenteditable; append new `EventLog` entries while open; clearing the log removes the warning chip until a later warning event; keep visibility, filter, and follow state session-only and never persisted
- [X] T023 [P] [US3] Add event-log visual rules to `src/style.css`: full-width docked row above the status bar, header controls (`All`, `Warnings`, `Clear`, close), timestamp/severity/message/detail rows, explicit empty states (`No events in this session` / `No warnings in this session`), `N new events` pill, scroll host, and both themes

**Checkpoint**: User Story 3 is functional on top of the shared event pipeline and status bar.

---

## Phase 6: User Story 4 - Resize panes with the mouse and keep the sizes (Priority: P2)

**Goal**: All four boundaries (sidebar width, outline width, event-log height,
Open/Browse split) are mouse- and keyboard-resizable, reset on double-click,
stay inert when their pane is hidden or collapsed, and persist through the
existing `docdeck.preferences.v1` key.

**Independent Test**: Drag each boundary, close and reopen docdeck, and confirm
the sizes return within 2 px; double-click each boundary and confirm the defaults
(sidebar 300 px, outline 240 px, log 200 px, even split) return.

**Dependency**: Depends on Phase 3 for the sidebar structure (both stories touch
`src/sidebar-panel.ts`).

### Tests for User Story 4

- [X] T024 [P] [US4] Write `src/layout-model.test.ts`: defaults `sidebarWidth 300`, `tocWidth 240`, `eventLogHeight 200`, `sidebarSplit 50`; static clamping; sidebar bounded `200 … min(600, floor(windowWidth / 2))`; outline bounded `160 … min(480, floor(windowWidth / 2))`; log bounded `100 … floor(0.6 * windowHeight)`; split bounded `15 … 85`; 320 px document floor allocation at 700 px and below; `resolveLayout` never mutates the stored preference; a window resize clamps the effective size without overwriting stored values (FR-023 – FR-026, FR-032, SC-005)
- [X] T025 [P] [US4] Write `src/layout-resizer.test.ts` under `happy-dom`: pointer drag for vertical and horizontal separators with clamping; persistence callback fires only on pointerup/cancel/blur; double-click restores the default; `ArrowLeft`/`ArrowRight` and `ArrowUp`/`ArrowDown` adjust by 10 px (2% for the split); `Home`/`End` jump to minimum/maximum; `Enter`/`Space` restore the default; `aria-valuenow` updates after every change; hidden/collapsed boundaries get `hidden`, `tabindex="-1"`, `aria-disabled="true"` and cannot start a drag; no Markdown render callback fires
- [X] T026 [P] [US4] Extend `src/preferences.test.ts`: layout defaults; full round-trip; legacy payload without `layout`; missing field, non-number, `NaN`/`Infinity`, and out-of-range values fall back per field while other preference fields survive; corrupt JSON still returns defaults; the storage key stays `docdeck.preferences.v1` with `version: 1`
- [X] T027 [P] [US4] Extend `src/sidebar-panel.test.ts`: the Open/Browse split host and handle render with `role="separator"`, accessible label, horizontal orientation, and `aria-valuemin`/`aria-valuemax`/`aria-valuenow`; the handle becomes inert when either section is collapsed

### Implementation for User Story 4

- [X] T028 [P] [US4] Implement `src/layout-model.ts`: `LayoutPreferences`, `DEFAULT_LAYOUT`, static limits, per-field `validateLayout`, and pure `resolveLayout(preferences, viewport)` returning effective `{ sidebarWidth, tocWidth, eventLogHeight, openFraction, documentMin: 320 }`; distribute remaining width when side panes would consume the 320 px document floor (FR-023 – FR-026, R7)
- [X] T029 [P] [US4] Extend `src/preferences.ts`: add `layout: LayoutPreferences` to `Preferences` and `DEFAULT_PREFERENCES`; decode each layout field independently with the static ranges from `data-model.md`; missing/corrupt/out-of-range fields use that field's default without discarding other fields; keep `version: 1` (FR-031, R8)
- [X] T030 [US4] Implement `src/layout-resizer.ts`: a reusable separator controller with guarded `setPointerCapture`, window-level `pointermove`/`pointerup`/`pointercancel`, double-click reset, keyboard `Arrow*`/`Home`/`End`/`Enter`/`Space`, `aria-valuenow` updates, an enabled/inert switch, and a persist-on-end callback; it must never render Markdown (FR-027 – FR-030, R9)
- [X] T031 [P] [US4] Extend `src/sidebar-panel.ts`: add the split host and handle mount point between Open Documents and Browse, expose split size updates, preserve the collapsed-section behavior, and keep the document lists/filter/empty states unchanged (FR-026, FR-029)
- [X] T032 [US4] Update `src/main.ts` layout wiring: instantiate `resolveLayout` and four `layout-resizer` controllers (sidebar, toc, event log, sidebar split); apply `--sidebar-width`, `--toc-width`, `--event-log-height`, and `--sidebar-split` to the app root; recompute effective sizes on window resize without persisting; persist final sizes through `createPreferenceWriter` only on drag end, keyboard change, or double-click; keep hidden/collapsed boundaries inert; never call `renderActiveContent` during a resize (FR-030 – FR-032, SC-007)
- [X] T033 [P] [US4] Add resizer/handle rules to `src/style.css`: 5 px visible handle with a larger invisible hit area, orientation cursors, focus-visible accent for both themes, positioning for sidebar/toc/log edges, and the sidebar split divider
- [X] T034 [P] [US4] Raise `minWidth` from 640 to 700 in `src-tauri/tauri.conf.json` (200 + 160 pane minima + 320 px document floor plus handle/border room)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, decision records, cleanup, and final validation.

- [X] T035 [P] Update `README.md`: window-title composition and Wayland caveat, status bar, session-only 500-entry event log, resizing and persistence, the 700 px minimum window width, and confirmation that no dependency was added
- [X] T036 [P] Add Unreleased entries to `CHANGELOG.md` for the status bar, event log, window title, and resizable panes
- [X] T037 [P] Create `_ai/context-definitions/status-bar-event-log.md` describing the four chrome surfaces, state ownership (webview vs. session-only vs. persisted layout), and the test seams
- [X] T038 [P] Create `_ai/technical_decisions/ADR__261106-1__session-event-log-and-resizable-panes.md` and add it to the index in `_ai/technical_decisions/README.md`
- [X] T039 Remove now-dead sidebar status code, imports, and `.inbox-status` styles from `src/sidebar-panel.ts` and `src/style.css`, then confirm `npm run typecheck` reports no unused locals or parameters
- [X] T040 Run the full validation pass: `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`, optional `npm run tauri build -- --no-bundle`, the `specs/004-status-bar-event-log/quickstart.md` manual checks, and confirm `package.json` / `src-tauri/Cargo.toml` gained no dependency

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks US1 and US3 (shared event store), and all story UI that uses the new shell rows.
- **User Story 1 (Phase 3, P1)**: Depends on Foundational.
- **User Story 2 (Phase 4, P1)**: Depends on Foundational only; independent of US1.
- **User Story 3 (Phase 5, P2)**: Depends on Foundational and US1 (status-bar click source and warning chip).
- **User Story 4 (Phase 6, P2)**: Depends on Foundational and US1 (sidebar structure before adding the split host).
- **Polish (Phase 7)**: Depends on all selected stories.

### User Story Dependencies

- **US1**: Requires the EventLog from Phase 2; no other story dependency.
- **US2**: Independent of US1/US3/US4 apart from shared `src/main.ts` edits.
- **US3**: Requires US1 for the status-bar toggle/warning-chip entry points.
- **US4**: Requires US1 for the final sidebar structure; independent of US2/US3.

### Shared-file serialization points

`src/main.ts` and `src/style.css` are touched by several stories. Treat them as
serialization points: implement stories in priority order, or coordinate edits so
parallel work never rewrites the same region. `src/sidebar-panel.ts` is shared by
US1 and US4, so US4 starts after US1 completes.

### Within Each User Story

1. Write the failing test tasks first.
2. Implement pure models before DOM controllers.
3. Implement controllers before orchestrator wiring in `src/main.ts`.
4. Add styles after the DOM structure exists.
5. Verify the independent test criterion before moving on.

### Parallel Opportunities

- Setup: T002 and T003 touch `index.html` and `src/style.css` respectively.
- US1: T007, T008, and T009 are separate test files; T010, T011, T012, and T014 touch separate implementation/style files.
- US2: T015, T017, and T019 touch separate files.
- US3: T020 and T023 touch separate files.
- US4: T024, T025, T026, and T027 are separate test files; T028, T029, T031, T033, and T034 touch separate files.
- Polish: T035 – T038 touch separate documentation files.

---

## Parallel Example: User Story 1

```bash
# Write the three failing suites together (different files):
Task: "Write src/status-view.test.ts"
Task: "Write src/status-bar.test.ts"
Task: "Extend src/sidebar-panel.test.ts"

# Then implement the independent modules together (different files):
Task: "Implement src/status-view.ts"
Task: "Implement src/status-bar.ts"
Task: "Extend src/sidebar-panel.ts"
Task: "Add status-bar rules to src/style.css"
# Serialize src/main.ts wiring after those complete.
```

## Parallel Example: User Story 4

```bash
# Write the four failing suites together (different files):
Task: "Write src/layout-model.test.ts"
Task: "Write src/layout-resizer.test.ts"
Task: "Extend src/preferences.test.ts"
Task: "Extend src/sidebar-panel.test.ts"

# Then implement the independent modules together (different files):
Task: "Implement src/layout-model.ts"
Task: "Extend src/preferences.ts"
Task: "Extend src/sidebar-panel.ts"
Task: "Add resizer rules to src/style.css"
Task: "Raise minWidth in src-tauri/tauri.conf.json"
# Serialize src/layout-resizer.ts → src/main.ts wiring.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (shared EventLog and lifecycle recording).
3. Complete Phase 3: US1 (quiet sidebar + one-line status bar).
4. **STOP and VALIDATE**: run the US1 independent test and `npm run test:web`.
5. Demo the quiet navigation and status line.

### Recommended First Release

Ship **US1 + US2** together: both are P1, and the window title is independent of
the status-bar internals. Then add US3 (event log) and US4 (resizable panes) in
priority order.

### Incremental Delivery

1. Setup + Foundational → shell and event pipeline ready.
2. US1 → validate → deliver.
3. US2 → validate → deliver.
4. US3 → validate → deliver.
5. US4 → validate → deliver.
6. Polish → final gates and quickstart.

### Parallel Team Strategy

With multiple developers, complete Setup + Foundational together, then:

- Developer A: US1 (status bar, sidebar cleanup).
- Developer B: US2 (window title + permission) — coordinate only `src/main.ts`.
- After US1: Developer C: US3 (event log panel).
- After US1: Developer D: US4 (layout model, resizers, preferences).

Because `src/main.ts` and `src/style.css` are shared, merge order is US1 → US2 →
US3 → US4 unless the team explicitly coordinates smaller patches.

---

## Notes

- [P] tasks = different files and no dependency on an incomplete task.
- [Story] labels map tasks to the user story for traceability.
- Each user story is independently completable and testable at its checkpoint.
- Verify each test task fails before the matching implementation.
- Commit after each task or logical group.
- Avoid: vague tasks, same-file conflicts, and cross-story dependencies that
  break the stated independent test criteria.
