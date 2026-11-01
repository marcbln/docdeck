# Feature Specification: Watch Configuration and Inbox Follow-ups

**Feature Branch**: `002-watch-inbox-followups`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Only the leftover scope from the config-driven watches and inbox design handoff: live config reload, config editing UI, persisted unread across restarts, inbox search/filtering, rename tracking, and macOS/Windows support."

## Context

The config-driven watch registry and the document sidebar are already in place.
This specification covers only the capabilities that design deliberately left
out, so the reader no longer has to restart the application to change watches,
lose awareness of changes made while the application was closed, hunt through
long lists by eye, or accept a rename being reported as a delete plus a create.
It also requires the same experience on macOS and Windows, which the earlier
design excluded.

This specification supersedes the earlier session-scoped unread assumption: read
and unread state now survives restarts. The contents of the Recently Changed
list remain session-scoped.

## Clarifications

### Session 2026-11-01

- Q: When a document is modified while it is the currently active document, should it be read or unread after the next restart? → A: Changes made while the document is active never make it unread, and it stays read after a restart (the acknowledgement refreshes while active).
- Q: When the in-app configuration surface saves, must it preserve comments, formatting, and unknown settings that are already in the configuration file? → A: Change only the affected selectors and keep all comments, formatting, and unknown keys intact.
- Q: What is the longest a rename or move may take before it appears as one updated row? → A: Within 2 seconds, the same bound as a configuration change.
- Q: If a document leaves all watches and is later watched again, should it be read or unread? → A: Unread, because history for unwatched documents is pruned and a re-added document enters as new.
- Q: On Windows, must the configuration accept selectors written with backslashes as well as forward slashes? → A: Accept both separators on Windows and normalize them to one internal form.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply watch configuration changes without restarting (Priority: P1)

A reader edits the watch configuration while docdeck is running. Newly matched
documents appear, removed selectors stop contributing documents, and changed
exclusions take effect within seconds, without a restart and without disturbing
the documents already open.

**Why this priority**: Restarting to pick up a new watch root is the largest
remaining friction in the monitoring workflow, and it is the prerequisite that
makes live editing, filtering, and rename tracking pleasant to use.

**Independent Test**: Launch with a configuration matching a few documents, add
a selector for a new folder, save, and confirm its documents appear in the
browse list without restarting; then introduce a syntax error and confirm the
previous watches keep working while the error is visible.

**Acceptance Scenarios**:

1. **Given** a running application with a valid configuration, **When** the reader adds a selector matching new documents and saves, **Then** those documents appear in the browse list shortly afterwards without a restart.
2. **Given** a removed selector, **When** the configuration is saved, **Then** its documents leave the browse list, while any of them that are open remain open.
3. **Given** an exclusion pattern is added, **When** the configuration is saved, **Then** matching documents leave the browse list and later changes to them are ignored.
4. **Given** a save that makes the configuration invalid, **Then** the previously applied configuration keeps running and a visible, actionable error is shown.
5. **Given** an invalid configuration is corrected and saved again, **Then** the error clears and the corrected configuration is applied without a restart.
6. **Given** the configuration file is deleted or becomes unreadable, **Then** the currently applied watches continue until the reader fixes or recreates it, and a setup hint explains what to do.
7. **Given** a session folder added from the command line, **When** the configuration is reloaded, **Then** that session folder is preserved.
8. **Given** documents already present before a reload, **When** the reload completes, **Then** none of them become unread solely because of the reload.

---

### User Story 2 - Keep unread awareness across restarts (Priority: P2)

A reader can close docdeck, let agents keep writing, and reopen the application
to find the documents changed in the meantime marked as unread. Documents the
reader had already reviewed stay ordinary. Reviewing a document persists that
acknowledgement.

**Why this priority**: The application's purpose is monitoring agent output; a
restart that erases what changed defeats that purpose.

