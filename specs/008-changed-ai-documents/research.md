# Phase 0 Research: Changed `_ai` Documents

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

All `NEEDS CLARIFICATION` items from the plan's Technical Context are resolved
here. The spec's Clarifications session already settled user-visible semantics;
this document settles how they are obtained safely and testably.

## D1. Git access lives in Rust behind a supervised subprocess

**Decision**: A new Rust module runs the user's `git` binary with
`std::process::Command`, an explicit argument vector, piped stdio and a
per-repository deadline. The command shape is:

```text
git --no-optional-locks -C <repository> status
    --porcelain=v1 -z --untracked-files=all --no-renames
    -- ':(glob)**/_ai/**' '_ai/**'
```

The child gets `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0` and a scrubbed
`GIT_DIR`/`GIT_WORK_TREE` so an inherited shell cannot point it at another
repository. Output is read on a helper thread with an 8 MiB cap, the child is
polled with `try_wait` until its deadline, and a child that overruns is killed
and reported as a timeout.

**Rationale**: The constitution puts process/filesystem concerns in Rust and
forbids the webview from shelling out. `--porcelain=v1 -z` is stable, machine
oriented and NUL-delimited, so paths with spaces or non-ASCII characters need no
unquoting. `--no-renames` turns a rename into a delete plus an add, which is
exactly the spec's "report the new path, skip the deleted one", and avoids
porcelain's second rename path field. `-uall` is required because the default
collapses untracked directories, hiding individual documents. The pathspec
restricts work to `_ai` while plain Rust filtering stays as defence in depth.
`--no-optional-locks` (equivalently `GIT_OPTIONAL_LOCKS=0`) prevents `git status`
from opportunistically rewriting `.git/index`, preserving the read-only promise.

**Spike result (2026-11-22, git 2.56)**: the exact command was run against a
throwaway repository. It listed root-level `_ai/backlog/tracked.md` (`MM`),
`_ai/backlog/new.md` (`??`) and nested `pkg/sub/_ai/x/deep.md` (`??`), and it
excluded `other/` and non-Markdown siblings. A tracked rename reported
`A  _ai/backlog/moved.md` and `D  _ai/backlog/tracked.md`, so the new path is the
one kept. The `.git/index` mtime was identical before and after a run with
`--no-optional-locks`, confirming the read-only claim.

**Alternatives considered**:
- *Dependency on a Rust git library (`gix`/`git2`)*: adds a large dependency and
  duplicates the reader's configured git behaviour (ignore rules, safe
  directories, worktree support). Rejected; the spec assumes the installed git.
- *A shell string (`sh -c "git status ..."`)*: violates FR-021 and the
  constitution's no-shell rule. Rejected.
- *No pathspec, filter only in Rust*: correct but reads the whole change set of
  a busy repository. Rejected in favour of a pathspec plus Rust filtering; a
  real-git fixture test proves both root-level and nested `_ai` matches.
- *`git status --porcelain=v2`*: richer, but its header records add parsing
  surface without benefit for three flags and a path.

## D2. Repository discovery uses the live watch set, with a bounded fallback

**Decision**: The command snapshots `WatcherState::all_roots()` (config roots
plus session CLI folders) and `WatcherState::excludes()`. For each root it walks
ancestors looking for a `.git` directory or file. A root inside a work tree maps
to that work tree; a root with no enclosing repository triggers a bounded
`walkdir` search for directories named `_ai` (hidden/noise/excluded subtrees
pruned, 10,000-entry budget). A CLI scope path resolves through the same
ancestor walk, but ignores the watch set for inclusion.

**Rationale**: This satisfies FR-020 without a new registry: the backend already
owns the authoritative watch roots. Typical configurations use selectors such as
`~/devel/*/_ai`, so roots are `_ai` folders inside repositories and resolve in
one ancestor walk. The fallback covers a broad root such as `~/notes` that is
not itself a repository but contains project repositories; its bound and
truncation flag keep the work predictable. A watched `_ai` folder that resolves
to no work tree is reported as a named entry rather than dropped, so the reader
sees which folder is outside git. `.git` as a file covers worktrees and
submodules without invoking git for discovery.

