# Feature Specification: Document and Section Bookmarks

**Feature Branch**: `005-document-bookmarks`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "I want bookmarks … lets start simple." The design discussion resolved the first release to whole-document and heading bookmarks, with unread awareness and optional bookmark-scoped notifications. Text-passage bookmarks with notes were explicitly deferred.

## Context

docdeck watches folders that agents rewrite continuously. The reader needs a way
to keep a small, deliberate set of documents and sections close at hand without
tracking them by filename in a list that changes under them.

A bookmark is a durable, reader-chosen marker. The first release supports two
kinds: a whole document, and a heading within a document. Both live in a
Bookmarks view beside the existing All documents and Recently changed views.
Bookmarked documents participate in the existing unread rule, and the reader may
choose to receive desktop notifications only for bookmarked documents.

The defining constraint is that bookmarked content is rewritten while it is
bookmarked. A section marker must resolve to the intended section after edits,
or say plainly that it cannot; it must never silently point at a different
section.

## Clarifications

### Session 2026-11-14

- Q: When two bookmarked headings share the same text, what should decide which one a bookmark points to? → A: Match by heading text first, use surrounding context to disambiguate identical headings, and use occurrence position only as a last resort.
- Q: How should a reader re-anchor a stale section bookmark to a heading that still exists? → A: The stale bookmark offers a picker listing the document's current headings, and the reader selects one.
- Q: Does the first release need a keyboard shortcut that bookmarks the section the reader is currently reading, without visiting the outline? → A: No section shortcut; keyboard users bookmark a heading by focusing it in the outline and activating its bookmark control.
- Q: When the browse filter matches a bookmarked section but not its document's name or path, what should the Bookmarks view show? → A: Show the document row as the section's container, with only the matching section nested under it.
- Q: In what order should a document's bookmarked sections appear in the Bookmarks view? → A: Document order, following the order the headings appear in the file.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bookmark documents and return to them (Priority: P1)

A reader marks a document as a bookmark from the open document, from its row in
the document list, or with a keyboard shortcut. Bookmarks survive restarts and
appear in a Bookmarks view alongside All documents and Recently changed, where
the reader can open them or remove the bookmark.

**Why this priority**: This is the smallest useful bookmark: it needs no anchor
resolution and immediately replaces hunting for a frequently read file. It is
also the foundation the section bookmarks build on.

**Independent Test**: Bookmark one open document and one document that is not
open, restart the application, and confirm both are listed in the Bookmarks
view and open correctly; then unbookmark one and confirm it leaves the view.

**Acceptance Scenarios**:

1. **Given** a document is open, **When** the reader bookmarks it, **Then** it appears in the Bookmarks view and every star affordance for that document shows it is bookmarked.
2. **Given** a document is listed but not open, **When** the reader bookmarks it from its row, **Then** it is added without opening and without changing the active document.
3. **Given** a bookmarked document, **When** the reader removes the bookmark, **Then** it leaves the Bookmarks view unless it still has section bookmarks, and the removal can be undone.
4. **Given** bookmarks exist, **When** the application restarts, **Then** every bookmark for a document that still exists is present again in the same grouping and order.
5. **Given** bookmarked documents from several projects, **Then** the Bookmarks view groups them the same way All documents does.
6. **Given** a filter term, **When** it is applied in the Bookmarks view, **Then** only matching bookmarked documents and sections are shown, a matching section keeps its document row as context, and clearing the term restores the full list.
7. **Given** there are no bookmarks, **Then** the view explains how to create one and offers a way to reach the document list.
8. **Given** a bookmarked document is deleted or leaves every watched location, **Then** its bookmark is shown as unavailable with a remove action, and no other bookmark is affected.

---

### User Story 2 - Bookmark a section and jump back to it (Priority: P2)

A reader bookmarks a heading from the table of contents. The section appears
nested under its document in the Bookmarks view. Activating it opens the
document if necessary and scrolls to that heading. When an agent edits the
document, the bookmark follows the section by its text and surrounding context;
when it can no longer be found reliably, the reader is told instead of being sent
to the wrong place.

**Why this priority**: Agent-written plans are long and change often. Returning to
one decision or checklist is the reason bookmarks matter in this application,
not just returning to a file.

