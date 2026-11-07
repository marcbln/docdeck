# Feature Specification: Status Bar, Event Log, Window Title, and Resizable Panes

**Feature Branch**: `N/A` (spec directory: `specs/004-status-bar-event-log`)

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "The window title should show the project name, then the document filename, then 'docdeck'. Put the scanning/status noise into a one-line footer instead of the navigation pane, and add a PhpStorm-style event log pane. Side panes and the log should be resizable with the mouse."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quiet left navigation, status moved to a one-line footer (Priority: P1)

A user keeps docdeck open while agents rewrite files in several projects. Today the left sidebar mixes document navigation with transient scan text ("Configuration reloaded 4m ago. 3 warnings.", "Results were truncated.", "Some paths were skipped…"), so the lists are harder to scan. The user wants navigation on the left and a single, calm status line at the bottom of the window.

**Why this priority**: The clutter is the original complaint and affects every session. Moving it makes the primary navigation usable without losing visibility of watch health.

**Independent Test**: Launch docdeck with at least one watch, let the initial scan finish, and confirm the left sidebar contains only document lists (plus the actionable setup hint when no configuration exists) while a single status line at the bottom reports scanning, reloads, and a warning count.

**Acceptance Scenarios**:

1. **Given** docdeck is starting up, **When** the initial scan runs, **Then** the bottom status line shows live progress with the current location and folder/file counts, and the sidebar shows no scan text.
2. **Given** a scan has completed, **When** the user looks at the bottom status line, **Then** it shows the most recent watch event and, if any exist, a warning count.
3. **Given** no watch configuration exists, **When** the app loads, **Then** the sidebar still shows the actionable setup hint with the expected configuration path.
4. **Given** the status line is idle, **When** no event is pending, **Then** it remains a single quiet line rather than disappearing or growing.

---

### User Story 2 - Window title identifies the project and document (Priority: P1)

A user juggling several docdeck windows and projects wants the operating-system window title to answer "which project and which document is this?" without switching windows. The title should read `project — filename — docdeck`.

**Why this priority**: It is a small change with constant value, especially when several windows are open or tabs are switched frequently.

**Independent Test**: Open a document under a project's `_ai` folder and confirm the window title becomes `project — filename — docdeck`; switch to a document without a project and confirm the project segment is omitted.

**Acceptance Scenarios**:

1. **Given** a document inside a project (`…/ruleman/_ai/…/README.md`) is active, **When** the tab is activated, **Then** the window title reads `ruleman — README.md — docdeck`.
2. **Given** a document that is not under any `_ai` folder is active, **When** it is activated, **Then** the title reads `filename — docdeck` with no misleading project segment.
3. **Given** no document is open, **When** the last tab closes, **Then** the title returns to `docdeck`.
4. **Given** several documents are open, **When** the user switches tabs, **Then** the title updates for the newly active document.

---

### User Story 3 - Inspect watch history in an event log pane (Priority: P2)

A user notices a warning count or truncated results and wants details without opening a configuration file or console. They open a docked event log above the status line, read timestamped events, optionally filter to warnings, and can clear the history.

**Why this priority**: It replaces the details that used to live in the sidebar and makes watch problems diagnosable in place, but the app is still usable without it.

**Independent Test**: Trigger a configuration reload with warnings, open the event log from the status line, and confirm timestamped entries with severity and full warning text; filter to warnings, clear the log, and close it again.

**Acceptance Scenarios**:

1. **Given** the event log is closed, **When** the user clicks the status line or presses the log shortcut, **Then** the log opens above the status line and the document area shrinks instead of being covered.
2. **Given** the log contains entries, **When** the user selects the warnings filter, **Then** only warning entries are shown.
3. **Given** the user has scrolled up in the log, **When** new events arrive, **Then** the view does not jump and a count of new events is offered; returning to the bottom resumes following.
4. **Given** the log is open, **When** the user clears it, **Then** all entries are removed for the rest of the session and subsequent events start a fresh list.
5. **Given** focus is inside the log, **When** the user presses Escape, **Then** the log closes without closing the active document or tab.

