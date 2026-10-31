---
description: "Task list for Left Sidebar Document Navigation"
---

# Tasks: Left Sidebar Document Navigation

**Input**: Design documents from `/specs/001-sidebar-document-lists/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui-interactions.md`, `quickstart.md`

**Tests**: Included. The repository requires Vitest coverage for new pure modules
and panel behavior (`AGENTS.md`, plan gate G1); they are not optional here.

**Organization**: Tasks are grouped by user story so P1 delivers an independent
MVP, then P2 and P3 add the browse and activity surfaces.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: `US1`, `US2`, `US3`, or `FOUND` for shared work
- Exact file paths are included in each task

## Path Conventions

Single desktop project: frontend under `src/`, specs under
`specs/001-sidebar-document-lists/`. `src-tauri/` is **not** modified.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the baseline and prepare the working branch.

- [ ] T001 Run `npm run typecheck` and `npm run test:web` on the current HEAD; record the baseline result in the implementation notes
- [ ] T002 Confirm no new runtime dependency is needed and leave `package.json` dependencies unchanged

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extract shared rendering infrastructure, extend the state models,
and reshape the shell. Every user story depends on this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Windowing and modal extraction

- [ ] T003 Move `visibleRange`, `ROW_HEIGHT`, `OVERSCAN`, and a row-recycler helper out of `src/inbox-panel.ts` into a new `src/virtual-list.ts`; keep the public behavior identical
- [ ] T004 [P] Add `src/virtual-list.test.ts` covering range clamping, zero totals, overscan, and scrolling windows (move existing assertions from `src/inbox-panel.test.ts`)
- [ ] T005 Move `InboxBrowser` out of `src/inbox-panel.ts` into a new `src/browse-modal.ts`; update imports and keep the modal contract (`.inbox-overlay`, `role="dialog"`, `Esc`)
- [ ] T006 [P] Update `src/inbox-panel.test.ts` to import the modal/windowing from the new modules; delete the old section-renderer assertions that no longer apply

### State model extensions

- [ ] T007 Add `changedAt` to `InboxEntry` in `src/inbox-model.ts`; set it on create, on a changed `upsert`, and on `markDeleted`, and never decrease it
- [ ] T008 [P] Extend `src/inbox-model.test.ts` to assert `changedAt` semantics, including that a no-op merge does not bump it
- [ ] T009 Extend `src/preferences.ts` with `browseMode: "all" | "recent"`, `openSectionCollapsed: boolean`, and `browseSectionCollapsed: boolean`; add defaults (`"recent"`, `false`, `false`) and per-field decoding
- [ ] T010 [P] Extend `src/preferences.test.ts` for the new fields, a legacy payload without them, and one corrupt field

### Shared sidebar model

- [ ] T011 Create `src/sidebar-model.ts` with `OpenDocument`, `RecentChange`, `SidebarState`, `buildOpenRows(tabs, activePath, autoSort)`, `selectRecent(entries, clearedAt)`, `clearRecent(state, now)`, and `undoClear(state, snapshot)`; no DOM access
- [ ] T012 [P] Add `src/sidebar-model.test.ts` covering ordering, dedupe, deleted inclusion, clear floor, and undo restoration

### Shell and panel skeleton

- [ ] T013 Update `index.html`: remove `<nav id="tabs-bar">` and the `⇄ Layout` button; host the sidebar in place of `#inbox-panel` and keep `#toc-panel` and `#content-container`
- [ ] T014 Update `src/style.css`: collapse the two layout variants into one grid (`header`, then `sidebar | toc | content`); add stacked-section and row styles; remove `.layout-top` / `.layout-side` tab rules
- [ ] T015 Create `src/sidebar-panel.ts` with the two sections, section headers, browse mode switch, status host, clear/undo controls, and callback options (`onOpen`, `onClose`, `onClear`, `onUndo`, `onModeChange`, `onToggleSection`, `onPopout`); render empty/default state first
- [ ] T016 [P] Add `src/sidebar-panel.test.ts` asserting both sections render, mode buttons reflect `aria-pressed`, and `render()` is idempotent

**Checkpoint**: Foundation ready — US1, US2, and US3 can proceed in parallel if
staffed, or sequentially in priority order.

