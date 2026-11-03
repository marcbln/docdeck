# Phase 0 Research: Installer Upgrade Restart

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

All unknowns from the Technical Context are resolved below. No `NEEDS
CLARIFICATION` remains. The design follows
[ADR 261103-1](../../_ai/technical_decisions/ADR__261103-1__upgrade-restart-via-instance-state-and-quit-channel.md).

## R1 — How the app publishes its running instance

**Decision**: Add a Rust `instance` module that writes one JSON record at
startup:

```json
{
  "version": 1,
  "pid": 12345,
  "exe": "/home/user/.local/bin/docdeck",
  "argv": ["/home/user/.local/bin/docdeck", "docs/plan.md", "./_ai"],
  "cwd": "/home/user/project",
  "startedAt": 1793700000000
}
```

Path resolution matches the ADR:

- `$XDG_RUNTIME_DIR/docdeck/instance.json` when `XDG_RUNTIME_DIR` is non-empty;
- otherwise `$HOME/.local/state/docdeck/instance.json`;
- on Windows, when neither variable exists, `%LOCALAPPDATA%\docdeck\instance.json`
  (documented platform fallback; the shell installer does not run there).

The directory is created `0700` and the file written atomically with `0600`
(temp file in the same directory, `fs::rename`). `argv` is captured from
`env::args_os()` (lossy UTF-8, because the frontend already treats paths as
strings) and includes `argv[0]`. The record is capped at 64 KiB; an oversized
record is rejected rather than read. It contains only process/location metadata,
never document content. Write failures are logged to stderr and are non-fatal.

