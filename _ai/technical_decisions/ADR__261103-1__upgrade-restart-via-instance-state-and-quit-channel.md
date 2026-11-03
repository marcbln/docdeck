---
title: Upgrade restarts use a runtime instance file and a `--quit` control channel
status: Accepted
date: 2026-11-03
deciders: docdeck maintainer
tags: [installer, single-instance, lifecycle, runtime-state]
adrId: 261103-1
---

# Upgrade restarts use a runtime instance file and a `--quit` control channel

## Context

`scripts/install.sh` builds a release binary and atomically replaces
`~/.local/bin/docdeck`. A running instance keeps the old inode, so the install
succeeds while the visible app keeps executing stale code. Because
`tauri-plugin-single-instance` forwards a second launch's arguments into that
old process, `docdeck foo.md` after an install silently opens in the stale
build — the failure is correctness, not just convenience.

Restarting requires knowing three things the installer cannot reliably observe:
whether an instance is running, what argv/cwd it was started with, and how to
stop it without a hard kill. `/proc/<pid>/cmdline` is Linux-only; `ps`/`lsof`
parsing on macOS is brittle; process-name matching alone cannot distinguish a
release install from `tauri dev`.

## Decision

**Runtime instance file.** The app writes `{pid, exe, argv, cwd, startedAt}` to
`$XDG_RUNTIME_DIR/docdeck/instance.json` (falling back to
`$HOME/.local/state/docdeck/instance.json`) at startup, and removes it on clean
exit. Directory mode `0700`, file mode `0600`. It is per-user and contains only
paths and a pid. A file is trusted only when its pid is alive *and* that
process's executable matches the recorded path; a stale file is deleted and
ignored. `exe` is compared against the install target and, in `--symlink` mode,
the resolved target.

**`--quit` control flag over single-instance IPC.** `run()` classifies arguments
before building the window. As the primary process it exits 0 immediately, so a
scripted `--quit` never flashes a window. When a primary already exists, the
single-instance callback receives `--quit` and calls `app.exit(0)`, letting the
plugin retire the secondary. `paths::classify_args` ignores the flag so it is
never treated as a document. This channel is the template for future lifecycle
control; it is not a general IPC bus.

**Installer contract.** Order is build → install → touch the process: a failed
build or copy leaves the running instance untouched. After a successful install
the script detects via the instance file (falling back to
`pgrep -u "$USER" -x docdeck`), prompts `Restart it now? [Y/n]` only on a TTY,
and honors `--restart` / `--no-restart`. On consent it sends `--quit`, waits up
to five seconds, falls back to `SIGTERM`, and aborts rather than start a second
primary. It then relaunches the installed path with the recorded argv and cwd.
With no recoverable argv it skips unless `--restart` was explicit, in which case
it relaunches bare and says so.

## Consequences

Positive:
- Detection, identity and relaunch arguments come from one cross-platform source.
- Stopping is graceful (no signal by default) and testable as pure predicates.
- The stale-instance trap after an install disappears.
- The same file is available to a future session-restore feature without new IPC.

Negative:
- A new file is written on every launch and must be cleaned on exit; a crash
  leaves a stale entry that readers must validate.
- Control flags must be filtered out of CLI path classification forever.
- A dev instance and a release install are distinguishable but not
  interchangeable; the installer must ask before converting one into the other.
- Open tabs are still session-scoped: a restart closes GUI-opened documents.

## Alternatives Considered

- Installer reads `/proc/<pid>/cmdline` and cwd: Linux-only, and macOS has no
  reliable equivalent for the original cwd.
- `pgrep`/`SIGTERM` only: works for any build but is abrupt and cannot recover
  argv or distinguish a dev instance.
- App self-restart via `current_exe()`: on Linux the path resolves to the
  replaced, deleted inode, so the successor can launch the old binary.
- Launching the new binary and letting single-instance forward: forwards into
  the stale process, which is the bug being fixed.
- Persisting the GUI session as part of the restart: a separate feature with its
  own storage and migration concerns; not required to make upgrades correct.

## Related Decisions

- Extends the single-instance wiring described in
  [ADR 261029-1](ADR__261029-1__block-webview-navigation-and-dispatch-links-explicitly.md)
  by adding one lifecycle flag to the same channel.
