# Feature Specification: Changed `_ai` Documents

**Feature Branch**: `008-changed-ai-documents`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Stream C — surface changed `_ai` documents
across watched repositories" (from the local agent-reading workflow epic).

## Context

docdeck already answers two questions: **what am I watching** (All documents)
and **what changed while docdeck was open** (Recently changed). Neither answers
the question a reader asks after an agent finishes a turn or after a restart:
**which `_ai` documents are uncommitted in my repositories right now?**

Today that answer lives outside the app. The reader switches to a terminal, runs
git status in one project, repeats it for the next project, maps the paths back
to documents, and opens them by hand. Staged edits disappear from the
observation-based Recently changed list after a restart, and changes made while
docdeck was closed never appear there at all.

This feature adds a transient **Changed `_ai`** view that lists uncommitted
Markdown documents under any `_ai` folder in the watched repositories (or in the
single repository named by a CLI request), newest first and labeled by project. It also adds a CLI entry point so an agent can ask
the running window to show its repository's changes. The view is read-only: it
reports git state, it never changes it.

## Clarifications

### Session 2026-11-21

- Q: Which repositories does the view cover? → A: Every repository that
  contains a currently watched `_ai` folder, merged into one list and labeled by
  project. `docdeck --changed [path]` narrows the view to the repository that
  contains `path` (the caller's working directory when path is omitted); that
  repository does not need to be in the watch configuration.
- Q: What counts as "changed"? → A: Staged, unstaged and untracked Markdown
  files under any `_ai` path segment. Deleted files are skipped because they
  cannot be opened; a rename is reported at its new path when that path still
  exists. Each path appears once, newest modification first, with the path as a
  stable tiebreaker.
- Q: How is it surfaced? → A: A transient browse view plus a CLI flag. The view
  is not persisted, does not replace the saved browse mode, and never opens a
  document by itself. There is no "open all".
- Q: When does the list refresh? → A: When the view opens or becomes active, and
  when the reader invokes the refresh action. docdeck does not poll git in the
  background.
- Q: Does the feature change repository or document state? → A: No. It reads git
  status and document contents only. Staging, committing, diffing, reverting,
  branch switching and any write to a watched document stay out of scope.
- Q: Where does the Changed `_ai` view appear in the window? → A: As a fourth
  entry in the existing document sidebar mode row, beside All documents,
  Recently changed and Bookmarks. Selecting it is transient: it is highlighted
  while shown, it does not overwrite the saved browse mode, and a restart
  returns to the previously saved mode.
- Q: When a repository has more changed `_ai` documents than a comfortable
  list, should the view show all of them or stop at a fixed safety limit? → A:
  No truncation. Every matching document is listed regardless of count, and the
  view stays responsive as the list grows; a size-driven limit never hides rows.
- Q: When `docdeck --changed` has to start docdeck itself, should the command
  return immediately or stay in the foreground until the window closes? → A:
  Return promptly in every case. It forwards to a running window and exits
  successfully, or starts docdeck in the background and exits successfully once
  the request is accepted; errors found before hand-off still print on stderr.
- Q: Must the Changed `_ai` view and every action in it be fully usable from the
  keyboard, with visible focus and accessible names? → A: Yes. The mode entry,
  rows, filter, refresh and the return-to-all action are keyboard operable with
  visible focus and accessible names, and loading, empty, partial-error and
  success states are exposed to assistive technology.
- Q: Should a Changed `_ai` row carry the sidebar's usual row actions (unread
  dot, bookmark star, close/dismiss), or show only report information? → A: Only
  report information. Rows show project, filename, distinguishing path context,
  change-state badges and modification time, with no dismiss, bookmark star or
  unread dot; activating a row opens the document, which then participates in
  the normal unread and bookmark behaviour elsewhere.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See uncommitted `_ai` work across projects (Priority: P1)

A reader has finished a session with agents in several projects. They choose
**Changed `_ai`** in the document sidebar's mode row and immediately see every
uncommitted `_ai` Markdown document, grouped visually by project and ordered
with the freshest work first.
Each row says whether the document has staged changes, unstaged changes, is
untracked, or a combination.

