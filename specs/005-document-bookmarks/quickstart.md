# Quickstart: Document and Section Bookmarks

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

Runnable validation for the bookmark view, section resolution, unread awareness
and bookmark-scoped notifications. Contracts and schema details live in
[contracts/](./contracts/) and [data-model.md](./data-model.md); this file is the
manual/automated run guide, not an implementation description.

## Prerequisites

- Linux, macOS or Windows with a desktop session and notification permission.
- Node.js 20+, Rust 1.80+ and the Tauri prerequisites for the platform.
- A scratch directory containing at least two Markdown documents with headings,
  ideally under different `_ai` projects, plus a watch configuration that
  includes them:

```toml
watch = ["/tmp/docdeck-bookmarks/**"]
exclude = ["**/archive/**"]

[tray]
notify = "always"        # makes notification checks quick; use "unfocused" for realism
throttle_secs = 1
```

Use a disposable directory; the scenarios rename, delete and recreate files.

## Automated gates

Run from the repository root:

```bash
npm ci
npm run typecheck
npm run test:web
npm test            # cargo test + vitest
npm run lint:rs
```

Expected: all pass, including the new bookmark model, anchor/resolver, storage,
view, controller and DOM suites, and the Rust `bookmark_filter` tests.

Launch the app:

```bash
npm run tauri dev
```

## Scenario 1 — Bookmark documents and survive a restart

1. Open a watched document. Use the header star. Confirm the star fills and the
   document appears in **Bookmarks** (third mode).
2. Press `Ctrl`+`D` (macOS `Cmd`+`D`). Confirm the bookmark is removed and a toast
   offers **Undo**; use it and confirm the bookmark returns.
3. From **All documents**, click a row's star without opening it. Confirm the
   active document does not change and the row reports the bookmarked state.
4. Repeat from **Recently changed** and from the full-height inventory modal.
5. Quit and relaunch. Confirm both documents are still listed in the same order
   and grouping, and both open from one activation.
6. Remove one bookmark; confirm it leaves the view and **Undo** restores it.
7. Right-click a document row and use **Bookmark document** /
   **Remove bookmark**; confirm the label matches the current state.

Expected: every star affordance for a document agrees; bookmarks persist; removals
are reversible. See [contracts/ui-interactions.md](./contracts/ui-interactions.md).

## Scenario 2 — Section bookmarks, rewrites and stale handling

1. Open a document with at least four headings. Expand **Outline** and bookmark
   two headings with identical text from different parts of the document.
2. Confirm both appear nested under the document in **Bookmarks**, in document
   order, and each outline star is pressed.
3. Click a section bookmark. Confirm the document opens/focuses and the heading
   lands below the sticky header.
4. While the document is open, insert a new heading with the same text **before**
   the bookmarked ones. Confirm each bookmark still points at its own section,
   not the new one.
5. Reorder sections and rewrite body text. Confirm the bookmarks follow their
   headings (`Moved` only when the heading text changed but context matched).
6. Rename a bookmarked heading while keeping its neighbours. Confirm it resolves
   as re-anchored instead of stale.
7. Delete a bookmarked heading. Confirm the row shows **Not found** with
   **Re-anchor** and **Remove**, and activating it does not scroll.
8. Use **Re-anchor**, pick a heading from the picker, and confirm activation
   scrolls to it. Repeat with Escape and overlay click: the anchor must not
   change and focus must return to the button.
9. Make two bookmarks resolve to the same heading (for example by editing
   duplicates). Confirm both rows remain and show **Shared**.
10. Close the document and change its headings on disk. Reopen **Bookmarks**.
    Confirm the section shows **Not checked** and that activation validates
    before scrolling (never a silent jump).

Expected: text first, context second, occurrence last; ambiguity and deletion
are explicit. See [contracts/section-resolution.md](./contracts/section-resolution.md).

## Scenario 3 — Unread awareness

1. Bookmark a document, open it once, then quit docdeck.
2. Modify the file while docdeck is closed.
3. Relaunch. Confirm the bookmark shows the unread marker (dot + accessible
   state, not colour alone).
