---
id: changed-ai
title: Changed `_ai` documents view
type: context
updated: 2026-11-22
related:
  - ADR__261122-1__git-status-changed-ai-view
---

# Changed `_ai` documents view

## Purpose

One transient fourth browse mode beside **All documents**, **Recently changed**
and **Bookmarks**. It answers "what `_ai` work is uncommitted right now across
my watched repositories?" without writing anything, opening anything, or
changing the saved browse mode.

## Commands and events

- `list_changed_ai_documents(scope?: string | null)` → `ChangedAiReport`.
  - `scope` is `null` for every watched repository, otherwise an absolute path
    (validated: non-empty, ≤ 4096 bytes, no NUL, absolute).
  - Rust snapshots `WatcherState::all_roots()` and `excludes()`; the webview
    never supplies the watch set.
  - Runs on `spawn_blocking`; a poisoned watch registry returns a typed
    `internal` `CommandError`.
- `startup_changed_scope()` → `string | null`. The `--changed` scope for this
  process, parsed by the same `paths::parse_cli` as `startup_paths`.
- `changed-ai-cli` event `{ path: string | null }`. Emitted by the
  single-instance callback before showing/focusing the window, then the normal
  `open-path-cli` entries are emitted.

`paths::parse_cli(args, cwd) -> CliRequest { entries, changed, warnings }` is the
single parser for startup and second-instance launches. `--changed=<path>` and
`--changed <path>` set the scope; a consumed path is never opened; a relative
scope resolves against the caller's cwd; an unresolvable scope is forwarded with
a warning so the view can name it.

## Report shape

`ChangedAiReport` (`#[serde(rename_all = "camelCase")]`):

| Field | Meaning |
|-------|---------|
| `scope` | `{ requested, repository }` when a CLI scope resolved |
| `scopeError` | requested path when no repository contains it |
| `watchedRoots` | live watch-root count used |
| `aiFolders` | watched `_ai` folders discovered |
| `repositories` | one entry per distinct work tree, ordered by `root` |
| `gitAvailable` | false when `git` could not be spawned |
| `discoveryTruncated` | the fallback walk hit its 10,000-entry budget |

Each `ChangedRepository` carries `root`, `documents[]`, `error` and `errorCode`
(`git-missing`, `timeout`, `output-limit`, `unreadable`, `not-a-repository`).
Each `ChangedDocument` carries `path`, `repositoryRoot`, `staged`, `unstaged`,
`untracked` and `modifiedTime` (epoch ms or `null`). A repository error is a row,
never a command error, so one failure cannot hide the others.

Rust canonicalizes and dedupes document paths. The view flattens the report into
`ChangedRow[]`: one row per path, `project` from `projectName` with the
repository basename as fallback, `context` below the deepest `_ai`, newest
`modifiedTime` first with `path.localeCompare` as the tiebreaker and `null` last.

## Session state

- `ChangedScopeState` is `{ kind: "all" }` or
  `{ kind: "repository", requestedPath, root }`. It is never persisted.
- `ChangedAiController` owns `{ active, scope, status, report, snapshot,
  loadedAt, generation, inFlight, refreshOnSettle }` with an injected loader and
  clock. Repeated activation/refresh shares one in-flight request; a rescope
  starts a new generation and the old result is dropped.
- Refresh triggers: first activation, re-activating the mode entry, the toolbar
  **Refresh**, `Ctrl`/`Cmd`+`Shift`+`R`, and one automatic refresh when startup
  scans settle **if** activation happened while a scan was in flight. There is no
  timer, interval or watcher-event refresh.
- Row activation opens/focuses a document and deliberately does not touch the
  controller state, the mode, or other rows.

## State matrix

`selectChangedState` checks in this order:

1. `scopeError != null` → `scope-error` (no scope, no rows).
2. `gitAvailable === false` → `error`.
3. rows > 0 → `ready`, or `partial` when any repository has an error.
4. no rows but any repository error → `partial` (errors only).
5. `aiFolders === 0` → `no-repository`.
6. `repositories.length === 0` → `no-repository` (watched `_ai` outside git).
7. otherwise → `empty`.

`loading`/`refreshing` are controller overlays. A refresh keeps the previous rows
painted. A filtered-to-nothing list uses the shared "No documents match" copy,
not a git message. `discoveryTruncated` appends a warning to the state panel.

## Read-only boundary

- Only `git status` runs, via `std::process::Command` with an argument vector:
  `--no-optional-locks -C <root> status --porcelain=v1 -z
  --untracked-files=all --no-renames -- ':(glob)**/_ai/**' '_ai/**'`.
- `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, and `GIT_DIR`/`GIT_WORK_TREE`
  are removed from the child environment. No shell, no expansion.
- Limits: 1.5 s per repository, 1.8 s aggregate, 8 MiB stdout, 10,000 discovery
  entries. There is no document-count limit.
- Documents are opened with `stat` only; content is never read by this feature.
  No file, index, preference, instance record or bookmark is written.

## Implementation

`src-tauri/src/changed_ai.rs` (discovery, supervisor, porcelain parser, report,
command), `src/changed-ai-model.ts` (rows and states), `src/changed-ai-controller.ts`
(session lifecycle), `src/changed-ai-rows.ts` (DOM builders),
`src/sidebar-panel.ts` (fourth mode), `src/main.ts` (wiring, shortcut, CLI event).