**Independent Test**: Review a document, add an acknowledgement, close the
application, change one watched document and leave another unchanged, restart,
and confirm only the changed document is unread.

**Acceptance Scenarios**:

1. **Given** a document reviewed before shutdown, **When** it is unchanged and the application restarts, **Then** it is not unread.
2. **Given** a document modified after shutdown, **When** the application restarts, **Then** it is unread and appears at the top of the newest-first document list.
3. **Given** an unread document, **When** the reader reviews it, **Then** it becomes read immediately and remains read after the next restart.
4. **Given** a first launch with no stored acknowledgement history, **Then** no document is marked unread solely because history is absent.
5. **Given** documents that disappeared while the application was closed, **Then** they are not shown as unread on restart, and their stored acknowledgements are eventually discarded.
6. **Given** stored acknowledgement history is corrupted or unreadable, **Then** the application still starts, treats it as a first launch, and reports no false unread marks.
7. **Given** the reader has not reviewed a document changed during the previous session, **When** the application restarts, **Then** its unread marker is still present.
8. **Given** a document modified while it was the active document, **When** the application restarts, **Then** it is not unread.

---

### User Story 3 - Filter the document lists (Priority: P3)

A reader types into a filter above the browse list to narrow All Documents or
Recently Changed to matching documents by name, location, or project, without
losing ordering or state.

**Why this priority**: Filters become useful as soon as inventories grow beyond a
few screens, and they build directly on the existing lists.

**Independent Test**: With a large inventory, type part of a filename and confirm
only matching rows remain in their original order, then clear the filter and
confirm the full list returns.

**Acceptance Scenarios**:

1. **Given** All Documents with many entries, **When** the reader types part of a filename, **Then** only matching documents are shown and their relative order is unchanged.
2. **Given** a filter term, **When** it matches a parent folder or project name, **Then** documents under that folder or project are also shown.
3. **Given** mixed case text, **When** the reader types a differently cased term, **Then** matching remains case-insensitive.
4. **Given** Recently Changed is selected, **When** a filter is applied, **Then** it narrows that list with the same rules.
5. **Given** a filter matching nothing, **Then** the list explains that no documents match and offers to clear the filter.
6. **Given** a scan discovers new documents while a filter is active, **Then** new matches appear and non-matches stay hidden.
7. **Given** a filter is active, **When** the reader switches browse modes, **Then** the filter remains applied.
8. **Given** a filter is active, **When** the reader opens or reviews a row, **Then** filtering does not alter any unread state.

---

### User Story 4 - Follow renamed and moved documents (Priority: P4)

When an agent renames or moves a watched document, the reader sees its row move
to the new name instead of a deletion followed by an unrelated new document. An
open document stays open, keeps its read state, and, if it was active, stays
active.

**Why this priority**: Renames are common in agent-authored documentation sets,
and treating them as delete plus create makes the reader re-open work and lose
their place.

**Independent Test**: Rename an open, read document within a watched folder and
confirm a single row reflects the new name, the document remains open and
active, and no unread or deleted state appears.

**Acceptance Scenarios**:

1. **Given** an open document is renamed within a watched location, **When** the change settles, **Then** its row shows the new name and no duplicate or deleted row is left behind.
2. **Given** an unread document is renamed, **Then** it remains unread under the new name.
3. **Given** a read document is renamed, **Then** it remains read under the new name.
4. **Given** the active document is renamed, **Then** it remains the active document.
5. **Given** a document is moved to another watched location, **Then** it is updated in place rather than reported as a new document.
6. **Given** a document is moved out of all watched locations, **Then** it leaves the browse list and any open view indicates that the file is no longer available, consistent with the existing deleted-document behavior.
7. **Given** a document is moved into a watched location, **Then** it appears as a new unread document.
8. **Given** a rename into an excluded location, **Then** the document leaves the browse list.
9. **Given** several renames of the same document in quick succession, **Then** only the final name is shown.

---

### User Story 5 - Edit the watch configuration inside the application (Priority: P5)

