# Contract: CLI and Installer Interface

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

Two user-facing surfaces change: the app gains `--quit`, and `scripts/install.sh`
gains restart flags and messages. The webview is unaffected.

## `docdeck --quit`

Requests that the running instance exit. The flag is a lifecycle control, never a
path, and takes precedence over every other argument.

| Situation | Behavior | Exit code |
|-----------|----------|-----------|
| A trusted instance record exists and the process is alive | Ask the primary to exit through the single-instance channel; print the target pid to stderr; no window is created by the requesting process | 0 |
| No live instance (record absent or stale) | Remove a stale record; print `docdeck is not running` to stderr; no window | 0 |
| Record exists but the primary's IPC socket has vanished | The process becomes primary, exits in `setup` without a usable window, and still returns | 0 |
| Record is unreadable/malformed | Treat as no live instance, remove it, print `docdeck is not running` | 0 |

- `docdeck --quit file.md` quits and does **not** open `file.md` (FR-018).
- `--quit` never writes an instance record and never detaches from the terminal.
- The primary's exit is a normal `app.exit(0)`: the record is removed, watched
  documents/config/preferences are untouched (FR-017).
- There is no `--restart` on the app; restart is owned by the installer.

## `scripts/install.sh`

### New flags

| Flag | Meaning |
|------|---------|
| `--restart` | Restart a detected installed instance without prompting. Non-interactive is allowed. A development/other instance still requires an interactive confirmation. |
| `--no-restart` | Never signal or restart a running instance. |
| `-n`, `--no-interaction` | Never prompt. With neither restart flag, skip the restart and print manual-restart guidance. |
| `--restart` + `--no-restart` | Usage error; exit 2. |

Existing flags (`--symlink`, `--copy`, `--no-build`, `--no-desktop`, `--default`,
`--prefix`, `-h`/`--help`) keep their meaning and are accepted before or after
the new flags.

### Ordering guarantee

```text
parse flags → build → install binary → desktop registration
            → restart flow (only after install succeeded)
```

A failed build or install returns before detection or signalling (FR-002,
SC-007). The prompt is never shown during the build.

### Restart detection

1. Read and validate the runtime record (see
   [`instance-record.md`](./instance-record.md)).
2. If no readable record, fall back to
   `pgrep -u "$(id -u)" -x docdeck`:
   - one pid → identify the live executable; launch context is unrecoverable;
   - more than one pid → do not guess; skip the restart with a message.
3. Classify the instance as **installed** (canonical exe == canonical `BIN_DST`)
   or **development/other** (anything else).

### Prompt

Only when stdin is a TTY, `--no-interaction` is absent, and no explicit restart
flag was given.

- Installed instance:
  `Restart the running docdeck instance (pid N) now? [Y/n]` — empty answer means
  **yes**.
- Development/other instance:
  `The running docdeck is <exe>, not the installed <BIN_DST>. Replace it with the
  installed build? [y/N]` — empty answer means **no**. This prompt is required
  even when `--restart` was given and even when stdin is not a TTY; without a
  TTY the installer skips and prints the warning instead.
- Unrecoverable launch arguments (after consent):
  `The original launch arguments could not be recovered. Start docdeck without
  them? [y/N]` — empty answer means **no**. With `--restart` and no TTY, the
  installer starts bare and says so (FR-010).

### Outcomes and messages

Every run ends with exactly one clear, actionable statement (FR-019, SC-006):

| Outcome | Message shape | Exit |
|---------|---------------|------|
| No instance | `No running docdeck instance. The new build will be used on the next launch.` | 0 |
| Restarted | `Restarted docdeck (pid N) from <BIN_DST> with its original launch arguments.` | 0 |
| Started, not confirmed | `Started docdeck from <BIN_DST>, but the new instance did not report within 5 seconds.` | 0 |
| Declined | `Left the running docdeck instance untouched. Quit and relaunch it to use the new build.` | 0 |
| Non-interactive, no flag | `No interactive terminal attached. Quit and relaunch docdeck to use the new build.` | 0 |
| Development instance, no confirmation | `The running docdeck is <exe>; the installed build is <BIN_DST>. Left it running; quit and relaunch it to use the new build.` | 0 |
| Concurrency lock held | `Another install is already restarting docdeck; skipping the restart.` | 0 |
| Old instance will not exit | `The running docdeck instance (pid N) did not exit after a graceful request and SIGTERM. Left it running and started nothing.` | 1 |
| Launch failed | `Stopped the old docdeck instance but could not start <BIN_DST>. Start it manually.` | 1 |
| Stale/mismatched record | Treated as "No instance"; the stale record is removed and the message says so. | 0 |

Standard streams follow the repository CLI conventions: prompts and messages go
to stderr, the installer's normal progress stays on stdout.

### Concurrency

Only the restart section is locked, at
`<record-dir>/install-restart.lock` (atomic `mkdir` + owner pid). At most one
installer may own the restart; the others complete their install and skip the
restart with the message above. A stale lock (owner pid dead) is removed once and
retried.

### Non-goals

- No `SIGKILL` escalation.
- No packaged/bundle upgrade path and no in-app update (spec Assumptions).
- No session restore of GUI-opened tabs.
