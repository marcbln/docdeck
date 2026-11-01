# Contract: User-Visible Interactions

**Feature**: `002-watch-inbox-followups` | **Date**: 2026-11-01

This contract maps the specification's acceptance scenarios to observable UI
behavior. It intentionally describes outcomes, not implementation.

## 1. Live configuration reload

| Trigger | Observable result |
|---------|-------------------|
| Valid config saved (in-app or externally) | Browse list reflects added/removed matches within 2 s for normal selectors; open documents and the active document are unchanged; no existing document becomes unread because of the reload |
| Exclusions changed | Matching rows leave the browse list; later writes to them are ignored; open tabs stay open |
| Invalid config saved externally | Last valid configuration keeps running; a visible, actionable error appears with the config path and recovery hint |
| Invalid config corrected and saved | Error clears; corrected config applies without restart |
| Config deleted or unreadable | Applied watches continue; first-run/setup hint explains how to recreate the config |
| CLI session folder present | It remains watched across reloads and is rescanned with the new excludes |
| Rapid repeated saves | Only the last valid configuration is applied; no duplicate or flickering rows |

## 2. Cross-session unread

| Trigger | Observable result |
|---------|-------------------|
| First launch, no history | Nothing is unread; a baseline is recorded so later changes are detectable |
| Restart after a document changed while closed | That document is unread and near the top of the newest-first list |
| Restart after a document was reviewed and unchanged | Document is read |
| Review an unread document | Unread clears immediately and survives the next restart |
| Document modified while it is the active document | It stays read after restart (clarification) |
| Document disappears while closed | Not shown as unread; its acknowledgement is pruned |
| Acknowledgement store corrupt/unreadable | App starts normally, treats it as a first launch, no false unread |
| Document leaves all watches, later re-added | Appears unread (clarification) |
| Recently Changed after restart | Empty, as before; unread markers may still exist in All Documents |

## 3. Filtering

- A search field sits above the browse list and applies to the selected list.
- Typing narrows by filename, parent folder, or project name,
  case-insensitively, preserving relative order.
- The term survives switching All Documents ↔ Recently Changed.
- One action (clear control or `Escape` in the field) restores the full list.
- No matches shows "No documents match “…”" plus a clear action.
- Newly discovered matching rows appear; non-matching rows stay hidden.
- Opening or reviewing a row is unaffected by the filter.
- The text cursor and focus remain stable while watcher events repaint rows.
- The pop-out inventory shows the same filtered set.
- Filtering never changes unread/open/active/deleted state.

## 4. Rename and move tracking

| Event | Observable result |
|-------|-------------------|
| Rename/move inside watched locations | One row updates to the new name within 2 s; no duplicate or deleted row; open/read/active state is preserved |
| Unread document renamed | Remains unread under the new name |
| Active document renamed | Remains active |
| Move to another watched location | Updated in place, not reported as new |
| Move out of all watched locations | Row leaves the browse list; any open tab shows the existing unavailable-file banner |
| Move into a watched location | Appears as a new unread row |
| Move/rename into an excluded location | Row leaves the browse list |
| Rapid successive renames | Only the final name is shown |
| Case-only rename on a case-insensitive platform | One row, new casing |

## 5. In-app configuration surface

- A **Watches** control in the header opens the surface, including when the
  browse section is hidden.
- Header of the surface shows: effective config path, whether it exists, current
  validity, and the result of the most recent reload (time, warnings,
  truncation, error).
- No file → **Create from example** produces a working configuration; saving it
  applies immediately.
- Add/remove watch and exclude selectors; Enter adds a row; each row has a
  labelled remove control.
- **Save** validates, persists, and applies without restart.
- Invalid input: precise error next to the field or at the top, nothing applied,
  draft preserved.
- Existing file is unparseable: the parse error is shown, Save is disabled, and
  **Open config file** opens it in the OS editor. The file is never silently
  overwritten.
- Duplicate selectors are reported/folded so no document is listed twice.
- Outside edit detected before save → conflict banner; reader can reload the
  file or explicitly overwrite; no silent overwrite.
- Non-writable config → explained error, previous config stays active, retry
  available.
- Closing with unsaved changes asks for confirmation; `Esc` respects the same
  rule.
- Keyboard: all controls are reachable by Tab, `Esc` closes, focus returns to
  the opening control.

## 6. Platform parity

- On macOS and Windows the config is discovered in the platform-standard
  location on first launch.
- Forward-slash selectors behave identically on every platform; native Windows
  backslash selectors are accepted and normalized.
- Live reload, unread, filtering, rename tracking, and the config surface behave
  the same on all three platforms.
- Unreadable/unwritable config shows the same non-fatal guidance everywhere.

## 7. Preserved behavior (no regressions)

- Open Documents row selection, close, close-all, context menu, copy path,
  Auto-Sort, and reopen-closed-tab shortcut unchanged.
- Clear/Undo in Recently Changed unchanged and still session-scoped.
- Deleted rows and deleted-tab banners unchanged for ordinary deletion.
- Virtualized scrolling, theme, TOC, frontmatter, find, Mermaid zoom, and tray
  notifications unchanged.