**Independent Test**: Bookmark two headings with identical text, rewrite the
document around them, reorder them, and delete one; confirm each remaining
bookmark resolves to its own section and the deleted one is reported stale.

**Acceptance Scenarios**:

1. **Given** a document with headings and the outline visible, **When** the reader bookmarks a heading, **Then** the heading is marked as bookmarked and appears under its document in the Bookmarks view.
2. **Given** a bookmarked heading, **When** the reader activates it, **Then** the document opens or is focused and scrolls so the heading is visible below the sticky header.
3. **Given** a bookmarked heading whose text is unchanged but whose position moved, **When** the document is rewritten, **Then** the bookmark still resolves to that heading.
4. **Given** a bookmarked heading whose text was edited but whose surrounding section context is still identifiable, **Then** the bookmark resolves to the edited heading rather than becoming stale.
5. **Given** a bookmarked heading was removed, **Then** the bookmark is shown as no longer present with remove and re-anchor choices, re-anchoring lists the document's current headings for the reader to choose from, and activating a stale bookmark never scrolls to a different section.
6. **Given** two headings share the same text, **Then** the bookmark identifies the specific occurrence, and inserting another heading with the same text earlier in the document does not move the bookmark to the new one.
7. **Given** a heading is already bookmarked, **When** the reader bookmarks it again, **Then** it is unbookmarked and no duplicate entry is created.
8. **Given** a document has section bookmarks but no document bookmark, **Then** the document still appears in the Bookmarks view as the container for its sections.

---

### User Story 3 - See which bookmarks changed (Priority: P3)

A bookmarked document that changed since the reader last reviewed it carries the
same unread marker used elsewhere. Reviewing it clears the marker, and the
marker state survives a restart.

**Why this priority**: A bookmark is only useful if the reader can tell whether
the bookmarked work still needs attention. Reusing the existing unread rule
keeps the meaning of the dot consistent across the application.

**Independent Test**: Bookmark a read document, change it while the application
is closed, restart, and confirm the bookmark shows unread; open it and confirm
the marker clears and stays clear after another restart.

**Acceptance Scenarios**:

1. **Given** a bookmarked document changed since it was last reviewed, **Then** its bookmark shows an unread marker.
2. **Given** the reader reviews that document, **Then** the marker clears and remains clear after a restart without further changes.
3. **Given** a first launch with no review history, **Then** no document is shown unread solely because it is bookmarked.
4. **Given** the unread marker is shown, **Then** its state is conveyed by more than color alone.
5. **Given** a document is bookmarked and unchanged, **Then** no unread marker is shown.

---

### User Story 4 - Limit desktop notifications to bookmarks (Priority: P4)

A reader who is only interested in a few documents can ask docdeck to raise
desktop notifications only for changes to bookmarked documents. The tray
presence indicator still reflects all detected changes; only popups are
filtered.

**Why this priority**: Agent workspaces can produce a steady stream of writes.
Bookmarks turn notification noise into signal, but the feature depends on P1 and
is optional, so it follows the core bookmark experience.

**Independent Test**: Enable desktop notifications and bookmark-only
notifications, change one bookmarked and one unbookmarked document, and confirm
exactly one popup names the bookmarked document while the tray dot reflects both.

**Acceptance Scenarios**:

1. **Given** bookmark-only notifications are enabled, **When** only unbookmarked documents change, **Then** the tray presence indicator updates but no desktop notification appears.
2. **Given** bookmark-only notifications are enabled, **When** a bookmarked document changes, **Then** a notification appears subject to the existing notification mode and throttling rules.
3. **Given** bookmark-only notifications are disabled, **Then** notification behavior is unchanged from before this feature.
4. **Given** bookmarks exist for sections but not for the document itself, **Then** that document counts as bookmarked for notification purposes.
5. **Given** there are no bookmarks, **When** bookmark-only notifications are enabled, **Then** no change notifications appear and the setting's effect is visible in the interface.
6. **Given** bookmark-only notifications are enabled, **Then** the existing off, unfocused, and always behaviours still decide whether a qualifying change raises a popup.

---

### Edge Cases