A reader opens a configuration surface from the sidebar or header, sees where the
watch configuration lives, and adds or removes watch and exclusion selectors
without editing a file by hand. Saving validates the change and applies it
immediately; a failure keeps the previous configuration and the reader's input.

**Why this priority**: The configuration is the entry point to everything the
application monitors, but hand-editing is error-prone and undocumented for new
readers.

**Independent Test**: Open the configuration surface with no configuration file,
create one from the offered example, add a selector, save, and confirm documents
appear without a restart; then submit invalid input and confirm the error is
shown and nothing is applied.

**Acceptance Scenarios**:

1. **Given** no configuration file exists, **When** the reader opens the configuration surface, **Then** it offers to create one from a working example.
2. **Given** the configuration surface, **When** the reader adds a valid watch or exclusion selector and saves, **Then** the change is persisted and applied without a restart.
3. **Given** invalid input, **When** the reader saves, **Then** a precise error is shown, nothing is applied, and the entered input is preserved.
4. **Given** a duplicate selector, **When** the reader saves, **Then** the duplicate is reported or folded so that documents are not listed twice.
5. **Given** the configuration file was changed outside the application while the surface is open, **When** the reader is about to save, **Then** the conflict is surfaced and the reader can reload before overwriting.
6. **Given** saving fails because the configuration is not writable, **Then** the failure is explained, the previous configuration remains active, and the reader can retry.
7. **Given** the configuration surface, **Then** it shows the effective configuration location, the current validity status, and the result of the most recent reload.
8. **Given** a configuration file containing comments, formatting, or settings the surface does not manage, **When** the reader saves a selector change, **Then** only the affected selectors change and everything else is preserved.

---

### User Story 6 - Use the same experience on macOS and Windows (Priority: P6)

A reader on macOS or Windows gets the same watching, unread, filtering, rename,
and configuration-editing behavior as on Linux, with configuration stored in the
platform's standard user configuration location and with wildcard and path
behavior that feels native on each platform.

**Why this priority**: The earlier design limited the application to Linux; this
story removes that limitation for the capabilities in this specification.

**Independent Test**: Repeat the primary acceptance flows for live reload,
cross-session unread, filtering, rename tracking, and in-app configuration on
each supported platform, using that platform's standard configuration location.

**Acceptance Scenarios**:

1. **Given** macOS or Windows, **When** the application starts for the first time, **Then** it looks for the watch configuration in the platform-standard user configuration location.
2. **Given** selectors written with forward or native Windows backward slashes, **When** they are applied on any supported platform, **Then** matching behaves the same as on Linux.
3. **Given** a rename or move within a watched location on any supported platform, **Then** the row follows the document as described in User Story 4.
4. **Given** the configuration is edited while the application runs on any supported platform, **Then** the change is applied without a restart.
5. **Given** any supported platform, **When** a configuration file cannot be read or written, **Then** the same non-fatal guidance and error states appear.

---

### Edge Cases

- When the configuration is saved repeatedly in quick succession, only the last valid configuration is applied and no duplicate rows appear.
- When a reload finishes during the initial scan, discovered documents appear once and in the correct list.
- When a reload removes the location of an open document, the document stays open and usable; only its watch membership ends.
- When the configuration contains thousands of selectors, reloading must not make the application unresponsive.
- When the system clock moves backwards or a file carries a future modification time, unread determination must remain predictable and must not mark reviewed documents unread repeatedly.
- When a rename crosses watched roots, the document is updated once rather than deleted and recreated.
- When only a document's letter case changes on a platform that ignores case, the rename is applied without leaving two rows.
- When the filter term contains characters that look like wildcards or punctuation, it is treated as literal text.
- When a filter is active and a document is renamed, it remains visible only if it still matches.
- When the configuration surface is open and the configuration becomes invalid from an external edit, the surface must not silently save over it.
- When stored unread history refers to documents that no longer exist, the history is pruned so it cannot grow without bound.

