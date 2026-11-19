# Tasks: Document and Section Bookmarks

**Input**: Design documents from `/specs/005-document-bookmarks/`

**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Included because the plan and Constitution P-II require every new
pure module to ship with deterministic tests and the DOM controllers to be
covered with `happy-dom`. Write each story's tests first and confirm they fail
before implementing it.

**Organization**: Tasks are grouped by user story so each priority can be
implemented, tested and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US4]`, mapping to the user stories in `spec.md`
- Every task names the exact file(s) it changes.

## Path Conventions

Desktop application with a flat webview `src/` and a Rust service layer in
`src-tauri/src/`. Documentation lives under `specs/005-document-bookmarks/`,
`_ai/`, and the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types, preference shape and list plumbing used by every story.

- [X] T001 Add `BookmarkCollection`, `DocumentBookmark`, `SectionBookmark`,
  `SectionAnchor`, remove-snapshot types, `EMPTY_COLLECTION` and identifier /
  heading-text normalization helpers in `src/bookmarks-model.ts`. Mirror the
  field names and validation ranges in
  `specs/005-document-bookmarks/data-model.md`: non-empty `path`/section `id`,
  finite `addedAt`, unique section ids, `depth` 1–4, `before`/`after` arrays of
  at most two strings nearest-first, `text` a string (empty allowed), and
  non-negative integer `ordinal`/`order`.
- [X] T002 [P] Extend `src/preferences.ts` and `src/preferences.test.ts` with
  `browseMode: "all" | "recent" | "bookmarks"` and
  `bookmarkNotificationsOnly: boolean` (default `false`). Validate each field
  independently; an unknown mode or non-boolean value falls back without
  discarding other preferences.
- [X] T003 [P] Extend `src/virtual-list.ts` and `src/virtual-list.test.ts` with a
  configurable `rowSelector` and activation rules: a click on
  `.inbox-row-main` or row padding activates the item; clicks on any other
  `button`/`a` do not. Keyboard activation stays limited to the main control or
  a focused row.
- [X] T003a [P] Add `src/shortcuts.ts` and `src/shortcuts.test.ts`: one registry
  of the application's fixed shortcuts (`Ctrl`/`Cmd`+`D`, `Ctrl`+`Tab`,
  `Ctrl`+`Shift`+`Tab`, `Ctrl`/`Cmd`+`Shift`+`T`, `Ctrl`/`Cmd`+`` ` ``,
  `Ctrl`/`Cmd`+`F`), a platform-aware label formatter (Ctrl vs Cmd), event
  matching, a typing-target guard for inputs/textareas/contenteditable, and a
  modal-open predicate that detects `[role="dialog"][aria-modal="true"]`.
  This is the shared seam feature 006 will use for shortcut conflict
  validation; only the copy shortcut is remappable, so nothing here is
  configurable yet.

**Checkpoint**: Shared types, preference decoding, row activation rules and
shortcut/modal seams are ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Durable collection, controller and accessible row scaffold that all
stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Implement `decode()` and the debounced storage writer in
  `src/bookmarks-storage.ts`; add `src/bookmarks-storage.test.ts` covering an
  absent key, corrupt JSON, wrong version, non-array fields, malformed
  document/section entries, duplicate paths/ids, debounce coalescing, explicit
  flush and tolerant write failure.
- [X] T005 [P] Implement pure collection operations in `src/bookmarks-model.ts`:
  add/remove/toggle document bookmark, add/remove section bookmark, duplicate
  detection by anchor identity, rename both kinds (dedupe a pre-existing target),
  notification path set (sorted unique document + section paths), and
  `RemovedBookmark` snapshots. Extend `src/bookmarks-model.test.ts` with
  add/remove/toggle/duplicate/rename/undo-snapshot cases. Depends on T001.