**Why this priority**: This is the reason the feature exists. It replaces a
manual loop of terminal commands and file opens with one view, works after a
restart, and covers work that the session-scoped Recently changed list cannot.

**Independent Test**: Create two temporary repositories, each with a watched
`_ai` folder. Stage one document in the first, edit another, create a third
untracked, and delete a fourth. Open the view and confirm exactly the three live
documents appear, each once, labeled by project.

**Acceptance Scenarios**:

1. **Given** two watched repositories contain changed `_ai` Markdown, **When**
   the reader opens **Changed `_ai`**, **Then** every staged, unstaged and
   untracked document appears once with its project label and change state.
2. **Given** a deleted `_ai` document and a changed non-Markdown file, **When**
   the view is shown, **Then** neither appears.
3. **Given** one document has both staged and unstaged edits, **When** the view
   is shown, **Then** it appears once and its row reports both states.
4. **Given** changed documents have different modification times, **When** the
   view is shown, **Then** the newest appears first and equal times are ordered
   by path.
5. **Given** the reader types a filter term, **When** rows are shown, **Then**
   only documents whose filename, path or project matches remain, in the same
   order.

---

### User Story 2 - Open a changed document without opening all of them (Priority: P1)

A reader scans the changed list and activates the one document they want. It
opens as a normal tab. Activating a document that is already open switches to
its existing tab instead of duplicating it. Merely opening the view never
creates tabs.

**Why this priority**: The list only delivers value if it leads into reading,
and the current reading surface must not be disturbed by a large change set.
Thirty changed documents must not become thirty tabs.

**Independent Test**: With thirty changed documents, open the view and confirm
no tab is created. Activate one row and confirm one tab with the correct
content. Activate a row for an already open document and confirm there is still
one tab for it.

**Acceptance Scenarios**:

1. **Given** the changed view lists a document, **When** the reader activates
   its row, **Then** the document opens, becomes active and can be read.
2. **Given** the document is already open, **When** the reader activates its
   changed row, **Then** the existing tab is activated without a duplicate.
3. **Given** a changed document lies outside the configured watch locations,
   **When** the reader activates it, **Then** it still opens and the rest of the
   application stays usable.
4. **Given** the view lists many documents, **When** it opens, **Then** no
   document tab is created until the reader activates a row.
5. **Given** a changed row is shown, **When** the reader inspects it, **Then** it
   offers no dismiss, bookmark or unread toggle, and activating it does not
   remove it from the changed list.

---

### User Story 3 - Ask from the agent workflow (Priority: P1)

An agent finishes work in a repository and runs `docdeck --changed`. If docdeck
is already running, the existing window comes forward and shows that
repository's uncommitted `_ai` documents; no second window or process appears.
Running `docdeck --changed <path>` from anywhere does the same for the
repository containing that path. The command always returns to the agent's shell
promptly instead of waiting for the window to close.

**Why this priority**: This is the agent-friendly entry point named in the epic.
It makes the feature reachable without navigating the UI and gives the agent a
way to hand the reader exactly the repository it just changed.

**Independent Test**: From a temporary repository that is not in the watch
configuration, run `docdeck --changed`. Confirm the running window focuses the
view on that repository. Run it again with a different repository's path and
confirm the same window is rescoped. Then quit docdeck, run the command from a
non-terminal caller, and confirm the command returns while the window opens.

**Acceptance Scenarios**:

1. **Given** no path is supplied, **When** the reader runs `docdeck --changed`,
   **Then** the view is scoped to the repository containing the caller's working
   directory.
2. **Given** a file or folder path is supplied, **When** the reader runs
   `docdeck --changed <path>`, **Then** the view is scoped to the repository
   containing that path.
3. **Given** docdeck is already running, **When** the flag is received, **Then**
   the existing window is focused and rescoped and no second instance starts.
4. **Given** the view is narrowed to one repository, **When** the reader chooses
   to show all watched repositories, **Then** the full list returns in one
   action.