## Requirements *(mandatory)*

### Functional Requirements

**Live configuration reload**

- **FR-001**: The application MUST detect changes to the watch configuration while it is running and apply a valid change without a restart.
- **FR-002**: A valid reload MUST add newly matched documents, remove documents no longer matched, and re-apply exclusion patterns.
- **FR-003**: A reload MUST NOT close open documents or change which document is active.
- **FR-004**: A reload MUST NOT mark existing documents unread on its own.
- **FR-005**: When a reloaded configuration is invalid or unreadable, the application MUST keep the last valid watches active and MUST show an actionable error.
- **FR-006**: Session folders added from the command line MUST survive reloads.
- **FR-007**: Repeated or rapid configuration saves MUST settle on the last valid configuration without duplicate or flickering rows.

**Cross-session unread awareness**

- **FR-008**: The application MUST remember when each watched document was last reviewed across restarts.
- **FR-009**: On startup, a watched document modified after its last review MUST be marked unread, except for changes made while it was the active document, which MUST leave it read.
- **FR-010**: On startup, a watched document unchanged since its last review MUST NOT be marked unread.
- **FR-011**: Reviewing a document MUST persist its acknowledgement immediately enough that a subsequent restart preserves the read state.
- **FR-012**: A first launch without stored acknowledgement history MUST NOT mark documents unread solely because of the missing history.
- **FR-013**: Cross-session unread documents MUST be discoverable without a search, using the existing newest-first document ordering.
- **FR-014**: Acknowledgement history MUST be pruned when a document leaves all watches so that it remains bounded; a document watched again afterwards MUST be treated as newly watched and shown as unread.
- **FR-015**: Corrupted or unreadable acknowledgement history MUST NOT prevent the application from starting or produce false unread marks.
- **FR-016**: The contents of Recently Changed MUST remain session-scoped even though unread markers persist.

**Filtering**

- **FR-017**: The browse section MUST provide a text filter that applies to the currently selected list.
- **FR-018**: Filtering MUST match document name, location, and project, case-insensitively.
- **FR-019**: Filtering MUST preserve the underlying list order and MUST NOT alter unread, open, active, or deleted state.
- **FR-020**: The filter MUST remain applied when the reader switches between All Documents and Recently Changed, and MUST be clearable in one action.
- **FR-021**: A filter with no matches MUST show an explanatory empty state with a clear action.
- **FR-022**: Documents discovered by a scan or a reload while a filter is active MUST appear when they match and stay hidden otherwise.
- **FR-023**: Filtering MUST remain responsive with thousands of documents.

**Rename and move tracking**

- **FR-024**: When a watched document is renamed or moved to another watched location, the application MUST update its existing entry instead of reporting a deletion plus a new document.
- **FR-025**: A renamed or moved document MUST keep its open state, its read or unread state, and its active state.
- **FR-026**: Moving a document out of all watched locations MUST remove it from the browse list and MUST show the existing unavailable-file behavior in any open view.
- **FR-027**: Moving a document into a watched location MUST add it as a new unread document.
- **FR-028**: Moving or renaming a document into an excluded location MUST remove it from the browse list.
- **FR-029**: Rapid successive renames of one document MUST settle on its final name without leaving stale rows.
- **FR-030**: A case-only rename on a case-insensitive platform MUST update the existing entry rather than creating a second one.

**In-app configuration editing**

- **FR-031**: The application MUST provide a configuration surface reachable from the main window.
- **FR-032**: The configuration surface MUST show the effective configuration location, its current validity, and the outcome of the most recent reload.
- **FR-033**: When no configuration exists, the surface MUST offer to create one from a working example.
- **FR-034**: The surface MUST allow the reader to add and remove watch and exclusion selectors and save them.
- **FR-035**: Saving MUST validate the configuration before applying it and MUST report precise errors without discarding the reader's input.
- **FR-036**: A successful save MUST persist the change without disturbing unrelated file content (comments, formatting, and settings the surface does not manage) and MUST apply it immediately using the live-reload behavior.
- **FR-037**: A failed save MUST leave the previously active configuration running and MUST allow the reader to retry.
- **FR-038**: If the configuration changed outside the application while the surface is open, the surface MUST surface the conflict and allow the reader to reload before overwriting.
- **FR-039**: Duplicate or conflicting selectors MUST be reported or folded so that a document is never listed twice.

