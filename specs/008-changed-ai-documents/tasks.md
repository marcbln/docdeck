---

description: "Task list for the Changed `_ai` documents feature"
---

# Tasks: Changed `_ai` Documents

**Input**: Design documents from `/specs/008-changed-ai-documents/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: Included because the plan lists the required suites as the definition of
done and the constitution requires deterministic tests for new pure logic
(Principle II). No test task is optional for this feature.

**Organization**: Tasks are grouped by user story so each story can be
implemented, tested and demonstrated on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names the exact file it touches

## Path Conventions

- Frontend: `src/` (flat vanilla TypeScript modules + colocated `*.test.ts`)
- Backend: `src-tauri/src/` (flat Rust modules + `*_test.rs` suites registered in
  `src-tauri/src/lib.rs`)
- Docs: `README.md`, `CHANGELOG.md`, `docs/manual.md`
- Project knowledge: `_ai/context-definitions/`, `_ai/technical_decisions/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Register the new modules and the shared type/registry surfaces that
other phases extend.

- [x] T001 Register `mod changed_ai;` and the `#[cfg(test)] mod changed_ai_test;` block in `src-tauri/src/lib.rs`, keeping the existing alphabetical grouping
- [x] T002 [P] Add `export type BrowseView = BrowseMode | "changed";` beside `BrowseMode` in `src/sidebar-model.ts`, documenting that `"changed"` is transient and never persisted (FR-009)
- [x] T003 [P] Add `{ id: "refresh-changed", key: "r", modifier: "ctrlOrCmd", shift: true }` to `FIXED_SHORTCUTS` in `src/shortcuts.ts` and extend `src/shortcuts.test.ts` to prove matching, `formatShortcut` (`Ctrl+Shift+R` / `Cmd+Shift+R`) and no collision with the existing fixed set

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The read-only git report that every story consumes, plus the shared
TypeScript wire types for it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Define `ChangedDocument`, `ChangedRepository`, `ChangedAiReport` and `ChangedErrorCode` (`"git-missing" | "timeout" | "output-limit" | "unreadable" | "not-a-repository"`) in `src-tauri/src/changed_ai.rs` with `#[serde(rename_all = "camelCase")]`, matching `WatchLoad`/`WatchAdded`; `modifiedTime` is `Option<u64>` epoch milliseconds
- [x] T005 Implement the porcelain v1 `-z` parser and change-state derivation in `src-tauri/src/changed_ai.rs` (split on NUL, keep the path that exists, `X != ' ' && X != '?'` for `staged`, `Y != ' ' && Y != '?'` for `unstaged`, `??` sets only `untracked`), with tests in `src-tauri/src/changed_ai_test.rs` for `??`, `M `, `A `, ` M`, `MM`, `UU`/`AA` (both badges), and `D`/`AD`/`DD` being dropped
- [x] T006 Implement inclusion filtering in `src-tauri/src/changed_ai.rs`: Markdown extension, an exact `_ai` path component, file exists on disk, no hidden/editor-backup/noise component below the repository root, and configured excludes in watched mode only; cover root-level `_ai/**`, nested `pkg/sub/_ai/**`, ignored files, non-Markdown siblings and excluded paths in `src-tauri/src/changed_ai_test.rs`
- [x] T007 Implement repository-root discovery in `src-tauri/src/changed_ai.rs`: ancestor walk for `.git` as a directory **or** pointer file (worktrees/submodules), plus the fallback `walkdir` search for `_ai` directories under a root with no enclosing work tree, pruning hidden/noise/excluded subtrees with a 10,000-entry budget and `discoveryTruncated`; test in `src-tauri/src/changed_ai_test.rs`
- [x] T008 Implement the supervised `git` runner in `src-tauri/src/changed_ai.rs`: `std::process::Command` argument vector (never a shell), `--no-optional-locks -C <root> status --porcelain=v1 -z --untracked-files=all --no-renames -- ':(glob)**/_ai/**' '_ai/**'`, scrubbed `GIT_DIR`/`GIT_WORK_TREE`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, 1.5 s per-repository kill deadline, 8 MiB stdout cap, and one worker thread per repository feeding a channel with a 1.8 s aggregate deadline; test timeout, cap breach, spawn failure and one-repository isolation with a fake `GitClient` in `src-tauri/src/changed_ai_test.rs`
- [x] T009 Implement report assembly in `src-tauri/src/changed_ai.rs`: canonicalize and dedupe document paths (symlinks resolved, Windows case-insensitive comparison), `stat` each file for `modifiedTime` (`None` when stat fails), keep every failed repository as an entry with empty `documents`, one entry per distinct work tree, no entry for a broad root that contains no `_ai` folder, unresolved watched `_ai` folders reported with their own path; test dedupe, ordering by `root` then `path`, and unresolved-folder entries in `src-tauri/src/changed_ai_test.rs`
- [x] T010 Add the `list_changed_ai_documents` command in `src-tauri/src/changed_ai.rs` (validate `scope`: non-empty, ≤ 4096 bytes, no NUL, absolute; snapshot `WatcherState::all_roots()` + `excludes()`; run on `spawn_blocking`) and register it in the `tauri::generate_handler!` list in `src-tauri/src/lib.rs`; add validation and poisoned-lock tests to `src-tauri/src/changed_ai_test.rs`
- [x] T011 [P] Add the matching TypeScript interfaces (`ChangedAiReport`, `ChangedRepository`, `ChangedDocument`, `ChangedErrorCode`, `ChangedScope`) to `src/changed-ai-model.ts` with camelCase field names mirroring the Rust wire structs

