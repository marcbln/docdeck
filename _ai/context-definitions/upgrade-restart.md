---
id: upgrade-restart
title: Installer upgrade restart and runtime instance record
type: context
updated: 2026-11-03
related:
  - ADR__261103-1__upgrade-restart-via-instance-state-and-quit-channel
---

# Installer upgrade restart and runtime instance record

## Why this exists

`scripts/install.sh` replaces the installed binary while the app may still be
running. A running process keeps the old inode, and the single-instance plugin
forwards a later `docdeck file.md` into that old process. The restart flow makes
the new build take effect and prevents a successful install from leaving the
user in stale code.

## Runtime record

The app writes one per-user record at startup and removes it on clean exit:

```text
$XDG_RUNTIME_DIR/docdeck/instance.json
$HOME/.local/state/docdeck/instance.json          # XDG_RUNTIME_DIR unset
%LOCALAPPDATA%\docdeck\instance.json              # Windows, neither set
```

Schema (`version: 1`): `pid`, `exe`, `argv`, `cwd`, `startedAt`. The directory is
`0700`, the file `0600`, writes are atomic (temporary file + rename), and the
record is bounded to 64 KiB. It contains process/location metadata only — never
document content, preferences, watch configuration, tokens, or environment
variables.

The writer is `src-tauri/src/instance.rs`; the installer parses the same format
with Node in `scripts/lib/restart.sh`. Neither side `source`s or `eval`s the
record.

## Trust rules

A record is trusted only when all of these hold:

1. It is readable, parses, is at most 64 KiB, and has schema version 1.
2. `pid > 0`, `exe` and `cwd` are non-empty absolute paths, and `argv` is a
   non-empty array of strings.
3. The pid is alive and owned by the current user.
4. The live executable matches the recorded `exe` after canonicalization.
   Linux reads `/proc/<pid>/exe` and strips a trailing ` (deleted)`; macOS uses
   `ps -p <pid> -o comm=`.

Any failure means the record is stale: remove it, signal nothing, and treat the
situation as "no instance". When no record exists at all, the installer falls
back to `pgrep -u "$(id -u)" -x docdeck`; more than one pid means "do not guess"
and the restart is skipped. Development/other executables require an interactive
confirmation before they are replaced.

## `--quit` control channel

`docdeck --quit` is a lifecycle flag, never a path. Before any window is built,
the process reads the record:

- no live instance: remove a stale record, print `docdeck is not running`, exit 0;
- live instance: forward `--quit` through `tauri-plugin-single-instance`, where
  the primary calls `app.exit(0)`.

`paths::classify_args` ignores `--quit`, and a regression test pins that. A
setup guard covers the race where the primary's IPC socket already vanished.

## Installer flow

Only after both the build and the install succeed:

```text
detect → validate/classify → consent → lock → stop → confirm → relaunch
```

- Consent: `--no-restart` declines, `--restart` restarts, a terminal prompts
  (default yes for an installed instance), and a non-interactive run prints
  manual-restart guidance without signalling anything.
- Stop: run the new `BIN_DST --quit`, wait up to five seconds, send exactly one
  `SIGTERM`, wait up to five seconds, then abort. Never `SIGKILL`. Never launch
  while the old pid is alive.
- Relaunch: start `BIN_DST` (the installed entry point, preserving symlink
  semantics) from the recorded `cwd` with `argv[1..]`, detached with `setsid` or
  `nohup`.
- Lock: `<record-dir>/install-restart.lock` (atomic `mkdir` + owner pid) ensures
  one installer owns the restart; a stale lock is removed once.

Every outcome prints one actionable message: no instance, restarted, started
but unconfirmed, declined, non-interactive, development instance, lock held,
stop failed, or launch failed.

## Tests

- `src-tauri/src/instance_test.rs`: path resolution, JSON round-trip and
  rejection, `0700`/`0600` modes, matching-pid cleanup, control flags.
- `scripts/install_test.sh` (`npm run test:install`): parser, validation,
  classification, decision flow, lock, escalation, and relaunch argument
  construction with stubbed signals.
- `specs/003-installer-upgrade-restart/quickstart.md`: manual lifecycle and
  safety scenarios.
