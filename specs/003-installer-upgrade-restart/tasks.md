# Tasks: Installer Upgrade Restart

**Input**: Design documents from `/specs/003-installer-upgrade-restart/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included because the project constitution (Principle II) and plan.md require deterministic unit tests and an executable Bash suite. Write failing tests before the implementation task they cover.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)
- Include exact file paths in descriptions

## Path Conventions

- Rust service layer: `src-tauri/src/`
- Shell installer: `scripts/`, `scripts/lib/`
- Tests: `src-tauri/src/*_test.rs`, `scripts/install_test.sh`
- Design artifacts: `specs/003-installer-upgrade-restart/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the new modules and test harness without adding behavior.

- [X] T001 [P] Create `src-tauri/src/instance.rs` and `src-tauri/src/instance_test.rs` with module docs, and register `mod instance;` plus `#[cfg(test)] mod instance_test;` in `src-tauri/src/lib.rs`
- [X] T002 [P] Create `scripts/lib/restart.sh` as a sourceable Bash file (no top-level execution) and `scripts/install_test.sh` as the Bash test harness; make `scripts/install_test.sh` executable and add `"test:install": "./scripts/install_test.sh"` to `package.json`
- [X] T003 [P] Document the new module and script purpose in `src-tauri/src/instance.rs` and `scripts/lib/restart.sh` headers so `cargo doc`/`shellcheck` have stable entry points

**Checkpoint**: New files exist, compile as empty modules, and `npm run test:install` invokes an empty harness.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The runtime instance record, the `--quit` control channel, and the shared installer primitives. No user story can proceed without these.

**⚠️ CRITICAL**: Complete this phase before starting any user story.

- [X] T004 [P] Write failing Rust unit tests in `src-tauri/src/instance_test.rs` for: `$XDG_RUNTIME_DIR/docdeck/instance.json` precedence; `$HOME/.local/state/docdeck/instance.json` fallback; Windows `%LOCALAPPDATA%\docdeck\instance.json` fallback; `InstanceRecord` JSON round-trip; rejection of missing, wrongly typed, unknown-version, and >64 KiB records; atomic write with directory mode `0700` and file mode `0600`; cleanup only when the stored `pid` equals the current pid
- [X] T005 Implement `InstanceRecord` (`version`, `pid`, `exe`, `argv`, `cwd`, `startedAt`), the record path resolver, the 64 KiB bounded reader, the atomic writer (temp file + rename), and the matching-pid remover in `src-tauri/src/instance.rs` to make T004 pass
- [X] T006 Write the record in the Tauri `setup` hook after the window exists and remove it in `RunEvent::Exit` only when the stored pid equals the current pid in `src-tauri/src/lib.rs` (depends on T005)
- [X] T007 Classify `--quit` before `detach_from_terminal` and before the Tauri builder, exit without a window when no live instance exists, forward it through the existing `tauri_plugin_single_instance` callback to call `app.exit(0)`, and add the `setup` guard for the missing-socket race in `src-tauri/src/lib.rs` (depends on T005)
- [X] T008 [P] Add a regression test to `src-tauri/src/paths_test.rs` asserting `--quit` (including `docdeck --quit file.md`) is never returned by `paths::classify_args` as a document or folder
- [X] T009 [P] Write failing Bash tests in `scripts/install_test.sh` for the shared primitives: record path resolution matching Rust; Node-based NUL-delimited JSON parsing; rejection of unknown version, oversized, malformed, and wrongly typed records; pid liveness; current-user ownership; canonical executable matching with Linux `/proc/<pid>/exe` ` (deleted)` stripping and macOS `ps -p <pid> -o comm=`; installed/development/other classification; atomic lock ownership and stale-lock recovery. Stub `kill`, `pgrep`, and `ps` through a temporary `PATH` so no real process is signalled
- [X] T010 Implement the primitives exercised by T009 in `scripts/lib/restart.sh`: record path resolution, Node JSON reader that never `source`s or `eval`s the record, bounded/typed validation, liveness/owner/executable identity checks, canonicalization, instance classification, and `mkdir`-based restart lock helpers (depends on T009)

**Checkpoint**: The app publishes and cleans a valid record, `--quit` is safe and never a path, and the installer can parse/validate/classify/lock without touching a process.

---

## Phase 3: User Story 1 - Upgrade a running app without a manual relaunch (Priority: P1) 🎯 MVP

**Goal**: After a successful build and install, detect an installed instance, ask for consent (default yes), stop it gracefully, confirm it exited, and relaunch the installed entry point with the original arguments and working directory.

**Independent Test**: Start an installed instance with an explicit document and folder, run `./scripts/install.sh`, accept the restart prompt, and confirm exactly one process is running the installed build with the same launch targets.

### Implementation for User Story 1

- [X] T011 [US1] Implement `restart_after_install` in `scripts/lib/restart.sh`: record-first detection with a single-pid `pgrep -u "$(id -u)" -x docdeck` fallback, installed classification against canonical `BIN_DST`, `Restart the running docdeck instance (pid N) now? [Y/n]` prompt with empty answer meaning yes, lock acquisition, `BIN_DST --quit`, up-to-5-second exit wait with Linux zombie detection, relaunch of `BIN_DST` from the recorded `cwd` with recorded `argv[1..]` via `setsid` or `nohup` with stdio redirected, and a best-effort 5-second wait for a new record with a different pid
- [X] T012 [US1] Call the restart flow from `scripts/install.sh` only after the build, binary install/symlink, and desktop registration all succeed; resolve `BIN_DST` to an absolute path before the flow and pass the install mode (depends on T011)
- [X] T013 [US1] Write Bash tests in `scripts/install_test.sh` for the US1 happy path: installed classification, default-yes prompt, graceful `--quit` request, exit confirmation, `argv[1..]` and `cwd` preservation, symlink and copy launch targets, and `Restarted docdeck (pid N)` output; stub process signalling and GUI launch (depends on T011, T012)

**Checkpoint**: US1 works end-to-end on its own: a successful install upgrades a running installed instance without a manual relaunch.

---

## Phase 4: User Story 2 - Decline, or install non-interactively (Priority: P2)

**Goal**: Never stop the app without consent, support explicit restart choices, and always print truthful manual-restart guidance when the new build is not active.

**Independent Test**: With a running instance, decline the prompt and separately run with stdin not a TTY; in both cases the pid is unchanged and the message names the manual restart as the remaining step.

### Implementation for User Story 2

- [X] T014 [US2] Add `--restart`, `--no-restart`, and `-n`/`--no-interaction` parsing to `scripts/install.sh`, update the usage header and `-h`/`--help` output, and make `--restart` plus `--no-restart` a usage error with exit 2
- [X] T015 [US2] Implement decision resolution in `scripts/lib/restart.sh` in priority order: `--no-restart` → decline; `--restart` → restart; interactive stdin TTY without `--no-interaction` → ask with default yes for installed instances; otherwise decline with `No interactive terminal attached. Quit and relaunch docdeck to use the new build.` and never signal the process (depends on T011)
- [X] T016 [US2] Write Bash tests in `scripts/install_test.sh` for the full decision table: no flags + TTY, no flags + no TTY, `-n`, `--restart` with and without a TTY, `--no-restart`, and the flag conflict exit 2; assert the exact decline and non-interactive messages from `contracts/cli.md` (depends on T014, T015)

**Checkpoint**: US2 works independently: declines and non-interactive installs leave the instance untouched and print the manual-restart instruction.

---

## Phase 5: User Story 3 - Refuse to restart the wrong or an unresponsive process (Priority: P3)

**Goal**: Fail safely when the detected process is not the installed build, is stale, belongs to another user, or refuses to exit.

**Independent Test**: Simulate a development instance, a stale record with no live process, and a process that ignores `--quit` and `SIGTERM`; verify the installer's message and that no relaunch happens in the last case.

### Implementation for User Story 3

- [X] T017 [US3] Enforce stale, foreign, and mismatched record rejection in `scripts/lib/restart.sh`: on any validation failure remove the record, signal nothing, and report `No running docdeck instance. The new build will be used on the next launch.`; when `pgrep` returns more than one pid, skip the restart without guessing (depends on T011)
- [X] T018 [US3] Implement development/other/unknown classification confirmation in `scripts/lib/restart.sh`: name both executables with `The running docdeck is <exe>, not the installed <BIN_DST>. Replace it with the installed build? [y/N]`, default no, require an interactive TTY even when `--restart` was given, and skip with the documented warning when no TTY is attached (depends on T017)
- [X] T019 [US3] Implement bounded stop escalation and safe abort in `scripts/lib/restart.sh`: after the 5-second `--quit` wait send exactly one `SIGTERM`, wait up to 5 seconds, then print `The running docdeck instance (pid N) did not exit after a graceful request and SIGTERM. Left it running and started nothing.`, start no new instance, and exit 1; never use `SIGKILL` (depends on T011)
- [X] T020 [US3] Implement unrecoverable launch-context handling in `scripts/lib/restart.sh`: prompt `The original launch arguments could not be recovered. Start docdeck without them? [y/N]` interactively, start bare without a TTY only when `--restart` was explicit (and say so), and treat a missing recorded `cwd` as unrecoverable (depends on T011)
- [X] T021 [US3] Write Bash tests in `scripts/install_test.sh` for stale/dead/mismatched/foreign-pid rejection with no `kill` call, multi-pid `pgrep` skip, development confirmation default no, non-TTY dev-instance skip, unresponsive abort after one escalation, unrecoverable `argv`/`cwd`, and concurrent-install lock ownership (depends on T017–T020)

**Checkpoint**: US3 works independently: every unsafe case produces a clear message and never leaves two instances or signals an unrelated process.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Governance, documentation, and end-to-end validation across all stories.

- [X] T022 Amend the Persistence bullet in `.specify/memory/constitution.md` to permit the ephemeral runtime instance record (path, `0700` directory / `0600` file, 64 KiB metadata-only content, clean-exit removal) and bump the version MINOR to 1.2.0 with a Sync Impact Report (G8 prerequisite)
- [X] T023 [P] Update `README.md` with the upgrade restart flow, `--restart`/`--no-restart`/`-n` flags, `docdeck --quit`, the runtime record path/privacy, the development-instance warning, and non-interactive behavior
- [X] T024 [P] Update `CHANGELOG.md` under `Unreleased` with the restart flow and `--quit` under Added, and the stale-build trap under Fixed
- [X] T025 [P] Create `_ai/context-definitions/upgrade-restart.md` describing detection, validation, stop, and relaunch for future agents, linking ADR 261103-1
- [X] T026 Run `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`, and `npm run test:install` from the repository root, fixing any regression in `src-tauri/src/` or `scripts/`
- [ ] T027 Execute every scenario in `specs/003-installer-upgrade-restart/quickstart.md` (sections 1–5) on Linux, and on macOS where available; confirm SC-001/SC-005 by timing the restart and checking that watched documents, `config.toml`, and preferences are byte-identical before and after

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001–T003 can run in parallel.
- **Foundational (Phase 2)**: Depends on Setup. T004/T008/T009 can be written in parallel; T005 depends on T004; T006/T007 depend on T005; T010 depends on T009.
- **User Stories (Phase 3+)**: All depend on Foundational. US1 is the MVP; US2 and US3 extend the same `restart_after_install` core and should follow US1 in priority order.
- **Polish (Phase 6)**: Depends on all implemented stories. T022 (constitution) is required before acceptance, not before coding.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no dependency on US2/US3.
- **US2 (P2)**: Depends on the US1 restart core (`T011`) but is independently testable through declines/non-interactive runs.
- **US3 (P3)**: Depends on US1 (`T011`) and the US2 decision surface (`T015`); adds the rejection, confirmation, escalation, and unlock paths.

### Within Each User Story

- Write the Bash tests first and confirm they fail before the implementation task.
- Shared primitives (record, identity validation, lock) land in Foundational before story behavior.
- `scripts/lib/restart.sh` is edited by T011, T015, T017–T020, so those tasks are sequential.
- `scripts/install.sh` is edited by T012 and T014; run them in that order.
- `scripts/install_test.sh` is edited by T009, T013, T016, T021; run them in that order.

### Parallel Opportunities

- Setup: T001 (Rust scaffold) and T002 (shell scaffold) are independent.
- Foundational: T004 (Rust tests), T008 (path regression), and T009 (Bash tests) touch different files and can start together.
- US1: T011 and T012 are sequential; T013 can be drafted alongside T011 but must run after T012.
- Polish: T023, T024, and T025 touch different documentation files and can run in parallel after the implementation is stable.

---

## Parallel Example: Foundational Test Authoring

```bash
# These test files are independent and can be written at the same time:
Task: "Write failing Rust record tests in src-tauri/src/instance_test.rs"
Task: "Add --quit classification regression in src-tauri/src/paths_test.rs"
Task: "Write failing Bash primitive tests in scripts/install_test.sh"
```

## Parallel Example: Polish Documentation

```bash
Task: "Update README.md with the upgrade restart flow"
Task: "Update CHANGELOG.md under Unreleased"
Task: "Create _ai/context-definitions/upgrade-restart.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) and run `cargo test` plus `npm run test:install`.
3. Complete Phase 3 (US1).
4. **STOP and VALIDATE**: Use the quickstart's section 1 to prove an installed running instance upgrades with its original targets.
5. Demo the MVP before adding decline/non-interactive handling.

### Incremental Delivery

1. Foundation ready → the record, `--quit`, and installer primitives are proven.
2. Add US1 → restart a running installed instance → validate independently.
3. Add US2 → declines, explicit flags, and non-interactive installs behave truthfully → validate independently.
4. Add US3 → stale/foreign/dev/unresponsive cases fail safely → validate independently.
5. Polish: constitution amendment, docs, full automated suite, and quickstart.

### Parallel Team Strategy

1. One developer owns the Rust record/`--quit` foundation (T004–T008); another owns the Bash primitive harness (T009–T010).
2. After the foundation, one developer drives US1 (T011–T013); US2 and US3 follow sequentially because they extend the same `restart.sh` functions.
3. Documentation and governance (T022–T025) can proceed in parallel once the behavior and messages are stable.

---

## Notes

- `[P]` marks tasks that touch different files and have no incomplete dependency.
- Every user story ends at a checkpoint that can be validated with `quickstart.md`.
- The record is metadata only: never write document content, preferences, watch configuration, tokens, or environment variables.
- Never `source` or `eval` `instance.json`; always pass launch arguments as an array.
- The installer must never signal a process before build and install both succeed.
- Run the full quality gate (`npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`, `npm run test:install`) before marking the feature complete.