**Checkpoint**: `cargo test` passes and the command returns a typed report. User
stories can now start.

---

## Phase 3: User Story 1 - See uncommitted `_ai` work across projects (Priority: P1) 🎯 MVP

**Goal**: A fourth browse entry, **Changed `_ai`**, lists every uncommitted `_ai`
Markdown document across watched repositories, newest first, each row showing
project, filename, `_ai`-relative context, change badges and relative time. It is
transient and never changes the saved browse mode.

**Independent Test**: Create two temporary repositories with watched `_ai`
folders; stage one document, edit another, add an untracked one, delete a fourth.
Open the view and confirm exactly the three live documents appear once each,
labelled by project, newest first, and that `browseMode` in preferences is
unchanged.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST; they must fail before the implementation below.**

- [x] T012 [P] [US1] Create `src/changed-ai-model.test.ts` covering one row per canonical path, newest-`modifiedTime`-first ordering, `path.localeCompare` tiebreak, `modifiedTime === null` sorting last, `_ai`-relative `context`, `projectName` with repository-basename fallback, and the baseline `loading`/`ready`/`empty`/`no-repository` selection
- [x] T013 [P] [US1] Create `src/changed-ai-controller.test.ts` covering first activation with scope `{ kind: "all" }`, a single in-flight request, the generation guard dropping a superseded report, and that activation performs no document action
- [x] T014 [P] [US1] Create `src/changed-ai-rows.test.ts` with `happy-dom` covering row anatomy (project chip, filename, context, real-text badges "Staged"/"Unstaged"/"New", `<time datetime>` with exact-time title), the accessible name composed from visible text, and the absence of dismiss/star/unread controls
- [x] T015 [P] [US1] Extend `src/sidebar-panel.test.ts` for the fourth mode button (label "Changed `_ai` documents", `aria-pressed` exclusive with the other three), changed-row painting, the section count after filtering, and Clear/Undo/Summarize/Popout plus the bookmark-settings block being hidden in this mode
- [x] T016 [P] [US1] Extend `src/filter-documents.test.ts` to prove `filterEntries` narrows changed rows by filename, full path and `_ai` project without reordering, and that a term matching nothing leaves the input order intact
- [x] T017 [P] [US1] Extend `src/preferences.test.ts` to prove a stored `browseMode: "changed"` is rejected by `isBrowseMode` and falls back to the saved default, and that selecting the transient view writes nothing

### Implementation for User Story 1

