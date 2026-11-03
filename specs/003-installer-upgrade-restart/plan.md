# Implementation Plan: Installer Upgrade Restart

**Branch**: `003-installer-upgrade-restart` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-installer-upgrade-restart/spec.md`

**Decision record**: [`_ai/technical_decisions/ADR__261103-1__upgrade-restart-via-instance-state-and-quit-channel.md`](../../_ai/technical_decisions/ADR__261103-1__upgrade-restart-via-instance-state-and-quit-channel.md)

## Summary

Make a successful `scripts/install.sh` never leave the user talking to the
previous build. The installed app will publish a small per-user runtime record
(pid, executable, argv, cwd, start time) and accept a `--quit` control flag over
the existing single-instance channel. After a successful build and install, the
installer will read that record, verify the process is the expected executable
and belongs to the current user, ask for consent (default yes, interactive only),
stop the old instance gracefully, confirm it exited, and relaunch the installed
entry point with the recorded arguments and working directory. Every outcome —
no instance, restarted, declined, skipped non-interactively, dev instance,
unrecoverable arguments, or failed stop — prints an explicit next step, and no
new instance is ever started while the old one is still alive.

The change stays inside the existing boundary. Rust owns process identity,
record persistence, and shutdown control; the webview is untouched; the shell
installer owns user interaction, validation, and process lifecycle orchestration.
The feature follows the accepted ADR rather than introducing a second IPC
mechanism.

## Technical Context

**Language/Version**: Rust 1.80+ (edition 2021) for the app; Bash 3.2+ for the
installer; Node.js 20+ already required by `npm`/Vite (also used by the installer
to parse the runtime record safely).

**Primary Dependencies**: Tauri 2.12, `tauri-plugin-single-instance` 2.5,
`serde`/`serde_json` (all existing). No new Rust, frontend, or Node dependency.

**Storage**: One ephemeral per-user runtime record,
`$XDG_RUNTIME_DIR/docdeck/instance.json`, falling back to
`~/.local/state/docdeck/instance.json` (and `%LOCALAPPDATA%\docdeck\instance.json`
on Windows when neither variable exists). Directory mode `0700`, file mode
`0600`, atomic replace, no document content. The watch config, preferences, and
watched documents are not touched.

**Testing**: `cargo test` for record path/encoding/permissions/cleanup and
control-argument classification; a new Bash test script for installer decision,
parsing, and stop logic; the existing Vitest/typecheck suites prove no webview
regression; manual quickstart covers process lifecycle on Linux and macOS.

**Target Platform**: Linux and macOS for the shell installer; the app-side
record and `--quit` flag are cross-platform (Windows uses the same record code
with the documented path fallback; packaged bundles remain out of scope).

**Project Type**: Desktop application (Rust service layer + vanilla
TypeScript/DOM webview) plus a Bash installer.

**Performance Goals**: An accepted restart starts the new build with the original
targets in under 10 seconds (SC-001). Detection and identity checks are O(1)
file/process reads; graceful quit is bounded at 5 seconds, followed by one
`SIGTERM` and a 5-second wait, then abort.

**Constraints**: Never stop anything before build and install both succeed; only
current-user processes are candidates; never signal a process whose executable
does not match the record; never run two instances; no `SIGKILL` loop; no new
dependencies; no document content in the record; no writes to watched documents,
watch configuration, or preferences; one restart owner under concurrent installs.

**Scale/Scope**: One instance per user session (enforced by the existing
single-instance plugin); a record bounded to 64 KiB; tens of launch arguments;
one restart action per installer run.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Boundary (P-I) | OS concerns in Rust; view state in the webview; typed command/event seam only | PASS — record write/remove, process identity, and shutdown control live in Rust; the installer orchestrates process lifecycle; no webview code or new command surface |
| G2 Pure logic + tests (P-II) | Pure modules with deterministic tests; error/empty/boundary paths covered | PASS — `instance` exposes pure path/record/control-argument functions with temp-dir and injected-env tests; installer logic is split into sourceable functions with a Bash test suite; failure paths are explicit |
| G3 Least privilege (P-III) | Re-validate every path/input; no raw filesystem access in the webview; no new permissions | PASS — the webview is untouched; the installer validates pid, owner, executable, and record size before signalling; record is `0600` in a `0700` directory; arguments are passed as an array, never `eval`ed |
| G4 Read-only, never surprising (P-IV) | Never write watched documents; persisted vs session state explicit; explicit states | PASS — only a new runtime record is written; documents, watch config, and preferences are untouched; every installer outcome prints an explicit state and next step |
| G5 Performance (P-V) | Virtualized lists; no polling; debounced background work | PASS — O(1) record work at startup/exit; no UI work; restart waits are bounded and do not affect the app while it runs |
| G6 Quality gates | Typecheck, frontend tests, Rust tests, clippy | PASS — Rust tests plus a new Bash suite; existing `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs` remain green |
| G7 Platform constraint | Linux, macOS, Windows desktop | PASS — app code is cross-platform; the shell installer is Linux/macOS by design and documented; Windows packaged installers are out of scope per the spec |
| G8 Persistence constraint | Constitution currently says `config.toml` is the only file docdeck writes | **CONDITIONAL** — this feature adds an ephemeral runtime record. The spec explicitly accepts this widening and ADR 261103-1 records it; the constitution's Persistence bullet must be amended (MINOR) before implementation acceptance |
| G9 Dependencies | New runtime dependencies justified | PASS — none added; `serde_json` and Node are already present |

Post-Phase-1 re-check: the design resolves all unknowns without new
dependencies and keeps G1–G7, G9 satisfied. G8 remains a governance
prerequisite, tracked in Complexity Tracking and as a constitution amendment
task; it is not a design violation.

## Project Structure

### Documentation (this feature)

```text
specs/003-installer-upgrade-restart/
├── plan.md                 # This file (/speckit.plan output)
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output
├── quickstart.md           # Phase 1 output
├── contracts/
│   ├── instance-record.md  # Record path, JSON schema, permissions, lifecycle
│   ├── cli.md              # `docdeck --quit` and installer flags/messages
│   └── restart-flow.md     # Detection → decision → stop → relaunch state machine
├── checklists/
│   └── requirements.md     # Existing spec quality checklist
└── tasks.md                # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
scripts/
├── install.sh              # EXTEND build/install orchestration, flags, help, messages
├── lib/
│   └── restart.sh          # NEW sourceable detection/decision/stop/launch helpers
└── install_test.sh         # NEW Bash test suite (Unix)