**Alternatives considered**:
- *Walking every watched root on every refresh*: a second full scan per refresh
  breaks the 2 s budget on large trees. Rejected.
- *Deriving folders only from the inventory in the webview*: misses a watched
  `_ai` folder with no Markdown documents and couples the backend domain to a
  view model. The inventory is not used for discovery.
- *`git rev-parse --show-toplevel` per root*: more process spawns, and it fails
  on Windows when git's safe-directory rules apply. An ancestor `.git` check is
  deterministic and cheaper.

## D3. Watched-scope inclusion requires a watched root; scoped mode does not

**Decision**: In watched mode a document is included only when it is a Markdown
file with an `_ai` path segment, exists on disk, lives under at least one watched
root, is not matched by a configured exclude, and has no hidden, editor-backup or
noise component below the repository root (the inventory scan's rule). In
`--changed <path>` mode the inclusion rule is "under the scoped repository root
and under an `_ai` segment"; the watch set and excludes are not applied, because
the repository need not be watched.

**Rationale**: Running status at the repository root must not surface `_ai`
documents elsewhere in the same repository that the reader does not watch, and
configured excludes express what "watched" means. The scoped repository is an
explicit request, so its whole `_ai` tree is the scope. Git-ignored files are
already absent from status, matching the spec's "git's view" assumption.

**Alternatives considered**:
- *Only `_ai` + extension filtering*: lists unwatched and excluded documents.
  Rejected.
- *Applying the watch set to the scope path*: contradicts FR-011 ("need not
  already be watched"). Rejected.

## D4. CLI flag parsing is one pure function used by every launch path

**Decision**: Extend `paths.rs` with `parse_cli(args, cwd) -> CliRequest
{ entries, changed, warnings }` and route `startup_paths`, the new
`startup_changed_scope` command and the single-instance callback through it.

Rules:
- `--changed=<path>` sets the scope from the value.
- `--changed` consumes the next argument as its scope when that argument does not
  start with `-`; otherwise the scope is `cwd`.
- The consumed scope path is never classified as a document or folder.
- Remaining non-flag arguments keep today's canonicalization and warning
  behaviour. `--quit` keeps precedence in `run()`.
- A relative scope resolves against the caller's `cwd` (the second shell's
  directory, matching the existing path-forwarding rule).
- A scope that cannot be canonicalized is forwarded verbatim with a stderr
  warning, so the view can name it in its "no repository" state (FR-018).

**Rationale**: One parser prevents the startup and second-instance paths from
disagreeing about what opens and what scopes. Optional-value consumption is the
conventional POSIX shape for `--flag [path]` and keeps the flag alone usable.
Printing warnings before `detach_from_terminal` preserves today's guarantee that
a typo is visible.

**Alternatives considered**:
- *A CLI parsing crate (`clap`)*: a new dependency for one flag, and it would
  re-parse the existing positional arguments with different rules. Rejected.
- *Only `--changed=<path>`*: contradicts the spec's `--changed <path>` examples.
- *Consuming every following path as scope*: would swallow normal document
  arguments and break US3 scenario 5. Rejected.

## D5. Second-instance forwarding uses the existing single-instance plugin

**Decision**: In the plugin callback, emit `changed-ai-cli` with
`{ path: string | null }` when the flag is present, then emit the remaining
`open-path-cli` entries and focus the window (including when only the changed
flag arrived). At startup the webview calls `startup_changed_scope()` and opens
the view after the initial documents are opened.

**Rationale**: The plugin already forwards argv and the caller's cwd and exits
the second process, which is exactly FR-012 and SC-007. A separate event keeps
the existing path event's payload typed and unchanged.

**Alternatives considered**: An HTTP/socket control channel (new surface and
permissions) and reusing `open-path-cli` with an optional field (would force
every existing listener to branch). Rejected.

## D6. `--changed` backgrounds a release build even without a terminal

**Decision**: Extend `detach::should_detach` to take "a changed view was
requested" into account: release builds detach when a terminal is attached (as
today) or when `--changed` is present; debug builds and `DOCDECK_FOREGROUND=1`
stay attached. Windows release already runs as a GUI subsystem process and
returns immediately.