- [x] T018 [US1] Implement `deriveChangedRows` and baseline state selection in `src/changed-ai-model.ts`: flat `ChangedRow[]` with `path`, `filename`, `project` (never null after fallback), `context` (path relative to the deepest `_ai` component, never empty), badge booleans, `modifiedTime`, `repositoryRoot`; order by `modifiedTime` descending with `path.localeCompare` as tiebreaker and null times last (FR-003, FR-005, FR-012 ordering rule from research D12)
- [x] T019 [US1] Implement the session controller in `src/changed-ai-controller.ts`: injected `ChangedAiLoader` and clock, state `{ scope, status, report, loadedAt, generation, refreshOnSettle }`, `activate(scope?)` and `refresh()` issuing exactly one request at a time, and results from earlier generations dropped
- [x] T020 [US1] Implement `createChangedRow`/`bindChangedRow` in `src/changed-ai-rows.ts` as one native `<button class="changed-row-main">` per row with project chip, filename, context, text badges and `<time>`; no close button, star, unread dot, middle-click dismissal or context menu
- [x] T021 [US1] Extend `src/sidebar-panel.ts`: add the **Changed `_ai`** mode button to the mode row, accept `browseMode: BrowseView` and the changed view state in `SidebarViewState`, render a dedicated `VirtualList<ChangedRow>` with its own scroll host (~56 px rows), and hide Clear/Undo/Summarize/Popout and the bookmark settings block while the mode is shown
- [x] T022 [US1] Extend `src/style.css` with `.changed-row*`, `.project-chip` usage in this row, `.change-badge--staged|--unstaged|--untracked` using the existing Catppuccin custom properties, and the changed list scroll host; no hard-coded colours and reduced-motion rules inherited
- [x] T023 [US1] Wire `src/main.ts`: construct the controller with an `invoke<ChangedAiReport>("list_changed_ai_documents", { scope })` loader and `Date.now`, treat selecting Changed `_ai` as transient (no `preferences.browseMode` write, no `setBrowseMode` call), pass filtered rows to the panel via `filterEntries`, and keep All/Recently changed/Bookmarks selection writing preferences exactly as today

**Checkpoint**: The view lists and labels changed documents and leaves the saved
mode untouched. This is the MVP.

---

## Phase 4: User Story 2 - Open a changed document without opening all of them (Priority: P1)

**Goal**: Activating one row opens that document as a normal tab, reusing an
existing tab; opening the view never creates tabs and there is no bulk action.

**Independent Test**: With thirty changed documents, open the view and confirm
zero tabs; activate one row and confirm one correct tab; activate a row whose
document is already open and confirm still one tab.

### Tests for User Story 2 ⚠️

- [x] T024 [P] [US2] Extend `src/changed-ai-rows.test.ts` to prove click, `Enter` and `Space` each call the activation callback exactly once, that a middle click does nothing, and that no dismiss/star/unread control exists on the row
- [x] T025 [P] [US2] Extend `src/sidebar-panel.test.ts` to prove painting the changed view creates no tab, activating a row leaves the mode selected and the row in the list, and a scoped row for a document outside the watch set still reports its path for opening
- [x] T026 [P] [US2] Extend `src/changed-ai-controller.test.ts` to prove row activation is not a view-state transition: the snapshot, status and `loadedAt` are unchanged after an activation

### Implementation for User Story 2

- [x] T027 [US2] Wire row activation in `src/main.ts` through the existing document pipeline: `tabs.has(path)` → `setActiveTab(path)`, otherwise `openDocument(path)`; never open a batch, never refresh, and never remove the row (FR-007, FR-008, FR-025)
- [x] T028 [US2] Add `onOpen`/`onActivate` pass-through in the changed list wiring in `src/sidebar-panel.ts` so a row activation reaches `main.ts` without changing browse mode, dismissing the row or touching bookmark/acknowledgement state
- [x] T029 [US2] Confirm and cover the vanishing-document path in `src/main.ts`: a failed `openDocument` shows the existing error naming the path, keeps the row in the snapshot, and leaves the rest of the app usable (FR-018, US2 scenario 3)

