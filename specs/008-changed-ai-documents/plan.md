# Implementation Plan: Changed `_ai` Documents

**Branch**: `008-changed-ai-documents` (feature identifier; the working checkout
is on `main` — setup-plan did not create a git branch) | **Date**: 2026-11-22 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-changed-ai-documents/spec.md`

**Decision record**: `_ai/technical_decisions/ADR__261122-1__git-status-changed-ai-view.md`
(written during implementation) records the three lasting choices: git status is
read through a supervised `git` subprocess in Rust, the view is transient and
never persisted, and CLI hand-off uses the existing single-instance channel.

## Summary

Add a transient fourth browse view, **Changed `_ai`**, beside All documents,
Recently changed and Bookmarks. It lists uncommitted Markdown documents under an
`_ai` path segment across every watched repository, newest modification first,
with a project chip, distinguishing path context, staged/unstaged/untracked
badges and a relative time. Activating a row opens or focuses the document; the
view itself never opens documents, never dismisses, bookmarks or acknowledges
anything, and never changes the saved browse mode.

The data comes from one new Rust command. Rust resolves the live watch set
(`WatcherState::all_roots()` plus the configured excludes), maps each watched
root to its enclosing git work tree, discovers `_ai` folders only for roots that
are not inside a repository, and runs one `git status --porcelain=v1 -z
--untracked-files=all --no-renames` per repository with a per-repository
deadline. A supervisor aggregates results until an overall 1.8 s budget, so one
slow or broken repository becomes a partial-error row instead of hiding the
others. No file is written and no shell is involved.

`docdeck --changed [path]` is parsed in Rust, forwarded to the running window
through the existing single-instance channel (or started in the background), and
scopes the view to the repository containing `path` (the caller's working
directory when omitted). The view refreshes on activation, on return to it, on
the new toolbar/shortcut refresh, and once when the startup watch scan settles.
Nothing about the view, its rows or its scope survives a restart.

## Technical Context

**Language/Version**: TypeScript 6 (`ES2020`, `strict`) on Vite 8 with vanilla DOM
and CSS; Rust 1.80+ (edition 2021) and Tauri 2.12.

**Primary Dependencies**: Existing `@tauri-apps/api` `^2`, `marked` 18,
highlight.js, Mermaid, the existing single-instance plugin and `walkdir`. No new
npm or Cargo dependency. The feature uses the user's installed `git` binary; its
absence is a recoverable, named error rather than a startup failure.

**Storage**: None. No `localStorage` key is added or changed. The view, its
scope, its rows and its loading state are session-only; `docdeck.preferences.v1`
keeps `browseMode` limited to `"all" | "recent" | "bookmarks"` and therefore
cannot restore the changed view. Snapshots are rebuilt from git on each refresh.
Watched documents and repository state are never written.

**Testing**: Vitest with `happy-dom` for the pure row/state model, the
controller and the DOM row builder; extended `sidebar-panel`,
`preferences`, `shortcuts`, `shortcut-reference` and `filter-documents` suites.
Rust `cargo test` for CLI parsing, porcelain parsing, change-state derivation,
`_ai` path filtering, repository-root discovery, per-repository isolation,
timeout and bounded-output handling, and validation; one real-`git` smoke test
is skipped when the binary is absent. Required gates: `npm run typecheck`,
`npm run test:web`, `npm test`, `npm run lint:rs`, plus the quickstart scenarios.

**Target Platform**: Linux, macOS and Windows desktop (Tauri 2 / WebKitGTK,
WKWebView, WebView2). Git path handling uses native separators through
`std::path`; `.git` may be a directory or a worktree/submodule pointer file.
Windows release builds already run as a GUI subsystem process, so CLI hand-off
returns without a fork; Unix release builds background themselves for
`--changed` even when no terminal is attached.

**Project Type**: Desktop application with a Rust service layer and a vanilla
TypeScript/DOM webview.

**Performance Goals**: The loading state paints within 100 ms of activation
(SC-003); the command resolves within a 1.8 s overall budget with ten repositories
and one thousand watched documents, reporting slow repositories as failed
instead of hanging; 500+ changed rows stay responsive through the existing
windowed renderer with no size-based row limit (FR-022); a refresh never blocks
document switching; `--changed` hand-off completes in under one second (SC-007,
SC-011).

**Constraints**: Read-only: only `git status` is executed, with argument-array
`std::process::Command` and no shell (FR-019, FR-021). Every CLI and webview
path is validated and canonicalized in Rust. Per-repository output is bounded
(8 MiB) and the fallback repository walk is bounded (10,000 entries with an
explicit truncation warning). The view performs no polling; the only automatic
re-read is the one-shot refresh when startup watches settle. No new capability,
permission, dependency or persisted store is introduced, so the constitution's
Persistence section is unchanged.

**Scale/Scope**: Real agent workspaces of up to ten repositories, 1,000 watched
documents and 500+ uncommitted `_ai` documents; one transient browse mode, one
new Tauri command plus one startup-scope command and one event, one Rust module,
three new frontend modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Boundary (P-I) | OS concerns in Rust; view state in the webview; typed command/event seam only | PASS — repository discovery, `git` execution and porcelain parsing run in Rust. Mode selection, scope, rows, ordering, filtering and all empty/loading/error states are webview state. The seam is one typed command (`list_changed_ai_documents`), one startup command (`startup_changed_scope`) and one typed event (`changed-ai-cli`). Rust gains no window or UI logic. |
| G2 Pure logic + tests (P-II) | New state, parsing and view-model logic in DOM-free modules with deterministic tests; error/empty/boundary paths covered | PASS — `changed-ai-model` (composition/order/empty-state selection) and `changed-ai-controller` (lifecycle/scope/generation) are pure with injected loader and clock; `changed-ai-rows` is DOM-only and tested with `happy-dom`; Rust parsing, filtering, discovery and timeout logic are plain functions tested with temp directories and fixture porcelain output. |
| G3 Least privilege (P-III) | Treat the webview as untrusted; re-validate every input; no shell; least-privilege capabilities | PASS — the only webview input is an optional scope path, which Rust validates for length, encoding and absolute shape before canonicalizing and mapping to a repository. `git` runs with an argument vector, never a shell; its output is parsed as NUL-delimited data, never evaluated. Capabilities, CSP and permissions are unchanged. |
| G4 Read-only, never surprising (P-IV) | Never write documents or repository state; session vs persisted state explicit; every state rendered with recovery | PASS — the feature only reads `git status` and file metadata; it has no write path. The view is explicitly transient and leaves the saved mode intact (FR-009). Loading, empty-with-repositories, no-repository, partial-error, scope-error and success states are each rendered, and every failure names the repository or path with refresh/return actions where they exist. |
| G5 Performance (P-V) | Virtualized lists; no polling; background work does not block the UI; feedback within 100 ms | PASS — rows render in a dedicated windowed list; the command runs on a blocking worker thread with a 1.8 s budget; the scroll/reading surface is untouched; no timer or watcher-driven git polling exists; the one automatic re-read is triggered by the existing scan-settled event. |
| G6 Quality gates | Typecheck, frontend tests, Rust tests, clippy | PASS — new and extended suites are part of the definition of done. |
| G7 Persistence constraint | The constitution enumerates every persisted store | PASS — no store is added or changed. The spec's assumption that Persistence does not change is honoured; `browseMode: "changed"` is rejected by the existing per-field validation. No amendment is required. |
| G8 Dependencies | New runtime dependencies justified | PASS — none added; `git` is an external tool already assumed by the reader's workflow, detected and reported at runtime. |
| G9 Rendering | GFM, syntax highlighting, Mermaid and frontmatter must not regress | PASS — the renderer is untouched; opening a row reuses the existing `load_file` pipeline, including frontmatter and Mermaid handling. |
| G10 Platform | Linux, macOS and Windows; platform differences documented | PASS — repository roots and paths use `std::path`; `.git` directory-or-file handles worktrees and submodules; the CLI background rule differs per platform and is documented in the contract. |

Post-Phase-1 re-check: the design satisfies every gate with no conditional row.
No `NEEDS CLARIFICATION` remains. No capability, dependency, watcher, content
command or persisted key is added; the only new surface is one read-only command,
one startup lookup and one event.

## Project Structure

### Documentation (this feature)

```text
specs/008-changed-ai-documents/
├── plan.md                    # This file (/speckit.plan output)
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── contracts/
│   ├── changed-ai-report.md   # Command payload, semantics, limits, errors
│   ├── cli-changed-flag.md    # Argument parsing, hand-off, scope, exit behavior
│   └── changed-view.md        # Surface, rows, states, filter, keyboard, a11y
└── tasks.md                   # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
index.html                      # unchanged (the sidebar is built in TypeScript)
src/
├── main.ts                     # EXTEND changed-view activation, CLI event, shortcut, scan-settled refresh
├── sidebar-model.ts            # EXTEND BrowseView = BrowseMode | "changed" (transient, never persisted)
├── sidebar-panel.ts            # EXTEND fourth mode, changed list/states, scope banner, refresh action
├── sidebar-panel.test.ts       # EXTEND mode row, changed rendering, state copy, toolbar visibility
├── changed-ai-model.ts         # NEW derived rows, ordering, path context, badges, state selection
├── changed-ai-model.test.ts    # NEW dedupe, order, tiebreak, filter, every empty/partial state
├── changed-ai-controller.ts    # NEW session state machine: scope, activate/refresh, staleness, settle
├── changed-ai-controller.test.ts # NEW activation, rescope, generation guard, error mapping, no tab opens
├── changed-ai-rows.ts          # NEW DOM row + state panel + scope banner builders
├── changed-ai-rows.test.ts     # NEW anatomy, accessible names, badge/state rendering, activation
├── preferences.ts              # unchanged; proves "changed" is rejected (existing guard)
├── preferences.test.ts         # EXTEND stored "changed" falls back to the saved default
├── shortcuts.ts                # EXTEND refresh-changed shortcut definition
├── shortcuts.test.ts           # EXTEND matching/formatting for the new chord
├── shortcut-reference.ts       # EXTEND a Changed `_ai` group and the row activation entry
├── shortcut-reference.test.ts  # EXTEND completeness walk over the new registry id
├── filter-documents.test.ts    # EXTEND shared filter over changed rows (filename/path/project)
├── style.css                   # EXTEND changed rows, badges, states, scope banner
└── *.test.ts                   # existing suites updated where the sidebar state shape changes
src-tauri/
├── src/changed_ai.rs           # NEW discovery, git supervision, porcelain parsing, filtering, command
├── src/changed_ai_test.rs      # NEW unit/integration-style tests with temp dirs and a fake git
├── src/paths.rs                # EXTEND CliRequest: `--changed [path]` parsing beside path classification
├── src/paths_test.rs           # EXTEND flag/scope/consumption/relative/cwd/nonexistent cases
├── src/detach.rs               # EXTEND background rule for `--changed` without a terminal
├── src/lib.rs                  # EXTEND command registration, startup scope, single-instance forwarding
README.md                       # EXTEND Changed `_ai`, CLI flag and refresh shortcut
CHANGELOG.md                    # ADD Unreleased entries
docs/manual.md                  # EXTEND agent workflow, view semantics, shortcut
_ai/
├── context-definitions/changed-ai.md                                  # NEW feature/context reference
└── technical_decisions/
    ├── ADR__261122-1__git-status-changed-ai-view.md                   # NEW decision record
    └── README.md                                                     # EXTEND ADR index