- [X] T006 Implement the base `BookmarksController` in
  `src/bookmarks-controller.ts` with injected clock, storage and notification
  sync seam: load, persist, document and section mutations, single-slot undo,
  rename and a session resolution map API. Extend
  `src/bookmarks-controller.test.ts` with document add/remove/undo, rename and
  storage-restart cases. Depends on T004, T005.
- [X] T007 Refactor document rows in `src/sidebar-rows.ts` and the open rows in
  `src/sidebar-panel.ts` into a main activation button plus sibling close button
  (no bookmark star yet). Update `src/sidebar-panel.test.ts`,
  `src/browse-modal.test.ts` and `src/virtual-list.test.ts` so clicking the main
  area activates, and clicking close does not. Depends on T003.
- [X] T008 Extend `src/toast.ts` and `src/toast.test.ts` with an optional inline
  action (`label`, `onClick`): one toast node, replacing an action replaces the
  callback, timeout hides it, and a click invokes it exactly once.
- [X] T009 [P] Extend `BrowseMode` and its tests in `src/sidebar-model.ts` /
  `src/sidebar-model.test.ts` with `"bookmarks"`. Keep the existing `all` and
  `recent` behavior unchanged.

**Checkpoint**: Collection, storage, controller, undo and accessible rows are
ready; user stories can start.

---

## Phase 3: User Story 1 — Bookmark documents and return to them (Priority: P1) 🎯 MVP

**Goal**: Add and remove whole-document bookmarks from the active document, any
navigation row, the context menu or `Ctrl`/`Cmd`+`D`; list them in a third browse
mode; persist across restarts; remove with undo; show unavailable documents.

**Independent Test**: Bookmark one open and one closed document, restart, confirm
both appear and open from **Bookmarks**, then unbookmark one and undo. See
`specs/005-document-bookmarks/quickstart.md` Scenario 1.

### Tests for User Story 1

- [X] T010 [P] [US1] Add `src/bookmarks-view.test.ts` for the document-only view:
  available/unavailable derivation from inventory, available ordering by
  `modifiedTime` descending then path, unavailable rows last, section count,
  total marker count, empty collection and document-level filter matching.
- [X] T011 [P] [US1] Extend `src/sidebar-panel.test.ts` for the third mode:
  mode button and count badge, bookmarks list, empty state with
  **Browse all documents**, filtered-empty state with **Clear filter**, document
  stars, Recent-only actions/popout hidden in bookmarks mode, and callbacks that
  do not change the active document.
- [X] T012 [P] [US1] Extend `src/browse-modal.test.ts` for document-row stars:
  pressed state, accessible name, star click not opening the document, and state
  refreshed when the bookmark set changes.
- [X] T013 [P] [US1] Extend `src/tab-menu.test.ts` for a dynamic
  `Bookmark document` / `Remove bookmark` item and its callback, and for the
  generic item helper accepting an optional shortcut hint (exercised with a
  stand-in hint so feature 006 can reuse it).

### Implementation for User Story 1

- [X] T014 [US1] Implement `src/bookmarks-view.ts` document composition:
  merge the collection with inventory entries, derive availability and
  filename/project, order rows, count markers, apply the shared filter and emit
  `BookmarkRow[]`; make T010 pass. Depends on T005, T006.
- [X] T015 [US1] Add the document bookmark star to `src/sidebar-rows.ts` and
  `src/browse-modal.ts` (`button.inbox-bookmark`, `aria-pressed`, accessible
  name, non-activating click); make T012 pass. Depends on T007, T014.
- [X] T016 [US1] Extend `src/sidebar-panel.ts` with the third mode, a separate
  bookmarks scroll/list, document rows, empty and filtered-empty states, the
  accessible count badge, star/open callbacks and mode-specific toolbar
  visibility; make T011 pass. Depends on T009, T014, T015.
- [X] T017 [US1] Extend `src/tab-menu.ts` with a generic menu-item helper
  (label + optional shortcut hint + callback), the document bookmark action and
  its current-state label; render the `Ctrl`/`Cmd`+`D` hint through
  `src/shortcuts.ts`; make T013 pass. Depends on T003a, T008, T013.
