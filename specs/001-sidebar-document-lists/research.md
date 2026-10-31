# Phase 0 Research: Left Sidebar Document Navigation

**Feature**: `001-sidebar-document-lists` | **Date**: 2026-10-31

All unknowns from the Technical Context are resolved below. No `NEEDS
CLARIFICATION` remains.

## R1 — How to keep the inline inventory fast with 10,000 documents

**Decision**: Extract the windowing already used by the All-files modal
(`visibleRange` + a row recycler in `src/inbox-panel.ts`) into
`src/virtual-list.ts` and use it for both the inline browse list and the pop-out
modal.

**Rationale**: The current inline sections render every row on every
`renderInbox()`. That is acceptable for the small "Change detected / Manually
opened" sets but not for the full inventory. The modal already proves the
approach: only visible rows plus overscan exist in the DOM. Reusing it keeps one
implementation and one set of tests.

**Alternatives rejected**:
- Render all rows and rely on browser layout — fails SC-002 and makes each
  watcher event O(n).
- Cap the list at N rows — hides documents and contradicts "All Documents".

**Follow-up**: Measure with a synthetic 10,000-row inventory in a Vitest/happy-dom
test for the range math, and a manual smoke test for real scroll latency.

## R2 — Deterministic "Recently Changed" ordering and clearing

**Decision**: Record a session observation timestamp `changedAt` on every
upsert/delete in `InboxModel`. Order Recently Changed by `changedAt` descending.
Clear stores `clearedAt = now` and snapshots the acknowledged entries + unread
flags for undo.

**Rationale**: File `modifiedTime` is not reliable for this purpose: a scan that
finishes after a clear can discover a file whose mtime predates the clear, and
filesystem clock skew makes mtime comparisons fragile. An observation time is
monotonic within the session and matches the user's mental model ("since I
cleared it"). A de-duplicated map keyed by path keeps memory bounded; a raw
event log would grow without limit because agents burst-write.

**Alternatives rejected**:
- Filter by file `modifiedTime` — the post-clear scan edge case in the spec.
- Append every write to a log — unbounded growth and repeated rows for one file.
- Persist the recent list — contradicts session-scoped unread semantics.

## R3 — Clear also acknowledges unread markers

**Decision**: Clear sets the `clearedAt` floor and clears `unread` for every
entry observed at or before the clear. Undo restores the previous floor and the
snapshotted unread flags. Entries observed after the clear are unaffected.

**Rationale**: A cleared activity list with still-pulsing dots is contradictory;
both signal "something happened". Snapshotting makes undo exact without
re-deriving state, and the floor guarantees later writes reappear.

**Alternatives rejected**:
- Clear the list only — leaves an inconsistent UI.
- Mark everything read globally — would also acknowledge changes that arrived
  after the clear, which the spec forbids (edge case).

## R4 — Relationship between Open Documents and Recently Changed

**Decision**: Allow a document to appear in both lists. De-duplicate within each
list. Open Documents is built from the tab registry; Recently Changed from
`InboxModel`.

**Rationale**: The lists answer different questions ("what am I working on" vs
"what has the agent touched"). Suppressing open documents from the activity feed
would hide the most interesting event in this app: the document you are reading
being rewritten. The old de-duplication in `sectionInbox` existed only because
both sections shared one list.

**Alternatives rejected**:
- Open wins / exclude open docs from Recent — makes the activity feed lie by
  omission.
- A single merged list — loses the simultaneous open-vs-activity view the user
  asked for.

## R5 — Removing the tab strip without losing navigation

**Decision**: The sidebar is always present. The existing `Inbox` toggle now
shows/hides only the browse section; Open Documents is never hidden. Remove the
`⇄ Layout` button and the `layout-top` / `layout-side` grid variants. Preserve
`Ctrl+Shift+T` reopen, row close, copy-path context menu, and active/unread
indicators.

**Rationale**: The tab strip was the only permanent switcher. Allowing the
sidebar to disappear would strand the reader with no way to change documents.
`sidebarLayout` is session-only (`main.ts:114`) and not persisted, so removal
needs no data migration.

**Alternatives rejected**:
- Keep a `Ctrl+P` palette as the only fallback — an extra switcher for a problem
  the always-visible Open list already solves.
- Keep the layout toggle — it would expose a broken, tab-less top mode.

## R6 — Rendering architecture and module boundaries

**Decision**: Introduce `sidebar-model.ts` (pure) and `sidebar-panel.ts`
(presentation), extract `virtual-list.ts` and `browse-modal.ts`, and reduce
`inbox-panel.ts` to nothing. `main.ts` keeps tab lifecycle ownership and calls
`sidebar.update(...)`.

**Rationale**: `inbox-panel.ts` is already 706 lines and mixes three concerns
(sections, windowing, modal). The new UI adds a second section and a mode switch;
keeping it in one class would make it harder to test. Pure state in a model
mirrors the existing `inbox-model.ts` / `inbox-panel.ts` split, which the tests
rely on.

**Alternatives rejected**:
- One large `sidebar-panel.ts` with embedded state — harder to unit-test and
  diverges from the established split.
- A framework/component library — no new dependency, and the app is vanilla DOM.

## R7 — Preferences additions and migration

**Decision**: Extend `Preferences` with `browseMode: "all" | "recent"`,
`openSectionCollapsed: boolean`, and `browseSectionCollapsed: boolean`. The
existing per-field `decode()` already tolerates missing keys, so no storage-key
bump is needed. Default `browseMode` is `"recent"`.

**Rationale**: `decode()` validates each field independently and falls back to
`DEFAULT_PREFERENCES`, so adding fields is backward-compatible with an existing
`docdeck.preferences.v1` payload. Keeping the key avoids losing the user's theme,
outline, and frontmatter choices.

**Alternatives rejected**:
- Bump to `v2` — discards existing preferences for no benefit.
- Persist the recent list — out of scope and contradicts session semantics.

## R8 — Table of contents placement

**Decision**: Leave the TOC as a separate column between the sidebar and the
document pane, unchanged.

**Rationale**: It is already opt-in and independent of navigation. Moving it
into a popover would expand scope and risks the scroll-spy behavior. The sidebar
width is already constrained; the TOC can be narrowed independently later if
needed.

## R9 — Accessibility and keyboard behavior

**Decision**: Keep `role="tablist"` semantics off the new lists; use
`role="list"` with `aria-current="true"` for the active open document. Rows
remain focusable (`tabindex="0"`) and respond to `Enter`/`Space`; close controls
are buttons with labels. The mode switch is a two-button segmented control with
`aria-pressed`. Section headers are disclosure buttons with `aria-expanded`.

**Rationale**: The old strip used `role="tab"` because it was a tablist. A
stacked list of documents with independent actions is better modelled as a list
of rows. Preserving keyboard activation keeps parity with the current tab bar.

## R10 — Failure and empty states

**Decision**: Reuse the existing status host for scan progress, config errors,
warnings, and truncation. Add explicit empty states for "no open documents",
"no watched documents", and "no recent changes" (with a button to switch to All
Documents). Open/close failures keep the current toast behavior.

**Rationale**: `InboxPanel` already renders these states; carrying them into the
browse section avoids regressions. The spec's edge cases map directly onto them.