**Lifecycle**: the record is written in the Tauri `setup` hook after the window
exists, and removed in `RunEvent::Exit` only when the recorded pid equals the
current pid (so a late exit cannot delete a successor's record). A crash leaves a
stale record; readers validate it before use.

**Rationale**: The installer cannot observe argv/cwd portably, and
`/proc/<pid>/cmdline` is Linux-only. One record is the single source of truth
for detection, identity, and relaunch arguments, and it is testable as pure
serialization plus temp-directory file operations.

**Alternatives rejected**:
- Read `/proc/<pid>/cmdline` and `/proc/<pid>/cwd`: Linux-only; macOS has no
  reliable equivalent for the original cwd.
- Parse `ps`/`lsof` output: brittle and cannot distinguish a release install
  from `tauri dev` by name alone.
- App self-restart via `current_exe()`: on Linux the path resolves to the
  replaced, deleted inode, so the successor would launch the old binary.
- Persist the GUI session: a separate feature with its own storage and
  migration concerns; explicitly out of scope.

## R2 — How `--quit` reaches the running instance

**Decision**: Treat `--quit` as a lifecycle control flag, classified before any
window is built.

1. `run()` parses control arguments before `detach_from_terminal` and before the
   Tauri builder. Control flags are never path arguments, so `--quit` cannot be
   treated as a document or folder (FR-018). `paths::classify_args` already
   skips every argument beginning with `-`; a regression test pins that.
2. With `--quit`, the process reads and validates the instance record:
   - **No live instance**: remove a stale record, print
     `docdeck is not running` to stderr, and exit 0 without creating a window.
   - **Live instance**: print the target pid to stderr, skip terminal detach, and
     continue into the single-instance plugin so the flag is forwarded.
3. The single-instance plugin callback checks for `--quit` first and calls
   `app.exit(0)` on the primary instead of forwarding it as a path. The plugin
   then exits the secondary. `app.exit` produces a normal `RunEvent::Exit`, which
   removes the record.
4. A `setup` guard repeats the `app.exit(0)` decision: if a record was live but
   the IPC socket had already disappeared (rare race), the process becomes
   primary and still exits without leaving a window open.
5. `--quit` takes precedence over any other arguments; `docdeck --quit file.md`
   quits and does not open `file.md`.

Liveness for the early check uses `libc::kill(pid, 0)` on Unix. On non-Unix
targets the early check assumes a live instance and relies on the plugin/setup
guard; the shell installer is Unix-only.

If the record is missing but an instance is running (pre-feature build or a
manually deleted record), `docdeck --quit` reports "not running". The installer
does not rely on this path for such instances; its `pgrep` fallback handles them
with a direct `SIGTERM` after confirmation.

**Rationale**: This is the ADR's control channel, reusing the existing
single-instance IPC instead of inventing a second bus. Checking the record before
building avoids a window flash in the common case, and the setup guard covers
the race.

**Alternatives rejected**:
- A new TCP/Unix-socket control server: duplicates the plugin, adds permissions,
  and creates a second lifecycle surface.
- Always creating the window and exiting in `setup`: flashes a window for a
  scripted quit.
- Treating `--quit` as a path: violates FR-018 and would open a bogus document.

## R3 — How the installer detects and validates the instance

**Decision**: Add sourceable helpers in `scripts/lib/restart.sh`; `install.sh`
calls them only after both build and install succeed.

Detection order:

1. **Record**: resolve the same path as the app, then parse it with Node (already
   required by `npm`) into NUL-delimited fields. Node reads the file with
   `fs.readFileSync` and writes `version`, `pid`, `exe`, `cwd`, `startedAt`, and
   each argv element; Bash reads them with `read -r -d ''`. The record is never
   `source`d or `eval`ed.
2. **Fallback**: if there is no readable record, use
   `pgrep -u "$(id -u)" -x docdeck`. One pid means "an instance exists but its
   launch context is unknown"; more than one means "do not guess" and the
   restart is skipped with a message.

Validation of a record-derived pid, in order, before any signal:

- pid is a positive integer and the process exists (`kill -0`);
- the process is owned by the current user (`ps -o uid= -p "$pid"`);
- the live executable matches the recorded executable. On Linux, read
  `/proc/$pid/exe`, strip a trailing `" (deleted)"` (the normal state after the
  installer replaced the binary), and canonicalize; on macOS use
  `ps -p "$pid" -o comm=` and canonicalize. Paths are canonicalized with Node's
  `fs.realpathSync` (falling back to the literal path when it no longer exists).
- a mismatch or dead pid means the record is stale: remove the record, do not
  signal the process, and report it as "nothing running" (FR-013).

Classification:

- **installed** — canonical recorded exe equals canonical `BIN_DST` (the path the
  installer just wrote; for `--symlink` this resolves to the build output, which
  is exactly what the running process recorded);
- **development/other** — any other executable (debug/release target, old
  prefix). The installer names both executables and requires confirmation.

**Rationale**: The record is the only portable source of argv/cwd. Validating
owner and executable before signalling satisfies the spec's "never signal an
unrelated process" rule. Node is already a hard prerequisite of the installer and
removes the need for a second data format or an extra binary.

**Alternatives rejected**:
- `source instance.json` or grep/`sed` parsing: unsafe with arbitrary arguments
  and unable to handle JSON escapes correctly.
- Requiring `jq`: a new dependency not guaranteed on user machines.
- Trusting the recorded pid without checking the executable: a reused pid from an
  unrelated process would be signalled.
- Refusing to handle a "deleted" executable link: after every successful copy
  install the old process's link is literally `.../docdeck (deleted)`, so the
  installer would always conclude "unrelated".

## R4 — Restart decision and interaction

**Decision**: Resolve one of three intents (restart / do not restart / ask) from,
in priority order:

1. `--no-restart` → do not restart;
2. `--restart` → restart;
3. interactive terminal and not `--no-interaction` → ask, default **yes**;
4. otherwise → do not restart, print manual-restart guidance.

Rules:

- The prompt appears only after build and install succeed (SC-007), and only
  when stdin is a TTY and `--no-interaction` is absent (FR-005, FR-006).
- Declining leaves the process untouched and prints: "Left the running docdeck
  instance untouched. Quit and relaunch it to use the new build."
- Non-interactive without an explicit flag prints the same manual-restart
  guidance plus "no interactive terminal attached".
- A development/other instance always requires interactive confirmation, even
  with `--restart`: the prompt names both executables, defaults to **no**, and a
  non-interactive run skips with a warning. `--restart` consents to restarting
  the installed app, not to silently replacing a different executable.
- If launch arguments or the working directory cannot be recovered: interactive
  runs ask a second explicit question ("start it without its original
  arguments?"); non-interactive runs skip unless `--restart` was explicit, in
  which case they start bare and say so (FR-010). If the recorded cwd no longer
  exists, the original launch context is treated as unrecoverable; with explicit
  consent the new instance starts in `$HOME` with a message.
- `-n` / `--no-interaction` never prompts; combined with neither restart flag it
  skips the restart (consistent with the CLI conventions used by the project).
- `--restart` and `--no-restart` together are a usage error (exit 2).

**Rationale**: The default-yes prompt matches FR-003; refusing to prompt without
a TTY matches FR-005 and avoids blocking CI; requiring an explicit interactive
answer for a dev instance is the only way to satisfy FR-014's "ask before
replacing" when the process is not the installed build.

**Alternatives rejected**:
- Prompting on `/dev/tty` even when stdin is piped: violates the spec's
  non-interactive rule and can hang scripted installs.
- Default-no prompt: makes the safe path the annoying path and contradicts
  FR-003.
- Treating `--restart` as consent for a dev instance: lets an unattended script
  kill `tauri dev` without naming what it found.

## R5 — Stop, confirmation, and relaunch

**Decision**: After consent, with the restart lock held:

1. **Graceful request**: run the newly installed `BIN_DST --quit`. Because the
   new binary supports the control flag, it forwards over the existing
   single-instance socket even when the old process is a previous build.
2. **Wait**: poll for up to 5 seconds for the old pid to disappear. A Linux
   zombie (`ps -o stat=` starting with `Z`) counts as exited.
3. **Escalate once**: if still alive, send `SIGTERM`, then wait up to 5 seconds.
4. **Abort rather than compete**: if still alive, print the failure, leave the
   old instance running, start nothing, and exit non-zero. No `SIGKILL` loop.
5. **Confirm**: do not launch until the old pid is confirmed gone (FR-008). If a
   stale record for that pid remains, remove it.
6. **Relaunch**: resolve `BIN_DST` to an absolute path before the restart
   section (the installer changes directory to the repository root) and start it
   (the installed entry point, preserving symlink semantics) from the recorded
   cwd with the recorded `argv[1..]`. Use `setsid` when available, otherwise
   `nohup`, with stdin/stdout/stderr redirected so the installer can exit
   immediately. Never launch `argv[0]` from the record.
7. **Verify (best effort)**: poll for a new record with a different pid for up to
   5 seconds; report the new pid when seen, otherwise report that the process was
   started but confirmation timed out.

Ordering guarantees: build → install → detect → decide → stop → confirm → launch.
A failed build or copy returns before any process is touched (FR-002).

**Rationale**: `--quit` is a clean `app.exit(0)` (record removed, preferences and
watch config untouched). `SIGTERM` is the single escalation the spec permits; a
process that survives it is not restartable safely. Launching the installed path
(rather than the recorded, deleted inode) is what makes the new build actually
run.

**Alternatives rejected**:
- `kill -9` after `SIGTERM`: risks data loss and can leave two instances if the
  process ignores signals; the spec explicitly prefers aborting.
- Launching the recorded executable: on Linux it points at the replaced inode.
- Starting the new instance before the old one is confirmed gone: violates
  FR-008 and can produce two primaries.
- Forwarding a normal launch through single-instance: that is the bug being
  fixed; it would land in the old process.

## R6 — Concurrent installs and lock ownership

**Decision**: Acquire a restart lock only after a successful install, at
`<record-dir>/install-restart.lock` (an atomically created directory containing
the owner pid). If creation fails:

- if the owner pid is alive, print "another install is already restarting
  docdeck" and skip the restart (exit 0 — the install itself succeeded);
- if the owner is stale, remove the lock once and retry;
- if the lock still cannot be acquired, skip with the same message.

Release the lock from a `trap` on `EXIT`/`INT`/`TERM`. The build/install steps
are not locked; only the process-control section has a single owner, which is the
spec's requirement.

**Rationale**: `flock` is not available on stock macOS; `mkdir` is atomic and
POSIX. A stale-lock check keeps a killed installer from blocking future runs.

**Alternatives rejected**:
- `flock`: missing on macOS by default.
- An advisory file with a pid and no atomic create: two installers can both read
  it and proceed.
- Locking the whole installer: serializes unrelated builds without protecting
  the instance any better.

## R7 — Testing strategy

**Decision**:

- **Rust unit tests** (`instance_test.rs`, temp dirs, injected env/platform):
  path resolution for XDG/HOME and the documented fallbacks; record JSON
  round-trip; unknown/missing/oversized record rejection; atomic write and Unix
  `0700`/`0600` permissions; cleanup removes only a matching pid; control-flag
  classification; `--quit` does not appear in `classify_args`.
- **Bash tests** (`scripts/install_test.sh`, no build needed): source
  `restart.sh`; fixture record parsed through the same Node helper; validation
  rejects dead/mismatched/foreign pids without calling `kill` (stub the signal
  command); decision table for explicit/interactive/non-interactive/dev/missing
  args; prompt answers (`""`, `y`, `n`); stop escalation using a real `sleep`
  child and a short grace override; launch argument construction without
  starting a GUI.
- **Existing suites**: `npm run typecheck`, `npm run test:web`, `npm test`,
  `npm run lint:rs` must stay green; `package.json` gains `test:install` for the
  Bash suite (kept out of `npm test` because Windows cannot run Bash).
- **Manual quickstart**: full lifecycle, decline, non-interactive, `--restart`,
  `--no-restart`, dev instance, stale record, unresponsive process
  (`SIGSTOP`), concurrent installs, relative paths, and `--symlink` mode.

**Rationale**: The constitution requires pure logic to be tested deterministically.
The risky installer logic is factored into functions so it can be exercised
without a Tauri build, while the actual process lifecycle is verified manually
where a real window and IPC socket exist.

**Alternatives rejected**:
- Covering the installer only through a full release build in `npm test`: slow,
  platform-specific, and unable to simulate stale records and unresponsive
  processes cheaply.
- Adding a Rust `bats`-style harness: a new dependency for a Bash-only concern.

## R8 — Documentation and governance

**Decision**:

- Amend `.specify/memory/constitution.md` Persistence bullet (MINOR bump to
  1.2.0 with a Sync Impact Report) to permit the ephemeral runtime instance
  record, state its path, modes, content limits, and clean-exit removal, and keep
  the existing "watched documents are read-only" guarantee.
- Update `README.md` with the upgrade flow, flags, `--quit`, record path/privacy,
  dev-instance warning, and the non-interactive behavior.
- Update `CHANGELOG.md` under Unreleased (Added: restart flow, `--quit`;
  Fixed: stale build trap).
- Add `_ai/context-definitions/upgrade-restart.md` describing detection,
  validation, and relaunch for future agents; the accepted ADR remains the
  decision record.

**Rationale**: The constitution requires documentation and an ADR for
hard-to-reverse decisions in the same commit; the ADR already exists, and the
runtime file is the one documented persistence widening the spec accepts.

**Alternatives rejected**:
- Leaving the persistence exception only in the ADR: the constitution would
  still forbid the write and future reviews would flag it.
- Documenting only in the changelog: users need the recovery rule when an
  upgrade prompt appears.