**Platform parity**

- **FR-040**: The configuration location MUST follow each supported platform's standard user configuration convention.
- **FR-041**: Selector and path semantics MUST produce equivalent matches on Linux, macOS, and Windows, and Windows selectors written with backward slashes MUST be accepted and normalized.
- **FR-042**: All behaviors required by this specification MUST be available on macOS and Windows as well as Linux.

### Key Entities *(include if feature involves data)*

- **Watch Configuration**: The reader's set of watch and exclusion selectors, its location, its last-valid state, and the result of the most recent reload.
- **Watched Document**: A document discovered through the configuration or a session folder. Key attributes: location, name, project context, modification time, open state, active state, and unread state.
- **Reader Acknowledgement**: The recorded moment a document was last reviewed, used to decide whether it is unread after a restart.
- **Session Watch**: A folder added for the current run from the command line, preserved across configuration reloads.
- **Browse Filter**: A session-only text term that narrows the selected list by name, location, or project.
- **Document Identity Transition**: The relationship between a document's previous and current location when it is renamed or moved, used to carry open, active, and read state forward.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can add or remove a watch selector and see the browse list reflect it within 2 seconds of saving, in 100% of valid-change tests, without restarting.
- **SC-002**: After a restart, every document modified while the application was closed appears unread and every reviewed, unchanged document appears read, in 100% of restart tests.
- **SC-003**: A reader can narrow a 10,000-document list to the first matching rows within 100 milliseconds of typing.
- **SC-004**: Within 2 seconds of a rename or move within watched locations, exactly one row remains, the open state is preserved, the active document stays active, and no false unread or deleted marker appears, in 100% of rename tests.
- **SC-005**: A reader can go from no configuration to a working watch selector through the in-app surface in under 60 seconds, without editing a file by hand.
- **SC-006**: An invalid or unreadable configuration never causes the application to lose its previously applied watches, crash, or exit.
- **SC-007**: The application passes the same acceptance flows on Linux, macOS, and Windows with no platform-specific behavior documented as unsupported.
- **SC-008**: After many sessions, stored acknowledgement history contains no more than one entry per currently watched document and none for documents that no longer exist.
- **SC-009**: Existing navigation behavior (open documents, browse lists, unread markers, clear and undo, copy path, Auto-Sort) continues to work unchanged alongside every new capability.

## Assumptions

- Scope is exactly the items the config-driven watch design deferred: live reload, in-app configuration editing, cross-session unread, list filtering, rename tracking, and macOS/Windows support. Named groups or profiles, notifications and sound, document editing, and non-Markdown rendering remain out of scope.
- Cross-session unread is expressed through per-document review acknowledgement timestamps, not through restoring the Recently Changed list.
- A first launch with no stored acknowledgement history establishes a baseline and marks nothing unread.
- The config file remains the source of truth; the in-app surface edits that file, and hand edits outside the application remain supported.
- A live reload applies only valid configurations; invalid configurations are non-fatal and preserve the previous state.
- Filtering is session-scoped and is not remembered across restarts.
- Rename tracking depends on the operating system reporting a move, or on pairing an observed removal and appearance of the same document within 2 seconds; when that is impossible, the existing delete-plus-create behavior is an acceptable fallback.
- The macOS and Windows requirement extends the project's current Linux-only platform constraint and therefore requires amending that constraint before implementation is accepted.
- All new behavior is expected to keep the existing responsiveness and accessibility standards, including keyboard use and visible state announcements.