**Checkpoint**: Thirty changed documents produce one tab only after the reader
chooses one.

---

## Phase 5: User Story 3 - Ask from the agent workflow (Priority: P1)

**Goal**: `docdeck --changed [path]` reaches the running window through the
single-instance channel (or starts it in the background), scopes the view to the
repository containing `path`, and returns promptly.

**Independent Test**: From a temporary repository outside the watch set, run
`docdeck --changed`; the running window focuses the view on that repository. Run
again with another repository's path and confirm rescoping. With docdeck stopped
and no terminal attached, confirm the command returns while the window opens.

### Tests for User Story 3 ⚠️

- [x] T030 [P] [US3] Extend `src-tauri/src/paths_test.rs` with `parse_cli` cases: bare `--changed` uses cwd; `--changed <path>` consumes the next non-`-` argument and never classifies it as an entry; `--changed=<path>`; relative scope joined to cwd; last `--changed` wins; `--changed --quit` leaves no scope; unresolvable scope forwarded verbatim with a warning; a scope argument is never also emitted as an `entries` item
- [x] T031 [P] [US3] Extend `src/changed-ai-controller.test.ts` to prove rescoping replaces the previous scope atomically, a failed scope resolution remembers `requestedPath` for the error state, and `showAllRepositories()` returns to `{ kind: "all" }`
- [x] T032 [P] [US3] Extend `src/changed-ai-rows.test.ts` to cover the scope banner: project/repository name, root path, and a single **Show all watched repositories** button with an accessible name

### Implementation for User Story 3

- [x] T033 [US3] Add `CliRequest { entries, changed, warnings }` and `parse_cli(args, cwd)` to `src-tauri/src/paths.rs` (rules 1–7 of `contracts/cli-changed-flag.md`), route `startup_paths` through it, and keep existing positional canonicalization, warnings and `--quit` precedence unchanged
- [x] T034 [US3] Extend `should_detach` in `src-tauri/src/detach.rs` to take "a changed view was requested" and detach release builds with `--changed` even when no terminal is attached, keeping debug builds and `DOCDECK_FOREGROUND=1` attached; update the inline tests in `src-tauri/src/detach.rs`
- [x] T035 [US3] Add the `startup_changed_scope` command in `src-tauri/src/lib.rs` returning `Option<String>` from `parse_cli`, and register it in `tauri::generate_handler!`; existing `startup_paths` payload stays unchanged
- [x] T036 [US3] Extend the single-instance callback in `src-tauri/src/lib.rs`: parse argv with `parse_cli`, emit `changed-ai-cli` with `{ path }` when the flag is present, still emit `open-path-cli` for remaining entries, then show/unminimize/focus the window even when only the changed flag arrived (FR-012, research D5)
- [x] T037 [US3] Implement the scope banner builder (`createScopeBanner`) in `src/changed-ai-rows.ts` with the **Show all watched repositories** button as its only control
- [x] T038 [US3] Implement scope replacement in `src/changed-ai-controller.ts`: `activate({ kind: "repository", requestedPath })`, `showAllRepositories()`, and rescope-then-refresh with no document opened
- [x] T039 [US3] Wire `src/main.ts`: call `startup_changed_scope()` once after the initial CLI documents open, listen for `changed-ai-cli`, activate the changed view with the reported path without writing preferences, and route **Show all watched repositories** to `showAllRepositories()`
- [x] T040 [US3] Render the scope banner in `src/sidebar-panel.ts` (visible whenever the scope is narrowed, even when empty, per FR-013) and keep it out of the mode row and filter row

**Checkpoint**: The agent-facing entry point scopes one running window and never
starts a second instance.

---

## Phase 6: User Story 4 - Refresh and recover without losing the reading position (Priority: P2)

**Goal**: Refreshing shows current git state without disturbing tabs, scroll or
unread/bookmark state; loading, empty, no-repository, partial-error, scope-error
and git-missing are each explicit and AT-readable; one failing repository never
hides another.