**Rationale**: FR-023/SC-011 require an agent invocation with no terminal to
return promptly. Today a release build started from a non-tty (a script, an agent
tool) would stay in the foreground for the window's lifetime. Restricting the new
rule to `--changed` keeps ordinary terminal launches unchanged.

**Alternatives considered**: Always detaching without a terminal (changes
existing behaviour and hides startup errors for normal launches); a dedicated
`--daemon` flag (extra surface for the same outcome).

## D7. The view is a transient extension of the browse-mode union

**Decision**: Keep `BrowseMode = "all" | "recent" | "bookmarks"` as the persisted
type. Add `BrowseView = BrowseMode | "changed"` in `sidebar-model.ts`, used only
by sidebar state, mode highlighting and `main.ts`. Selecting the changed entry
does not write `preferences.browseMode`; selecting any other entry writes it as
today. `preferences.isBrowseMode` continues to reject `"changed"`, so a corrupted
or hand-edited stored value falls back to the default.

**Rationale**: FR-009 requires the view to be transient and a restart to return
to the saved mode. A separate union makes that impossible to break accidentally
and keeps the storage contract untouched (G7 passes without an amendment).

**Alternatives considered**: Adding `"changed"` to `BrowseMode` and clearing it
on load (easy to regress, and it would widen the persisted schema); a boolean
`changedActive` beside `browseMode` (two sources of truth for one highlighted
mode).

## D8. The refresh action is `Ctrl`/`Cmd`+`Shift`+`R`

**Decision**: Register `{ id: "refresh-changed", key: "r", modifier: "ctrlOrCmd",
shift: true }` in `FIXED_SHORTCUTS`, add a toolbar refresh button in the changed
view, and list both in the shortcut reference under a new **Changed `_ai`** group
alongside a literal `Enter`/`Space` row-activation entry. The global handler
calls `preventDefault` so the webview's own reload chord never fires.

**Rationale**: It reads as "refresh", is free in the registry and in
`find-bar.ts`, and satisfies FR-014/SC-010. Checked against the existing fixed
set (`Ctrl+D`, `Ctrl+Tab`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+\``, `Ctrl+F`) and
feature 006's proposed copy chord (`Ctrl+Shift+C`).

**Alternatives considered**: `F5` (browser reload on WebKitGTK and
inconsistent on macOS), `Ctrl+R` (webview reload), `Ctrl+Shift+G` (reads as
"find previous", weak semantics).

## D9. The changed list gets its own windowed renderer and row anatomy

**Decision**: Add a dedicated `VirtualList<ChangedRow>` with its own scroll host
and a taller row height (~56 px), rather than extending the inbox list's union
type. Rows are one focusable activation button plus non-interactive metadata
(project chip, filename, `_ai`-relative context, badges, `<time>`). No close,
star or dismiss controls and no context menu.

**Rationale**: FR-025 forbids the browse row's actions, and the existing browse
list binds middle-click dismissal, a star click handler and an index-based
context menu that would all have to be branched. A separate list keeps the
existing modes untouched and still virtualizes 500+ rows (FR-022, SC-002).

