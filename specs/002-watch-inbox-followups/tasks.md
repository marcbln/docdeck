---
description: "Task list for Watch Configuration and Inbox Follow-ups"
---

# Tasks: Watch Configuration and Inbox Follow-ups

**Input**: Design documents from `/specs/002-watch-inbox-followups/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included. The feature specification does not use the word "TDD", but
`plan.md` (Testing) and constitution principle II require deterministic unit
tests for every new pure module and Rust change. Test tasks below are therefore
part of the deliverable, not optional extras.

**Organization**: Tasks are grouped by user story so each story can be
implemented, tested, and demonstrated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Every task names the exact file path it changes.

## Path Conventions

- Webview: `src/` (TypeScript, Vitest)
- Backend: `src-tauri/src/` (Rust, `cargo test`)
- Shell entry point: `index.html`
- Specification artifacts: `specs/002-watch-inbox-followups/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the two justified backend dependencies and establish a green baseline.

- [X] T001 Add `notify-debouncer-full` and `toml_edit` as runtime dependencies and remove `notify-debouncer-mini` in `src-tauri/Cargo.toml`, then run `cargo build` to refresh `Cargo.lock`
- [X] T002 Establish the green baseline by running `npm run typecheck`, `npm run test:web`, `npm test`, and `npm run lint:rs` and recording any pre-existing failures in `specs/002-watch-inbox-followups/tasks.md` (Notes) before changing code under `src/` or `src-tauri/src/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives every story depends on: platform paths, selector normalization, revisions, payload types, and the webview `origin` field.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Implement the pure platform path resolver in `src-tauri/src/config.rs`: a `Platform` enum (`Linux`, `MacOs`, `Windows`, `Other`), `resolve_config_path(platform, env)` honoring `$DOCDECK_CONFIG` first, then XDG (`$XDG_CONFIG_HOME/docdeck/config.toml` or `$HOME/.config/docdeck/config.toml`), macOS (`$HOME/Library/Application Support/docdeck/config.toml`), and Windows (`%APPDATA%\docdeck\config.toml`, else `%USERPROFILE%\AppData\Roaming\docdeck\config.toml`); keep `config_path()` as the production wrapper; add tests in `src-tauri/src/config_test.rs`
- [X] T004 [P] Add `normalize_selector(selector, platform)` in `src-tauri/src/paths.rs` that converts `\` to `/` only on Windows, is applied before tilde expansion and glob compilation, and leaves backslashes literal on Unix; add tests in `src-tauri/src/paths_test.rs`
- [X] T005 [P] Add a dependency-free FNV-1a 64-bit `revision_of(bytes) -> String` helper (lowercase hex) in `src-tauri/src/config.rs` and tests that prove stability, byte-sensitivity, and empty-input handling in `src-tauri/src/config_test.rs`
- [X] T006 [P] Define the shared typed backend contracts in `src-tauri/src/commands.rs`: `Origin` (`"config" | "session"`), extended `InboxEntry { path, filename, modified_time, origin }`, extended `WatchLoad { config_path, config_found, roots, entries, warnings, error, truncated, revision, generation, at }`, `WatchConfigView { path, found, revision, watch, exclude, error }`, `ReloadResult` (per `contracts/tauri-commands.md`), `SaveOutcome` (`applied | conflict | invalid | ioError`), and `CommandError { code: "invalid" | "conflict" | "io" | "notWritable" | "internal"; message; details? }`; use `#[serde(rename_all = "camelCase")]` and add serialization assertions in new `src-tauri/src/commands_test.rs` registered in `src-tauri/src/lib.rs`
- [X] T007 [P] Extend the webview types in `src/inbox-model.ts`: add `origin: "config" | "session" | "manual"` to `InboxEntry`/`InboxSeed` (default `manual` when omitted), add `lastReload: { at, ok, error, warnings, truncated } | null` to `InboxStatus`, and update `src/inbox-model.test.ts` so seeded entries keep origin and existing behavior is unchanged
- [X] T008 Wire `WatchConfig` loading through platform resolution and selector normalization in `src-tauri/src/config.rs` so `load()` and `expand_with_limits_and_progress()` use the resolved platform and normalized watch/exclude patterns (depends on T003, T004)