5. **Given** the flag is combined with document or folder arguments, **When**
   docdeck launches, **Then** both the normal open/watch behavior and the
   changed view take effect.
6. **Given** docdeck is not running, **When** an agent runs `docdeck --changed`
   without an attached terminal, **Then** docdeck starts, the command reports
   success and returns, and the agent's next command runs without waiting for
   the window to close.

---

### User Story 4 - Refresh and recover without losing the reading position (Priority: P2)

A reader leaves the changed view open, reviews a document, and returns to the
view. It refreshes and shows the current git state. If one repository cannot be
read — git is missing, permissions fail, the repository moved — the view names
that repository and its problem while still showing results from the others.
An empty list explains which condition applies rather than showing a blank
panel.

**Why this priority**: A stale or silently failing list destroys trust faster
than a missing feature, and the view is only useful if it survives the ordinary
errors of a developer machine.

**Independent Test**: Open the view, change a document on disk, refresh, and
confirm the list updates without changing the active document or its scroll
position. Then simulate a repository that git cannot read and confirm the other
repositories still list their documents.

**Acceptance Scenarios**:

1. **Given** the changed view is open, **When** the reader activates it after
   reading a document, **Then** it refreshes without closing tabs, switching the
   active document or moving scroll positions.
2. **Given** a new uncommitted document appears, **When** the reader refreshes,
   **Then** it appears; when a change is removed, it disappears.
3. **Given** one repository fails, **When** the view refreshes, **Then** that
   repository's error is shown and other repositories' rows remain.
4. **Given** no watched `_ai` folder is inside a git repository, **When** the
   view opens, **Then** it says so instead of claiming there are no changes.
5. **Given** repositories exist but have no uncommitted `_ai` Markdown, **When**
   the view opens, **Then** it says there are no uncommitted `_ai` documents and
   offers refresh.

---

### Edge Cases

- **git is not installed**: the view shows an actionable message naming the
  missing tool; the application still starts and documents still open.
- **The path is not in a repository**: the view names the path and explains that
  no repository was found.
- **A repository disappears or is renamed while the view is open**: its next
  refresh reports the failure; other repositories are unaffected.
- **A document changes while the list is being read**: the row stays valid; the
  next refresh shows the current state.
- **Nested repositories, worktrees and submodules**: each distinct repository
  root is queried once; a document never appears twice.
- **Symlinked paths**: the repository and document are resolved through the link
  before the query, so the same file does not appear under two spellings.
- **Spaces and non-ASCII characters in paths**: handled literally; no shell
  interpretation.
- **A rename leaves `_ai`, becomes non-Markdown, or is deleted**: the document
  is not listed unless it still exists as Markdown under `_ai`.
- **An untracked directory contains many files**: only Markdown under `_ai` is
  listed; the rest is ignored.
- **A file is ignored by git**: it is not reported as changed, because the
  feature reports git's view rather than a filesystem diff.
- **The same document is open and also changed**: it appears in the changed
  view and its tab is activated on selection, never duplicated.
- **The flag is run by a tool or script without a terminal**: the invocation
  still returns with success, and the window it started stays open
  independently of the caller.
- **The changed view is large**: it remains responsive and lists every matching
  document; no size-based limit hides rows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST provide a **Changed `_ai`** view that lists
  uncommitted Markdown documents under any `_ai` path segment in the watched
  repositories, merged into one list, or in the single repository named by a
  `--changed` request.
- **FR-002**: "Changed" MUST mean staged, unstaged or untracked according to the
  repository's git state. Deleted documents MUST be excluded.
- **FR-003**: Each document MUST appear at most once, with the path as the
  identity, even when it has staged and unstaged edits or is reached through
  more than one watched root.
- **FR-004**: Each row MUST show the document's project, its filename and enough
  path context to distinguish similarly named files, and whether it has staged
  changes, unstaged changes, is untracked, or a combination.
- **FR-005**: Rows MUST be ordered newest modification first, with the path as a
  stable tiebreaker.