**Alternatives considered**: Reusing the inbox `VirtualList` with a union item
type (branching every handler and risking regressions in three modes); an
unvirtualized list (fails the 500-row responsiveness requirement and the
constitution's virtualization rule).

## D10. State machine, filtering and staleness live in the controller/model

**Decision**: `changed-ai-controller.ts` holds `{ scope, status, report,
requestedAt }`, runs exactly one request at a time, tags each request with a
generation, and discards results from superseded generations. It exposes
`activate(scope?)`, `refresh()`, `showAllRepositories()` and
`notifyWatchesSettled()`. `changed-ai-model.ts` derives rows and selects one
explicit state from the report and the visible rows. The shared filter is applied
in `main.ts` with the existing `filterEntries` before the model derives
counts/empty copy.

**Rationale**: Activating, CLI rescoping and refresh can race; a generation
guard is the same pattern the app already uses for config reloads. Keeping the
filter outside the controller means changing the filter never re-runs git and
never changes order (FR-006).

**Alternatives considered**: Letting the sidebar own request state (DOM
controller would need Tauri); filtering in Rust (a keystroke would re-run
git); a promise-chain lock without generations (late results can still paint).

## D11. States, copy and accessibility

**Decision**: Render these states explicitly, each naming its subject:

| State | Copy and action |
|-------|-----------------|
| Loading | "Reading git status in N repositories…" with `aria-busy="true"` |
| Ready | Rows, plus a quiet "N changed `_ai` documents" count |
| Empty, repositories exist | "No uncommitted `_ai` documents in N repositories." + **Refresh** |
| No repository found | "No watched `_ai` folder is inside a git repository." + **Refresh** and the watch-configuration hint |
| Watched folders exist, none readable | Per-repository messages, no silent blank panel |
| Partial error | Rows stay plus a banner naming each failing repository and its reason |
| Scope error | "No git repository contains `<path>`." + **Show all watched repositories** |
| Git missing | "git is not installed or could not be started." + **Refresh**; documents still open |

The state panel is a `role="status"` live region, the list sets
`aria-busy` while loading, badges carry text (never colour alone), the
`<time>` element carries `datetime` and an exact-time title, and every control is
a native button with an accessible name. Filter counts go through the existing
visually-hidden live region.

**Rationale**: FR-016–FR-018, FR-024 and SC-012 ask for state-specific,
AT-readable feedback; the app already uses native controls, `aria-pressed` mode
buttons and a hidden filter count.

**Alternatives considered**: A single generic error banner (cannot distinguish
"no `_ai` folder in a repo" from "nothing uncommitted"); an ARIA grid/treegrid
(more announcement complexity than the flat list needs).

## D12. Order and identity are computed once, deterministically

**Decision**: Rust canonicalizes and dedupes document paths (symlinks resolved,
Windows case-insensitive comparison) and returns each path once. The webview
orders rows by `modifiedTime` descending with `path.localeCompare` as the
tiebreaker; documents without a mtime sort last. Project labels come from the
existing `projectName` (`_ai` segment) with the repository basename as fallback;
path context is the path relative to the deepest `_ai` segment.

**Rationale**: FR-003, FR-005 and the spec's edge cases for symlinks, worktrees
and nested repositories. Canonicalization in Rust prevents the same file
appearing under two spellings; sorting in the webview keeps the pure model
testable and matches existing sidebar ordering. The spec says "grouped visually
by project" in US1 but clarifies "merged into one list and labeled by project";
FR-005's global newest-first order makes project header rows impossible, so the
project chip is the label (the same convention All documents uses).

**Alternatives considered**: Sorting in Rust (the view would still need to
re-sort after filtering, and tests would be split across two runtimes); using
git's ordering (undefined and not newest-first); project header rows (would break
the global newest-first requirement).

## D13. One refresh when startup watches settle

**Decision**: Track `scansInFlight` (already present). If the changed view
activates while a scan is in flight, it shows its loading state and the
controller sets one `refreshOnSettle` flag; `main.ts` calls
`notifyWatchesSettled()` when the counter reaches zero, and the controller
performs a single refresh. No timer, interval or watcher-event refresh is added.

**Rationale**: A cold `docdeck --changed` can run before `load_watches` has
published roots; without this, the view would briefly claim there is no `_ai`
folder. One event-driven follow-up keeps FR-014 honest without polling.

**Alternatives considered**: Blocking activation until the scan finishes (breaks
SC-003 and the prompt-hand-off requirement); refreshing on every watcher event
(out of scope and expensive).

## D14. Bounded output and one repository must never hide another

**Decision**: Each repository runs in its own worker thread, bounded by the
existing 256-root configuration cap. Results arrive over a channel; the
aggregator waits until the 1.8 s overall deadline, taking whatever has completed
and marking the rest as timed out. A per-repository 1.5 s deadline kills a hung
child. Per-repository stdout is capped at 8 MiB and a cap breach becomes that
repository's error.

**Rationale**: FR-016 (partial error), SC-008 and the performance goals. Threads
plus a channel avoid a hung repository serializing the whole list, and no new
dependency is needed for timeouts.

**Alternatives considered**: `wait_with_output` in sequence (one hang blocks
every later repository); a `wait-timeout` crate (new dependency); ignoring the
result entirely (cannot distinguish timeout from an empty repository).
