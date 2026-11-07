# Contract: Status Bar and Event Log

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

Observable behavior for the one-line status bar and the docked event log.
State shapes and retention rules live in
[`../data-model.md`](../data-model.md).

## 1. Status bar

### Layout

- One line, full window width, at the very bottom. It never disappears when
  idle (US1 scenario 4).
- It occupies its own layout row and never overlays or intercepts the document
  area (FR-022).
- The left segment is the current state; the right side carries an optional
  warning chip.

### Content precedence

| State | Display |
|-------|---------|
| Scan running, progress received | `Scanning <short location> (<n> folders · <m> files)` |
| Scan running, no progress yet | `Scanning watched paths…` |
| Scan/reload finished or failed | The newest event's one-line message, with its severity |
| Warning entries exist | The message plus a `N warnings` chip |
| Nothing has happened | A quiet idle line (e.g. `Ready` or `Watching N folders`) |

- The latest event and warning count are watch/scan events only. Document and
  tab activity never appears (FR-014).
- Severity is conveyed with a text label/icon as well as color.
- When space is tight, the location shortens (leading ellipsis allowed); folder
  and file counts remain visible (FR-009).

### Interactions

| Action | Result |
|--------|--------|
| Click anywhere on the status line except the warning chip | Toggle the event log |
| Click the warning chip | Open the log, select the Warnings filter |
| `Ctrl+\`` | Toggle the log (ignored while typing in an input/textarea/contenteditable) |
| Warning count is zero | No chip is rendered |
| Log cleared | Chip disappears; a later warning event recreates it |

The status bar never steals focus on its own and never blocks document
scrolling, tab switching, or link activation.

## 2. Event log

### Open / close

- Closed by default on every launch (session-only visibility).
- Opens as a full-width docked row above the status bar; the document area
  shrinks rather than being covered (FR-018).
- Closing it returns the space to the document area and restores its previous
  height on the next open.
- `Escape` while focus is inside the log closes the log only; it does not close
  the active tab or document (US3 scenario 5).
- Focus returns to the control that opened the log.

### Contents

Only watch/scan lifecycle entries are recorded:

| Recorded | Not recorded |
|----------|--------------|
| Scan start and completion | Document open / reload / render |
| Configuration reload success, failure, warnings, truncation | Tab activation / closing / unread state |
| Watch roots added or removed | Link handling |
| Watch-related errors | Copy actions |
| Per-warning detail entries | Summary requests |
| | Watch progress ticks (each directory/file) |

Each row shows, at minimum:
- a timestamp,
- a severity label/icon (info, warning, error),
- the one-line message,
- the full detail text when present (expanded or inline depending on the row).

The log contains at most the 500 most recent entries; older entries are
discarded silently. It is cleared on app exit and is never written to disk.

### Warning filter

- `All` shows every entry.
- `Warnings` shows only warning-severity entries, including truncation and
  reload warnings.
- The filter survives new entries and `Clear`.
- With no matching entries, an explicit empty state is shown (e.g. "No warnings
  in this session"), never a blank area.

### Following behavior

| Situation | Result |
|-----------|--------|
| New entry, user at/near the bottom | Row appended; view stays at the bottom |
| New entry, user scrolled up | View does not jump; a `N new events` indicator appears |
| User scrolls back to the bottom | Indicator clears; following resumes |
| Filter changed | List re-renders; follow state is recomputed from the scroll position |
| Clear | Entries removed immediately; empty state shown; view stays open |

"Near the bottom" means within 24 px of the maximum scroll position.

### Performance and safety

- Appending one entry must not re-render the whole list or reset scroll.
- Opening, filtering, or clearing 500 entries must complete in under 100 ms
  (SC-004).
- Event text is rendered as text, never as HTML; warning/error details come from
  the backend and may contain arbitrary characters.
- The log does not accept document content, shell output, or file contents.

## 3. Sidebar separation

| Sidebar shows | Sidebar no longer shows |
|---------------|-------------------------|
| Open Documents list | Scan progress |
| Browse/All Documents list | Reload summaries |
| Filter and empty states | Warning lists or truncation notices |
| The "no configuration found" setup hint with the expected path | Watch/configuration errors |

The setup hint appears when no configuration exists and there is no load error.
Configuration errors live in the status bar and event log only (FR-010,
FR-011).