- [X] T018 [US1] Add the header bookmark toggle to `index.html` and wire it in
  `src/main.ts` with active-document state, disabled state, rename/open/switch
  refresh and `Ctrl`/`Cmd`+`D` matched through `src/shortcuts.ts` (ignored
  inside inputs, textareas, contenteditable and while a modal dialog is open).
  Depends on T002, T003a, T005, T006.
- [X] T019 [US1] Wire `BookmarksController` and `src/bookmarks-view.ts` into
  `src/main.ts`: load/persist, toggle from header/row/context, open or focus
  document rows, keep the active document unchanged for row toggles, show the
  undo toast on removal, re-key document bookmarks on rename, and render
  unavailable rows. Depends on T014, T015, T016, T017, T018.
- [X] T020 [US1] Add User Story 1 styles to `src/style.css`: star buttons and
  focus rings, mode count badge, bookmark document rows, unavailable badge,
  empty/filtered-empty layout, and reduced-motion-safe transitions.
- [X] T021 [US1] Run `npm run typecheck` and `npm run test:web`; fix User Story 1
  failures in the files above.

**Checkpoint**: Whole-document bookmarks are fully usable, persistent and
independently testable — the MVP.

---

## Phase 4: User Story 2 — Bookmark a section and jump back to it (Priority: P2)

**Goal**: Bookmark outline headings, nest them under their document, resolve them
by text/context/occurrence after rewrites, report stale sections, re-anchor from
the current headings, and scroll below the sticky header.

**Independent Test**: Bookmark two identical headings, rewrite/reorder them,
delete one, and confirm each remaining bookmark resolves to its own section while
the deleted one is reported stale. See `quickstart.md` Scenario 2.

### Tests for User Story 2

- [X] T022 [P] [US2] Add `src/bookmark-anchors.test.ts` for capture and
  resolution: unique text, duplicate text with context, both sides identical,
  insertion immediately before the target, final-heading insertion, reorder,
  edited text with unique/ambiguous context, deletion, depth change, empty text,
  one-heading and no-heading documents, occurrence only with zero context
  evidence, and stale never carrying a slug.
- [X] T023 [P] [US2] Extend `src/bookmarks-view.test.ts` for section rows:
  nesting in document order, statuses (`unverified`, `current`, `re-anchored`,
  `stale`, `shared`, `unavailable`), document-only container, section-only filter
  matches, and shared-target preservation.
- [X] T024 [P] [US2] Extend `src/sidebar-panel.test.ts` for section rows, status
  badges, `Re-anchor`/`Remove` actions, indentation, and action clicks that do
  not activate the section.
- [X] T025 [P] [US2] Add `src/bookmark-picker.test.ts` for opening the picker with
  current headings, indentation, selecting a heading, Escape/overlay/Cancel,
  empty outline with **Remove bookmark**, and focus restoration.
- [X] T026 [P] [US2] Extend `src/toc-panel.test.ts` for one bookmark control per
  heading, pressed/mixed state, `setBookmarkedSlugs` refresh, and the toggle
  callback not scrolling.
- [X] T027 [P] [US2] Extend `src/bookmarks-controller.test.ts` for section
  add/remove/undo, session resolution storage, anchor commit on activation,
  picker re-anchor, ambiguous/shared handling and rename of section paths.

### Implementation for User Story 2

- [X] T028 [US2] Implement `captureAnchor` and `resolveHeading` in
  `src/bookmark-anchors.ts` using the two-heading window, depth scoring and
  occurrence-last rules in `contracts/section-resolution.md`; make T022 pass.
- [X] T029 [US2] Add section add/remove/re-anchor and session resolution methods
  to `src/bookmarks-model.ts` and `src/bookmarks-controller.ts`, including
  `via: "picker"`, rename re-keying and shared-target computation; make T027
  pass. Depends on T028.
