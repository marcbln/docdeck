---
title: Changed `_ai` view reads git status through a supervised subprocess and stays transient
status: Accepted
date: 2026-11-22
deciders: docdeck maintainer
tags: [git, changed-view, cli, single-instance, read-only, tauri]
adrId: 261122-1
---

# Changed `_ai` view reads git status through a supervised subprocess and stays transient

## Context

Agents leave uncommitted work spread across several repositories. A reader wants
one place that answers "what `_ai` Markdown is uncommitted right now?" and then
opens one of those documents, without docdeck acquiring any write or repository
management surface. Three decisions had to be made together: how repository state
is read, how the view relates to persisted browse state, and how an agent's
`docdeck --changed` reaches a window that is already open.

The constitution puts process and filesystem concerns in Rust, treats the
webview as untrusted, forbids a shell, and requires that session-scoped state is
documented and cleared on restart. The feature also must not block or mutate the
reading surface, and one slow repository must never hide another.

## Decision

**Repository state is read by a supervised `git` subprocess in Rust.** A new
module runs the user's installed `git` with `std::process::Command` and an
explicit argument vector:

```text
git --no-optional-locks -C <root> status --porcelain=v1 -z
    --untracked-files=all --no-renames -- ':(glob)**/_ai/**' '_ai/**'
```

The child gets `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, and a scrubbed
`GIT_DIR`/`GIT_WORK_TREE`. No shell or command string is built from a path. Each
repository runs on its own worker against a 1.5 s kill deadline; results are
aggregated until 1.8 s, stdout is capped at 8 MiB, and the fallback `_ai`
discovery walk is capped at 10,000 entries. A failure becomes that repository's
typed row (`git-missing`, `timeout`, `output-limit`, `unreadable`,
`not-a-repository`), never a command-level error, so one repository cannot hide
another. Only `stat` is used for modification times; document content is never
read by this feature. `--porcelain=v1 -z` gives NUL-delimited paths without
quoting, and `--no-renames` turns a rename into a delete plus an add so the
existing path is the only one kept.

**The view is transient and never persisted.** `BrowseMode` stays
`"all" | "recent" | "bookmarks"`. A separate `BrowseView = BrowseMode | "changed"`
is used only by sidebar state, mode highlighting and `main.ts`. Selecting the
fourth entry does not write `preferences.browseMode`; selecting any other entry
writes it as before, and `preferences.isBrowseMode` continues to reject
`"changed"`, so a corrupted stored value falls back to the default. The scope,
rows, filter and loading state are session-only; restart returns to the saved
browse mode. Refresh triggers are bounded to activation, re-activation, the
toolbar action, `Ctrl`/`Cmd`+`Shift`+`R`, and one event-driven follow-up when the
startup scan settles — no polling and no index watching.

**CLI hand-off reuses the existing single-instance channel.** `paths::parse_cli`
parses `--changed [path]` once for `startup_paths`, `startup_changed_scope` and
the plugin callback. The second process forwards argv and its own cwd; the primary
emits a typed `changed-ai-cli` event, then the existing `open-path-cli` entries,
then shows, unminimises and focuses the window even when only the changed flag
arrived. A consumed scope path is never opened. Release builds on Unix detach
when `--changed` is present even without a terminal, so an agent invocation
returns promptly; debug builds and `DOCDECK_FOREGROUND=1` stay attached.

## Consequences

- Repository state follows the user's configured git (ignore rules, safe
  directories, worktree support) without adding a git library dependency.
- The read-only promise is mechanically testable: a real-git smoke test compares
  `.git/index` bytes before and after a report.
- A missing, slow or broken repository is visible and named instead of blanking
  the list, at the cost of a fixed 1.8 s worst-case wait when a repository hangs.
- The fallback walk only runs for a watched root outside any work tree; a broad
  root containing repositories resolves them, and its bound is reported rather
  than silently truncating.
- The webview keeps its existing pure-model discipline: row composition,
  ordering and the full state matrix are DOM-free and unit tested; the sidebar
  remains a thin DOM owner.
- No capability, permission, CSP, dependency or persisted store changes. The
  feature adds one read-only command, one startup lookup and one event.
- `--changed --quit` leaves no scope; `--quit` keeps its existing precedence.

## Alternatives Considered

- **A Rust git library (`gix`/`git2`)**: large dependency and a second
  implementation of the reader's configured git behaviour. Rejected.
- **A shell string (`sh -c "git status …"`)**: violates the no-shell rule.
  Rejected.
- **No pathspec, filtering only in Rust**: correct but reads a busy repository's
  whole change set. Rejected in favour of a pathspec plus Rust filtering.
- **`git status --porcelain=v2`**: richer records without benefit for three
  badges and a path. Rejected.
- **Adding `"changed"` to `BrowseMode` and clearing it on load**: easy to
  regress and widens the persisted schema. Rejected in favour of a separate
  view union.
- **A separate HTTP/socket control channel or reusing `open-path-cli` with an
  optional field**: new surface or forced branching in every existing listener.
  Rejected.
- **Sequence `wait_with_output` per repository**: one hang blocks every later
  repository. Rejected.
- **A new `wait-timeout` crate**: an extra dependency for logic a channel plus
  `try_wait` already covers. Rejected.

## Related Decisions

- [261019-1](ADR__261019-1__config-driven-watch-registry.md): the watch set the
  report snapshots.
- [261103-1](ADR__261103-1__upgrade-restart-via-instance-state-and-quit-channel.md):
  the instance record and quit channel the CLI reuses.
- [261024-3](ADR__261024-3__windowed-inbox-list.md): virtualization, applied to
  the changed list.
