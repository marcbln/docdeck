---
title: Custom HTML context menu for in-app right-click actions
status: Accepted
date: 2026-10-24
deciders: docdeck maintainer
tags: [ui, context-menu, tabs, clipboard, webview]
adrId: 261024-2
---

# Custom HTML context menu for in-app right-click actions

## Context

The tab bar has no context menu. Right-clicking a tab currently surfaces the
webview's default menu, which offers nothing docdeck-specific. The first action
needed is "Copy absolute path": agents are usually addressed with file paths, so
the reader wants to grab the path of a tab without switching to it.

Two implementations are possible: a native Tauri menu (`@tauri-apps/api/menu`,
already installed, with `core:menu:default` covered by `core:default`) or an
HTML popup rendered by the frontend. docdeck's UI is themed through CSS
variables, its web modules are covered by vitest/happy-dom tests, and the app
already owns custom transient UI such as the unread-dot pulse and the find bar.

## Decision

In-app right-click actions use a custom HTML context menu, not a native Tauri
menu.

The menu is a singleton appended to the document only while open, positioned
`fixed` at the pointer and clamped to the viewport. It closes on outside
pointer-down, Escape, window blur, resize and scroll. Right-clicking a tab never
changes the active document. Keyboard users open the same menu with
`Shift+F10` or the ContextMenu key; focus moves into the menu, Escape returns it
to the tab. Tab context menus suppress the webview's default menu only; text
selection elsewhere keeps it.

The menu reuses the existing `copyText()` helper from `src/copy-code.ts`, whose
textarea fallback covers WebKitGTK's clipboard restrictions. Copy feedback is a
separate singleton toast (`src/toast.ts`) announced via `aria-live`, so the menu
can close immediately.

## Consequences

Positive:
- The menu follows the light/dark theme and the app's spacing and typography.
- Behavior is testable in happy-dom, unlike a native menu.
- Additional in-app actions (folder path, filename, reveal, close) can be added
  without new permissions or Rust commands.

Negative:
- docdeck owns positioning, outside-click, focus and dismissal logic that the
  OS would otherwise provide.
- Native menus are still required for OS-level surfaces (tray, application
  menu); the convention applies to in-app element menus only.
- Right-click parity with native menus (submenus, accelerators, screen-reader
  roles) is limited to what is implemented explicitly.

## Alternatives Considered

- **Native Tauri menu via `menu.popup()`.** Rejected: not testable in vitest,
  built asynchronously on every click, cannot follow the app theme, and would
  add a native-menu dependency for a single item.
- **Inline copy button on each tab.** Rejected: permanently consumes tab-bar
  space and competes with the close affordance for a rarely used action.
- **Keyboard shortcut only (copy active tab path).** Rejected: cannot target a
  background tab and is undiscoverable.

## Related Decisions

- [261024-1](ADR__261024-1__css-custom-highlight-api-for-in-document-find.md) —
  the find bar is another custom in-app surface driven by webview APIs.