**Independent Test**: Open a long document, scroll halfway, open Changed `_ai`,
return after reading and refresh; the tab, active document and scroll position
are unchanged. Break one repository and confirm the others still list rows with a
named error. Delete a changed file and confirm its row disappears after refresh.

### Tests for User Story 4 ⚠️

- [x] T041 [P] [US4] Extend `src/changed-ai-model.test.ts` with the full state matrix: ready, partial (rows + repository errors), errors-only, empty with repositories, `no-repository` for `aiFolders === 0` and for `repositories.length === 0` with `aiFolders > 0`, scope-error (`scopeError !== null` implies no scope and no repositories), git-missing (`gitAvailable === false`), and `discoveryTruncated`
- [x] T042 [P] [US4] Extend `src/changed-ai-controller.test.ts` to prove refresh keeps the previous snapshot while in flight, a later generation supersedes an earlier one, `notifyWatchesSettled()` refreshes exactly once and only when `refreshOnSettle` was set, and no timer/polling path exists
- [x] T043 [P] [US4] Extend `src/changed-ai-rows.test.ts` and `src/sidebar-panel.test.ts` for the state panel (`role="status"`, `aria-live="polite"`, `aria-busy="true"` while loading), the **Refresh** control, per-repository error banners naming repository and reason, empty vs no-repository copy, and a filtered-to-nothing list rendering the shared "No documents match" copy instead of a git message
- [x] T044 [P] [US4] Extend `src/shortcuts.test.ts`/`src/shortcut-reference.test.ts` to prove `Ctrl`/`Cmd`+`Shift`+`R` is registered, formatted and listed in the shortcut reference under the Changed `_ai` group

### Implementation for User Story 4

- [x] T045 [US4] Implement the complete `selectChangedState` matrix in `src/changed-ai-model.ts` following the state table in `contracts/changed-view.md`, ordering the checks so scope-error and git-missing win before row counting
- [x] T046 [US4] Implement `refresh()`, `notifyWatchesSettled()`, staleness and `loadedAt` handling in `src/changed-ai-controller.ts`; a refresh keeps the old rows painted with `status: "refreshing"` and never mutates tabs, active document, scroll, unread, acknowledgement or bookmark state (FR-015)
- [x] T047 [US4] Implement `createStatePanel` and `createRepositoryErrorBanner` in `src/changed-ai-rows.ts` with the exact copy from research D11 and one line per failing repository, each naming the repository or path
- [x] T048 [US4] Add the **Changed `_ai`** toolbar **Refresh** button and state-panel host to `src/sidebar-panel.ts`, set `aria-busy` on the list host while loading, and keep the header count following the visible rows
- [x] T049 [US4] Wire `src/main.ts`: handle `refresh-changed` in the global key handler with `preventDefault`, treat re-activating the mode entry as a refresh, call `notifyWatchesSettled()` when `scansInFlight` reaches zero, and add no timer, interval or watcher-event refresh
- [x] T050 [US4] Add the Changed `_ai` group (Refresh chord plus `Enter`/`Space` row activation) to `src/shortcut-reference.ts`

**Checkpoint**: Refresh is safe, every failure is named, and one broken repository
cannot hide the others.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, decision record, project knowledge and end-to-end
validation.

