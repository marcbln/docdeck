---
title: Session event log, single window-title permission and persisted pane layout
status: Accepted
date: 2026-11-06
deciders: docdeck maintainer
tags: [chrome, status-bar, event-log, layout, persistence, tauri]
adrId: 261106-1
---

# Session event log, single window-title permission and persisted pane layout

## Context

The left sidebar had become two surfaces at once: document navigation and a
stream of transient watch diagnostics ("Configuration reloaded 4m ago. 3
warnings.", truncation notices, watch errors). That made the navigation harder
to scan and duplicated state that the reader only needs on demand. The window
title also stayed at `docdeck`, so several open windows were indistinguishable.

Three decisions were needed at once: where watch diagnostics live, how the
native title is updated without moving view state into Rust, and how four pane
sizes survive a restart without adding a second storage key.

## Decision

**Diagnostics leave the sidebar.** All scan/reload/warning/truncation/error text
moves to a one-line bottom status bar and a docked event log. The sidebar keeps
only document lists and the actionable "no configuration found" hint. The
status line derives from the log (live progress > newest event > idle), so a
cleared log also removes the warning chip instead of advertising unreachable
entries.

**The event log is session-only and bounded.** `EventLog` keeps at most 500
watch/scan lifecycle entries with a monotonic id, in memory, and never touches
`localStorage`. Progress ticks are deliberately excluded; only scan/reload
start, completion and outcomes are recorded. `EventLogPanel` owns visibility,
the All/Warnings filter, Clear, follow/pause and Escape focus return while the
store stays pure and testable.

**One narrowly scoped Tauri permission.** The webview composes the title
(`project — filename — docdeck`) and writes `document.title` synchronously, then
calls `getCurrentWindow().setTitle(...)` fire-and-forget. The only capability
added is `core:window:allow-set-title` for the existing `main` window. No Rust
command or new event type is introduced; active-document state stays in the
webview.

**Pane sizes extend the existing versioned preference.** The four sizes
(`sidebarWidth`, `tocWidth`, `eventLogHeight`, `sidebarSplit`) live inside
`docdeck.preferences.v1` under `layout`, decoded per field. `resolveLayout`
derives effective sizes for the current viewport, honouring a 320 px document
floor, and never writes back; only drag end, keyboard change or double-click
persist. The window minimum width rises from 640 to 700 px so both side panes
can keep their minima (200 + 160) plus the document floor (680 px required).

## Consequences

Positive:
- One calm status line and a details-on-demand log replace scattered sidebar
  warnings; the navigation is usable at a glance.
- The log is cheap at its cap, append-only, and trivially reset; nothing new is
  written to disk.
- The title follows activation, open, close, close-all and rename without
  involving Rust or the IPC command surface.
- Resizing changes CSS custom properties only; it never re-renders Markdown, and
  a narrow window clamps without erasing the user's stored size.
- No dependency was added.

Negative:
- The event history disappears on exit by design.
- One additional capability permission must pass security review; it can only
  change the window's own title.
- The 700 px minimum width is a visible change for users who previously ran at
  640 px.
- Some Wayland compositors do not repaint their own header bar after a native
  title change (upstream Tauri #13749).

## Alternatives Considered

- **Keep a persistent warning count beside the log**: after Clear the chip would
  promise entries that no longer exist; deriving it from the log keeps the
  two-interaction promise honest.
- **Persist the event log**: the spec scopes it to the session, and persisting
  would silently widen the app's storage surface and need migration/cleanup.
- **A Rust `set_window_title` command**: moves view state into Rust (violates the
  boundary), and broadens the IPC surface more than one window permission.
- **`document.title` alone**: not reliable across WebKitGTK/WebView2; the native
  title can stay at the configured value.
- **A second storage key for layout**: duplicates validation, cleanup and the
  corruption story; the existing key is additive and already versioned.
- **Persist effective (clamped) sizes**: would overwrite the user's preference
  whenever the window is small.
- **Third-party split-pane library**: a new dependency in a deliberately
  framework-free webview, and no keyboard/a11y fit.

## Related Decisions

- Follows the session-scoped activity model in
  [ADR 261019-2](ADR__261019-2__session-scoped-unread-inbox.md).
- Extends the config-driven watch registry's reload signals from
  [ADR 261019-1](ADR__261019-1__config-driven-watch-registry.md).