---

### User Story 4 - Resize panes with the mouse and keep the sizes (Priority: P2)

A user with a wide monitor or a long document wants to widen the sidebar or outline, shrink them to make room for content, and make the event log taller while reading warnings. Sizes should survive a restart.

**Why this priority**: Resizing materially improves reading space, but the feature remains usable at the default widths.

**Independent Test**: Drag each boundary (sidebar width, outline width, log height, Open/Browse split), close and reopen docdeck, and confirm the sizes return; double-click each boundary to confirm the defaults return.

**Acceptance Scenarios**:

1. **Given** the sidebar and outline are visible, **When** the user drags their boundaries, **Then** both panes resize within their allowed limits and the document area remains usable.
2. **Given** the event log is open, **When** the user drags its top edge, **Then** the log grows or shrinks within its limits.
3. **Given** the user has resized panes, **When** docdeck is restarted, **Then** the previous sizes are restored.
4. **Given** a pane is resized, **When** the user double-clicks its boundary, **Then** it returns to its default size.
5. **Given** a pane is hidden or collapsed, **When** the user attempts to drag its boundary, **Then** nothing moves and the visible panes are unaffected.

### Edge Cases

- A document path contains more than one `_ai` segment: use the deepest one.
- A document path has no `_ai` segment: omit the project from the window title.
- A filename is very long or contains unusual Unicode: the title is still composed predictably; the operating system may truncate it visually.
- The window is narrower than the stored pane widths: panes are re-clamped so the document area keeps a usable minimum, without overwriting the stored preference.
- The stored layout values are missing, corrupt, or out of range: defaults are used.
- The outline is hidden while the sidebar is visible: the sidebar boundary still resizes the sidebar, and the outline boundary is inert.
- The event log is closed: its resize handle is inert and reopening restores its last height.
- The scan produces events rapidly: the log does not record every progress tick; the status line updates live and the log records start and completion.
- Warning count is zero: no warning chip is shown.
- The log contains no entries: an explicit empty state is shown, not a blank area.

## Requirements *(mandatory)*

### Functional Requirements

**Window title**

- **FR-001**: The window title MUST be composed as `project — document filename — docdeck` when the active document belongs to a project, using the project segment directly above the document's deepest `_ai` folder.
- **FR-002**: The window title MUST omit the project segment when the active document is not under an `_ai` folder, producing `document filename — docdeck`.
- **FR-003**: The window title MUST be exactly `docdeck` when no document is active.
- **FR-004**: The window title MUST update within 200 ms of activating a tab, opening a document, or closing the active tab.

**Status line**

- **FR-005**: The application MUST show a single-line status bar spanning the full window width at the bottom.
- **FR-006**: During a scan, the status bar MUST show the current location and the number of folders and files processed, updating without perceptible delay.
- **FR-007**: After a scan, reload, or error, the status bar MUST show the most recent watch event, with visual severity (informational, warning, error).
- **FR-008**: When one or more warnings exist, the status bar MUST show a warning count that reveals the corresponding entries when activated.
- **FR-009**: The status bar MUST NOT truncate essential meaning: when space is insufficient, it shortens the location (for example with a leading ellipsis) before hiding counts.
- **FR-010**: The left navigation sidebar MUST NOT display scan progress, reload summaries, warning lists, truncation notices, or watch errors.
- **FR-011**: The left navigation sidebar MUST retain the actionable "no configuration found" setup hint, including the expected configuration path.

**Event log**

