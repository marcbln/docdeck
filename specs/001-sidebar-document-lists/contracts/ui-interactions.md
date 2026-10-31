# UI Interaction Contract: Left Sidebar Document Navigation

**Feature**: `001-sidebar-document-lists` | **Date**: 2026-10-31

This is a desktop UI feature, so the contract is the set of user actions and the
observable response, plus the stable test seams. It is not a network API.

## Surface

```text
#sidebar
├── section[data-section="open"]        (always present)
│   ├── header button[data-action="toggle-open"]
│   └── ul[role="list"]                 (OpenDocument rows)
└── section[data-section="browse"]
    ├── header button[data-action="toggle-browse"]
    ├── div[role="group"]               (mode switch)
    │   ├── button[data-mode="all"]     aria-pressed
    │   └── button[data-mode="recent"]  aria-pressed
    ├── div.sidebar-status              (scan/error/warning host)
    ├── button[data-action="clear-recent"]
    ├── button[data-action="undo-clear"]
    └── ul[role="list"]                 (browse rows)
```

The pop-out full-height view keeps the existing modal contract
(`.inbox-overlay` with `role="dialog"`, `Esc` to close).

## Actions

| Action | Trigger | Preconditions | Response | Postconditions |
|--------|---------|---------------|----------|----------------|
| Activate open document | Click / `Enter` / `Space` on an open row | Row exists | Set active document, clear its unread marker | Row is `aria-current="true"`; document painted; scroll preserved per existing rules |
| Close open document | Click `[data-action="close"]` on an open row | Row exists | Close tab, release watch, choose next active | Row removed; another row becomes active if available; else empty pane |
| Copy path | Context menu / `Shift+F10` on a row | Row exists | Copy absolute path, show toast | Clipboard contains path; toast confirms |
| Reopen closed | `Ctrl`/`Cmd`+`Shift`+`T` | Closed stack non-empty | Reopen last closed document | Document appears in Open Documents and becomes active |
| Sort open | Click `⚡ Auto-Sort` | — | Toggle ordering mode | Rows reorder; preference applied for the session |
| Switch browse mode | Click All / Recently Changed | — | Replace browse rows | `aria-pressed` moves; mode persisted |
| Activate browse row | Click / `Enter` / `Space` | Row exists | Open or focus the document | Document is open and active |
| Clear recent | Click `[data-action="clear-recent"]` | Recent list non-empty | Empty list, acknowledge unread up to now, create undo snapshot | List empty; unread markers cleared; undo enabled; toast offers undo |
| Undo clear | Click `[data-action="undo-clear"]` | Snapshot exists | Restore previous list + unread flags + `clearedAt` | Undo disabled; snapshot discarded |
| Collapse/expand section | Click section header | — | Toggle section body | `aria-expanded` reflects state; preference persisted |
| Show/hide browse | Existing `✉ Inbox` toggle | — | Hide/show browse section only | Open Documents always remains visible |
| Open pop-out | Click `[data-action="popout"]` | Inventory non-empty | Open full-height modal | Modal traps focus; `Esc` closes |
| Dismiss modal | `Esc` / close button / backdrop click | Modal open | Close modal | Focus returns to the pop-out trigger |

## Keyboard contract

| Key | Context | Result |
|-----|---------|--------|
| `Enter` / `Space` | Focused row | Activate row |
| `Shift+F10` / ContextMenu key | Focused row | Open path context menu |
| `Ctrl`/`Cmd`+`Shift`+`T` | Global | Reopen last closed document |
| `Esc` | Pop-out modal | Close modal |
| `Tab` | Anywhere | Moves focus through rows, close buttons, mode switch, clear/undo in DOM order |

Focus order must follow visual order. A row's close control is a real button and
is reachable by `Tab` without activating the row.

## Test seams

Pure, DOM-free (Vitest):

- `buildOpenRows(tabs, activePath, autoSort)` — ordering, active flag, unread,
  deleted.
- `selectRecent(entries, clearedAt)` — dedupe, ordering, inclusion of deleted.
- `clearRecent(state, now)` and `undoClear(state, snapshot)` — floor and unread
  restoration.
- `decode()` in `preferences.ts` — new fields default correctly and tolerate a
  legacy payload.
- `visibleRange(...)` — extracted unchanged from the modal.

DOM-based (happy-dom):

- `SidebarPanel.render(state)` produces two sections, the correct mode, the
  active/unread/deleted classes, and the clear/undo enabled states.
- Clicking a row calls the `onOpen` callback exactly once.
- Clicking close does not bubble an open action.
- Clear calls `onClear`; undo calls `onUndo`.
- Empty states render when `openRows`, `inventory`, or `recent` are empty.

## Error and edge behavior

- A failed open/close keeps the row and shows the existing error toast.
- Clear while a scan is running acknowledges only entries observed so far; rows
  discovered afterwards with `changedAt` greater than the new floor appear.
- If the inventory shrinks while a snapshot exists, undo restores only paths
  that still exist.
- Collapsing both sections still leaves each header reachable and the document
  pane visible.
