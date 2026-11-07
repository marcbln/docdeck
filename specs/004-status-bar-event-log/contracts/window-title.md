# Contract: Window Title

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

Describes user-observable title behavior. Composition details live in
[`../data-model.md`](../data-model.md); the permission note is repeated here
because it is a review item.

## Composition

| Active document | OS window title |
|-----------------|-----------------|
| none | `docdeck` |
| `…/ruleman/_ai/backlog/README.md` | `ruleman — README.md — docdeck` |
| `…/a/_ai/x/b/_ai/plan.md` | `b — plan.md — docdeck` (deepest `_ai`) |
| `…/notes/todo.md` (no `_ai`) | `todo.md — docdeck` |
| `C:\\work\\_ai\\spec.md` | `work — spec.md — docdeck` |
| file named `_ai.md` | `_ai.md — docdeck` (not a directory) |

The separator is exactly one em dash surrounded by spaces. The filename is
never shortened or rewritten; the OS may truncate it visually (spec edge case).

## Update triggers and timing

| Trigger | Expected result | Budget |
|---------|-----------------|--------|
| Activate an open tab | Title matches the new active document | ≤ 200 ms |
| Open a document | Title matches the opened document | ≤ 200 ms |
| Close the active tab | Title matches the new active document | ≤ 200 ms |
| Close the last tab / close all | Exactly `docdeck` | ≤ 200 ms |
| Rename the active document | Title follows the new filename/project | ≤ 200 ms |
| App mount with no document | Exactly `docdeck` | immediate |

Title updates happen before Markdown rendering, so a large or slow document
cannot delay them.

## Failure and platform behavior

- The webview updates `document.title` even if the native API call fails; a
  failure is logged to the console and never blocks tab switching.
- The app requests only `core:window:allow-set-title` for the `main` window. No
  other window permission is added.
- Known limitation: on some Linux Wayland compositors the compositor-drawn header
  bar may not repaint after a native title change, while the taskbar title and
  `Window.title()` do. This is upstream (Tauri #13749); it is documented in the
  README and quickstart rather than worked around with Rust window logic.
- No document content, path beyond the filename/project, or secret is placed in
  the title.

## Non-goals

- No title changes for watcher activity on background documents.
- No project name inferred from watch roots or the working directory.
- No per-tab title caching; the title is always derived from the active path.