- **FR-012**: The event log MUST record watch and scan lifecycle events: scan start and completion, configuration reload outcomes, warnings, truncation, watch added/removed, and watch-related errors.
- **FR-013**: The event log MUST record each entry with a timestamp, severity, one-line message, and optional detail text.
- **FR-014**: The event log MUST NOT record document activity, tab activity, link handling, copy actions, or summary requests.
- **FR-015**: The event log MUST be session-only; entries MUST NOT be persisted across restarts.
- **FR-016**: The event log MUST retain at least the 500 most recent entries and discard the oldest beyond that.
- **FR-017**: The event log MUST open and close from the status bar and from a keyboard shortcut, and MUST close on Escape when focus is inside it.
- **FR-018**: When open, the event log MUST push the document area up so no content is permanently covered.
- **FR-019**: The event log MUST provide a warnings filter and a clear action.
- **FR-020**: The event log MUST follow new entries automatically, pause following when the user scrolls away from the bottom, indicate how many entries arrived while paused, and resume following when the user returns to the bottom.
- **FR-021**: The event log MUST show an explicit empty state when there are no entries.
- **FR-022**: The status bar and event log MUST NOT block document scrolling, tab switching, or link activation.

**Resizable panes**

- **FR-023**: Users MUST be able to resize the sidebar width with the mouse, bounded between 200 px and the smaller of 600 px or half the window width.
- **FR-024**: Users MUST be able to resize the outline width with the mouse, bounded between 160 px and the smaller of 480 px or half the window width.
- **FR-025**: Users MUST be able to resize the event log height with the mouse while it is open, bounded between 100 px and 60% of the window height.
- **FR-026**: Users MUST be able to resize the split between the Open Documents and Browse sections of the sidebar, bounded so each section occupies between 15% and 85% of the sidebar's usable height.
- **FR-027**: Each resize boundary MUST return its pane to the default size when double-clicked.
- **FR-028**: Each resize boundary MUST be keyboard operable: focused with Tab, adjusted by arrow keys, and announced with an accessible label and orientation.
- **FR-029**: A resize boundary MUST be inert when its pane is hidden or collapsed.
- **FR-030**: Resizing MUST NOT re-render document content or cause the document text to reflow beyond the change in available width.
- **FR-031**: Resized sizes MUST be remembered across restarts and restored on launch; when stored values are missing or invalid, defaults MUST be used.
- **FR-032**: On window resize, pane sizes MUST be clamped to the current window so the document area stays usable, without discarding the user's stored preference.

### Key Entities *(include if data involved)*

- **Status Event**: A watch or scan occurrence. Attributes: timestamp, severity (informational, warning, error), one-line message, optional detail text.
- **Document Identity**: The active document's project name (optional), filename, and whether a document is active at all.
- **Layout Preference**: Remembered sizes for sidebar width, outline width, event log height, and the Open Documents/Browse split.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the initial scan, the left sidebar contains zero persistent scan, reload, warning, truncation, or watch-error messages, while retaining the setup hint when no configuration is present.
- **SC-002**: Switching between tabs updates the window title in under 200 ms for 95% of switches, and the title always matches the active document.
- **SC-003**: A user can reach the full text of any warning from the status bar in at most two interactions (open the log, select the warning).
- **SC-004**: The event log remains responsive with 500 entries, and opening or clearing it takes under 100 ms.
- **SC-005**: 100% of resize operations keep the document area at least 320 px wide, and no resize can make a pane exceed its stated bounds.
- **SC-006**: After restarting the application, all four pane sizes are restored within 2 px of their previous values.
- **SC-007**: During a drag, the document text does not scroll or re-render; only the pane boundaries move.
- **SC-008**: A user who has never resized anything sees the same default layout and reading width as before this feature.

## Assumptions

- A document "belongs to a project" only when its path contains an `_ai` folder with a named parent; there is no guessing from watch roots or working directories.
- All supported desktop platforms expose an operating-system window title that can be updated while running.
- The event log is a diagnostic and convenience surface, not a durable audit log; session-only retention is acceptable.
- The default sizes preserve today's layout: sidebar 300 px, outline 240 px, event log 200 px, and an even Open/Browse split.
- The event log's height and visibility are not persisted; only the sizes are remembered.
- Warning details and the "no configuration" hint remain reachable without the event log being open, because the status bar and sidebar expose them.
- No new runtime dependency is required to deliver this feature.
- Document content remains read-only; this feature changes only window chrome, navigation layout, and preference storage.