- **FR-006**: The shared browse filter MUST narrow the changed list by filename,
  path or project without changing order or any open, unread or deleted state.
- **FR-007**: Activating a row MUST open the document, or activate its existing
  tab when it is already open; it MUST NOT create a duplicate.
- **FR-008**: Opening the view, refreshing it or receiving a CLI request MUST
  NOT open any document by itself. There MUST be no "open all" action.
- **FR-009**: The view MUST be transient: it MUST NOT be persisted as the saved
  browse mode, MUST NOT be restored after a restart, and MUST leave All
  documents, Recently changed and Bookmarks unchanged. Selecting it MUST NOT
  overwrite the saved browse mode.
- **FR-010**: The application MUST expose the view as a fourth entry in the
  document sidebar's mode row, beside All documents, Recently changed and
  Bookmarks, covering every watched repository. While the view is shown, that
  entry MUST be the highlighted mode.
- **FR-011**: The application MUST accept `docdeck --changed [path]` and scope
  the view to the repository containing `path`, defaulting to the caller's
  working directory. The repository need not already be watched.
- **FR-012**: When docdeck is already running, a `--changed` request MUST be
  forwarded to the existing window and rescope it; it MUST NOT start a second
  instance or window.
- **FR-013**: A narrowed view MUST display its scope and MUST offer a one-action
  return to all watched repositories.
- **FR-014**: The view MUST refresh when it opens, when it becomes active after
  the reader returns to it, and when the reader invokes the refresh action, which
  MUST have a toolbar control and a keyboard shortcut listed in the application's
  shortcut reference.
- **FR-015**: Refreshing MUST NOT close tabs, change the active document, move
  document scroll positions, or alter unread, bookmark or acknowledgement state.
- **FR-016**: The view MUST render explicit loading, empty, partial-error and
  success states. A failure in one repository MUST NOT hide results from others.
- **FR-017**: The view MUST distinguish "no watched `_ai` folder is inside a git
  repository" from "repositories exist but nothing is uncommitted".
- **FR-018**: Missing git, a missing repository, an unreadable path and an
  unreadable document MUST each produce an actionable message naming the
  affected repository or path, with a recovery action where one exists.
- **FR-019**: The feature MUST be read-only. It MUST NOT stage, commit, diff,
  revert, checkout, switch branches, write to a document or change repository
  state.
- **FR-020**: Repository discovery MUST use the current watch set, including
  session watches, and MUST run when the view is requested rather than delaying
  application startup.
- **FR-021**: Paths supplied by the CLI or git MUST be treated literally; no
  shell interpretation, expansion or command construction from path text.
- **FR-022**: The view MUST list every matching document regardless of count,
  MUST remain usable with at least 500 listed documents, and MUST NOT hide rows
  behind a size-based limit.
- **FR-023**: Every `docdeck --changed` invocation MUST return control to the
  caller promptly with a success status once the request has been handed off or
  accepted, whether or not docdeck was already running and whether or not a
  terminal is attached. Starting docdeck in response to the flag MUST NOT hold
  the caller's process open for the lifetime of the window; errors detected
  before hand-off MUST still be reported.
- **FR-024**: The Changed `_ai` view MUST be fully operable from the keyboard:
  the mode entry, row activation, filter, refresh and the return-to-all action
  MUST each be reachable with visible focus and an accessible name. Loading,
  empty, partial-error and success states MUST be exposed to assistive
  technology, naming the affected repository or path.
- **FR-025**: Changed rows MUST be informational only: project, filename,
  distinguishing path context, change-state badges and modification time. They
  MUST NOT offer dismiss, bookmark or unread toggles, and activating a row MUST
  NOT remove it from the list. Once opened, the document follows the same unread
  and bookmark behaviour as when it is opened from any other view.

### Key Entities

- **Watched repository**: A git working tree that contains at least one watched
  `_ai` folder. Identified by its resolved root; contributes documents to the
  view and an error when it cannot be read.