---

## Phase 3: User Story 1 — Switch between open documents (Priority: P1) 🎯 MVP

**Goal**: A usable viewer with an always-present sidebar that lists open
documents and switches, closes, reopens, and orders them.

**Independent Test**: Launch with three documents; switch via sidebar rows, close
one, reopen with `Ctrl+Shift+T`, and toggle Auto-Sort. No browse list required.

### Tests for User Story 1

- [ ] T017 [P] [US1] Extend `src/sidebar-model.test.ts` with open-row cases: manual order vs Auto-Sort, active flag, unread and deleted flags, empty set
- [ ] T018 [P] [US1] Extend `src/sidebar-panel.test.ts` with open-row cases: click activates once, close does not bubble an activation, `aria-current` moves, empty state renders

### Implementation for User Story 1

- [ ] T019 [US1] Implement the Open Documents section in `src/sidebar-panel.ts`: compact rows with filename, active state, unread dot, deleted state, close button, keyboard activation, and the existing context menu
- [ ] T020 [US1] Implement section collapse/expand with `aria-expanded` in `src/sidebar-panel.ts`
- [ ] T021 [US1] Rewire `src/main.ts`: replace `renderTabs()` and the `tabsBar` element with `SidebarPanel.update(...)`; construct the panel with callbacks; remove the layout toggle listener and `sidebarLayout` field
- [ ] T022 [US1] Keep document lifecycle parity in `src/main.ts`: `openDocument`, `setActiveTab`, `closeTabPath`, `reopenClosedTab`, `flashActiveTab`, and copy-path all update the sidebar instead of the tab strip
- [ ] T023 [US1] Apply Auto-Sort to the Open Documents ordering in `src/sidebar-model.ts` and wire the existing `⚡ Auto-Sort` button in `src/main.ts`
- [ ] T024 [US1] Add compact open-row and active/unread/deleted styles to `src/style.css`, including the active-write pulse

**Checkpoint**: US1 is fully functional and testable independently — the app is
usable without the browse or recent lists.

---

## Phase 4: User Story 2 — Browse the complete inventory inline (Priority: P2)

**Goal**: A browse section that shows All Documents, marks open documents, opens
a document, reports scan state, and can pop out.

**Independent Test**: With a multi-document watch config, switch to All
Documents, confirm every path appears once, click a non-open document, and
confirm it opens. No clear/undo required.

### Tests for User Story 2

- [ ] T025 [P] [US2] Extend `src/sidebar-model.test.ts` for All Documents selection and open-path marking
- [ ] T026 [P] [US2] Extend `src/sidebar-panel.test.ts` for All Documents rows, the mode switch, open markers, and row activation
- [ ] T027 [P] [US2] Extend `src/virtual-list.test.ts` for a 10,000-row inventory window

### Implementation for User Story 2

- [ ] T028 [US2] Implement the browse section's mode switch and All Documents rendering in `src/sidebar-panel.ts`, using `src/virtual-list.ts` for the row window
- [ ] T029 [US2] Render scan progress, config error, config-missing hint, warnings, truncation, and the no-watched-documents empty state in the browse status host (`src/sidebar-panel.ts`)
- [ ] T030 [US2] Add a pop-out trigger that opens `src/browse-modal.ts` from the browse header, with `Esc`/backdrop close and focus return
- [ ] T031 [US2] Wire inventory, status, open paths, and active path from `src/main.ts` into `SidebarPanel.update(...)`, including `scan-progress` updates
- [ ] T032 [US2] Add two-line browse-row, mode-switch, status, and pop-out styles to `src/style.css`

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Review and clear recent activity (Priority: P3)

**Goal**: Recently Changed lists distinct touched documents newest-first, can be
cleared (acknowledging unread) and undone, and persists the selected mode.

**Independent Test**: Write to several documents, verify the recent list, clear,
verify unread clearing and undo, then write again and verify reappearance.

### Tests for User Story 3