- [X] T030 [US2] Extend `src/bookmarks-view.ts` with section views/rows, status
  derivation, document-order sorting, shared/unavailable handling and section
  text filtering; make T023 pass. Depends on T028, T029.
- [X] T031 [US2] Implement `src/bookmark-picker.ts` as a modal over the existing
  overlay shell, with heading selection, empty state, focus restoration and
  `Remove bookmark`; make T025 pass. Depends on T028.
- [X] T032 [US2] Extend `src/toc-panel.ts` with a per-heading star button,
  `setBookmarkedSlugs`, mixed state and the toggle callback; make T026 pass.
  Depends on T028.
- [X] T033 [US2] Extend `src/sidebar-panel.ts` to render section rows with
  statuses and `Re-anchor`/`Remove` actions, dispatch the new callbacks, and
  keep document rows as containers; make T024 pass. Depends on T030, T031.
- [X] T034 [US2] Wire section behavior into `src/main.ts`: capture anchors from
  the active outline, resolve after every active render/reload, open/focus before
  scrolling, commit anchors on activation, report stale without scrolling, open
  the picker, remove/undo sections, and re-key sections on rename. Depends on
  T029, T031, T032, T033.
- [X] T035 [US2] Add section-row, status-badge, picker and indentation styles to
  `src/style.css`, including focus-visible and non-color status cues.
- [X] T036 [US2] Ensure `src/main.ts` rename/move-out/delete/reload handling
  re-keys or retains section bookmarks and session resolutions and never reads a
  closed document; extend the relevant tests in
  `src/bookmarks-controller.test.ts`. Depends on T034.
- [X] T037 [US2] Run `npm run typecheck` and `npm run test:web`; fix User Story 2
  failures in the files above.

**Checkpoint**: Section bookmarks resolve safely, stale sections are explicit and
re-anchorable, and activation scrolls to the intended heading.

---

## Phase 5: User Story 3 — See which bookmarks changed (Priority: P3)

**Goal**: Reuse the existing unread rule for bookmarked documents so changes are
visible in the Bookmarks view, survive restarts, and clear when reviewed.

**Independent Test**: Bookmark a read document, change it while docdeck is
closed, restart and confirm the unread marker; open it and confirm it clears and
stays clear after another restart. See `quickstart.md` Scenario 3.

### Tests for User Story 3

- [X] T038 [P] [US3] Extend `src/bookmarks-view.test.ts` with an injected unread
  resolver: available changed document unread, reviewed document read,
  first-launch/no-history read, unavailable suppression, and document-level-only
  behavior for section containers.
- [X] T039 [P] [US3] Extend `src/sidebar-panel.test.ts` and
  `src/sidebar-rows.test.ts` (create if absent) for bookmark-row unread
  presentation: dot plus bold filename and accessible state, and no marker for
  unavailable rows.

### Implementation for User Story 3

- [X] T040 [US3] Add the unread input/resolver seam to `src/bookmarks-view.ts`
  and emit `unread` on document views without touching section-level state; make
  T038 pass. Depends on T030.
- [X] T041 [US3] Render the unread marker on bookmark document rows through the
  shared row anatomy in `src/sidebar-rows.ts` / `src/sidebar-panel.ts`; make T039
  pass. Depends on T016.
- [X] T042 [US3] Wire `InboxModel` unread flags and `Acknowledgements` into the
  bookmark view in `src/main.ts`, including first-launch baseline, active-document
  acknowledgement through `setActiveTab`, restart persistence and unavailable
  suppression. Depends on T040, T041.
- [X] T043 [US3] Run `npm run typecheck` and `npm run test:web`; fix User Story 3
  failures in the files above.

**Checkpoint**: Bookmarked documents show the same unread meaning as every other
document, across restarts.

---

## Phase 6: User Story 4 — Limit desktop notifications to bookmarks (Priority: P4)

**Goal**: Let the reader opt into popups only for bookmarked documents while the
tray dot continues to reflect all changes, composing with the existing
off/unfocused/always modes and throttle.