**Checkpoint**: Platform paths, selector normalization, revisions, shared payloads, and webview origins are ready.

---

## Phase 3: User Story 1 - Apply watch configuration changes without restarting (Priority: P1) 🎯 MVP

**Goal**: A valid config change (in-app or external) adds/removes watches and re-applies excludes within 2 seconds, without restarting, closing tabs, changing the active document, or marking existing documents unread.

**Independent Test**: Launch with a config matching a few documents, add a selector for a new folder, save, and confirm its documents appear in the browse list without restarting; then introduce a syntax error and confirm previous watches keep working while the error is visible.

### Tests for User Story 1

- [X] T009 [P] [US1] Write failing Rust tests in new `src-tauri/src/config_watch_test.rs` for parent-directory watching, 300 ms debounce coalescing, monotonic generations, skipped expansion when the revision is unchanged, invalid/unreadable configs preserving the previous watch plan, and session roots surviving a reload
- [X] T014 [P] [US1] Write failing Vitest tests in `src/inbox-model.test.ts` for origin-aware reconciliation: keep `manual` rows, rescan `session` rows, replace `config` rows, preserve `changedAt`/`unread` for surviving paths, add new config paths as unread, remove departed config rows, and never duplicate a path

### Implementation for User Story 1

- [X] T010 [US1] Implement `src-tauri/src/config_watch.rs`: a `ConfigWatchState` that watches the config file's **parent directory** (not the file) with a 300 ms debounce, re-reads/expands on relevant events, runs the shared `reconcile_config`, assigns a monotonic `generation`, emits `config-reloaded` with the `ReloadResult` payload, skips expansion when `revision` equals the last applied revision, and emits `error`/`found=false` without replacing watches; register the module and `config_watch_test` in `src-tauri/src/lib.rs` (depends on T006, T009)
- [X] T011 [US1] Add config/session ownership tracking to `src-tauri/src/watcher.rs` (separate sets for config-owned roots/files and session-owned roots), a `replace_config_watches` operation that registers added roots/files and unwatches removed ones without touching session roots, and session rescans under the new excludes; extend `src-tauri/src/watcher_test.rs` (depends on T010)
- [X] T012 [US1] Refactor `load_watches` in `src-tauri/src/commands.rs` to run through the shared `reconcile_config` path, tag every entry with `origin`, return `revision`, `generation`, and `at`, and keep the existing blocking-worker plus `scan-progress` behavior (depends on T006, T010)
- [X] T013 [US1] Start the config watcher during app setup in `src-tauri/src/lib.rs` after `WatcherState::init`, and keep the existing invoke handler registrations compiling (depends on T010)
- [X] T015 [US1] Implement the origin-aware `reconcile` method in `src/inbox-model.ts`: replace `config` entries from the reload result, rescan `session` entries, keep `manual` entries, preserve `unread`/`changedAt`/filename for surviving paths, add new config paths as unread, and remove departed config/session rows (tab state is untouched) (depends on T007, T014)
- [X] T016 [US1] Add the `config-reloaded` listener and newest-generation guard in `src/main.ts`: ignore stale generations, update `watchRoots` and `inboxStatus` from `roots`/`warnings`/`error`/`truncated`, call `inbox.reconcile`, keep every tab open and the active path unchanged, and surface the reload outcome (depends on T015)
- [X] T017 [P] [US1] Render the reload outcome in `src/sidebar-panel.ts`: show `lastReload` status near the config status, keep the existing actionable config error and setup hint (including the config path), and add sidebar tests in `src/sidebar-panel.test.ts` (depends on T007)

**Checkpoint**: Live reload works end-to-end; US1 is demonstrable without US2–US6.

---

## Phase 4: User Story 2 - Keep unread awareness across restarts (Priority: P2)

**Goal**: After restart, documents modified since their last review are unread, reviewed/unchanged documents are read, and first launch marks nothing unread.

**Independent Test**: Review a document, add an acknowledgement, close the application, change one watched document and leave another unchanged, restart, and confirm only the changed document is unread.

### Tests for User Story 2

