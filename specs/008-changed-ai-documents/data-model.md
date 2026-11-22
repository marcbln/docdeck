# Phase 1 Data Model: Changed `_ai` Documents

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

Everything in this feature is derived or session-scoped. No new persisted store,
record, index or cache is introduced; the only durable inputs are git's index,
the watched files and the existing watch configuration, none of which this
feature writes.

Wire structs serialise with `#[serde(rename_all = "camelCase")]`, matching
`WatchLoad` and `WatchAdded`.

## Entity: ChangedDocument (derived, transient)

One uncommitted Markdown document under an `_ai` segment, as produced by git
status and verified against the filesystem.

| Field | Type | Required | Derivation / validation |
|-------|------|----------|-------------------------|
| `path` | `string` | yes | Canonical absolute path; symlinks resolved; duplicate spellings collapse to one path |
| `repositoryRoot` | `string` | yes | Canonical work-tree root that produced the status |
| `staged` | `boolean` | yes | Index column `X` is neither a space nor `?`; false for untracked |
| `unstaged` | `boolean` | yes | Work-tree column `Y` is neither a space nor `?`; false for untracked |
| `untracked` | `boolean` | yes | Porcelain `??` |
| `modifiedTime` | `number \| null` | yes | Filesystem mtime in epoch milliseconds; `null` when stat fails, which sorts last |

**Invariants**
- A path appears at most once across the whole report, even with staged *and*
  unstaged edits or two watched roots that resolve to the same repository.
- `staged`, `unstaged` and `untracked` are not mutually exclusive except that
  `untracked` excludes the other two.
- Deleted paths never appear: status rows whose path does not exist on disk are
  dropped (`D`, `AD`, `DD`, and the old side of a rename).
- Only Markdown files are present; only paths with an exact `_ai` component are
  present.
- No content, size, unread flag, bookmark state or acknowledgement is carried.

**Change-state truth table**

| Porcelain `XY` | staged | unstaged | untracked | Listed |
|----------------|--------|----------|-----------|--------|
| `??` | false | false | true | yes, if the file exists |
| `M ` / `A ` / `C ` | true | false | false | yes |
| ` M` / `MM` | per column | per column | false | yes |
| `D ` / ` D` / `AD` / `DD` | — | — | — | no (path absent) |
| `UU` / `AA` | true | true | false | yes (both badges) |

## Entity: ChangedRepository (derived, transient)

One git work tree queried for this snapshot.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `root` | `string` | yes | Canonical work-tree root; unique per report |
| `documents` | `ChangedDocument[]` | yes | Sorted by path in Rust; the view re-sorts by mtime |
| `error` | `string \| null` | yes | Human-readable failure for this repository |
| `errorCode` | `"git-missing" \| "timeout" \| "output-limit" \| "unreadable" \| "not-a-repository" \| null` | yes | Lets the view choose recovery wording |

**Invariants**
- A repository with `error != null` still has an entry; it is never dropped from
  the report.
- `documents` is empty when `error != null`.
- One repository root is queried exactly once per refresh.
- An entry may describe a watched `_ai` folder that could not be resolved to a
  work tree: `root` is then that folder, `documents` is empty, and `errorCode` is
  `not-a-repository` or `unreadable`. It exists so the view can name the folder
  (FR-018) and still distinguish "no `_ai` folder is in a repository" from
  "repositories exist but nothing is uncommitted".

## Entity: ChangedAiReport (transient command result)

The complete answer to one refresh. It carries no UI state.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `scope` | `{ requested: string, repository: string } \| null` | yes | Present only for a successful CLI/scoped request |
| `scopeError` | `string \| null` | yes | Set when a requested scope has no repository; names the path |
| `watchedRoots` | `number` | yes | Live watch-root count the snapshot used |
| `aiFolders` | `number` | yes | Watched `_ai` folders discovered (including nested fallback) |
| `repositories` | `ChangedRepository[]` | yes | Deterministic order by root |
| `gitAvailable` | `boolean` | yes | False when the git binary could not be started |
| `discoveryTruncated` | `boolean` | yes | The bounded fallback walk stopped at its entry budget |

**Invariants**
- `scopeError != null` implies `scope == null` and `repositories == []`; the
  view must not claim there are no changes in that case.
- `aiFolders == 0` and `repositories == []` is the "no `_ai` folder in a
  repository" case; `aiFolders > 0` with `repositories == []` is the
  "watched `_ai` folders are not inside a repository" case.
- `gitAvailable == false` implies every attempted repository reports `git-missing`
  (or the list is empty); the view names the missing tool.
- No field is ordered by time in Rust; ordering is a view concern.

## Entity: ChangedRow (view model, transient)

The flat row the virtual list renders.

