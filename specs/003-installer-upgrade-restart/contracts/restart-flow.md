# Contract: Restart Flow

**Feature**: `003-installer-upgrade-restart` | **Date**: 2026-11-03

This is the installer side of the lifecycle. The record format is in
[`instance-record.md`](./instance-record.md); prompts and messages are in
[`cli.md`](./cli.md).

## Sequence

```text
install.sh
  │
  ├─ parse --restart / --no-restart / --no-interaction
  ├─ npm install (if needed)
  ├─ npm run tauri build -- --no-bundle        ── failure → exit, no process touched
  ├─ install/symlink BIN_DST                    ── failure → exit, no process touched
  ├─ Linux desktop registration (optional)
  │
  └─ restart_after_install(BIN_DST)
       │
       ├─ no instance (record absent/stale, pgrep empty)
       │    → clear stale record; print "next launch"; exit 0
       │
       ├─ instance found
       │    ├─ validate owner + executable; stale → clear, treat as none
       │    ├─ classify installed vs development/other
       │    ├─ resolve decision (explicit / prompt / non-interactive)
       │    └─ decline → print manual guidance; exit 0
       │
       ├─ consent
       │    ├─ acquire restart lock (or skip if another owner is alive)
       │    ├─ args/cwd recoverable?
       │    │    ├─ no → second confirmation (interactive) or explicit --restart
       │    │    │        → if still no: do not stop; print guidance; exit 0
       │    │    └─ yes
       │    ├─ send --quit through BIN_DST; wait 5 s
       │    ├─ still alive? → SIGTERM; wait 5 s
       │    ├─ still alive? → print failure; leave running; do not launch; exit 1
       │    ├─ confirm exited; remove a stale record for that pid
       │    ├─ launch BIN_DST from cwd with argv[1..] (setsid/nohup, stdio closed)
       │    ├─ best-effort: wait for a new record with a different pid
       │    └─ print "restarted (pid N)" or "started, not confirmed"; exit 0
       │
       └─ release lock (trap)
```

## Process-identity validation

Before `--quit` or any signal, the target must pass all checks:

```text
record parsed and bounded
  ∧ version == 1
  ∧ pid > 0
  ∧ process alive
  ∧ process uid == current uid
  ∧ canonical(live exe) == canonical(record.exe)
```

`canonical(live exe)`:

- Linux: `readlink /proc/<pid>/exe`, strip a trailing `" (deleted)"`.
- macOS: `ps -p <pid> -o comm=`.
- Canonicalization: Node `fs.realpathSync`; on failure, use the literal path so a
  deleted inode can still be compared by path.

Failure ⇒ stale record: remove it and do not signal. For a pid found only via
`pgrep`, the executable is resolved the same way but there is no record and no
recoverable argv.

## Classification

| Recorded exe | Installed target | Class |
|--------------|------------------|-------|
| `~/.local/bin/docdeck` | `~/.local/bin/docdeck` | installed (copy) |
| `src-tauri/target/release/docdeck` | symlink to that path | installed (symlink) |
| `src-tauri/target/debug/docdeck` | `~/.local/bin/docdeck` | development |
| `/usr/local/bin/docdeck` (old prefix) | `~/.local/bin/docdeck` | other |
| unknown (`pgrep` only) | any | unknown |

Development/other/unknown always needs an interactive confirmation that names
both executable paths. `--restart` alone is not consent to replace a different
executable.

## Stop policy

| Step | Action | Bound | On timeout |
|------|--------|-------|------------|
| 1 | Run `BIN_DST --quit` (new binary forwards to the old primary) | 5 s | escalate |
| 2 | `SIGTERM` the validated pid | 5 s | abort |
| 3 | No further signal | — | leave old running, start nothing, exit 1 |

- A Linux zombie (`ps -o stat=` starts with `Z`) is treated as exited.
- The old instance must be confirmed gone before launch (FR-008).
- `SIGKILL` is never used.

## Relaunch policy

| Input | Behavior |
|-------|----------|
| `argv` recoverable, `cwd` exists | `cd "$cwd"` and start `BIN_DST` with `argv[1..]` |
| `argv` recoverable, `cwd` missing | treat launch context as unrecoverable; ask, or start in `$HOME` only with explicit consent, and say so |
| `argv` missing | ask (interactive) or, with explicit `--restart`, start `BIN_DST` bare and say so |
| Install mode `copy` | start `BIN_DST` (the installed copy) |
| Install mode `symlink` | start `BIN_DST` (the symlink), so a later rebuild is picked up the same way |

Detachment: use `setsid` when present, otherwise `nohup`, with stdin/stdout/stderr
redirected to `/dev/null`. The installer must be able to exit without taking the
new app down.

## Failure matrix

| Failure | Old instance | New instance | Exit |
|---------|--------------|--------------|------|
| Build fails | untouched | none | non-zero (existing behavior) |
| Install/copy fails | untouched | none | non-zero (existing behavior) |
| No instance | none | none (next launch) | 0 |
| Declined / non-interactive | untouched | none | 0 |
| Dev instance, no confirmation | untouched | none | 0 |
| Lock held by live installer | untouched | none | 0 |
| Old instance ignores `--quit` and `SIGTERM` | still running | none | 1 |
| New process fails to start | gone | none | 1 |
| New process starts but no record within 5 s | gone | running | 0 (warning) |