- [ ] T033 [P] [US3] Extend `src/sidebar-model.test.ts` for recent dedupe/order, deleted inclusion, `clearRecent` floor, later-write reappearance, and `undoClear` restoration
- [ ] T034 [P] [US3] Extend `src/sidebar-panel.test.ts` for Recent rows, clear/undo enabled states, the empty-recent explanation, and mode persistence callbacks
- [ ] T035 [P] [US3] Extend `src/inbox-model.test.ts` for acknowledging unread up to `clearedAt` without touching later changes

### Implementation for User Story 3

- [ ] T036 [US3] Implement the Recently Changed mode in `src/sidebar-panel.ts`, including clear/undo controls and the empty-recent state with a switch-to-All action
- [ ] T037 [US3] Add the acknowledge operation to `src/inbox-model.ts` (clear `unread` for entries with `changedAt <= clearedAt`) and expose the snapshot data the panel needs
- [ ] T038 [US3] Wire clear/undo in `src/main.ts`: create the snapshot, clear unread, show an undo toast via `src/toast.ts`, and restore on undo
- [ ] T039 [US3] Persist and restore `browseMode`, `openSectionCollapsed`, and `browseSectionCollapsed` in `src/main.ts`; keep Recently Changed session-scoped
- [ ] T040 [US3] Repurpose the `✉ Inbox` toggle to show/hide only the browse section in `src/main.ts` and relabel it in `index.html` if needed
- [ ] T041 [US3] Add clear/undo and recent-row styles to `src/style.css`

**Checkpoint**: All three user stories work and remain independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T042 [P] Update `README.md`: replace tab-strip descriptions, the layout toggle, and the control table with the sidebar model
- [ ] T043 [P] Add a `CHANGELOG.md` entry for the sidebar navigation change
- [ ] T044 Remove dead code: the old `inbox-panel.ts` section renderer and CSS no longer referenced; keep `browse-modal.ts`
- [ ] T045 Run `npm run typecheck` and `npm run test:web`; fix all failures
- [ ] T046 Run the manual checks in `specs/001-sidebar-document-lists/quickstart.md`, including the 10,000-document scale smoke test
- [ ] T047 Delete the throwaway scale fixture and confirm `git status` contains only intended changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup; **blocks all user stories**.
- **US1 (Phase 3)**: Depends on Foundational. Delivers the MVP.
- **US2 (Phase 4)**: Depends on Foundational; integrates with US1 but is
  independently testable.
- **US3 (Phase 5)**: Depends on Foundational; uses the browse section from US2
  for its UI, so implement after US2 in practice.
- **Polish (Phase 6)**: Depends on all desired stories.

### User Story Dependencies

- **US1 (P1)**: No story dependency — ship first.
- **US2 (P2)**: No hard dependency on US1; can run in parallel if the panel
  skeleton is stable.
- **US3 (P3)**: Depends on US2 for the browse-mode surface; state logic itself
  is independent.

### Within Each User Story

- Write/extend tests first and confirm they fail.
- Model functions before panel rendering.
- Panel rendering before `main.ts` wiring.
- Wire before styling.
- Validate the story at its checkpoint before moving on.

### Parallel Opportunities

- T004/T006/T008/T010/T012/T016 are separate files and can run in parallel.
- US1 tests (T017, T018) can run in parallel.
- US2 tests (T025–T027) can run in parallel.
- US3 tests (T033–T035) can run in parallel.
- Documentation tasks T042 and T043 are independent.

---

## Parallel Example: Foundational

```bash
# After T003 and T005, these touch different files:
Task: "Add src/virtual-list.test.ts"
Task: "Extend src/inbox-model.test.ts"
Task: "Extend src/preferences.test.ts"
Task: "Add src/sidebar-model.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: run the US1 independent test and
   `npm run typecheck` + `npm run test:web`.
4. Ship/demo the tab-less viewer if desired.

### Incremental Delivery

1. Foundation → all shared infrastructure ready.
2. US1 → usable viewer (MVP).
3. US2 → inline inventory and pop-out.
4. US3 → recent activity with clear/undo.
5. Polish → docs, cleanup, scale validation.

### Notes

- [P] tasks touch different files and have no dependencies.
- Commit after each logical group, not after every checkbox.
- Do **not** modify `src-tauri/`; if a requirement seems to need it, revisit the
  plan first.
- The `changedAt` observation time is the single source of truth for recent
  ordering and clearing; do not substitute file mtime.