- A bookmarked document is renamed or moved within watched locations; its bookmark, its section bookmarks, and its unread state follow it.
- A bookmarked document moves out of every watched location and later returns; it is unavailable in the meantime and usable again on return without re-bookmarking.
- A different file is created at a previously bookmarked path; the bookmark follows the path and the document is treated as changed, not as a silently different bookmark.
- A bookmarked heading is duplicated, reordered, renamed, or deleted in one write burst; resolution picks the intended section or reports stale, never a different section.
- A document is rewritten while its bookmark is active; scroll position and the bookmark's resolved section are refreshed without closing the document.
- A document with section bookmarks is unbookmarked at the document level; the section bookmarks remain and the document stays visible as their container.
- The stored bookmark collection is missing, corrupt, or partially invalid; the application starts normally, keeps every valid bookmark, and discards only invalid entries.
- A bookmark points at a document that is no longer watched; it is retained and shown as unavailable rather than deleted.
- The filter is active while a bookmark is added or removed; the view updates without clearing the filter.
- Two bookmarked headings resolve to the same section after an edit; both remain visible and the ambiguity is reported rather than silently de-duplicated.

## Requirements *(mandatory)*

### Functional Requirements

**Creating and removing bookmarks**

- **FR-001**: Users MUST be able to bookmark and unbookmark the active document.
- **FR-002**: Users MUST be able to bookmark and unbookmark a document from any row that represents it, without opening it.
- **FR-003**: Users MUST be able to bookmark and unbookmark any heading shown in the document outline.
- **FR-004**: Bookmarking MUST be a toggle: bookmarking an already bookmarked document or heading removes that bookmark, and duplicates MUST NOT accumulate.
- **FR-005**: Every bookmark affordance MUST show the current state of the document or heading it controls.
- **FR-006**: Removing a bookmark MUST be reversible or confirmed.
- **FR-007**: Removing a document bookmark MUST leave its section bookmarks intact; the document MUST remain in the Bookmarks view while it has section bookmarks.

**The Bookmarks view**

- **FR-008**: The Bookmarks view MUST sit beside All documents and Recently changed in the document sidebar, not open a separate window.
- **FR-009**: The view MUST list bookmarked documents and, nested under each, its bookmarked sections in the order the headings appear in the file.
- **FR-010**: The view MUST group documents by project using the same grouping and ordering rules as All documents.
- **FR-011**: Activating a document entry MUST open it or focus its existing tab.
- **FR-012**: Activating a section entry MUST open or focus its document and scroll to that section.
- **FR-013**: The existing browse filter MUST narrow the Bookmarks view at both document and section level, case-insensitively, without changing order or state; when only a section matches, its document MUST remain visible as the container with only the matching section nested under it.
- **FR-014**: The view MUST display a count of bookmarks in a way that remains usable by assistive technology.
- **FR-015**: An empty Bookmarks view MUST explain how to create a bookmark and offer a recovery path to the document list.
- **FR-016**: Bookmark actions MUST also be available from the document row context menu.

**Resolution and staleness**

- **FR-017**: A section bookmark MUST resolve by heading text first, MUST use the section's surrounding context to distinguish headings that share the same text, and MUST use the occurrence position among identical headings only as a last resort.
- **FR-018**: When the heading text changes, resolution MUST fall back to the section's surrounding context before declaring the bookmark stale.
- **FR-019**: A stale section bookmark MUST be shown as no longer present, with actions to remove it or re-anchor it to a heading the reader selects from the document's current headings.
- **FR-020**: A stale section bookmark MUST NOT scroll to an unrelated section.
- **FR-021**: A document bookmark whose document is unavailable MUST be shown as unavailable with a remove action and MUST be retained until the user removes it or the document returns.

**Change awareness**

- **FR-022**: A bookmarked document MUST use the same unread rule as every other document: changed since last reviewed means unread, reviewed means read.
- **FR-023**: Unread state for bookmarks MUST survive application restarts.
- **FR-024**: Unread indicators MUST convey state with more than color alone.
- **FR-025**: The application MUST allow notifications to be limited to documents that are bookmarked, including documents that are bookmarked only at section level.
- **FR-026**: Bookmark-limited notifications MUST NOT change the tray presence indicator, which MUST continue to reflect all detected changes.
- **FR-027**: Bookmark-limited notifications MUST be opt-in and MUST preserve the existing notification modes and throttling when enabled.
- **FR-028**: The effect of enabling bookmark-limited notifications with no bookmarks MUST be visible in the interface.