- [X] T018 [P] [US2] Write failing Vitest tests in new `src/acknowledgements.test.ts` for the `docdeck.acknowledgements.v1` payload `{ version: 1, entries: { "<path>": { mtime, at } } }`: first-launch baseline, `document.modifiedTime > entry.mtime` ⇒ unread, no entry with an existing store ⇒ unread, active-document refresh, pruning, wrong version/corrupt JSON/dropped bad entry recovery, and debounced writes plus `pagehide` flush
- [X] T019 [P] [US2] Write failing Vitest tests in `src/inbox-model.test.ts` for applying acknowledgement-derived unread flags to inventory entries without changing `changedAt` or list order

### Implementation for User Story 2

- [X] T020 [US2] Implement `src/acknowledgements.ts`: pure decode/validate per entry, `isUnread(entry, record)`, `acknowledge(path, mtime)`, `move(oldPath, newPath)`, `prune(watchedPaths)`, `seedBaseline(entries)`, and a debounced writer with a `flush()` used on `pagehide`/`beforeunload`; never persist `changedAt`, `clearedAt`, or `Recently Changed` (depends on T018)
- [X] T021 [US2] Add an acknowledgement-aware unread application helper to `src/inbox-model.ts` (seed/apply flags per path without touching `changedAt`) and make the tests from T019 pass (depends on T007, T019)
- [X] T022 [US2] Wire acknowledgements in `src/main.ts`: create the baseline only after the first **successful** inventory load, derive startup unread flags before the first paint, acknowledge on row activation/opening and on a watcher write while the document is active, prune on every successful reload, and flush on `pagehide`/`beforeunload` (depends on T016, T020)
- [X] T023 [US2] Add a regression test in `src/sidebar-model.test.ts` proving `Recently Changed` (`changedAt`, `clearedAt`, `ClearSnapshot`) remains session-scoped while persisted unread markers still appear in All Documents (depends on T022)

**Checkpoint**: Restart-safety works; no false unread on first launch or corrupt history.

---

## Phase 5: User Story 3 - Filter the document lists (Priority: P3)

**Goal**: A session-only text filter narrows the selected browse list by name, location, or project, case-insensitively, preserving order and all document state.

**Independent Test**: With a large inventory, type part of a filename and confirm only matching rows remain in their original order, then clear the filter and confirm the full list returns.

### Tests for User Story 3

- [X] T024 [P] [US3] Write failing Vitest tests in new `src/filter-documents.test.ts` for case-insensitive literal substring matching on `filename`, full `path`, and `projectName(path)`; preserved input order; punctuation treated literally; empty/whitespace term returning all entries; no-match returning `[]`; and non-mutation of entries

### Implementation for User Story 3

- [X] T025 [US3] Implement `src/filter-documents.ts` exporting `filterEntries(entries, term)` that trims and lower-cases the term once, matches a literal substring against filename/path/project, preserves order, and never mutates entries (depends on T024)
- [X] T026 [US3] Add the browse filter to `src/sidebar-panel.ts`: a labelled search input in the browse toolbar, a clear control, `Escape` to clear, filtered counts, the empty state `No documents match “<term>”` with a clear action, and a render path that reuses the existing input element so focus and caret survive watcher repaints; extend `SidebarViewState` and `src/sidebar-panel.test.ts` (depends on T025)
- [X] T027 [US3] Add session-only `filterTerm` state in `src/main.ts` (never in `Preferences`): derive filtered `inventory`/`recent` via `filterEntries`, pass the term to `SidebarPanel`, keep it across All Documents ↔ Recently Changed switches and watcher events, and hand the filtered inventory to the pop-out (depends on T026)
- [X] T028 [P] [US3] Update `src/browse-modal.ts` to accept the already-filtered inventory, show the same filtered empty state/count, and keep virtualization and scroll math intact; extend `src/browse-modal.test.ts` (depends on T025)
- [X] T029 [P] [US3] Add filter input, clear-control, and filtered empty-state styles in `src/style.css` using existing Catppuccin custom properties

**Checkpoint**: Filtering meets SC-003 and never changes unread/open/active/deleted state.

---

## Phase 6: User Story 4 - Follow renamed and moved documents (Priority: P4)

**Goal**: A rename or move inside watched locations updates one row in place within 2 seconds, carrying open/read/active state; a move-out removes the row and marks an open tab unavailable; a move-in appears unread.