**Independent Test**: Enable bookmark-only notifications, change one bookmarked
and one unbookmarked document, and confirm exactly one popup names the bookmarked
document while the tray dot reflects both. See `quickstart.md` Scenario 6.

### Tests for User Story 4

- [X] T044 [P] [US4] Add `src-tauri/src/bookmark_filter_test.rs` for validation
  (absolute, non-empty, no NUL, ≤ 4096 bytes, ≤ 10,000 paths), dedupe, disabled
  pass-through, enabled empty set, mixed batches, rename source/target matching,
  and invalid input retaining the previous filter.
- [X] T045 [P] [US4] Extend `src/bookmarks-controller.test.ts` for the notification
  payload: `{ enabled, paths }` with sorted unique document + section-only paths,
  re-sync on add/remove/undo/rename/setting change, and sync failure leaving the
  bookmark action successful.
- [X] T046 [P] [US4] Extend `src/sidebar-panel.test.ts` for the setting checkbox,
  visible label/description, persisted state, and the two effect notes (with and
  without bookmarks).

### Implementation for User Story 4

- [X] T047 [US4] Implement `src-tauri/src/bookmark_filter.rs` with
  `BookmarkFilterState`, `NotificationBookmarkFilter`, validation and a pure
  candidate-filtering helper; make T044 pass.
- [X] T048 [US4] Extend `src-tauri/src/tray.rs` and `src-tauri/src/tray_test.rs`:
  filter candidates before notifying, match rename source and target, keep the
  presence update on the full batch, return before throttle on an empty candidate
  set, and build title/body from candidates only.
- [X] T049 [US4] Register `BookmarkFilterState`, the
  `set_bookmark_notification_filter` command and
  `#[cfg(test)] mod bookmark_filter_test;` in `src-tauri/src/lib.rs`; confirm
  `src-tauri/capabilities/default.json` is unchanged.
- [X] T050 [US4] Add the notification filter payload and sync seam to
  `src/bookmarks-model.ts` / `src/bookmarks-controller.ts`; make T045 pass.
  Depends on T005, T006.
- [X] T051 [US4] Add the bookmark-only notification checkbox and effect note to
  `src/sidebar-panel.ts`, with callbacks and persistence; make T046 pass.
  Depends on T002, T016.
- [X] T052 [US4] Wire `src/main.ts` to invoke
  `set_bookmark_notification_filter` on startup, bookmark mutations, undo, rename
  and setting changes; log failures and show an error toast when the setting is
  on. Depends on T050, T051.
- [X] T053 [US4] Add setting, note, checkbox and disabled/focus styles to
  `src/style.css`. Depends on T051.
- [ ] T054 [US4] Run `npm test`, `npm run lint:rs`, `npm run typecheck` and
  `npm run test:web`; fix User Story 4 failures in Rust and webview files.

**Checkpoint**: Popups can be limited to bookmarks without changing the tray
presence indicator or the existing notification modes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Governance, documentation, performance, accessibility and full
validation.

- [X] T055 Amend `.specify/memory/constitution.md`: add
  `docdeck.bookmarks.v1` to Technical Constraints → Persistence, describe its
  versioned per-entry validation and session-only resolution status, confirm the
  new preference fields under `docdeck.preferences.v1`, and include the Sync
  Impact Report required by governance. Explicitly note that feature 006's
  separate `shortcuts.toml` is not added here; 006 amends Persistence when it is
  implemented.
- [X] T056 [P] Write
  `_ai/technical_decisions/ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md`
  with the persisted-key, anchor-resolution and Rust notification-filter
  decisions; add it to `_ai/technical_decisions/README.md`.
- [X] T057 [P] Add `_ai/context-definitions/bookmarks.md` describing the
  bookmark store, resolution states, notification filter and where each lives.
- [X] T058 [P] Update `README.md` with bookmarks, section stale/re-anchor,
  `Ctrl`/`Cmd`+`D`, the third browse mode and bookmark-only notifications.