```

**Structure Decision**: Keep the flat `src/` layout and its pure-module
convention. `changed-ai-model.ts` owns all derived presentation rules (row
composition, `_ai`-relative context, ordering, empty/partial state selection) so
it can be unit-tested without a DOM or Tauri. `changed-ai-controller.ts` owns the
session lifecycle (scope, in-flight generation, staleness, one-shot
scan-settled refresh) and takes its loader and clock as constructor seams, so no
test needs a real git repository. `changed-ai-rows.ts` and `SidebarPanel` stay
thin DOM owners, matching `sidebar-rows.ts`/`bookmarks-view.ts`. `main.ts`
remains the single orchestrator that connects the mode row, the document
pipeline, the CLI event and the shortcut.

On the Rust side, `changed_ai.rs` is one self-contained service module: a
`GitClient` boundary (real subprocess in production, fake in tests), pure
porcelain/classification/`.git`-ancestor helpers, bounded discovery, and the
report assembly. The Tauri command is a thin wrapper that snapshots the live
watch roots and excludes from `WatcherState` and runs the blocking work on
`spawn_blocking`, following `load_watches` and `save_watch_config`. This keeps
`commands.rs` from absorbing another domain and keeps the read-only git boundary
in one auditable place.

### Behavioural outline

1. **Rust command** `list_changed_ai_documents(scope?)`:
   - snapshot `WatcherState::all_roots()` and `excludes()`;
   - watched scope: map each root to its enclosing work tree; walk (bounded) for
     `_ai` folders only when a root has no enclosing repository; dedupe roots;
   - CLI scope: resolve the requested path, find its work tree, ignore the watch
     set for inclusion (the repository need not be watched);
   - one `git status` per repository with a 1.5 s per-repository deadline and a
     1.8 s aggregate deadline; one repository's failure never discards another's
     rows;
   - filter to existing Markdown files with an `_ai` segment, under the watched
     roots (watched scope) or the scoped repository, excluding hidden, backup
     and noise components and respecting configured excludes in watched scope
     only;
   - stat modification time, dedupe by canonical path, return typed rows.
2. **Webview model** turns the report into rows: project chip via `projectName`,
   `_ai`-relative context via a new pure helper, badge list, newest-first order
   with the path as tiebreaker, and one explicit state
   (`loading | ready | empty | no-repository | partial | error | scope-error`).
3. **Sidebar** paints the fourth mode with its own windowed list, scope banner,
   refresh action and state panel; existing Clear/Undo/Summarize/Popout and
   bookmark settings hide while the transient mode is shown.
4. **CLI**: `parse_cli` consumes `--changed` and its optional path, the running
   window receives `changed-ai-cli`, startup receives the same scope through
   `startup_changed_scope`, and both rescope and activate the view without
   opening a document.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitutional violations. The complexity worth watching is recorded in
[research.md](./research.md) with its rejected alternatives: the bounded
`git` subprocess supervisor, the fallback repository walk for unwatched broad
roots, and the transient `BrowseView` union that keeps `browseMode` persistence
untouched.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| A repository with a very large change set makes porcelain output large | 8 MiB per-repository read cap, per-repository deadline, and a named repository error instead of a hung list |
| `git` is missing or blocked by permissions | Spawn failure is detected per repository, reported as a named, actionable error; the app and document reading stay usable |
| A network filesystem makes `git status` hang | Supervised child process killed at the per-repository deadline; the aggregate budget still returns the other repositories |
| The startup watch scan is still running when `--changed` opens the view | The view shows a loading state immediately and performs exactly one refresh when scans settle; no polling |
| A watch root is a broad folder outside any repository but contains repositories | A bounded `_ai`-folder walk resolves nested repositories and reports truncation instead of silently missing them |
| Icons/badges drift from the shared filter | The changed row keeps the same `path`/`filename` shape, so `filterEntries` is reused unchanged and project matching stays identical |