**Independent Test**: Rename an open, read document within a watched folder and confirm a single row reflects the new name, the document remains open and active, and no unread or deleted state appears.

**Dependency note**: US4 preserves read state across a rename, so its acknowledgement transfer task (T040) depends on US2. It can be developed after US2 in priority order.

### Tests for User Story 4

- [X] T030 [P] [US4] Write failing Rust tests in new `src-tauri/src/rename_test.rs` for identity pairing within 2 seconds, `From` + `To` ⇒ one `renamed` transition, `From` without `To` after 2 s ⇒ `movedOut`, `To`/create without `From` ⇒ `created`, rapid renames settling on the final name, case-only renames matching by identity, and the unavailable-identity delete-plus-create fallback
- [X] T031 [P] [US4] Write failing Vitest tests in `src/inbox-model.test.ts` for rename (one entry moves, keeps `unread`/`changedAt`, no duplicate or deleted row), move-out (row removed), and move-in/create (new unread row)

### Implementation for User Story 4

- [X] T032 [US4] Implement the pure pairing module `src-tauri/src/rename.rs`: `FileIdentity`, a `pendingFrom` queue with a 2-second hold, oldest-matching-identity selection, and `RenameOutcome::{Renamed, MovedOut, Created}`; register `rename` and `rename_test` in `src-tauri/src/lib.rs` (depends on T030)
- [X] T033 [P] [US4] Add a file-identity helper to `src-tauri/src/paths.rs` using `std::os::unix::fs::MetadataExt` (`dev`, `ino`) on Unix/macOS and `std::os::windows::fs::MetadataExt` (`volume_serial_number`, `file_index`) on Windows, returning `None` when unavailable; add cfg-gated tests in `src-tauri/src/paths_test.rs`
- [X] T034 [US4] Replace `notify-debouncer-mini` with `notify-debouncer-full` in `src-tauri/src/watcher.rs`, preserve `notify::EventKind` (`Modify(Name(From|To|Both))`, `Remove`, `Create`, `Modify(Data)`), add the backend-only identity cache seeded by scans and opened files, run every settled event through `rename`, and emit `PathChange { kind, path, from_path?, exists, modified_time? }` with kinds `created | modified | deleted | renamed | movedOut`; extend `src-tauri/src/watcher_test.rs` (depends on T001, T032, T033)
- [X] T035 [US4] Verify/extend the tray notification body in `src-tauri/src/tray.rs` and `src-tauri/src/tray_test.rs` so it keeps using `path` and ignores `kind`/`fromPath` (depends on T034)
- [X] T036 [US4] Seed the identity cache from every inventory scan (`load_watches`, `add_watch`) and from `load_file` in `src-tauri/src/commands.rs`, without reading document content (metadata only) (depends on T033, T034)
- [X] T037 [US4] Add `rename(oldPath, newPath)`, `removeForMoveOut(path)`, and `addCreated(seed)` operations to `src/inbox-model.ts` that move one entry (carrying `unread`, `changedAt`, origin), remove it on move-out, and add a new unread row on create/move-in; make the tests from T031 pass (depends on T007, T031)
- [X] T038 [US4] Handle the extended `PathChange` kinds in `src/main.ts`: on `renamed` re-key the tab, `activePath`, reload tokens, closed-tab history, inbox entry, and acknowledgement; on `movedOut` remove the inventory row and mark any open tab unavailable; on `created` add an unread row without opening a tab; on `deleted` keep the existing struck-through behavior (depends on T034, T037)
- [X] T039 [US4] Verify the sidebar/browse rendering in `src/sidebar-panel.ts` and `src/browse-modal.ts` shows the renamed row once and the unavailable banner for move-outs, and add/adjust assertions in `src/sidebar-panel.test.ts` and `src/browse-modal.test.ts` (depends on T038)
- [X] T040 [P] [US4] Extend `src/acknowledgements.ts` with rename transfer and move-out pruning and cover both in `src/acknowledgements.test.ts` (depends on T020)

**Checkpoint**: Exactly one row remains after a rename; moves-in/out match the spec.

---

## Phase 7: User Story 5 - Edit the watch configuration inside the application (Priority: P5)