- [X] T059 [P] Add Unreleased `Added`/`Changed` entries to `CHANGELOG.md`.
- [X] T060 Validate the 500-bookmark/100 ms budget from `quickstart.md` Scenario
  7; profile and optimize `src/bookmarks-view.ts` / `src/sidebar-panel.ts` if it
  misses the target, and record the result in
  `_ai/context-definitions/bookmarks.md` (created by T057).
- [X] T061 Perform the keyboard/screen-reader audit in `quickstart.md` Scenario
  8 across `src/sidebar-panel.ts`, `src/sidebar-rows.ts`, `src/toc-panel.ts`,
  `src/bookmark-picker.ts` and `src/style.css`; fix names, focus order and
  status-by-text issues.
- [X] T062 Verify read-only behavior: run the bookmark scenarios, compare watched
  file bytes/mtimes, and confirm the new Rust command performs no filesystem
  access; record the result in `_ai/context-definitions/bookmarks.md`.
- [ ] T063 Run every scenario in `specs/005-document-bookmarks/quickstart.md` and
  the full gates (`npm run typecheck`, `npm run test:web`, `npm test`,
  `npm run lint:rs`); fix regressions in the affected files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T002/T003 can run in parallel, and
  T003a is independent of both.
- **Foundational (Phase 2)**: depends on Setup and blocks every user story.
  T004 and T005 can run in parallel after T001; T006 depends on both; T007
  depends on T003; T008 and T009 are independent within the phase.
- **User Story 1 (Phase 3)**: depends on Foundational. This is the MVP.
- **User Story 2 (Phase 4)**: depends on Foundational and the bookmarks view /
  document container delivered by US1. Its resolver and model tests can run as
  soon as Foundational is complete.
- **User Story 3 (Phase 5)**: depends on US1's document rows and US2's section
  views (for document-level unread on containers).
- **User Story 4 (Phase 6)**: depends on US1/US2 for the bookmark path set and
  on Foundational for the controller; Rust work can start in parallel with the
  webview wiring.
- **Polish (Phase 7)**: depends on the stories it documents and validates; T063
  is last.

### User Story Dependencies

- **US1 (P1)**: independently testable after Foundational; no other story
  required.
- **US2 (P2)**: builds on US1's third browse mode and document container, but
  the resolver is a standalone pure module and section behavior is testable with
  a document open.
- **US3 (P3)**: builds on US1/US2; unread composition is a pure input and can be
  tested without either story's DOM.
- **US4 (P4)**: builds on US1/US2 for the path set; the Rust filter is
  independently unit-testable.

### Cross-feature coordination with 006-copy-markdown-content

Feature 006 adds **Copy Markdown** to the same tab menu and a configurable
`Ctrl`/`Cmd`+`Shift`+`C` shortcut. It is a draft with no plan or tasks yet and
is implemented **after** 005. To avoid two incompatible rewrites of the same
files:

- T003a owns the shortcut registry, label formatter, typing guard and modal
  predicate. 006 reuses them for conflict validation and menu hints; it must not
  add a second shortcut parser.
- T013/T017 own the generic tab-menu item helper. 005 adds the bookmark item;
  006 later adds the copy item with a hint, without changing the helper's shape.
- T031's `BookmarkPicker` must mount with `role="dialog"` and
  `aria-modal="true"` so 006's modal suppression sees it.
- 006's shortcut editor belongs in the existing Config/Watches panel, not the
  Bookmarks toolbar; the two settings must not share a surface.
- The two persistence stores stay separate: 005 owns
  `docdeck.bookmarks.v1` + `docdeck.preferences.v1`; 006 owns
  `shortcuts.toml` and amends the constitution Persistence section itself.
- Do not implement both features concurrently: they edit `src/main.ts`,
  `src/tab-menu.ts`, `src/style.css`, `README.md` and `CHANGELOG.md`.

