# Feature Specification: Keyboard Shortcuts Help and Tab Closing

**Feature Branch**: `007-app-chrome-baseline`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "`?` zeigt ein Modal mit Keyboard-Shortcuts – vielleicht 2. Tab für ein Manual. Jede Tauri-App hat `?` als Overlay für Keyboard-Shortcuts sowie `Ctrl-W` (Tab schließen) und `Ctrl-Shift-T` (Tab wiederherstellen)."

## Context

docdeck is operated mostly from the keyboard: switching documents, reopening a
closed document, finding text, bookmarking and toggling panels all have
shortcuts, but the only place they are recorded is the code and a few tooltips.
A reader who forgets a chord has to guess or leave the app.

This feature adds a discoverable keyboard-shortcuts overlay and a short,
bundled manual behind the same help surface. It also completes the
browser-style tab shorthand with `Ctrl+W` to close the active document, which
pairs with the existing `Ctrl+Shift+T`.

The shortcut list must not become a second hand-maintained table. It is derived
from the same registry the handlers validate against, so a shortcut that exists
in the app cannot be missing from the overlay and a removed shortcut cannot
linger there.

## Clarifications

### Session 2026-11-21

- Q: Should `?` open help while the reader is typing in the browse filter or the
  find field? → A: No. `?` is a normal character while typing; help opens only
  outside editable fields.
- Q: What should the second tab contain? → A: A short manual bundled with the
  application, so it works offline and needs no network or external file.
- Q: Does `Ctrl+W` close the window when the last document is closed? → A: No.
  It closes the active document and leaves the application open. Closing the
  window stays an OS action.
- Q: What happens to `Ctrl+W` on macOS, where `Cmd+W` is the platform
  convention? → A: The feature ships `Ctrl+W` everywhere. `Cmd+W` remains the
  operating system's window action; the manual states the difference.
- Q: May help open on top of another dialog? → A: No. `?` is suppressed while
  any modal dialog is open.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a shortcut without leaving the app (Priority: P1)

A reader wants to jump to the event log but cannot remember the chord. They
press `?`, scan a grouped list of every application shortcut, find it, press
`Esc`, and use it.

**Why this priority**: This is the reason the overlay exists. It replaces
guessing and out-of-app documentation with an answer two keystrokes away.

**Independent Test**: Press `?` with no document open, confirm the overlay lists
the document, reading and panel shortcuts, close it with `Esc`, and confirm the
previously focused control is not lost.

**Acceptance Scenarios**:

1. **Given** no dialog is open, **When** the reader presses `?`, **Then** a modal
   dialog titled for help opens showing the shortcuts grouped by task.
2. **Given** the help dialog is open, **When** the reader presses `Esc`, **Then**
   the dialog closes and the application returns to the previous view.
3. **Given** the find field has focus, **When** the reader types `?`, **Then**
   the character is inserted and the help dialog does not open.
4. **Given** a shortcut uses the platform modifier, **When** the help dialog is
   shown on macOS, **Then** it displays `Cmd` where the application accepts
   `Cmd`, and `Ctrl` where the shortcut is Ctrl-only.

### User Story 2 - Read the manual in the same place (Priority: P2)

A reader wants to know how watched folders, unread marks or the browse filter
work. They open help and switch to the Manual tab, which explains the main
surfaces and workflows without leaving the application.

**Why this priority**: Shortcut chords alone do not explain the reading model.
The manual tab makes the help surface useful beyond memorised keys, and it costs
little once the dialog exists.

**Independent Test**: Open help, select the Manual tab, confirm it contains
sections for opening documents, reading, bookmarks and configuration, then
switch back to Shortcuts.

**Acceptance Scenarios**:

1. **Given** the help dialog is open, **When** the reader selects the Manual
   tab, **Then** the shortcut list is hidden and the manual is shown.
2. **Given** the reader is on the Manual tab, **When** they close and reopen
   help, **Then** help opens on the Shortcuts tab again.
3. **Given** the manual contains Markdown, **When** it is shown, **Then**
   headings, lists, tables and inline code are rendered like document content.

### User Story 3 - Close the active document with the keyboard (Priority: P1)

A reader finishes reviewing a document and presses `Ctrl+W` to close it. The
document disappears from the open list and the previous document becomes active,
exactly as if the row's close control had been used.