**Goal**: A header-reachable surface shows the effective config path, validity, and last reload; adds/removes selectors; preserves comments/formatting/unknown keys; detects outside edits; and applies saves without restart.

**Independent Test**: Open the configuration surface with no configuration file, create one from the offered example, add a selector, save, and confirm documents appear without a restart; then submit invalid input and confirm the error is shown and nothing is applied.

### Tests for User Story 5

- [X] T041 [P] [US5] Write failing Vitest tests in new `src/config-editor-model.test.ts` for draft/`dirty`, add/remove selector rows, duplicate folding, per-field validation errors, stale-revision `conflict`, `createFromExample`, `invalidFile` disabling structural save, `saving`, and preserving the draft on failed saves
- [X] T043 [P] [US5] Write failing Rust tests in new `src-tauri/src/config_edit_test.rs` for surgical `watch`/`exclude` edits preserving comments, formatting, `[tray]`, and unknown keys; duplicate folding/reporting; invalid selector rejection; revision mismatch producing `conflict` with no write; atomic temp-file replace; and the Windows remove-then-rename branch

### Implementation for User Story 5

- [X] T042 [US5] Implement the pure `src/config-editor-model.ts` holding path, loaded revision, draft `watch`/`exclude`, `dirty`, `createFromExample`, `invalidFile`, `errors`, `conflict`, `lastReload`, and `saving`, with explicit add/remove/validate/save-result transitions and no DOM access (depends on T041)
- [X] T044 [US5] Implement `src-tauri/src/config_edit.rs` using `toml_edit::DocumentMut`: start from the existing document (or a small valid template when creating from example), mutate only the `watch`/`exclude` arrays in place so retained items keep decor, leave every other key/comment/formatting untouched, re-parse through `WatchConfig`, fold exact duplicates, reject invalid selectors/TOML, compare `revision` before writing, and write atomically (temp file in the same directory, sync, rename; Windows remove-then-rename inside a short critical section); register the module and test in `src-tauri/src/lib.rs` (depends on T001, T005, T043)
- [X] T045 [US5] Add `read_watch_config`, `save_watch_config`, and `reload_watch_config` commands in `src-tauri/src/commands.rs` using `WatchConfigView`, `SaveOutcome`, and `CommandError`; `save_watch_config` must validate, detect revision conflicts, write nothing on failure, and trigger the shared `reconcile_config`; `reload_watch_config` must skip expansion when the revision matches; register all three in `src-tauri/src/lib.rs` and extend `src-tauri/src/commands_test.rs` (depends on T010, T044)
- [X] T046 [US5] Implement `src/config-panel.ts`: a modal showing path/found/validity/last-reload, editable watch and exclude rows with add (Enter) and labelled remove controls, **Create from example**, **Save**, **Reload**, **Cancel**, a conflict banner with **Reload from disk** and **Overwrite**, inline field errors that preserve input, unsaved-changes confirmation on close/`Esc`, keyboard reachability, and focus return to the opener; add happy-dom tests in new `src/config-panel.test.ts` (depends on T042)
- [X] T047 [US5] Add the header **Watches** control in `index.html` and wire it in `src/main.ts` so it opens even when the browse section is hidden, loads `read_watch_config`, passes status/`lastReload`, applies an `applied` reload through the same newest-generation path as US1, and refreshes status on `conflict`/`invalid`/`ioError` (depends on T045, T046)
- [X] T048 [P] [US5] Add config modal, row editor, conflict-banner, and inline-error styles in `src/style.css` using existing custom properties
- [X] T049 [US5] Wire **Open config file** through the existing `open_local_path` command and disable structural save when `read_watch_config` returns a parse `error`, in `src/config-panel.ts` and `src/main.ts`; add coverage in `src/config-panel.test.ts` (depends on T045, T046)

**Checkpoint**: A reader can go from no config to working watches in under 60 seconds without hand-editing.

---

## Phase 8: User Story 6 - Use the same experience on macOS and Windows (Priority: P6)

**Goal**: The same watching, unread, filtering, rename, and configuration behavior on Linux, macOS, and Windows, with native config locations and equivalent path/selector semantics.

