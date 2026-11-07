# Quickstart: Status Bar, Event Log, Window Title, and Resizable Panes

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

Validation guide for the feature. Run after `/speckit.implement` or phase by
phase. Observable behavior lives in [`contracts/`](./contracts/); state rules
live in [`data-model.md`](./data-model.md).

## Prerequisites

```bash
cd /home/marc/devel/docdeck
npm install
```

Linux also needs the packages listed in `README.md`; macOS and Windows need the
standard Tauri 2 prerequisites. Use a scratch workspace so real documents are
not modified.

## Automated checks

```bash
npm run typecheck
npm run test:web      # Vitest: window-title, layout-model, event-log, status-view,
                      # status-bar, event-log-panel, layout-resizer, preferences, sidebar
npm test              # cargo test + the same Vitest suites
npm run lint:rs       # cargo clippy -D warnings
```

Expected:

- Typecheck clean (`noUnusedLocals` / `noUnusedParameters` included).
- New pure suites pass with injected clocks and no real filesystem/network.
- Updated preference and sidebar suites pass, including legacy payloads and the
  removal of sidebar status text.
- All existing Rust and frontend suites remain green.
- Optional packaging smoke: `npm run tauri build -- --no-bundle`.

## Manual setup

```bash
mkdir -p /tmp/docdeck-e2e/_ai/backlog
export DOCDECK_CONFIG=/tmp/docdeck-e2e/config.toml
printf 'watch = ["/tmp/docdeck-e2e/_ai/**/*.md"]\nexclude = []\n' > "$DOCDECK_CONFIG"
printf '# One\n\nbody\n' > /tmp/docdeck-e2e/_ai/backlog/one.md
printf '# Two\n\nbody\n' > /tmp/docdeck-e2e/_ai/backlog/two.md
npm run tauri dev
```

## 1. Quiet sidebar and one-line status bar (P1)

1. Launch with the config above. Confirm the left sidebar contains only Open
   Documents, Browse/All Documents, its filter, and (if applicable) the setup
   hint — no scan progress, reload summary, warning list, truncation notice, or
   watch error.
2. During the initial scan, confirm the bottom line shows the current location
   and folder/file counts, updating smoothly.
3. After the scan, confirm the line shows the most recent watch event and stays a
   single quiet line.
4. Add a warning-producing selector (e.g. an unreadable/unmatched path) and
   reload. Confirm the status line shows warning severity and a warning count.
5. Remove the config file and restart. Confirm the sidebar still shows the
   actionable setup hint with the expected config path and example TOML, while no
   scan/error text appears elsewhere in the sidebar.
6. Resize the window very narrow. Confirm the status line does not wrap, the
   location shortens before the counts, and the app remains usable.

## 2. Window title (P1)

1. Open `/tmp/docdeck-e2e/_ai/backlog/one.md`. Confirm the OS title is
   `docdeck-e2e — one.md — docdeck`.
2. Open a file outside any `_ai` folder (e.g. `/tmp/plain.md`). Confirm the title
   is `plain.md — docdeck` with no project segment.
3. Switch between tabs rapidly. Confirm the title follows the active tab within
   200 ms.
4. Close the last tab. Confirm the title returns to exactly `docdeck`.
5. Rename `one.md` while it is active. Confirm the title updates to the new
   filename.
6. Linux/Wayland only: confirm the taskbar title updates. If the compositor's own
   header bar does not, confirm the documented upstream limitation and that X11 /
   the other platforms update normally.

## 3. Event log (P2)

1. Click the status line. Confirm the log opens above it and the document area
   shrinks rather than being covered. Press `Ctrl+\`` to close and reopen.
2. Confirm entries carry a timestamp, severity, one-line message, and the full
   warning text where applicable.
3. Select the Warnings filter. Confirm only warning entries remain; select All to
   restore everything.
4. Produce several events, scroll up in the log, and trigger more. Confirm the
   view does not jump and a "N new events" indicator appears. Scroll to the bottom
   and confirm following resumes.
5. Click Clear. Confirm all entries disappear, the explicit empty state appears,
   and subsequent events start a fresh list. If the warning chip was showing, it
   disappears with the log entries.
6. With focus inside the log, press `Escape`. Confirm only the log closes; the
   active document and tab remain.
7. Confirm document opens, tab switches, link clicks, copy actions, and summary
   requests never create log entries.
8. Trigger a scan over a deep tree. Confirm the log records scan start and
   completion, not one entry per directory/file.

## 4. Resizable panes and persistence (P2)

1. Drag the sidebar's right edge, the outline's right edge, the log's top edge,
   and the Open/Browse divider. Confirm each resizes smoothly and stops at its
   limits.
2. While dragging, confirm the document does not scroll or re-render; only the
   boundary moves.
3. Double-click each boundary. Confirm it returns to its default (sidebar 300,
   outline 240, log 200, even split).
4. Resize all four, quit, and relaunch. Confirm all four sizes return within 2 px.
5. Shrink the window below the stored widths. Confirm panes re-clamp so the
   document keeps its usable minimum, then enlarge again and confirm the stored
   preferences return. Confirm the stored values were not overwritten.
6. Hide the outline and collapse the Open or Browse section. Confirm their
   boundaries are inert (not draggable, not in the Tab order) and visible panes
   are unaffected.
7. Close the log and reopen it. Confirm it restores its last height and its
   resize handle is inert while closed.
8. Tab to each boundary and use the arrow keys, `Home`/`End`, and `Enter`/`Space`.
   Confirm sizes change within bounds, defaults restore, and the separator's
   accessible name/orientation/values are announced.
9. Confirm a window narrower than the defaults still leaves the document area at
   least 320 px wide whenever the window is at or above 680 px.

## 5. Corrupt / missing storage

1. In devtools, set `docdeck.preferences.v1` to invalid JSON and restart. Confirm
   the app starts with defaults and no crash.
2. Store a negative sidebar width, a huge outline width, a log height beyond 60%,
   and a split of 5. Confirm each bad field falls back to its default while valid
   preference fields (theme, toggles) survive.
3. Remove the `layout` key entirely. Confirm defaults are used and the other
   preferences still load.

## 6. Scale and performance

1. Point the config at a large tree (≈10,000 `.md` files) and scan. Confirm the
   status line updates without blocking tab switching or scrolling.
2. Generate 500+ events (repeated valid/invalid reloads). Confirm the log stays
   responsive, retains the 500 newest entries, and opening/filtering/clearing
   takes under 100 ms.
3. Drag boundaries while the log is at capacity. Confirm the drag remains smooth
   and the document does not re-render.

## 7. Regression checks

- Markdown, GFM tables, syntax highlighting, Mermaid zoom, frontmatter, TOC,
  find, link handling, unread dots, summary, config editing, tray, and installer
  behavior are unchanged.
- The sidebar still opens documents, closes tabs, filters, clears, and undoes.
- The event log and status bar never intercept document links or scrolling.
- No new dependency appears in `package.json` / `Cargo.toml`.
