# Feature Specification: Left Sidebar Document Navigation

**Feature Branch**: `001-sidebar-document-lists`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Replace the top tab strip with a single left sidebar that stacks two lists above each other: an Open Documents list to switch between open documents, and a browse list below it that can switch between All Documents and Recently Changed. Recently Changed is a growing, session-scoped list of distinct documents touched since launch, clearable with a Clear action that acknowledges changes and can be undone. Remove the layout toggle; keep the sidebar always present."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch between open documents from the sidebar (Priority: P1)

A reader has several documents open and moves between them using the sidebar's **Open Documents** list instead of a horizontal tab strip. The active document is visibly highlighted, unread changes carry a marker, and each row offers a close control.

**Why this priority**: Without a way to switch between open documents, the application is unusable. This story alone delivers a working viewer and is the minimum shippable slice.

**Independent Test**: Open three documents, click each row in the Open Documents list, and confirm the correct document is shown and highlighted. Close one row and confirm it leaves the list. This can be fully tested without the browse list.

**Acceptance Scenarios**:

1. **Given** two or more open documents, **When** the reader activates a row in Open Documents, **Then** that document is displayed and its row is highlighted as active.
2. **Given** an open document with an unread change, **When** the reader activates its row, **Then** the unread marker clears for that row.
3. **Given** an open document, **When** the reader activates its close control, **Then** the document leaves Open Documents and a later document becomes active.
4. **Given** a document closed earlier in the session, **When** the reader invokes the reopen shortcut, **Then** the most recently closed document returns as an open row.
5. **Given** Auto-Sort is enabled, **When** a document is written by an agent, **Then** Open Documents reorders to put the most recently modified document first.
6. **Given** an open document is deleted on disk, **Then** its row remains visible with a deleted indication until it reappears or is closed.

---

### User Story 2 - Browse the complete document inventory inline (Priority: P2)

A reader scans every watched document in the sidebar's **All Documents** view, sees which ones are open or changed, and opens or returns to a document directly from that list.

**Why this priority**: Discovering documents is the second most important navigation job, but the viewer remains usable with only Open Documents.

**Independent Test**: With a watch configuration matching several documents, switch the browse list to All Documents and confirm every watched document appears exactly once with its location and modification time, and that activating one opens it as an open document.

**Acceptance Scenarios**:

1. **Given** watched documents, **When** the reader selects All Documents, **Then** every watched document appears exactly once in the browse list.
2. **Given** a document that is already open, **When** it appears in All Documents, **Then** it is marked as open there.
3. **Given** a document in All Documents, **When** the reader activates it, **Then** it opens as an open document or, if already open, becomes the active document.
4. **Given** thousands of watched documents, **When** the reader scrolls the browse list, **Then** the list remains responsive and does not stall document switching.
5. **Given** a scan is in progress, **When** the reader looks at the browse list, **Then** the current scan status and any configuration warnings are visible.
6. **Given** a large inventory, **When** the reader requests the expanded browse view, **Then** the complete inventory opens in a full-height view they can dismiss.

---

### User Story 3 - Review and clear recent activity (Priority: P3)

A reader uses **Recently Changed** to see which distinct documents agents have touched since launch, newest first, and clears that activity list once reviewed. Clearing also acknowledges the unread markers, and an undo restores the previous state.

**Why this priority**: This is the application's core monitoring value, but it builds on the two navigation lists and can be added once they exist.

**Independent Test**: With Recently Changed selected, write to several documents, confirm each appears once in newest-first order, clear the list, confirm it empties and unread markers clear, then undo and confirm the list and markers return.

**Acceptance Scenarios**:

1. **Given** an agent writes to a document not yet listed, **When** the write settles, **Then** that document appears in Recently Changed with the newest change first.
2. **Given** a document written several times, **Then** it appears once, ordered by its most recent change.
3. **Given** a document that is both open and recently changed, **Then** it may appear in both lists; each list still shows it at most once.
4. **Given** a Recently Changed list with entries, **When** the reader clears it, **Then** the list empties and all unread markers for changes up to that moment are cleared.
5. **Given** the reader has just cleared Recently Changed, **When** they undo, **Then** the previous list contents and unread markers are restored.
6. **Given** Recently Changed was cleared, **When** an agent writes to a document afterwards, **Then** that document reappears in Recently Changed.
7. **Given** Recently Changed is empty at launch, **Then** the list explains that no changes have occurred and offers a way to switch to All Documents.
8. **Given** a deleted document, **Then** it remains in Recently Changed until it is cleared or reappears.

---

### Edge Cases

