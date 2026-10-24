---
filename: "_ai/backlog/reports/261024_1006__IMPLEMENTATION_REPORT__tab_context_menu_copy_path.md"
title: "Report: Tab context menu: copy absolute path with tooltip and toast feedback"
createdAt: 2026-10-24 10:06
updatedAt: 2026-10-24 10:18
planFile: "_ai/backlog/active/261024_1006__IMPLEMENTATION_PLAN__tab_context_menu_copy_path.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 5
filesModified: 4
filesDeleted: 0
tags: [ui, tabs, clipboard, context-menu, accessibility]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Tab context menu: copy absolute path with tooltip and toast feedback

## 1. Summary

Every tab now has a themed, single-item context menu with **Copy absolute
path**, opened by right-click or by `Shift+F10` / the ContextMenu key on a
focused tab. Right-clicking never changes the active document; the existing
`copyText()` helper writes the path (including its WebKitGTK textarea fallback),
and a reusable toast confirms success or failure. The full-path tooltip moved
from the filename span to the whole tab item.

## 2. Files Changed

### Created (5)

| File | Purpose |
| --- | --- |
| `src/toast.ts` | `ToastHost`: one reusable, accessible transient status node |
| `src/toast.test.ts` | Accessibility attributes, duration, reuse, tone reset, dismissal |
| `src/tab-menu.ts` | `TabContextMenu`: menu lifecycle, positioning, dismissal, focus |
| `src/tab-menu.test.ts` | Structure, activation, single-instance, positioning, clamping, dismissal |
| `_ai/backlog/reports/261024_1006__IMPLEMENTATION_REPORT__tab_context_menu_copy_path.md` | This report |

### Modified (4)

- `src/main.ts` — imports, `tabMenu`/`toast` fields, `copyTabPath()`, tab
  `title` move, `contextmenu` and keyboard triggers.
- `src/style.css` — toast and tab-menu blocks, including reduced-motion handling.
- `README.md` — **Copy a tab's path** feature bullet and architecture entries.
- `CHANGELOG.md` — `Unreleased → Added` entry.

### Deleted

None.

## 3. Key Changes

- **Menu lifecycle.** `TabContextMenu.open()` builds the menu on demand,
  appends it, positions it, installs global dismissal listeners and focuses the
  item. `close()` removes the node and every listener. Re-opening replaces the
  previous menu and path, so only one menu can exist.
- **Positioning.** Pointer opens clamp the menu inside the viewport with an
  8px margin; keyboard opens place it just below the tab rectangle. Measurement
  happens after appending so the menu has a box.
- **Dismissal.** Outside `pointerdown`, `Escape`, window `blur`, `resize` and
  any captured `scroll` close the menu. `Escape` returns focus to the tab when
  it is still connected; the other paths do not steal focus.
- **Tooltip move.** `item.title` now carries the absolute path (with
  ` (deleted on disk)` appended when applicable), covering the padding, dot and
  close affordance instead of only the filename span.
- **Keyboard trigger.** `Shift+F10` and the ContextMenu key open the menu below
  the tab. An `isOpen` guard in the `contextmenu` handler prevents a duplicate
  native event from repositioning an already-open menu to `(0, 0)`.
- **Clipboard and toast.** `copyTabPath()` reuses `copyText()`, so the existing
  async Clipboard API path and WebKitGTK textarea fallback both apply. The
  result is reported through `ToastHost.show()`, with the error tone on failure.
- **Right-click isolation.** The context menu handler never calls
  `setActiveTab()`, so copying a background tab's path leaves the reading
  position untouched.

## 4. Deviations from Plan

1. **Test mock typing adjusted.** The planned
   `ReturnType<typeof vi.fn>` is not callable under the project's TypeScript 6
   and Vitest 5 types. The test declares the mock as
   `ReturnType<typeof vi.fn<(path: string) => void>>`; runtime behavior is
   unchanged.
2. **Manual webview checklist not run.** This environment has no interactive
   display, so `npm run tauri dev -- ./README.md` and the pointer/keyboard/edge
   checks could not be exercised here. They remain the recommended post-merge
   verification (see section 6).
3. **No commit, branch, or push.** The plan explicitly asked for none, which
   overrides the generic implement-plan commit step.

## 5. Technical Decisions

- **The menu keeps the path, not the tab element.** A watcher-driven
  `renderTabs()` can replace the tab node while the menu is open; the action
  still copies the correct path, and Escape restores focus only when the
  original node is still connected.
- **The duplicate-contextmenu guard is based on `isOpen`.** By the time an
  already-open menu receives a real second right-click, its captured
  `pointerdown` has closed it, so the guard only suppresses the duplicate
  keyboard-generated event.
- **`ToastHost` is instantiated per app, not as a module singleton.** Tests
  create isolated hosts with explicit duration and body, and the node is
  re-created if `document.body` is replaced.

## 6. Testing Notes

Automated, all green:

```bash
npm run typecheck
npm run test:web        # 16 files, 132 tests
npm test                # 60 Rust tests + 132 Vitest tests
npm run lint:rs         # clippy with -D warnings
```

Unit coverage includes the toast's accessible role/live attributes, fade
timing, node reuse, error-tone reset and immediate dismissal; and the menu's
ARIA structure, focus entry, path reporting, single-instance replacement,
pointer and keyboard anchoring, viewport clamping (with a stubbed
`getBoundingClientRect`), outside/inside pointer-down, Escape focus return,
blur, resize and scroll dismissal.

Real-webview checklist (manual, not run here): right-click a background tab,
copy and paste the path; hover the whole tab; `Shift+F10` and ContextMenu key;
Escape focus return; close on outside click, resize and scroll; clamping in
sidebar layout and near the edges; forced clipboard failure shows the error
toast.

## 7. Usage Examples

- Right-click a tab, click **Copy absolute path** — the menu closes and a
  “Path copied” toast appears; the active document is unchanged.
- Paste into a terminal or agent prompt — the path is the tab's absolute path
  without the “deleted on disk” suffix.
- Focus a tab, press `Shift+F10` (or the ContextMenu key) — the menu opens below
  the tab; `Escape` closes it and returns focus to the tab.

## 8. Documentation Updates

- `README.md`: added the **Copy a tab's path** feature bullet and
  `tab-menu.ts` / `toast.ts` to the architecture file map.
- `CHANGELOG.md`: added the feature under `Unreleased → Added`, mentioning the
  context menu, keyboard trigger, toast and whole-tab tooltip.
- No `ADR` was added: ADR `261024-2` already records the custom HTML menu
  decision implemented here.

## 9. Next Steps

- Run the manual webview checklist above in `npm run tauri dev -- ./README.md`
  before release, especially the clipboard fallback under WebKitGTK.
- Extend the menu only if requested later (copy filename, copy parent folder,
  reveal in file manager); the controller is structured so additional items
  are additive.
