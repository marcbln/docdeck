# Contract: Changed `_ai` view (UI)

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

The fourth entry in the existing browse mode row. It is transient: it can be
shown, refreshed and left, but it is never saved, restored, or allowed to change
the saved browse mode.

## Surface

```text
Browse section
├── mode row: [All] [Recently changed] [Bookmarks] [Changed _ai]   ← fourth entry
├── filter row: existing "Filter" input (shared, unchanged)
├── changed toolbar: [⟳ Refresh]                                     ← only in this mode
├── scope banner (only when scoped):
│     Showing changes in <project/repository> — <root>   [Show all watched repositories]
├── repository error banner (only on partial failure):
│     ⚠ <repository>: <reason>   (one line per failing repository)
├── state panel (role="status", aria-live="polite"):
│     loading | empty | no-repository | scope-error | error | success count
└── changed list: <ul role="list"> with one windowed row per document
      <li>
        <button class="changed-row-main" type="button">       ← the only interactive element
          <span class="changed-row-title">
            <span class="project-chip">docdeck</span>
            <span class="changed-row-filename">plan.md</span>
          </span>
          <span class="changed-row-context">backlog/261122__plan.md</span>
          <span class="changed-row-badges">
            <span class="change-badge change-badge--staged">Staged</span>
            <span class="change-badge change-badge--unstaged">Unstaged</span>
            <span class="change-badge change-badge--untracked">New</span>
          </span>
          <time datetime="…" title="Exact time">2 min ago</time>
        </button>
      </li>
```

While this mode is shown, the browse toolbar's **Clear**, **Undo**, **Summarize**
and **Popout** actions and the bookmark-only settings block are hidden, because
they apply to other modes. The mode row, filter and Refresh remain. The section
header count reflects the number of changed rows (after filtering).

## Mode selection

- Selecting **Changed `_ai`** sets the transient view only. `preferences.browseMode`
  is not written; `aria-pressed="true"` moves to this button while shown.
- Selecting All / Recently changed / Bookmarks leaves the transient view,
  restores the normal list **and** writes that mode to preferences as today.
- Clicking **Changed `_ai`** while it is already active re-activates it, which
  refreshes (FR-014 "becomes active after the reader returns to it").
- Restart restores the saved browse mode; the changed view, its rows and its
  scope are gone (FR-009, SC-009).
- `docdeck --changed` activates the view without changing the saved mode and
  without opening a document.

## Refresh triggers

Exactly these, and no others:

1. First activation in the session.
2. Re-activating the mode entry (clicking it again after reading a document).
3. The **Refresh** toolbar button.
4. The `Ctrl`/`Cmd`+`Shift`+`R` shortcut (also activates the view if another
   mode is shown), listed in the shortcut reference.
5. One automatic refresh when the startup watch scan settles, and only if the
   view activated while a scan was in flight.

Watcher events, tab changes and document opens never trigger a refresh. There is
no polling and no index watching.

Refreshing must not close tabs, switch the active document, move document scroll
positions, or alter unread, bookmark or acknowledgement state (FR-015). When rows
already exist, the old snapshot stays on screen with a quiet "Refreshing…" status
and `aria-busy="true"` until the new report arrives.

## Row behaviour

- Activating the row button (click, `Enter` or `Space`) opens the document through
  the normal `openDocument` path. An already-open document activates its existing
  tab; no duplicate tab is created (FR-007).
- Opening never removes the row, changes the mode, or triggers a refresh
  (FR-025, SC-013).
- A document outside the configured watch locations still opens; the rest of the
  app stays usable (US2 scenario 3).
- If the document vanished or cannot be read, the existing open error names the
  path, the row stays in the snapshot, and the view remains usable (FR-018).
- Rows expose **no** close/dismiss button, no bookmark star and no unread dot.
  Middle click does nothing. There is no row context menu.
- Ordering is newest modification first, path as tiebreaker, rows without a
  modification time last; filtering never changes the order (FR-005, FR-006).
- Opening the view never creates a tab and there is no "open all" action
  (FR-008, SC-004).

## Filter

The existing browse filter is shared unchanged:

- Matches filename, full path or `_ai` project name, case-insensitively.
- Keeps row order and all open/unread/bookmark state.
- When a term hides every row, the existing "No documents match “term”." copy and
  **Clear** action render, not an empty-git message.
- The count in the header and the hidden live-region count follow the visible
  rows.

## States and copy

| State | Condition | Copy | Action |
|-------|-----------|------|--------|
| Loading | first request in flight, no snapshot | "Reading git status in N repositories…" | — (`aria-busy`) |
| Refreshing | request in flight, snapshot present | rows + "Refreshing…" | — |
| Success | rows > 0, no errors | "N changed `_ai` documents" | Refresh |
| Partial | rows > 0 and at least one repository error, or errors only | rows + per-repository error banner | Refresh |
| Empty | repositories readable, zero uncommitted `_ai` documents | "No uncommitted `_ai` documents in N repositories." | Refresh |
| No repository | `aiFolders === 0`, or watched `_ai` folders exist but none resolves to a repository | "No watched `_ai` folder is inside a git repository."; unresolved folders named in the error banner when known | Refresh; watch-configuration hint |
| Scope error | requested path has no repository | "No git repository contains `<path>`." | **Show all watched repositories** |
| Git missing | `gitAvailable === false` | "git is not installed or could not be started." | Refresh |
| Discovery truncated | fallback walk hit its budget | partial warning appended to the state panel | Refresh |

A scoped view always shows its scope banner, even when empty, so the reader knows
why other repositories are absent (FR-013). **Show all watched repositories** is
one action that returns the full watched list.

## Keyboard and accessibility

| Interaction | Keys | Requirement |
|-------------|------|-------------|
| Select the mode | `Tab` to the mode button, `Enter`/`Space` | Focus visible, name "Changed `_ai` documents" |
| Activate a row | `Tab` to the row button, `Enter`/`Space` | Focus visible, name "<filename>, <project>, <states>, <time>" |
| Reach the filter | existing `Tab` order | unchanged |
| Refresh | `Ctrl`/`Cmd`+`Shift`+`R`, or `Tab` to **Refresh** | Shortcut listed in the reference (SC-010) |
| Return to all repositories | `Tab` to the scope banner button, `Enter`/`Space` | Name "Show all watched repositories" |
| Leave the view | `Tab` to another mode button | — |

- The list is a real `<ul role="list">`; each row is a single native `<button>`
  with an accessible name composed from its visible text (filename, project,
  states, relative time). Badge text is real text, never colour alone.
- `<time>` carries `datetime` and an exact-time `title`.
- The state panel and the count use `role="status"`/`aria-live="polite"`; loading
  sets `aria-busy="true"` on the list host. Each announcement names the
  repository or path it refers to.
- Every state is reachable without a pointer; no hover-only affordance exists.
- Reduced-motion and colour-token rules are inherited from the existing sidebar
  styling; badges use Catppuccin custom properties, not hard-coded colours.

## Persistence

- Nothing: no `localStorage` write, no preference field, no instance-record
  change.
- `browseMode: "changed"` is not a valid stored value; a corrupted payload falls
  back to the default mode as today.
- The saved browse mode is untouched by mode selection, scoping, refreshing or
  the CLI flag.

## Out of scope (enforced by omission)

- No stage/commit/diff/revert/open-all/bulk action.
- No unread dot, bookmark star, dismiss or acknowledgement control on a row.
- No git history, blame, branch, remote or conflict UI.
- No real-time index watching.
