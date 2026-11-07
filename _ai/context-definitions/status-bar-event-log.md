---
id: status-bar-event-log
title: Status bar, event log, window title and resizable panes
type: context
updated: 2026-11-06
related:
  - ADR__261106-1__session-event-log-and-resizable-panes
  - ADR__261019-1__config-driven-watch-registry
---

# Status bar, event log, window title and resizable panes

Four chrome surfaces share one rule: watch diagnostics leave the navigation
sidebar, and nothing new is persisted except the four pane sizes.

## 1. Window title

Pure `composeWindowTitle(activePath)` in `src/window-title.ts`:

- `null` → `docdeck`
- path under `_ai` → `project — filename — docdeck` (deepest `_ai` wins)
- no `_ai` → `filename — docdeck`

`main.ts` writes `document.title` synchronously and then calls the native
`getCurrentWindow().setTitle(...)` fire-and-forget. The only added capability is
`core:window:allow-set-title` on the `main` window. Update points: mount, tab
activation, open, active-tab close, close-all and rename. Some Wayland
compositors do not repaint their header bar (upstream Tauri #13749).

## 2. Status bar

`src/status-view.ts` is pure and derives `{ phase, location, directories, files,
event, warningCount, severity, text }` with precedence **live scan progress >
newest event > idle**. `src/status-bar.ts` is a thin DOM controller that renders
the location and counts as separate segments (the location ellipsizes before
the counts), shows a warning chip only when the count is non-zero, and never
takes focus or intercepts document events.

Clicking the bar toggles the log; the warning chip opens it with the Warnings
filter selected. `Ctrl+\`` does the same unless focus is in an input/textarea/
contenteditable.

## 3. Event log (session-only)

`src/event-log.ts` is a DOM-free bounded store: capacity 500, oldest-first,
monotonic ids never reused after `clear()`, never touches `localStorage`.
`EventKind` is a closed union of watch/scan lifecycle kinds. Recorded signals:
scan start/completion, reload outcome, warnings, truncation, watch roots
added/removed, and watch errors. Never recorded: document opens, tab activity,
links, copies, summaries, watcher document ticks, or `scan-progress` ticks.

`src/event-log-panel.ts` owns visibility, the All/Warnings filter, Clear,
follow/pause (within 24 px of the bottom), an `N new events` pill, and Escape
focus return. It appends one row per new entry rather than re-rendering, and
always renders text with `textContent`. Log visibility, filter and follow state
are session-only.

## 4. Resizable panes

`src/layout-model.ts` holds defaults (300 / 240 / 200 / 50), static ranges,
per-field validation and `resolveLayout(preferences, viewport)`. Resolution
reserves a 320 px document floor and never mutates the stored preference; both
panes fall back to their minima below 680 px (the window minimum is 700 px).

| Pane | Default | Bound |
| --- | --- | --- |
| Sidebar width | 300 | 200 … min(600, ½ window) |
| Outline width | 240 | 160 … min(480, ½ window) |
| Event-log height | 200 | 100 … 60% window height |
| Open/Browse split | 50% | 15 … 85% |

`src/layout-resizer.ts` is one reusable controller for all four boundaries:
pointer drag with guarded capture, double-click reset, `Arrow*`/`Home`/`End`/
`Enter`/`Space`, `aria-valuenow` updates, an inert switch, and persist-on-end.
Persistence reuses `docdeck.preferences.v1` under `layout`; a window resize
recomputes CSS only and does not write.

## State ownership

| State | Owner | Persisted |
| --- | --- | --- |
| Active document / title | webview `main.ts` | no |
| Status bar view | derived per render | no |
| Event log entries | `EventLog` | no (session) |
| Log open/filter/follow | `EventLogPanel` | no |
| Pane sizes | `Preferences.layout` | yes, version 1 |
| Effective layout | `resolveLayout` | never written back |

## Test seams

Pure: `window-title.test.ts`, `status-view.test.ts`, `event-log.test.ts`,
`layout-model.test.ts`. DOM (`happy-dom`): `status-bar.test.ts`,
`event-log-panel.test.ts`, `layout-resizer.test.ts`, plus the updated
`preferences.test.ts` and `sidebar-panel.test.ts`.
