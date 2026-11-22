# Contract: Changed `_ai` report (Tauri commands)

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

Two read-only commands and one event connect the webview to git state. They carry
paths and metadata only; no document content is returned and no file, index or
repository state is written.

## Command: `list_changed_ai_documents`

```ts
invoke<ChangedAiReport>("list_changed_ai_documents", { scope });
```

### Request

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `scope` | `string \| null` | yes | `null` = all watched repositories. Otherwise an absolute path; validated (non-empty, ≤ 4096 bytes, no NUL, absolute after the caller resolved it against its cwd) |

The command ignores no other input. The watch set is **not** a parameter: Rust
snapshots the authoritative live roots and excludes from `WatcherState`
(config roots plus session CLI folders), which is what FR-020 requires.

### Response

```ts
interface ChangedAiReport {
  scope: { requested: string; repository: string } | null;
  scopeError: string | null;
  watchedRoots: number;
  aiFolders: number;
  repositories: ChangedRepository[];
  gitAvailable: boolean;
  discoveryTruncated: boolean;
}

interface ChangedRepository {
  root: string;
  documents: ChangedDocument[];
  error: string | null;
  errorCode:
    | "git-missing"
    | "timeout"
    | "output-limit"
    | "unreadable"
    | "not-a-repository"
    | null;
}

interface ChangedDocument {
  path: string;
  repositoryRoot: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  modifiedTime: number | null;
}
```

Schemas and invariants are in [data-model.md](../data-model.md). The response is
deterministically ordered by `repository.root` and then by `path`; the webview
re-sorts by modification time. An entry may describe a watched `_ai` folder that
could not be resolved to a work tree; it then has no documents and a
`not-a-repository` / `unreadable` error, which is how FR-018's "name the affected
repository or path" is met without dropping the folder.

### Success semantics

1. **Watched mode** (`scope === null`):
   - For every live watch root, find the enclosing work tree by walking
     ancestors for `.git` (directory or file).
   - If a root has no enclosing work tree, walk only that root for directories
     named `_ai` (hidden, editor-backup and noise directories pruned; configured
     excludes pruned; 10,000-entry budget) and resolve each to its work tree.
   - A watched `_ai` folder that still cannot be resolved is reported as a
     `repositories[]` entry with the folder as `root`, no documents, and
     `errorCode: "not-a-repository"` (or `"unreadable"` when it vanished), so the
     view names it instead of silently dropping it. A broad watched root that
     contains no `_ai` folder contributes nothing.
   - Query each distinct work tree once.
   - Keep a status entry only when it is a Markdown file with an exact `_ai`
     component, the file exists, it lies under a watched root, no configured
     exclude matches it, and no component below the repository root is hidden,
     an editor backup or a noise directory (the same rule the inventory scan
     applies, so the two views agree).
2. **Scoped mode** (`scope` is a path):
   - Canonicalize the path; use its parent when it names a file.
   - Walk ancestors for `.git`; no watch membership and no config excludes are
     required or applied.
   - Query that repository and keep Markdown entries with an `_ai` component
     that still exist and have no hidden/backup/noise component below the
     repository root.
3. Every document path is canonicalized and deduplicated; symlinked spellings
   collapse to one row.
4. Each repository is queried with:

   ```text
   git --no-optional-locks -C <root> status --porcelain=v1 -z
       --untracked-files=all --no-renames
       -- ':(glob)**/_ai/**' '_ai/**'
   ```

   with `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, and `GIT_DIR` /
   `GIT_WORK_TREE` removed from the child environment.

### Limits

| Limit | Value | On breach |
|-------|-------|-----------|
| Per-repository run time | 1.5 s | Kill the child, `errorCode: "timeout"` for that repository; other repositories still return |
| Overall run time | 1.8 s | Return completed repositories and mark the rest `timeout` |
| Captured stdout per repository | 8 MiB | `errorCode: "output-limit"` for that repository |
| Discovery walk entries (fallback only) | 10,000 | `discoveryTruncated: true`; already-found repositories still return |
| Repositories | One entry per distinct work tree or unresolved watched `_ai` folder; the existing 256-root cap bounds the watch set | No document rows are truncated |

There is deliberately **no** document-count limit (FR-022).

### Error response

A command-level failure is a typed `CommandError`:

| Code | Cause |
|------|-------|
| `invalid` | `scope` is empty, longer than 4096 bytes, contains NUL, or is not absolute |
| `internal` | The watcher state lock is poisoned (retryable by a later refresh) |

Per-repository problems are **not** command errors; they are rows in
`repositories[]` with `error`/`errorCode`, so one failure never hides the rest
(FR-016, SC-008). `gitAvailable: false` means the executable could not be
spawned at all.

### Read-only guarantee

- Only `git status` is executed. There is no `add`, `commit`, `diff`, `revert`,
  `checkout`, `fetch` or branch operation.
- `--no-optional-locks` / `GIT_OPTIONAL_LOCKS=0` prevents git from refreshing
  `.git/index` opportunistically.
- Documents are opened with `stat` and filesystem metadata only; the command
  never reads content.
- No shell, no command string built from a path, no environment expansion
  (FR-019, FR-021).

### Blocking behaviour

The command wrapper runs the work on `tauri::async_runtime::spawn_blocking`, like
`load_watches`. The webview paints its loading state synchronously before
awaiting, so the 100 ms feedback goal is met independently of git.

## Command: `startup_changed_scope`

```ts
invoke<string | null>("startup_changed_scope");
```

Returns the absolute scope path when this process was launched with `--changed`
(its optional path or the process cwd), otherwise `null`. Uses the same parser as
`startup_paths` and the single-instance callback. Additive command; existing
`startup_paths` behaviour and payload are unchanged.

## Event: `changed-ai-cli`

```ts
interface ChangedAiCliPayload {
  /** Absolute scope path; null only for a bare --changed resolved against cwd. */
  path: string | null;
}

await listen<ChangedAiCliPayload>("changed-ai-cli", (event) => { ... });
```

Emitted by the single-instance callback when a second invocation carries
`--changed`. The same callback still emits `open-path-cli` for any remaining
document/folder arguments, then shows, unminimises and focuses the main window —
including when only `changed-ai-cli` was emitted (FR-012).

Ordering: `changed-ai-cli` is emitted before the focus call; `open-path-cli`
entries are emitted as today. The webview may receive both; it opens each
document/folder and rescopes the changed view. It never opens a document merely
because the changed view was rescoped (FR-008).

## Validation (Rust re-validates the untrusted webview)

- `scope`: length and NUL checks before touching the filesystem; canonicalization
  failure is not an error (the report names the path).
- Root and repository paths come from the backend itself, never from the
  webview.
- Git output is parsed as NUL-delimited records; paths are treated as opaque
  bytes-to-string data, never evaluated, expanded or passed to a shell.
- Output, time and discovery budgets are enforced before the response is built.