src-tauri/
├── src/
│   ├── instance.rs         # NEW runtime record, path resolution, control args, cleanup
│   ├── instance_test.rs    # NEW pure/unit tests (temp dirs, injected env)
│   ├── lib.rs              # EXTEND --quit handling, record write, RunEvent::Exit cleanup
│   └── paths_test.rs       # EXTEND regression: control flags are never paths
└── Cargo.toml              # unchanged (serde/serde_json/libc already present)

README.md                   # document upgrade restart, --quit, record path/privacy
CHANGELOG.md                # Unreleased Added/Fixed entries
_ai/
├── context-definitions/upgrade-restart.md   # NEW recovery/flow context
└── technical_decisions/README.md            # ADR 261103-1 already listed
.specify/memory/constitution.md              # amendment prerequisite (G8)
package.json                # add `test:install` script (Unix)
```

**Structure Decision**: Keep the flat Rust layout and add one focused module
(`instance`) with a separate test file, matching `config`/`config_watch` and the
repository's `*_test.rs` convention. On the installer side, extract restart
logic into `scripts/lib/restart.sh` so the decision table, record parser, and
stop sequence can be exercised by `scripts/install_test.sh` without running a
real build; `install.sh` remains the user-facing orchestrator. No webview files
change, which keeps the feature out of the UI layer entirely.

## Complexity Tracking

| Violation / complexity | Why needed | Simpler alternative rejected because |
|-----------------------|------------|--------------------------------------|
| Adds a runtime instance record, while the constitution's Persistence bullet says `config.toml` is the only file docdeck writes (G8) | The installer cannot reliably recover argv/cwd or distinguish a dev instance from an install without them (FR-009, FR-012, FR-014) | Re-reading `/proc/<pid>/cmdline` and cwd is Linux-only and brittle on macOS/Windows; `pgrep` + process name cannot recover arguments; app self-restart resolves to the replaced, deleted inode on Linux |
| Installer parses JSON with Node | The record must be `instance.json` and must not be `source`d; Node is already a hard requirement of the build (`npm`) | Bash JSON parsing is unsafe/incomplete; `python3` is not guaranteed and would add a dependency; a second binary format would diverge from the accepted ADR |
| Splits installer logic into `scripts/lib/restart.sh` | The decision table and stop sequence are the risky parts; they need executable tests | Testing them inside a monolithic `install.sh` requires running a full Tauri build or copying logic into the test |
| Windows path fallback for the record | The app is cross-platform and must not fail to start when `HOME`/`XDG_RUNTIME_DIR` are absent | Failing the app on Windows or leaving record-less instances would diverge from the cross-platform constitution and make future packaged installers harder |
| Interactive confirmation is required for a dev instance even with `--restart` | FR-014 requires asking before converting a development instance into an installed one | Treating `--restart` as consent to replace a different executable would let an unattended script silently kill `tauri dev`; the spec's safety story is explicit about not guessing |
