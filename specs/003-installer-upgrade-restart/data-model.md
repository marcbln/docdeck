# Phase 1 Data Model: Installer Upgrade Restart

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

This feature has no webview state. Its data lives in one per-user runtime file,
one derived process identity, and the installer's in-memory decision state.
Contract details and wire formats are in
[`contracts/instance-record.md`](./contracts/instance-record.md) and
[`contracts/cli.md`](./contracts/cli.md).

## Entity: InstanceRecord

The app's published description of its running process.

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `version` | integer | yes | Must be `1`; unknown versions are rejected. |
| `pid` | integer | yes | `> 0`; must be alive for the record to be trusted. |
| `exe` | string | yes | Absolute path of the executable that wrote the record. |
| `argv` | string[] | yes | Non-empty; includes `argv[0]`; each element UTF-8 lossy; total record ≤ 64 KiB. |
| `cwd` | string | yes | Absolute working directory at launch; the base for relative `argv` paths. |
| `startedAt` | integer | yes | Unix epoch milliseconds; informational only, not used for identity. |

**Storage**: JSON at the runtime record path (see below). Directory `0700`,
file `0600`, written atomically (temporary file + rename). The app writes it in
the Tauri `setup` hook; it contains metadata only, never document content,
preferences, or watch configuration.

**Validation for trust** (installer, before any signal):

1. File is readable, parses as JSON, and is ≤ 64 KiB.
2. `version == 1`, `pid > 0`, `exe`/`cwd` non-empty absolute strings, `argv` is
   a non-empty array of strings.
3. The pid refers to a live process.
4. The process is owned by the current user.
5. The live executable matches `exe` after canonicalization (Linux
   `/proc/<pid>/exe` with a trailing ` (deleted)` stripped; macOS
   `ps -p <pid> -o comm=`).

Any failure means the record is **stale**: remove it, do not signal the pid, and
treat the situation as "nothing running" (for a dead/mismatched record) or
"unidentified instance" (for the `pgrep` fallback).

**Lifecycle**:

```text
absent ──app start──▶ written ──clean exit──▶ absent
                         │
                         ├──crash──────▶ stale ──reader validates──▶ removed
                         └──installer stop──▶ exited ──new app──▶ written (new pid)
```

A record is removed on exit only when its `pid` equals the exiting process's
pid, so an exiting old instance cannot delete a successor's record.

## Entity: RuntimeRecordPath

| Platform / environment | Path |
|------------------------|------|
| Unix with non-empty `$XDG_RUNTIME_DIR` | `$XDG_RUNTIME_DIR/docdeck/instance.json` |
| Unix without `$XDG_RUNTIME_DIR` | `$HOME/.local/state/docdeck/instance.json` |
| Windows without `$XDG_RUNTIME_DIR`/`$HOME` | `%LOCALAPPDATA%\docdeck\instance.json` |

The app and `scripts/lib/restart.sh` use the same rules. `DOCDECK_CONFIG` does
not affect this path; the record is about the process, not the watch config.

## Entity: InstallTarget

The entry point the installer wrote, used to classify a detected process.

| Field | Type | Rules |
|-------|------|-------|
| `path` | string | Absolute path of `BIN_DST`; may be a copy or a symlink. |
| `resolved` | string | Canonical path of `BIN_DST` (symlink target for `--symlink`). |
| `mode` | enum | `copy` or `symlink`. |

**Classification** of a detected record:

| Condition | Class | Installer behavior |
|-----------|-------|--------------------|
| canonical `record.exe` == canonical target | installed | Normal restart prompt (default yes). |
| canonical `record.exe` != canonical target | development/other | Name both executables; require interactive confirmation (default no). |
| no usable record (pgrep fallback) | unknown | Name the pid; require interactive confirmation; launch context is unrecoverable. |

## Entity: RestartDecision

The resolved intent and its provenance.

| Field | Type | Rules |
|-------|------|-------|
| `intent` | enum `restart` \| `decline` \| `ask` | Derived from flags and TTY. |
| `source` | enum `explicit-restart` \| `explicit-no-restart` \| `prompt` \| `non-interactive-default` | Auditability for the printed message. |
| `consent` | boolean | Final answer after the prompt (or the explicit flag). |
| `requiresDevConfirmation` | boolean | True for development/other/unknown instances. |
| `argsRecoverable` | boolean | False for pgrep fallback, unreadable argv, or a missing cwd. |

**Decision table**:

| `--restart` | `--no-restart` | stdin TTY | `--no-interaction` | Result |
|-------------|----------------|-----------|--------------------|--------|
| no | no | yes | no | ask, default yes (installed) / default no (dev) |
| no | no | no | any | decline with manual-restart guidance |
| no | no | yes | yes | decline with manual-restart guidance |
| yes | no | any | any | restart (dev still asks; without TTY → skip with warning) |
| no | yes | any | any | decline, never signal |
| yes | yes | any | any | usage error, exit 2 |

If `consent == true` but `argsRecoverable == false`: interactive runs ask a
second explicit question before stopping; non-interactive runs proceed bare only
when `source == explicit-restart`, and say so (FR-010).

## Entity: StopAttempt

| Field | Type | Rules |
|-------|------|-------|
| `pid` | integer | Validated target only. |
| `gracefulRequested` | boolean | `--quit` sent through the installed entry point. |
| `gracefulWait` | duration | 5 seconds. |
| `escalated` | boolean | `SIGTERM` sent at most once after the graceful wait. |
| `escalationWait` | duration | 5 seconds. |
| `exited` | boolean | Confirmed by liveness/zombie check before launch. |

**Invariants**:

- No signal is sent to a pid that failed identity/ownership validation.
- No new instance is started unless `exited == true`.
- If `exited == false` after escalation, the old instance is left running and
  the installer exits non-zero without launching anything.
- At most one installer holds the restart lock for a given record directory.

## State Transitions (installer)

```text
build/install ──fail──▶ no process touched; old instance keeps running
      │
    success
      ▼
detect ──none/stale──▶ clear stale record; print "next launch" guidance
      │
   found
      ▼
decide ──decline/non-interactive/dev-without-TTY──▶ leave untouched; manual guidance
      │
   consent
      ▼
lock ──held──▶ another installer owns restart; skip
      │
  acquired
      ▼
stop (--quit → wait 5s → SIGTERM → wait 5s)
      │
   exited? ──no──▶ report; leave old running; no launch; exit non-zero
      │ yes
      ▼
launch installed entry point with argv[1..] and cwd
      │
   started? ──no──▶ report failure; exit non-zero
      │ yes
      ▼
verify new record (best effort) → print "restarted (pid N)"
```