4. Open it from the bookmark. Confirm the marker clears.
5. Quit and relaunch without changes. Confirm it stays clear.
6. Delete a bookmarked document. Confirm it becomes **Unavailable** and shows no
   unread marker; recreate a file at the same path and confirm the bookmark
   becomes available and reports the change.

## Scenario 4 — Rename, move and unavailable bookmarks

1. Rename a bookmarked document (including one with section bookmarks) inside a
   watched location. Confirm the document and sections follow; no duplicate.
2. Move it outside every watched location. Confirm the bookmark stays visible as
   **Unavailable** with **Remove**; section rows are unavailable too.
3. Move it back. Confirm it is usable again without re-bookmarking.
4. Remove a document bookmark while section bookmarks exist. Confirm the
   container stays visible for its sections and the document star is empty.
5. Restart with a config that no longer watches the document. Confirm the
   bookmark is retained as unavailable, not deleted.

## Scenario 5 — Filter and empty states

1. With no bookmarks, open **Bookmarks**. Confirm the empty state explains how to
   create one and offers **Browse all documents**.
2. Create several bookmarks across projects. Type a term matching a document:
   confirm the document and all its sections stay together.
3. Type a term matching only a section heading: confirm the document appears as
   a container with only the matching section.
4. Type a term matching nothing: confirm the filtered-empty message and
   **Clear filter**; clearing restores the order and states.
5. Add/remove a bookmark while the filter is active: confirm the filter is not
   cleared.

## Scenario 6 — Bookmark-only desktop notifications

1. In **Bookmarks**, enable **Notify only for bookmarked documents**. Confirm the
   note explains the tray dot still reflects all changes.
2. Change one bookmarked and one unbookmarked document in quick succession.
   Confirm exactly one popup names the bookmarked document while the tray dot
   turns amber for both.
3. Change only unbookmarked documents. Confirm the tray dot updates and no popup
   appears.
4. Add section-only bookmarks to another document and change it. Confirm it
   qualifies for a popup.
5. Remove every bookmark while the setting is on. Confirm no popups appear and
   the interface says why.
6. Set the tray mode to `off`, then `unfocused`, then `always` and confirm the
   existing mode/focus/throttle behavior still decides whether a qualifying
   change pops up.
7. Rename a bookmarked document while the setting is on. Confirm the rename
   still qualifies (source or target path).
8. Quit and relaunch. Confirm the setting and filter survive.

Expected: popups are filtered, the presence dot is not. See
[contracts/tauri-commands.md](./contracts/tauri-commands.md).

## Scenario 7 — Corrupt storage and scale

1. Quit docdeck. In the webview devtools (or by pre-seeding
   `docdeck.bookmarks.v1`), corrupt the JSON, then relaunch. Confirm startup is
   normal with an empty Bookmarks view.
2. Restore a payload where one entry is malformed. Relaunch. Confirm the valid
   bookmark survives and only the bad entry is gone.
3. Seed 500 bookmarks and open/filter the view. Confirm opening and filtering
   each complete in under 100 ms and scrolling stays smooth.
4. Run 20 quick rewrites of an open bookmarked document. Confirm no bookmark is
   lost and no activation after the run lands on the wrong section.

## Scenario 8 — Read-only and accessibility

1. Capture `find` output and `stat` mtimes for the watched documents, run all
   bookmark actions, and compare. Confirm zero byte and mtime changes in watched
   files.
2. Complete Scenarios 1–5 using only the keyboard (Tab, Enter/Space, Escape,
   `Ctrl`/`Cmd`+`D`). Confirm visible focus, announced star states, and that the
   picker returns focus.
3. Confirm every status (`Not checked`, `Moved`, `Shared`, `Not found`,
   `Unavailable`) is readable as text, not only by colour.
4. Resize the window and panes; confirm bookmark rows and section indentation
   remain usable.

## Documentation checks

- `README.md` documents bookmarks, stale/re-anchor behavior, the `Ctrl`/`Cmd`+`D`
  shortcut and bookmark-only notifications.
- `CHANGELOG.md` has Unreleased entries.
- `_ai/context-definitions/bookmarks.md` exists and links to the decision record.
- `_ai/technical_decisions/ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md`
  is indexed.
- `.specify/memory/constitution.md` Persistence now lists
  `docdeck.bookmarks.v1` (amendment prerequisite).