**Why this priority**: `Ctrl+W` is the expected browser and editor gesture. Its
absence is felt every time a document is finished.

**Independent Test**: Open two documents, press `Ctrl+W`, confirm the active
document closes and the other remains; press `Ctrl+Shift+T` and confirm the
closed document returns.

**Acceptance Scenarios**:

1. **Given** two documents are open, **When** the reader presses `Ctrl+W`,
   **Then** the active document closes, the other becomes active, and the
   application stays open.
2. **Given** the last open document is active, **When** the reader presses
   `Ctrl+W`, **Then** the document closes and the empty state is shown.
3. **Given** a modal dialog is open, **When** the reader presses `Ctrl+W`,
   **Then** no document closes.
4. **Given** a document was closed with `Ctrl+W`, **When** the reader presses
   `Ctrl+Shift+T`, **Then** that document reopens.

### Edge Cases

- `?` arrives with Shift on most layouts but without it on some; the key value
  decides, not the Shift state.
- `?` pressed with Ctrl, Cmd or Alt held is not the help shortcut.
- `Ctrl+W` pressed while the browse filter or find field has focus still closes
  the active document, matching browser behaviour.
- Help opened twice in a row must not stack two overlays.
- The manual is bundled; a missing or unreadable manual must show a readable
  error inside the dialog rather than an empty tab.
- The shortcut list must include shortcuts that are not simple modifier chords
  (for example the context-menu key and middle-click actions) so the overlay
  describes the real interaction surface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Pressing `?` outside an editable field and with no modal dialog
  open MUST open the help dialog.
- **FR-002**: The help dialog MUST be modal, MUST have an accessible name, and
  MUST close on `Esc`, on its close control, and on a click outside its panel.
- **FR-003**: The help dialog MUST present shortcuts grouped by task, with a
  human-readable key chord and a one-line description for each.
- **FR-004**: The shortcut list MUST be derived from the application's shortcut
  registry so every registered shortcut appears and no unregistered chord is
  invented.
- **FR-005**: Platform labels MUST follow the application's existing convention:
  `Cmd` for shortcuts that accept Cmd on macOS, `Ctrl` for Ctrl-only shortcuts.
- **FR-006**: The help dialog MUST offer a second tab containing a bundled
  manual rendered as Markdown.
- **FR-007**: Opening help MUST show the Shortcuts tab first, regardless of the
  tab used last time.
- **FR-008**: `Ctrl+W` MUST close the active document without closing the
  application or window.
- **FR-009**: `Ctrl+W` MUST be suppressed while a modal dialog is open.
- **FR-010**: `Ctrl+W` MUST be listed in the help dialog and MUST reserve the
  chord so a future configurable shortcut cannot reuse it.
- **FR-011**: A closed document MUST remain available to `Ctrl+Shift+T`.
- **FR-012**: A header control MUST open the same help dialog for pointer users.

### Key Entities

- **Shortcut reference**: A grouped, display-only view of the shortcut registry
  plus non-chord interactions (context menu, middle-click, Escape).
- **Help dialog**: A modal surface with two views, Shortcuts and Manual, and one
  close action.
- **Manual**: Bundled Markdown describing the application's main workflows.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can find any application shortcut in at most three
  actions: open help, scan one group, close help.
- **SC-002**: Every shortcut that the application handles appears in the help
  dialog; an automated test fails when the registry gains an entry that the
  dialog omits.
- **SC-003**: Closing the active document with `Ctrl+W` takes one keystroke and
  never terminates the application.
- **SC-004**: The help dialog opens in under 100 ms with no network access.
- **SC-005**: The manual is available offline on every supported platform.

## Assumptions

- The existing `Ctrl+Shift+T`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+D`, `Ctrl+F`
  and ``Ctrl+` `` shortcuts stay unchanged.
- The manual is a short, curated document rather than a full copy of the README.
- `Ctrl+W` is deliberately Ctrl-only so the app never intercepts or conflicts
  with the macOS `Cmd+W` window action.
- Help is a session-only surface; no preference is stored for the last tab.

## Out of Scope

- Remapping most shortcuts; the copy-Markdown shortcut is specified separately
  in `specs/006-copy-markdown-content`.
- A command palette.
- Opening help from the CLI or as a separate window.
- Closing the application window with a keyboard shortcut.
