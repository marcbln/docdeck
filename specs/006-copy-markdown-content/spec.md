# Feature Specification: Copy Markdown Content

**Feature Branch**: `006-copy-markdown-content`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Add a way to copy a document's raw Markdown source to the clipboard, triggered from the tab context menu and by a keyboard shortcut that is shown in the menu label."

## Clarifications

### Session 2026-11-19

- Q: When the user opens the tab menu on a tab that is not the active document and chooses Copy Markdown, what should be copied? → A: The right-clicked tab's source is copied without switching tabs.
- Q: Should the copy shortcut do nothing while a modal dialog is open? → A: Yes; the shortcut is suppressed while any modal dialog (browse, config, summary, mermaid fullscreen) is open.
- Q: Should the copy shortcut be fixed or user-configurable? → A: User-configurable, with a persisted preference and a settings control; other app shortcuts stay fixed.
- Q: Where should the configurable shortcut be stored? → A: In a separate `shortcuts.toml` file in the docdeck config directory (`~/.config/docdeck` on Linux), not in the watch config.
- Q: What should happen when the user picks a shortcut already used by another app shortcut? → A: Reject it with an explanatory message and keep the previous shortcut.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copy a document's source from the tab menu (Priority: P1)

A reviewer is reading an agent-written plan in docdeck and wants to hand its exact
Markdown to an agent or web chat. They right-click the document's tab, choose
**Copy Markdown**, and the document's raw source is on the clipboard, confirmed
by a brief on-screen message.

**Why this priority**: This is the core value. It lets a user move a document's
source from the viewer into another tool without opening the file in an editor or
file manager. It is independently useful even without the shortcut.

**Independent Test**: Open a document, invoke **Copy Markdown** from its tab menu,
and paste into a plain-text field; the pasted text must equal the document's
source exactly, and a confirmation must appear.

**Acceptance Scenarios**:

1. **Given** a document is open and active, **When** the user chooses **Copy
   Markdown** from its tab menu, **Then** the document's entire raw Markdown
   source is placed on the clipboard and a success message is shown.
2. **Given** the document starts with a YAML frontmatter block, **When** the user
   copies its Markdown, **Then** the frontmatter is included verbatim in the
   copied text.
3. **Given** the document is long and scrolled far down with text selected,
   **When** the user copies its Markdown, **Then** the whole source is copied
   regardless of scroll position or selection.
4. **Given** the user opens the tab menu on a tab that is not the active
   document, **When** they choose **Copy Markdown**, **Then** that tab's raw
   source is copied and the active document does not change.

---

### User Story 2 - Copy the active document with a keyboard shortcut (Priority: P2)

A keyboard-driven user wants to copy the current document's source without
reaching for the mouse. They press the shortcut shown next to the menu item, and
the active document's source is copied with the same confirmation.

**Why this priority**: It speeds up a frequent action and makes the feature
discoverable, but the feature still delivers value through the menu alone.

**Independent Test**: With a document active, press the copy shortcut and paste
into a plain-text field; the active document's source must be present.

**Acceptance Scenarios**:

1. **Given** a document is active, **When** the user presses the documented
   shortcut, **Then** the active document's source is copied and confirmed.
2. **Given** the user is typing in a text field such as the browse filter,
   **When** they press the shortcut, **Then** their typing is unaffected and no
   copy is triggered.
3. **Given** a modal dialog is open, **When** the user presses the shortcut,
   **Then** no copy is triggered.

---

### User Story 3 - Change the copy shortcut (Priority: P3)

A user whose editor or terminal already uses Ctrl+Shift+C wants to avoid the
clash. They open the settings control, record a new combination, and the
shortcut and menu hint immediately use it. If they choose a combination that is
invalid or already taken by another app shortcut, they are told why and their
previous shortcut stays in effect.

**Why this priority**: The default works for most users; remapping matters only
for people whose other tools claim the same combination, but it lets the feature
fit their setup without conflicts.

**Independent Test**: Open the settings control, set a new valid combination,
confirm the menu hint updates, use the new shortcut to copy, restart the app,
and confirm the shortcut still works. Then try a conflicting combination and
confirm it is rejected.