- When All Documents is empty because no watch configuration matches anything, the browse list explains the situation and how to configure watches.
- When the Open Documents list grows beyond the space available, it scrolls independently and does not push the browse list off screen.
- When a document is open and the reader collapses the browse area, Open Documents remains available so navigation never becomes impossible.
- When a stale scan finishes after the reader changed the browse mode, the result is still shown under the correct mode.
- When the active document is closed and no documents remain open, the reading pane shows the empty state and the sidebar still explains how to open one.
- When the reader clears Recently Changed while a scan is still running, documents discovered after the clear are not silently marked as read.
- When a row's underlying file disappears, reopen and open actions report the failure rather than leaving the application in a loading state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST present a single left navigation sidebar and MUST NOT present a horizontal tab strip.
- **FR-002**: The sidebar MUST stack an Open Documents section above a browse section.
- **FR-003**: Open Documents MUST show exactly one row per open document, including its filename, active indication, unread indication, deleted indication, and a close control.
- **FR-004**: Activating an Open Documents row MUST display that document; activating its close control MUST close it.
- **FR-005**: Open Documents MUST preserve the existing document actions: copy a document's path from a row, and reopen the most recently closed document by shortcut.
- **FR-006**: Open Documents MUST order rows by open order unless Auto-Sort is enabled, in which case it MUST order them by most recent modification.
- **FR-007**: The browse section MUST offer two mutually exclusive modes, All Documents and Recently Changed, with the selected mode always visible.
- **FR-008**: All Documents MUST list every watched document exactly once, with filename, identifying location, modification time, and open/unread/deleted state.
- **FR-009**: Recently Changed MUST list distinct documents changed or deleted since launch, newest first, with the same row information as All Documents.
- **FR-010**: Recently Changed MUST NOT record repeated changes to the same document as separate entries.
- **FR-011**: A document MAY appear in both Open Documents and Recently Changed; each list individually MUST NOT duplicate a document.
- **FR-012**: The browse section MUST provide a Clear action that empties Recently Changed and acknowledges unread markers for changes up to the moment of clearing.
- **FR-013**: Clearing MUST be undoable, restoring the previous Recently Changed contents and unread markers.
- **FR-014**: Changes occurring after a clear MUST reappear in Recently Changed.
- **FR-015**: Activating a row in either browse mode MUST open that document as an open document, or activate it if already open.
- **FR-016**: The sidebar MUST always be available; the existing inbox control MUST only show or hide the browse section, never the Open Documents section.
- **FR-017**: The layout toggle that switches between top tabs and a left rail MUST be removed.
- **FR-018**: Both sidebar sections MUST be individually collapsible, and their collapsed state MUST be remembered across restarts.
- **FR-019**: The selected browse mode MUST be remembered across restarts; Recently Changed contents MUST remain session-scoped and MUST NOT be restored after a restart.
- **FR-020**: The browse section MUST keep scan progress, configuration errors, and warnings visible to the reader.
- **FR-021**: The browse section MUST remain responsive with thousands of watched documents, with independently scrollable lists.
- **FR-022**: The application MUST retain the expanded full-height view of the complete inventory, reachable from the browse section.
- **FR-023**: Unread markers MUST distinguish an unread background change from a brief acknowledgement pulse on the active document.
- **FR-024**: When Recently Changed has no entries, the browse section MUST show an empty explanation and a way to switch to All Documents.
- **FR-025**: When no documents are open, the reading pane MUST show an empty state while the sidebar remains usable.

### Key Entities *(include if feature involves data)*

- **Open Document**: A document currently loaded in the reading pane. Key attributes: location, filename, last modification time, open order, unread state, deleted-on-disk state, and active state.
- **Watched Document**: A document discovered through the watch configuration or a session folder. Key attributes: location, filename, project context, last modification time, and whether it is open.
- **Recent Change**: The latest change to a distinct document during the current session. Key attributes: location, last change time, unread state, and deleted state.
- **Sidebar Preferences**: Reader choices that persist across restarts. Key attributes: selected browse mode, collapsed state of each section, and Auto-Sort state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can switch to any open document with a single activation from the sidebar, with no horizontal tab strip in the interface.
- **SC-002**: With 10,000 watched documents, scrolling the browse list and switching documents each respond within 100 milliseconds, with no visible freeze.
- **SC-003**: A reader can complete the primary tasks — switch document, open a watched document, review recent changes, clear recent changes — without opening a separate window or dialog.
- **SC-004**: Every pre-existing document-navigation capability (active indication, unread markers, close, reopen, copy path, Auto-Sort) remains available after the change.
- **SC-005**: Clearing recent activity and undoing it restores the list and unread markers in 100% of attempts in testing.
- **SC-006**: A reader can always reach document switching: collapsing the browse section never removes access to open documents.
- **SC-007**: After a restart, the selected browse mode and section collapse states are the same as before the restart, while Recently Changed starts empty.

## Assumptions

- The application continues to run as a single window; multi-window navigation is out of scope.
- Unread state remains session-scoped, consistent with the current behavior: a restart clears unread markers.
- Recently Changed is a de-duplicated activity set ordered by each document's most recent change, not a per-write event log.
- Duplicate appearance across Open Documents and Recently Changed is intentional because the lists answer different questions; duplication within a single list is not.
- The table-of-contents outline remains a separate panel and is out of scope for this feature.
- The expanded full-height inventory view is retained as an optional pop-out rather than removed.
- Drag-to-reorder of open documents is out of scope; ordering is open order or Auto-Sort.