| Field | Type | Notes |
|-------|------|-------|
| `path` | `string` | Identity; also the tab key when opened |
| `filename` | `string` | `fileName(path)`; used by the shared filter |
| `project` | `string \| null` | `projectName(path)`, fallback repository basename |
| `context` | `string` | Path relative to the deepest `_ai` component, e.g. `backlog/261122__plan.md` |
| `staged`, `unstaged`, `untracked` | `boolean` | Badge source |
| `modifiedTime` | `number \| null` | Newest-first key; null last |
| `repositoryRoot` | `string` | Used for the error/scope banner and the full-path title |

**Invariants**
- One row per canonical path.
- No `unread`, `bookmarked`, `dismissed` or `deleted` field exists, by design
  (FR-025).
- `context` is never empty for a valid row; it may repeat across projects, in
  which case the project chip and full-path title disambiguate.

## Entity: ChangedScope (session state)

| Variant | Shape | Set by | Cleared by |
|---------|-------|--------|------------|
| All watched repositories | `{ kind: "all" }` | First activation, mode click with no prior scope, **Show all watched repositories**, restart | — |
| One repository | `{ kind: "repository", requestedPath: string, root: string \| null }` | `--changed [path]` at startup or via the running window | **Show all watched repositories**, restart |

**Invariants**
- Scope is never written to preferences, `localStorage` or the instance record.
- A failed scope resolution is still remembered as the requested path so the
  error state can name it and offer the return action.
- Rescoping replaces the previous scope atomically; there is exactly one scope
  per session.

## Entity: ChangedViewState (session state machine)

```text
                         activate / refresh
        idle ──────────────────────────────────> loading
          ▲                                         │
          │ leave mode                              │ report (generation current)
          │                                         ▼
          │                              ┌── scopeError ──────> scope-error
          │                              ├── !gitAvailable ────> error
          │                              ├── rows > 0 ─────────> ready (partial banner if errors)
          │                              ├── aiFolders == 0 ───> no-repository
          │                              ├── repositories == 0 ─> no-repository
          │                              └── otherwise ────────> empty
          │                                         │
          └─────────────────────────────────────────┘
                       refresh (endpoint states stay painted while
                       `refreshing` overlays a status; rows are kept)
```

| Field | Type | Notes |
|-------|------|-------|
| `status` | `"idle" \| "loading" \| "refreshing" \| "ready" \| "empty" \| "no-repository" \| "partial" \| "error" \| "scope-error"` | Derived, never persisted |
| `rows` | `ChangedRow[]` | Unfiltered; `main.ts` applies the shared filter at paint time |
| `repositories` | `ChangedRepository[]` | For counts and banners |
| `scope` | `ChangedScope` | Session scope |
| `scopeError` | `string \| null` | From the report |
| `gitAvailable` | `boolean` | From the report |
| `discoveryTruncated` | `boolean` | From the report |
| `loadedAt` | `number \| null` | Injected clock; drives "Refreshing…" and relative times |
| `generation` | `number` | Internal; results from earlier generations are dropped |
| `refreshOnSettle` | `boolean` | Internal one-shot flag for the startup scan |

**Invariants**
- `status === "idle"` only before the first activation and after leaving the
  view; leaving the view discards nothing, so re-entering repaints the same
  snapshot until the activation refresh completes.
- A refresh never mutates tabs, the active document, scroll positions, unread
  flags, acknowledgements or bookmarks.
- Activating a row is a document action, not a view-state transition: the row
  stays in the snapshot and the view stays selected.
- Filtering is not a state transition; `ready` with zero visible rows renders the
  shared "no documents match" copy.

## Entity: CliRequest / ChangedScopeRequest (transient)

| Field | Type | Notes |
|-------|------|-------|
| `entries` | `CliEntry[]` | Existing document/folder arguments, unchanged shape |
| `changed` | `string \| null` | Absolute scope path: supplied value, or `cwd` for a bare `--changed`; `null` when the flag is absent |
| `warnings` | `string[]` | Unresolvable positional or scope paths, printed before detaching |

**Invariants**
- The consumed scope path never also appears in `entries`.
- `changed` is non-null only when the flag is present.
- `--quit` is handled before this request and is never turned into an entry.

## Relationships

```text
WatcherState (roots, excludes) ─┐
git status per repository ──────┼─> ChangedAiReport ─> ChangedRow[] ─> SidebarPanel
CLI scope path ─────────────────┘         │
                                          └─> ChangedViewState ─> state panel + banners
```

## Deletion and lifecycle

- Leaving the changed mode keeps the last snapshot in memory for the session so
  re-entering paints instantly, then refreshes.
- Restart discards the snapshot, the scope and the mode; preferences restore the
  previously saved browse mode (SC-009).
- Nothing in this model has a save path; there is no storage codec to corrupt.