**Persistence and lifecycle**

- **FR-029**: Bookmarks MUST persist across restarts and live document reloads.
- **FR-030**: Bookmarks MUST follow a document that is renamed or moved within watched locations, including its section bookmarks and unread state.
- **FR-031**: An invalid or corrupt bookmark collection MUST NOT prevent startup; valid bookmarks MUST survive and only invalid entries MUST be discarded.
- **FR-032**: Bookmarking MUST NOT modify, create, or delete any watched document.
- **FR-033**: Bookmarks MUST be scoped to the local user and machine; no account or network access is required.

**Accessibility and performance**

- **FR-034**: Every bookmark action and the Bookmarks view MUST be fully operable with the keyboard, with visible focus and accessible names; heading bookmarks MUST be reachable by focusing a heading in the outline and activating its bookmark control.
- **FR-035**: Bookmark actions MUST acknowledge input within 100 ms, and the view MUST remain responsive with large document inventories and heavy agent write activity.
- **FR-036**: Adding or removing bookmarks MUST NOT reorder, close, or otherwise disturb open documents or the Recently changed list.

### Key Entities

- **Document bookmark**: A reader-chosen marker on one document. Identified by the document's location, with the time it was added and the document's current availability and unread state.
- **Section bookmark**: A reader-chosen marker on one heading inside a document. Identified by the document, the heading text, optional surrounding context used to distinguish identical headings, the occurrence position among identical headings as a fallback, and a resolution status of current, re-anchored, or stale.
- **Bookmark collection**: The durable set of document and section bookmarks for the local user, including the information needed to validate entries and recover from corruption.
- **Bookmark-scoped notification setting**: The reader's opt-in choice to receive desktop notifications only for bookmarked documents, composed with the existing notification mode and throttle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can bookmark the active document with one action and reach it from the Bookmarks view with one activation.
- **SC-002**: After a restart, 100% of bookmarks for documents that still exist are restored, with no manual recreation.
- **SC-003**: Across a test set of 20 live rewrites (insertions, renames, reorderings, deletions), every section activation lands on the intended heading or shows an explicit stale state; the number of silent jumps to a different section is zero.
- **SC-004**: Bookmarking changes zero bytes and zero modification times in watched documents across the test suite.
- **SC-005**: With 500 bookmarks, opening the Bookmarks view and applying a filter each complete in under 100 ms.
- **SC-006**: With bookmark-limited notifications enabled, unbookmarked documents produce zero desktop popups while every settled change to a bookmarked document still qualifies under the existing throttle.
- **SC-007**: In a usability check, at least 90% of first-time readers find the Bookmarks view after creating their first bookmark without consulting documentation.
- **SC-008**: No bookmark is lost across 20 rename and move operations within watched locations.

## Out of Scope

- Bookmarking a text passage or quote, highlighting, annotations, and per-bookmark notes.
- Section-level change indicators; the first release reports change at document level.
- Cross-device sync, accounts, or sharing bookmark collections.
- Bookmarking folders, watch configurations, or external web addresses.
- Export, import, and command-line access to bookmarks.
- Scoping the Recently changed summary to bookmarks.
- A keyboard shortcut that bookmarks the section at the reader's current scroll position.
- Editing document content or writing bookmarks into watched files.

## Assumptions

- Bookmarks are personal to the local user and machine; no sign-in or synchronization exists.
- The first release covers whole documents and headings. Passage bookmarks were deliberately deferred and the model should not be closed to them.
- The Bookmarks view follows the existing sidebar patterns: project grouping, the shared filter, row context menus, and the same open, unread, and unavailable states.
- The existing rename and move detection is reused; no second watcher is introduced.
- Document-level unread state answers "did this bookmark change" in the first release; section-level change indicators come later.
- Removing a document bookmark does not cascade to its section bookmarks.
- Unavailable bookmarks are retained until the reader removes them; the application never silently discards a bookmark.
- Bookmark-limited notifications are off by default and do not alter the desktop presence indicator.
- Keyboard shortcuts follow the application's existing conventions, with the document bookmark shortcut available from the active document; section bookmarks are reached through the outline, with no scroll-position section shortcut in the first release.
- A user has at most a few hundred bookmarks; the feature must still behave predictably if that grows.
- Watched documents remain strictly read-only.
