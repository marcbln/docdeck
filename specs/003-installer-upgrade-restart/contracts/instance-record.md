# Contract: Runtime Instance Record

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

The app publishes exactly one record per user session. The installer is the only
reader besides the app itself. The record is metadata, not preferences or
session state.

## Location

Resolved identically by `src-tauri/src/instance.rs` and
`scripts/lib/restart.sh`:

| Condition | Path |
|-----------|------|
| `XDG_RUNTIME_DIR` is set and non-empty | `$XDG_RUNTIME_DIR/docdeck/instance.json` |
| `XDG_RUNTIME_DIR` unset/empty, `HOME` set (Unix) | `$HOME/.local/state/docdeck/instance.json` |
| Windows, neither variable set | `%LOCALAPPDATA%\docdeck\instance.json` |

`DOCDECK_CONFIG` and the watch configuration do not affect this path.

## Permissions

- Containing directory: mode `0700` (created if missing; an existing directory is
  not widened).
- File: mode `0600`.
- Written atomically: create a temporary file in the same directory, write, then
  `rename` over the record. A partially written record must never be observable.

## Encoding

UTF-8 JSON, at most 64 KiB. Unknown fields are ignored by readers. Missing,
wrongly typed, or unknown-version records are rejected.

```json
{
  "version": 1,
  "pid": 12345,
  "exe": "/home/user/.local/bin/docdeck",
  "argv": [
    "/home/user/.local/bin/docdeck",
    "docs/plan.md",
    "./_ai"
  ],
  "cwd": "/home/user/project",
  "startedAt": 1793700000000
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `version` | integer | `1` in this feature. |
| `pid` | integer | Process identifier of the primary instance. |
| `exe` | string | Absolute executable path recorded at startup. |
| `argv` | string[] | Full argument vector including `argv[0]`; relative paths are relative to `cwd`. |
| `cwd` | string | Absolute working directory at launch. |
| `startedAt` | integer | Epoch milliseconds, informational. |

**Privacy**: the record may name document/folder paths because those are launch
arguments, but it must never contain document content, rendered text, watch
configuration values, preferences, tokens, or environment variables.

## Writer Rules (app)

- Write after the window exists, in the Tauri `setup` hook.
- Capture `env::args_os()` lossily; capture `std::env::current_exe()` and
  `std::env::current_dir()`.
- A write failure is logged to stderr and does not prevent startup.
- Remove the record in `RunEvent::Exit` **only if** the stored `pid` equals the
  current pid.
- A process launched as the single-instance secondary or with `--quit` never
  writes a record.
- Crash, `SIGKILL`, or power loss may leave a stale record; readers must validate.

## Reader Rules (installer)

1. Reject a record larger than 64 KiB or one that does not parse.
2. Validate `version == 1`, `pid > 0`, non-empty absolute `exe` and `cwd`, and a
   non-empty `argv` array of strings.
3. Trust the pid only when:
   - the process is alive;
   - it is owned by the current user; and
   - its live executable matches `exe` after canonicalization (strip a trailing
     ` (deleted)` from Linux `/proc/<pid>/exe`; use `ps -p <pid> -o comm=` on
     macOS).
4. On any failure, treat the record as stale: remove the file, do not signal the
   pid, and report "nothing running" (or "unidentified instance" when the pid
   came from the `pgrep` fallback).
5. Never `source`, `eval`, or interpolate record values into a shell command.
   Arguments are always passed as an array.