**Independent Test**: Repeat the primary acceptance flows for live reload, cross-session unread, filtering, rename tracking, and in-app configuration on each supported platform, using that platform's standard configuration location.

- [X] T050 [P] [US6] Extend `src-tauri/src/config_test.rs` with macOS and Windows config-path cases (env maps, `%APPDATA%` and `%USERPROFILE%` fallbacks) and Windows backslash selector/exclude normalization cases that prove matching equals the forward-slash form
- [X] T051 [US6] Gate Unix-only test code in `src-tauri/src/config_test.rs` and `src-tauri/src/folder_test.rs` with `#[cfg(unix)]` (or a Windows symlink helper), and cfg-gate the WebKitGTK environment variable in `src-tauri/src/render.rs` to Linux with matching assertions in `src-tauri/src/render_test.rs` (depends on T050)
- [X] T052 [P] [US6] Audit and adjust `src-tauri/tauri.conf.json` (identifier, bundle targets `all`, icons) and `src-tauri/capabilities/default.json` (no new permissions) for macOS/Windows, and record the result in `specs/002-watch-inbox-followups/plan.md` or the PR description
- [X] T053 [P] [US6] Make the frontend path helpers separator-aware in `src/project.ts` (`fileName`, `parentPath`, `isUnder`, `isUnderAny`, `projectName`, `compactPath` handle `\`, `/`, and mixed input without treating a backslash as a separator on Unix) and add Windows-shaped cases in `src/project.test.ts`

**Checkpoint**: No behavior in this specification is documented as Linux-only.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Governance, documentation, validation, and regression safety across all stories.

- [X] T054 [P] Amend `.specify/memory/constitution.md`: Platform from "Linux desktop only" to Linux/macOS/Windows, Persistence to list `docdeck.acknowledgements.v1` and its versioning rules while keeping document content/session state unpersisted, and the live-reload exception; include a Sync Impact Report and version bump
- [X] T055 [P] Write an ADR in `_ai/technical_decisions/` covering file-identity rename pairing and cross-session acknowledgement persistence (both hard to reverse), and link it from the affected context docs
- [X] T056 [P] Update `README.md`: platform requirements, config path per platform, live reload, unread persistence, filter, rename behavior, and the in-app config surface
- [X] T057 [P] Update `CHANGELOG.md` with the user-visible additions from all six stories
- [X] T058 [P] Update `_ai/` context documents for config reload/reconciliation and the acknowledgement schema; do **not** hand-edit the generated `_ai/conventions.md`
- [X] T059 [P] Extend `scripts/simulate_folder_watch.sh` with a reload and rename smoke run for manual verification
- [X] T060 Run the full gate `npm run typecheck && npm run test:web && npm test && npm run lint:rs` and fix every failure in the affected files under `src/`, `src-tauri/src/`, and `index.html`
- [ ] T061 Execute the manual flows in `specs/002-watch-inbox-followups/quickstart.md` (live reload, cross-session unread, filtering, rename/move, config surface) on Linux and record the outcome
- [X] T062 Validate SC-003/SC-001/SC-004 performance: add a deterministic boundary test in `src/filter-documents.test.ts` over 10,000 entries and confirm reload/rename work stays off the main thread (no blocked switching or scrolling)
- [X] T063 Run the regression audit from `specs/002-watch-inbox-followups/quickstart.md` (open/close/close-all, copy path, Auto-Sort, `Ctrl+Shift+T`, Clear/Undo, deleted rows/banners, tray, virtual list, theme/TOC/frontmatter/find/Mermaid) and fix any regression

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–8)**: All depend on Foundational. Priority order is US1 → US2 → US3 → US4 → US5 → US6.
- **Polish (Phase 9)**: Depends on all desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: Needs Foundational only. No story dependency. **MVP.**
- **US2 (P2)**: Needs Foundational and benefits from US1's successful-reload hook for pruning; no code dependency on US3–US6.
- **US3 (P3)**: Needs Foundational; works on the existing lists and is independent of US1/US2 (merge `main.ts` wiring after them).
- **US4 (P4)**: Needs Foundational; **depends on US2** for transferring acknowledgement state across a rename (T040). Backend rename tracking (T030–T036) is independent of US2.
- **US5 (P5)**: Needs Foundational and US1 (the save path reuses `reconcile_config` and the generation guard).
- **US6 (P6)**: Needs Foundational (platform resolver); T053 is independent and can start early.

### Within Each User Story

- Tests first, then implementation; verify the tests fail before writing the code.
- Rust: pure helper → watcher/command wiring → `lib.rs` registration.
- Webview: pure model → panel/DOM → `main.ts` orchestration.
- Each story completes and is validated before moving to the next priority.

### Parallel Opportunities

- Setup: T001 and T002 are sequential in practice (baseline before dependency churn), but T002 is read-only.
- Foundational: T003, T004, T005, T006, T007 can all run in parallel (different files); T008 waits for T003/T004.
- US1: T009 and T014 run in parallel (Rust tests vs Vitest tests); T017 is parallel with T016 once T015 lands (different files).
- US2: T018 and T019 run in parallel; T020 follows T018; T021 follows T019.
- US3: T024 runs alone first; T028 and T029 are parallel once T025 is in place.
- US4: T030 and T031 are parallel; T033 is parallel with T032 (different files); T040 is parallel with T038/T039 after T020.
- US5: T041 and T043 are parallel; T048 is parallel with T046/T047.
- US6: T050, T052, and T053 are parallel; T051 follows T050 (same file).
- Polish: T054–T059 are all parallel; T060–T063 follow.

---

## Parallel Example: User Story 1

```bash
# Rust reload tests and webview reconcile tests in parallel:
Task: "Write failing Rust config_watch tests in src-tauri/src/config_watch_test.rs"
Task: "Write failing Vitest reconcile tests in src/inbox-model.test.ts"

# After the reconcile model lands, panel and orchestrator fan out:
Task: "Render reload outcome in src/sidebar-panel.ts"
Task: "Add config-reloaded listener and generation guard in src/main.ts"
```

## Parallel Example: User Story 4

```bash
# Pairing tests, inbox tests, and identity helper in parallel:
Task: "Write failing pairing tests in src-tauri/src/rename_test.rs"
Task: "Write failing rename/moveOut tests in src/inbox-model.test.ts"
Task: "Add file-identity helper in src-tauri/src/paths.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks every story).
3. Complete Phase 3: User Story 1 — live config reload.
4. **STOP and VALIDATE**: follow quickstart §1 (live reload) independently.
5. Demo/deploy if ready.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → live reload → MVP.
3. US2 → restart-safe unread.
4. US3 → filtering.
5. US4 → rename/move tracking.
6. US5 → in-app configuration surface.
7. US6 → macOS/Windows parity.
8. Polish → constitution, docs, full gates, regression audit.

Each step leaves earlier behavior intact and is independently testable.

### Parallel Team Strategy

1. One developer completes Setup + Foundational.
2. Then:
   - Developer A: US1, then US5 (save path depends on reload).
   - Developer B: US2, then US4 (rename depends on acknowledgement transfer).
   - Developer C: US3 and US6 path-helper work (independent).
3. Integrate in `src/main.ts`, the shared orchestrator; merge US1/US2/US4 branches
   in priority order to limit conflicts.

---

## Notes

- T061 (interactive quickstart flows) could not be executed in this headless
  agent environment: there is no desktop session to click through. The
  automated equivalents (live reload, acknowledgement rules, filter, rename,
  config editing) are covered by `cargo test` and Vitest; the manual checklist
  remains the release acceptance step.
- Pre-existing baseline (T002, before any change): `npm run typecheck` clean,
  `npm run test:web` 24 files / 216 tests passing, `cargo test` 82 passing,
  `cargo clippy -D warnings` clean. No pre-existing failures.
- [P] tasks touch different files and have no incomplete-task dependency.
- [Story] labels map every story-phase task to its specification story.
- Tests must fail before implementation; commitment is per story checkpoint.
- Do not change `.specify/memory/constitution.md` until T054; the two conditional
  gates (G7 platform, G8 persistence) are governance prerequisites, not design
  violations.
- Do not hand-edit `_ai/conventions.md` (generated by `ruleman`).
- Commit after each task or logical group using Conventional Commit style.
- Avoid: writing watched documents, adding frontend dependencies, polling, or
  rendering the full inventory without the virtual list.