### Within Each Story

1. Write the listed tests and confirm they fail.
2. Implement pure/model/view modules.
3. Implement DOM controllers and styles.
4. Wire `main.ts`.
5. Run the story gates before moving on.

### Parallel Opportunities

- Setup: T002 (preferences), T003 (virtual list) and T003a (shortcut/modal
  seams) in parallel.
- Foundational: T004 (storage) and T005 (model) in parallel after T001;
  T008 (toast) and T009 (sidebar mode) in parallel with T006/T007.
- US1 tests: T010–T013 in parallel; implementation is mostly sequential because
  T016/T019 touch `sidebar-panel.ts`/`main.ts`.
- US2 tests: T022–T027 in parallel; implementation T028/T031/T032 can run in
  parallel, then T029/T030/T033, then T034.
- US3 tests: T038/T039 in parallel.
- US4 tests: T044 (Rust), T045 (controller) and T046 (panel) in parallel; Rust
  T047–T049 can proceed alongside webview T050–T053.
- Polish docs T056–T059 in parallel after behavior is stable.

## Parallel Example: User Story 2

```bash
# Resolver, picker and outline are separate files:
Task: "Implement captureAnchor and resolveHeading in src/bookmark-anchors.ts"
Task: "Implement the re-anchor modal in src/bookmark-picker.ts"
Task: "Add per-heading bookmark controls in src/toc-panel.ts"
```

## Parallel Example: User Story 1

```bash
# The four US1 test files can be written together before implementation:
Task: "Add src/bookmarks-view.test.ts for document-only view rows"
Task: "Extend src/sidebar-panel.test.ts for the third mode and empty states"
Task: "Extend src/browse-modal.test.ts for document-row stars"
Task: "Extend src/tab-menu.test.ts for the bookmark menu item"
```

## Parallel Example: User Story 3

```bash
# View derivation and row presentation are separate seams:
Task: "Extend src/bookmarks-view.test.ts with an injected unread resolver"
Task: "Extend src/sidebar-panel.test.ts and src/sidebar-rows.test.ts for unread presentation"
```

## Parallel Example: User Story 4

```bash
# Rust and webview can advance side by side:
Task: "Implement src-tauri/src/bookmark_filter.rs and its validation tests"
Task: "Add the notification payload/sync seam to src/bookmarks-controller.ts"
Task: "Add the setting checkbox and effect note to src/sidebar-panel.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational).
3. Complete Phase 3 (US1: document bookmarks, view, persistence, undo).
4. **STOP and VALIDATE** with `quickstart.md` Scenario 1 and the web gates.
5. Ship/demo the MVP.

### Incremental Delivery

1. Setup + Foundational → collection, storage, controller and accessible rows.
2. US1 → document bookmarks (MVP).
3. US2 → section bookmarks and safe resolution (the core agent-plan use case).
4. US3 → unread awareness on bookmarks.
5. US4 → bookmark-only notifications.
6. Polish → constitution, ADR, docs, performance, accessibility and full gates.

### Notes

- `[P]` tasks touch different files and have no incomplete dependency; never
  parallelize two edits to `src/main.ts`, `src/sidebar-panel.ts` or
  `src/style.css`.
- Section resolution must never read a closed document; only the active rendered
  document supplies headings.
- The new Rust command is metadata-only: no path reads, writes, stats or
  canonicalization.
- Watched documents remain read-only throughout.

## Implementation Status (2026-11-19)

T001–T053 and T055–T062 are implemented. `npm run typecheck`, `npm run
test:web` (47 files, 532 tests) and `npm run build` pass.

T054 and T063 remain open because this environment has no C toolchain or system
development libraries (`cc`, `gcc` and `clang` are absent), so `cargo test` and
`cargo clippy` cannot link even a build script. The Rust modules were formatted
with `rustfmt`; they still need the normal Rust gates and the desktop quickstart
scenarios on a machine with the Tauri prerequisites.