**Acceptance Scenarios**:

1. **Given** the settings control is open, **When** the user records a valid new
   combination and saves, **Then** the shortcut and the menu hint use it
   immediately and it remains in effect after a restart.
2. **Given** the user tries an invalid or already-used combination, **When** they
   confirm, **Then** the change is rejected with an explanatory message and the
   previous shortcut remains in effect.
3. **Given** the user chooses to restore the default, **When** they save, **Then**
   the default shortcut and menu hint return.
4. **Given** `shortcuts.toml` is missing, malformed, or holds an invalid entry,
   **When** the app starts, **Then** the default shortcut is used and the app
   starts normally.

---

### Edge Cases

- **No document active**: the shortcut does nothing and shows no error.
- **Document removed from disk after it was opened**: copying still yields the
  last content the viewer displayed.
- **Clipboard unavailable or access denied**: the user sees a failure message and
  the document is left untouched.
- **Modal dialog open**: the shortcut is ignored and nothing is copied behind the
  dialog.
- **Very large document**: the copy completes and confirms; it does not freeze the
  interface.
- **Menu label on each platform**: the shortcut hint renders the configured
  combination using the platform's conventional modifier name (Ctrl on
  Linux/Windows, Cmd on macOS).
- **Conflicting or invalid shortcut choice**: the settings control rejects it
  with a message and the previous shortcut stays in effect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tab context menu MUST offer a **Copy Markdown** action for a
  document.
- **FR-002**: The **Copy Markdown** menu label MUST display its keyboard shortcut
  in brackets next to the action name.
- **FR-003**: Choosing **Copy Markdown** MUST place the entire raw Markdown
  source of the document whose tab was right-clicked on the clipboard,
  including any YAML frontmatter, verbatim, without changing the active
  document.
- **FR-004**: The copy MUST cover the whole document, independent of the current
  scroll position or any text selection.
- **FR-005**: A keyboard shortcut MUST copy the active document's source with the
  same result as the menu action.
- **FR-006**: The shortcut MUST be user-configurable, default to Ctrl+Shift+C on
  Linux/Windows and Cmd+Shift+C on macOS, and MUST match the hint shown in the
  menu at all times, including after the user changes it.
- **FR-007**: The shortcut MUST NOT fire while the user is typing in a text entry
  field or editable region, or while a modal dialog (browse, config, summary, or
  mermaid fullscreen) is open; in those cases behavior MUST be as if the
  shortcut did not exist.
- **FR-008**: When no document is active, the shortcut MUST be a no-op with no
  error.
- **FR-009**: A successful copy MUST show a brief confirmation; a failed copy MUST
  show an error message.
- **FR-010**: Copying MUST NOT modify, save, or otherwise write the document.
- **FR-011**: The app MUST provide a settings control where the user can view,
  change, and restore the default of the copy shortcut; the setting MUST be
  stored in a separate `shortcuts.toml` file in the docdeck config directory
  (for example `~/.config/docdeck/shortcuts.toml` on Linux), not in the watch
  config.
- **FR-012**: A user-configured shortcut MUST be remembered across restarts.
- **FR-013**: Only the copy shortcut MUST be remappable; the existing tab, log,
  and navigation shortcuts MUST remain fixed.
- **FR-014**: Valid changes to the shortcut setting MUST take effect without
  restarting the app, including edits saved through the settings control.
- **FR-015**: A missing, malformed, invalid, or conflicting shortcut entry MUST
  fall back to the default shortcut and MUST NOT prevent the app from starting.
- **FR-016**: The settings control MUST reject a shortcut that lacks a platform
  modifier or that is already used by another app shortcut, MUST explain the
  rejection, and MUST keep the previous shortcut in effect.

### Key Entities

- **Document source**: The raw Markdown text of an open document as currently
  loaded by the viewer, including an optional YAML frontmatter block. It is
  read-only from the feature's perspective.
- **Shortcut configuration**: The key combination that triggers copying, stored
  in `shortcuts.toml` in the docdeck config directory. It has a platform-aware
  default and a user-chosen value; it is validated on load and on save.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can copy the active document's source with a single action
  (one menu choice or one shortcut press) and sees confirmation within 1 second
  for a typical document.