- **Changed document**: A Markdown file under an `_ai` segment that git reports
  as staged, unstaged or untracked. Attributes: path, project, change state and
  modification time. It is not a new persisted record.
- **Changed `_ai` view**: A transient, filterable snapshot of changed documents
  for all watched repositories or one narrowed repository. It has a loading,
  empty, partial-error or success state, with an actionable message when no
  repository can be read.
- **Scope**: Either "all watched repositories" or one repository chosen by the
  CLI request. Scope is part of the transient view, not a saved preference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can go from deciding to check for agent changes to
  opening the first changed document in at most three actions: open the view,
  scan the list, activate a row.
- **SC-002**: In a fixture covering staged, unstaged, untracked, deleted,
  renamed, non-Markdown and non-`_ai` changes, 100% of live `_ai` Markdown
  changes appear exactly once and none of the excluded files appear. The same
  completeness holds when the fixture contains 500 live `_ai` changes.
- **SC-003**: With ten repositories and one thousand watched documents, a
  loading indication appears within 100 ms and the first rows within two
  seconds on a typical developer machine.
- **SC-004**: Thirty changed documents produce zero document tabs until the
  reader activates one.
- **SC-005**: Listing and refreshing leave repository and document state
  unchanged; a before-and-after comparison of a temporary repository detects no
  modification.
- **SC-006**: Every failure mode (missing git, missing repository, unreadable
  path, unreadable document) shows a message naming the affected repository or
  path, and the rest of the application remains usable.
- **SC-007**: `docdeck --changed` from a repository reaches the running window
  and shows that repository's changes in under one second, with no second
  process.
- **SC-008**: With three repositories where one fails, the other two still list
  their changed documents and the failing one's error is visible.
- **SC-009**: After a restart the application returns to the reader's saved
  browse mode; no changed view, scope or list survives.
- **SC-010**: The reader can refresh with one keyboard shortcut, and that
  shortcut appears in the shortcut reference.
- **SC-011**: `docdeck --changed` returns success to the caller in under one
  second on a typical machine, both when a window is already running and when
  the flag has to start one, including when no terminal is attached.
- **SC-012**: A keyboard-only reader can open the view, filter it, activate a
  row, refresh it and return to all watched repositories without a pointer, and
  every loading, empty, partial-error and success state is announced with the
  repository or path it refers to.
- **SC-013**: No changed row exposes a dismiss, bookmark or unread toggle, and
  activating a row leaves the changed list unchanged apart from the opened tab.

## Assumptions

- The reader has git installed. It is required for this feature to produce
  results, but its absence is a recoverable error rather than a startup failure.
- The watched repository set is derived from the existing watch configuration
  and session CLI folders; no new repository registry or persisted list is
  introduced.
- `_ai` is matched as an exact path segment, following the convention already
  used for project labels.
- Files ignored by git are not "changed" for this feature; the list reports
  git's view, not a filesystem comparison.
- "Newest first" uses the document's filesystem modification time because git
  status carries no timestamp.
- The view is session-scoped, so the Persistence section of the constitution
  does not change.
- The feature uses the user's installed git; no new runtime dependency is added.
- The CLI flag is additive: existing document and folder arguments keep their
  current behavior, and `--quit` and other flags are unaffected.
- Documentation (`README.md`, `CHANGELOG.md`, the relevant `_ai/` context note)
  and the shortcut reference are updated in the same change.
- The epic reserves the number `008` for this feature.

## Out of Scope

- Any git write: staging, committing, diffing, reverting, checkout, branch
  switching, fetching, pushing or resolving conflicts.
- A general git client, commit history, blame, pull requests or remote hosting
  integration.
- Changed-file views outside `_ai`, and changed non-Markdown files.
- Watching git's index in real time or refreshing on every commit. Refresh is
  on open, on return and on explicit request.
- Opening every changed document, multi-select bulk opening, or a batch action.
- Persisting the view, its scope or its filter across restarts.
- Filesystem changes that git ignores, such as ignored untracked files.
- A second application window or a second instance.