- [x] T051 Extend `README.md` with the **Changed `_ai`** mode, `docdeck --changed [path]`, the refresh shortcut and the read-only guarantee
- [x] T052 Add `CHANGELOG.md` Unreleased entries for the view, the CLI flag and the refresh shortcut
- [x] T053 Extend `docs/manual.md` with the agent workflow, view semantics, scope banner, states and keyboard access
- [x] T054 [P] Create `_ai/context-definitions/changed-ai.md` describing the command, report shape, transient scope, state matrix and read-only boundary, linking the ADR
- [x] T055 [P] Write `_ai/technical_decisions/ADR__261122-1__git-status-changed-ai-view.md` (Context / Decision / Consequences / Alternatives) recording the three lasting choices: supervised `git` subprocess in Rust, transient never-persisted view, and hand-off through the existing single-instance channel; add its row to `_ai/technical_decisions/README.md`
- [x] T056 [P] Sweep existing `src/*.test.ts` fixtures that construct `SidebarViewState` or use `BrowseMode` and add the changed-view fields so no suite breaks on the widened state shape
- [x] T057 Run the `specs/008-changed-ai-documents/quickstart.md` scenarios 1–13 against the fixture, including the read-only audit (status and `.git/index` hash unchanged) and the 500-document scale check
- [x] T058 Run the required gates from the repository root: `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on T001; T011 needs T004's field names. Blocks every user story.
- **US1 (Phase 3)**: Depends on Foundational. Produces the model, controller, rows and sidebar surface every later story extends.
- **US2 (Phase 4)**: Depends on US1 (rows and panel must exist to activate).
- **US3 (Phase 5)**: Rust tasks T030–T036 depend only on Foundational; the TS tasks T037–T040 depend on US1's controller/rows/panel. Independent of US2.
- **US4 (Phase 6)**: Depends on US1 (controller/model/rows/panel) and benefits from US3's scope banner; independent of US2.
- **Polish (Phase 7)**: Depends on all desired stories. T057/T058 come last.

### Within Each User Story

- Tests are written first and must fail before the implementation task.
- Pure model → controller → rows → panel → `main.ts` wiring → styles.
- Rust: types → parser → filtering → discovery → supervisor → assembly → command.

### Parallel Opportunities

- T002, T003 are independent of each other and of Rust work.
- T011 is independent of Rust work once T004 fixes the wire field names; T005–T010 are serial because they share `src-tauri/src/changed_ai.rs`.
- Within each story, the `[P]` test tasks touch distinct files and can be written together.
- After US1 lands, US3 (Rust half) and US2 can run in parallel with US4's model work.

---

## Parallel Example: User Story 1 tests

```bash
# Write all US1 tests together (distinct files, no shared state):
Task: "Create src/changed-ai-model.test.ts for ordering, dedupe and context"
Task: "Create src/changed-ai-controller.test.ts for activation and generations"
Task: "Create src/changed-ai-rows.test.ts for row anatomy and a11y"
Task: "Extend src/sidebar-panel.test.ts for the fourth mode and toolbar hiding"
Task: "Extend src/filter-documents.test.ts over changed rows"
Task: "Extend src/preferences.test.ts for the rejected transient mode"
```

```bash
# Foundational Rust + shared TS types, once T001 and T004 exist:
Task: "Implement porcelain parsing in src-tauri/src/changed_ai.rs"
Task: "Add report interfaces to src/changed-ai-model.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (`cargo test` proves the report).
2. Phase 3 US1 → the view lists changed documents with badges and ordering.
3. **STOP and VALIDATE** quickstart Scenarios 1, 2 and 10 (completeness, filter,
   read-only audit).
4. Demo the merged multi-repository list.

### Incremental Delivery

1. US1 — list and label (MVP).
2. US2 — open one row, never bulk-open.
3. US3 — `docdeck --changed` and repository scoping.
4. US4 — refresh, recovery and every explicit state.
5. Polish — docs, ADR, context note, quickstart, gates.

Each step keeps the previous ones working: US2 only adds activation, US3 only
adds scope, US4 only adds transitions and copy.

### Parallel Team Strategy

- Developer A: Rust (T004–T010, then T030–T036).
- Developer B: model + controller tests/implementation (T012/T013/T018/T019).
- Developer C: rows, styles and sidebar/`main.ts` wiring (T014/T020–T023), then
  US2/US4 UI tasks.
- Rust CLI work can proceed beside the frontend once the report command exists.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task.
- Every task names its file; no task is "implement the feature".
- Constraints quoted from the design docs and enforced in tasks: 4096-byte /
  no-NUL scope validation, 1.5 s per repository, 1.8 s aggregate, 8 MiB output
  cap, 10,000-entry discovery budget, 256-root watch cap, `modifiedTime === null`
  sorts last, no document-count limit.
- Nothing is persisted by this feature: no preference key, no `localStorage`
  write, no instance-record change (`browseMode: "changed"` stays invalid).
