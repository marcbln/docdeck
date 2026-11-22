# Contract: `docdeck --changed [path]`

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

One additive flag. Existing document and folder arguments, `--quit` and the
single-instance behavior keep their current semantics.

## Grammar

```text
docdeck [--changed[=<path>] | --changed [<path>]] [<document-or-folder>...] [--quit]
```

- `--changed` without a value scopes the view to the repository containing the
  caller's working directory.
- `--changed <path>` consumes the immediately following argument as the scope
  path. That argument is not opened or watched.
- `--changed=<path>` is the equivalent single-argument form.
- A `<path>` is a file or a folder; the repository containing it is used.
- Relative paths resolve against the caller's cwd — for a second invocation that
  is the second shell's directory, exactly like today's path forwarding.
- `--quit` keeps precedence: `docdeck --changed --quit` quits the running window
  and never opens the view (existing lifecycle rule).
- An absolute scope path must be no longer than 4096 bytes and contain no NUL.

### Examples

| Command (cwd = `~/devel/proj`) | Scope | Other effects |
|--------------------------------|-------|---------------|
| `docdeck --changed` | repository containing `~/devel/proj` | none |
| `docdeck --changed .` | repository containing `~/devel/proj` | none |
| `docdeck --changed ~/devel/other/_ai/plan.md` | repository containing `~/devel/other` | none |
| `docdeck --changed ../other` | repository containing `~/devel/other` | none |
| `docdeck --changed ~/devel/a ~/devel/b` | repository containing `~/devel/a` | `~/devel/b` is watched as a session folder |
| `docdeck README.md --changed` | repository containing the caller's cwd | `README.md` opens |
| `docdeck --changed` (docdeck already running) | existing window rescoped and focused | no second window or process |
| `docdeck --changed --quit` | — | the running window quits; no view opens |

## Parsing rules (Rust, `paths::parse_cli`)

1. Skip `argv[0]`.
2. `--changed=<value>` sets the scope to `<value>`.
3. `--changed` sets the scope to the next argument when that argument exists and
   does not start with `-`; otherwise to the process cwd. The consumed argument
   is removed from positional classification.
4. Other arguments starting with `-` are ignored, as today.
5. Remaining positional arguments are canonicalized into document/folder entries
   with today's warnings for unresolvable paths.
6. A relative scope is joined to cwd. If it cannot be canonicalized, the
   absolute-joined path is forwarded unchanged, with a warning on stderr before
   stdio is detached (the view then names it in its scope-error state).
7. Multiple `--changed` flags: the last one wins.

`startup_paths`, `startup_changed_scope` and the single-instance callback all
call this one function so they cannot disagree.

## Hand-off and process lifetime

### Not running

- The app starts, opens any document/folder arguments as today, and activates the
  changed view with the parsed scope. The activation happens without waiting for
  the watch scan; when watches settle, the view performs one refresh.
- Release builds on Unix detach from the terminal as today **and also detach when
  `--changed` is present without a terminal** (fork, `setsid`, stdio to
  `/dev/null`), so an agent's command returns immediately (FR-023, SC-011).
- Release builds on Windows already run as a GUI subsystem process and return
  immediately.
- Debug builds and `DOCDECK_FOREGROUND=1` stay attached, so `tauri dev` and
  Ctrl-C behave normally. This is a development-only difference.
- Errors detected before hand-off (unresolvable scope or positional path) print
  on stderr while stdio still points at the caller; they do not abort the launch.

### Already running

- The single-instance plugin forwards argv and the caller's cwd to the primary.
- The primary emits `changed-ai-cli` with `{ path }`, emits `open-path-cli` for
  any remaining document/folder entries, then shows, unminimises and focuses the
  main window.
- The second process exits successfully once the request is accepted; it never
  waits for the window to close and never creates a second window or instance
  (FR-012).
- Rescoping replaces the previous scope; the view refreshes immediately and does
  not open any document (FR-008).

## Failure behaviour

| Situation | Behaviour |
|-----------|-----------|
| Scope path does not exist | stderr warning before hand-off; the view shows its scope-error state naming the path, with **Show all watched repositories** |
| Scope path exists but is not in a git repository | the view shows "No git repository contains `<path>`." and the return action |
| `git` is not installed | the window opens, the view names the missing tool, and document reading still works |
| Path contains spaces or non-ASCII characters | passed literally; no shell interpretation, no expansion |
| Scope is too long or contains NUL | the command rejects it; the view is not scoped (the request is reported, never executed) |

## Non-goals

- No second window, no daemon mode, no watching the repository or the index.
- No write flag (`--stage`, `--commit`, `--diff`, `--revert`) and no branch or
  remote interaction.
- No persistence of the scope; a restart returns to the saved browse mode.