- **SC-002**: In verification, the copied text matches the document's source
  exactly, including frontmatter, in 100% of cases.
- **SC-003**: The shortcut hint is visible in the menu label on both the Ctrl and
  Cmd platforms and reflects any user-configured shortcut, so the shortcut is
  discoverable without documentation.
- **SC-004**: The feature performs zero writes to any document (100% of copy
  actions leave files unchanged).
- **SC-005**: Pressing the shortcut while typing never alters or blocks text
  entry in any tested text field.
- **SC-006**: Pressing the shortcut while a modal dialog is open triggers zero
  copies in 100% of tested modal states.
- **SC-007**: A user-configured shortcut remains in effect after an app restart
  in 100% of tested restarts.
- **SC-008**: A missing, malformed, or invalid shortcut configuration falls back
  to the default and the app still starts in 100% of tested cases.
- **SC-009**: In 100% of tested attempts to save an invalid or conflicting
  shortcut, the change is rejected, an explanation is shown, and the previous
  shortcut still works.

## Assumptions

- The copied source is the document's currently loaded content; if a background
  update is still arriving, the copy may reflect the immediately preceding
  content rather than a write that has not yet been applied.
- The feature copies the whole document, not the current selection.
- YAML frontmatter is part of the source and is included.
- The action lives on the tab context menu and its shortcut; sidebar rows are out
  of scope for this feature.
- Only plain-text Markdown is placed on the clipboard; no rich-text or HTML
  variant is produced.
- The default shortcut is Ctrl+Shift+C on Linux/Windows and Cmd+Shift+C on macOS.
- The copy shortcut is stored in a separate `shortcuts.toml` in the docdeck
  config directory; the watch `config.toml` is unchanged.
- Only the copy shortcut is remappable in this feature; the other app shortcuts
  are out of scope for remapping.

## Dependencies and coordination with 005-document-bookmarks

This feature is planned and implemented **after**
`005-document-bookmarks`, which is already fully tasked. 005 adds **Bookmark
document / Remove bookmark** to the same tab context menu and `Ctrl`/`Cmd`+`D`
as an application shortcut. The two features must not be implemented
concurrently because they edit `src/main.ts`, `src/tab-menu.ts`, `src/style.css`,
`README.md` and `CHANGELOG.md`.

Reconciliation decisions:

- 005 adds a shared `src/shortcuts.ts` registry containing the fixed shortcuts
  (`Ctrl`/`Cmd`+`D`, `Ctrl`+`Tab`, `Ctrl`+`Shift`+`Tab`,
  `Ctrl`/`Cmd`+`Shift`+`T`, `Ctrl`/`Cmd`+`` ` ``, `Ctrl`/`Cmd`+`F`), a
  platform-aware label formatter and a typing-target guard. This feature reuses
  that registry for conflict validation; it must not introduce a second shortcut
  parser or formatter.
- 005 adds a generic tab-menu item helper accepting a label, an optional
  shortcut hint and a callback. This feature adds its **Copy Markdown** item
  through that helper; it does not restructure the menu again.
- 005 adds the `BookmarkPicker` modal with `role="dialog"` and
  `aria-modal="true"`, and a shared modal-open predicate. This feature's
  shortcut suppression must include that picker in addition to the browse,
  config, summary and Mermaid-fullscreen dialogs.
- The shortcut editor lives in the existing Config/Watches panel. It must not be
  added to the Bookmarks toolbar, where 005 places its notification setting.
- Persistence stays separate: 005 owns `docdeck.bookmarks.v1` and the two
  `docdeck.preferences.v1` fields. This feature owns `shortcuts.toml` and amends
  the constitution's Persistence section itself when implemented; 005's
  amendment deliberately does not pre-declare this store.
- A valid copy shortcut must reject the fixed shortcuts above as conflicts, so
  `Ctrl`/`Cmd`+`D` is unavailable for remapping to the copy action.

This section is a planning constraint, not an implementation of feature 006. Its
own plan, tasks and quickstart are produced after 005 lands.
