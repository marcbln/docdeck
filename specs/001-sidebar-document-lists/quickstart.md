# Quickstart: Left Sidebar Document Navigation

**Feature**: `001-sidebar-document-lists` | **Date**: 2026-10-31

Manual and automated checks that prove the feature works. Run these after
`/speckit.implement` (or after each phase while developing).

## Prerequisites

```bash
cd /home/marc/devel/docdeck
npm install
```

Backend is unchanged, so a dev run is enough:

```bash
npm run tauri dev -- ./README.md ./CHANGELOG.md ./AGENTS.md
```

## Automated

```bash
npm run typecheck
npm run test:web
```

Expected: typecheck clean; all Vitest suites pass, including the new
`sidebar-model`, `sidebar-panel`, `virtual-list`, and extended `preferences`
tests.

If any Rust file was touched (it should not be):

```bash
npm test
```

## Manual verification

### 1. No tab strip, always-present sidebar

- Launch with three documents.
- Verify there is no horizontal tab strip and no `⇄ Layout` button.
- Verify the left sidebar shows **Open Documents** above the browse section.

### 2. Open Documents switches documents

- Click each row; confirm the active document changes and the row highlights.
- Press `Ctrl+Shift+T`; confirm the most recently closed document returns.
- Right-click a row; confirm "copy path" works and a toast appears.
- Close every document; confirm the reading pane shows the empty state while the
  sidebar remains usable.

### 3. All Documents

- Switch the browse list to **All Documents**.
- Confirm every watched path appears once with filename, location, and time.
- Confirm open documents carry an open marker.
- Click a non-open document; confirm it opens and appears in Open Documents.

### 4. Recently Changed

- Write to two different documents from a terminal.
- Confirm both appear in **Recently Changed**, newest first, one row each.
- Write to one of them again; confirm it moves to the top without duplicating.
- Confirm a document that is open can appear in both lists.

### 5. Clear and undo

- Click **Clear**.
- Confirm Recently Changed empties and unread markers disappear.
- Click **Undo**; confirm the list and unread markers return.
- Clear again, then write to a document; confirm only the new change appears.

### 6. Collapse and persistence

- Collapse the browse section; confirm Open Documents remains.
- Toggle the `✉ Inbox` control; confirm only the browse section hides.
- Change the browse mode, collapse a section, switch theme, then restart.
- Confirm mode and collapse states are restored and Recently Changed is empty.

### 7. Scale smoke test

Generate a large watch set (or point the config at a large tree) totalling about
10,000 Markdown files:

- Scroll the All Documents list rapidly; confirm no visible stall.
- Switch documents while the list is scrolled; confirm the document paints
  promptly.
- Open the pop-out view; confirm it still virtualizes and `Esc` closes it.

### 8. Edge states

- Delete a file that is open; confirm the row shows a deleted state in both
  lists.
- Recreate it; confirm the deleted state clears.
- Start with an empty config; confirm the browse section explains how to
  configure watches.
- Clear Recently Changed while a scan is still running; confirm files
  discovered afterwards are not silently marked read.

## Definition of done

- [ ] Every acceptance scenario in `spec.md` for P1–P3 passes manually.
- [ ] `npm run typecheck` and `npm run test:web` pass.
- [ ] No top tab strip or layout toggle remains in the UI.
- [ ] Open Documents is always reachable.
- [ ] Clear/undo behave and are covered by tests.
- [ ] `README.md` and its control table describe the sidebar instead of tabs.
