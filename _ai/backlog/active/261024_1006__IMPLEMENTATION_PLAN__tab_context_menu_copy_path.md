---
filename: "_ai/backlog/active/261024_1006__IMPLEMENTATION_PLAN__tab_context_menu_copy_path.md"
title: "Tab context menu: copy absolute path with tooltip and toast feedback"
createdAt: 2026-10-24 10:06
updatedAt: 2026-10-24 10:06
status: draft
priority: medium
tags: [ui, tabs, clipboard, context-menu, accessibility]
estimatedComplexity: simple
documentRevision: 1
sourceSpec: ""
sourceHandoff: ""
sourceAdrs: ["_ai/technical_decisions/ADR__261024-2__custom-html-context-menu.md"]
documentType: IMPLEMENTATION_PLAN
---

# Tab context menu: copy absolute path with tooltip and toast feedback

## Problem

docdeck tabs currently expose no file-specific actions. Right-clicking a tab
surfaces the webview's default context menu, which offers nothing useful, and
the full path is only available through a native tooltip on the filename span.
Readers working with coding agents constantly need the absolute path of a
document (to paste into a prompt or a shell), and switching to a background tab
just to retrieve it is unnecessary friction.

## Executive Summary

Add a themed, single-item context menu to every tab. Right-clicking any tab — or
pressing `Shift+F10` / the ContextMenu key while a tab has focus — opens a
frontend-rendered menu with **Copy absolute path**. Right-clicking never switches
the active tab. The action reuses the existing `copyText()` helper, whose
textarea fallback covers WebKitGTK, and reports success or failure through a new
transient toast. The path tooltip moves from the filename span to the whole tab
item. No Tauri permissions, Rust commands, plugins, or dependencies are added.

## Design Decisions & Rejected Alternatives

| Decision | Rationale |
| --- | --- |
| Custom HTML menu instead of a native Tauri menu | Themeable, testable in happy-dom, no new permissions; recorded in ADR `261024-2`. |
| Build the menu only while open | No hidden DOM or global listeners at rest; stale anchors and paths are impossible. |
| Right-click does not activate the tab | Copying a background tab's path must not disturb the reading position. |
| Reuse `copyText()` for the clipboard write | One clipboard implementation with the existing WebKitGTK fallback; no duplication. |
| `ToastHost` class instead of a module-level singleton | Test isolation (fresh instance per test) and no stale detached node after `document.body` changes. |
| Native `title` tooltip moved to the whole `.tab-item` | Free, consistent with the app; a custom tooltip would add positioning and dismissal code for no gain. |
| Dismiss on outside pointer-down, Escape, blur, resize and scroll | A fixed-position menu must not survive a moved anchor or viewport change. |
| Keyboard trigger via `Shift+F10` / ContextMenu key | The action must be reachable without a mouse; focus enters the menu and Escape returns it to the tab. |

Rejected alternatives:

- **Native Tauri menu (`menu.popup()`)** — not testable in vitest, rebuilt
  asynchronously per click, cannot follow the app theme. See ADR `261024-2`.
- **Inline copy button on every tab** — consumes tab-bar width permanently and
  competes with the close affordance.
- **Keyboard shortcut only** — cannot target a background tab and is
  undiscoverable.
- **Inline “Copied” feedback inside the menu** — the menu would have to linger
  after activation; a toast lets the menu close immediately.
- **Silent copy** — a failed clipboard write would go unnoticed.
- **Custom HTML tooltip** — unnecessary positioning and hover-delay machinery.

## Project Environment

- Desktop app: Tauri 2 + Vite + TypeScript (strict), frontend tests with
  vitest + happy-dom.
- Rust backend is unchanged. No new dependencies, permissions, or config.
- Repository has no `AGENTS.md`; work directly on the current branch. Do not
  create branches, commit, or open pull requests unless explicitly asked.
- Relevant commands:
  - `npm run typecheck` — `tsc --noEmit`
  - `npm run test:web` — vitest only
  - `npm test` — `cargo test` + vitest
  - `npm run tauri dev -- ./README.md` — manual UI verification
- happy-dom does not implement layout geometry: menu-clamping tests must stub
  `getBoundingClientRect`; real clamping is verified manually in the webview.

## Out of Scope

- Copying the filename, parent folder path, or file contents.
- Revealing the file in the system file manager.
- Context menus outside the tab bar.
- Native OS menus, tray menus, or new Tauri capabilities.

## Phase 1 — Toast host

**Goal:** a reusable, accessible transient status message for clipboard feedback.

**Files:**
- `src/toast.ts` — [NEW FILE]
- `src/toast.test.ts` — [NEW FILE]
- `src/style.css` — [MODIFY] (append toast styles)

### [NEW FILE] `src/toast.ts`

```ts
export type ToastTone = "info" | "error";

/** How long a toast stays visible before it starts fading out, in ms. */
const TOAST_DURATION_MS = 2000;

/**
 * A single transient notification anchored to the bottom-right corner.
 *
 * One host owns at most one toast node: a new message reuses it, restarts the
 * countdown, and cannot stack duplicates. The node stays in the DOM after it
 * fades so successive messages do not re-create it.
 */
export class ToastHost {
  private el: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement = document.body,
    private readonly durationMs: number = TOAST_DURATION_MS,
  ) {}

  public show(message: string, tone: ToastTone = "info"): void {
    const el = this.ensureElement();
    el.textContent = message;
    el.classList.toggle("toast-error", tone === "error");

    // Remove and re-add in the same frame so a replacement message replays the
    // entrance transition instead of appearing at full opacity instantly.
    el.classList.remove("toast-visible");
    void el.offsetWidth;
    el.classList.add("toast-visible");

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      el.classList.remove("toast-visible");
    }, this.durationMs);
  }

  /** Hides the toast immediately; the next `show` reuses the same node. */
  public dismiss(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.el?.classList.remove("toast-visible");
  }

  private ensureElement(): HTMLDivElement {
    if (this.el !== null && this.el.isConnected) return this.el;

    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    this.host.appendChild(el);
    this.el = el;
    return el;
  }
}
```

### [NEW FILE] `src/toast.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastHost } from "./toast";

describe("ToastHost", () => {
  let host: ToastHost;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    host = new ToastHost(document.body, 2000);
  });

  afterEach(() => {
    host.dismiss();
    vi.useRealTimers();
  });

  it("mounts one accessible status element and shows the message", () => {
    host.show("Path copied");

    const toast = document.querySelector(".toast");
    expect(toast?.textContent).toBe("Path copied");
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.getAttribute("aria-live")).toBe("polite");
    expect(toast?.classList.contains("toast-visible")).toBe(true);
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("fades out after the configured duration", () => {
    host.show("Path copied");
    vi.advanceTimersByTime(1999);
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(true);

    vi.advanceTimersByTime(1);
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(false);
  });

  it("reuses the node and restarts the countdown for a new message", () => {
    host.show("Path copied");
    vi.advanceTimersByTime(1500);

    host.show("Copy failed", "error");
    const toast = document.querySelector(".toast");
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(toast?.textContent).toBe("Copy failed");
    expect(toast?.classList.contains("toast-error")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(toast?.classList.contains("toast-visible")).toBe(true);

    vi.advanceTimersByTime(500);
    expect(toast?.classList.contains("toast-visible")).toBe(false);
  });

  it("clears the error tone when a success message follows", () => {
    host.show("Copy failed", "error");
    host.show("Path copied");
    expect(
      document.querySelector(".toast")?.classList.contains("toast-error"),
    ).toBe(false);
  });

  it("dismiss hides immediately and cancels the pending timer", () => {
    host.show("Path copied");
    host.dismiss();
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(false);

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
```

### [MODIFY] `src/style.css` — append

```css
/* --------------------------------------------------------------------------
   Transient toast — clipboard and status confirmations
   -------------------------------------------------------------------------- */

.toast {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 20;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
  font-size: 13px;
  pointer-events: none;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 150ms ease-out,
    transform 150ms ease-out;
}

.toast-visible {
  opacity: 1;
  transform: translateY(0);
}

.toast-error {
  color: var(--danger-color);
  border-color: var(--danger-color);
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    transition: none;
  }
}
```

### Phase 1 verification

```bash
npm run typecheck
npm run test:web -- toast
```

Done when both new tests pass and no other test changes behavior.

## Phase 2 — Tab context menu controller

**Goal:** a self-contained controller that owns the menu element, positioning,
dismissal, and keyboard focus. It never touches tab state; it only reports the
path that should be copied.

**Files:**
- `src/tab-menu.ts` — [NEW FILE]
- `src/tab-menu.test.ts` — [NEW FILE]
- `src/style.css` — [MODIFY] (append menu styles)

### [NEW FILE] `src/tab-menu.ts`

```ts
/** Where a tab menu should open: pointer coordinates or a tab's rectangle. */
export type TabMenuAnchor = { x: number; y: number } | { rect: DOMRect };

/** Gap kept between the menu and the viewport edges, in CSS pixels. */
const VIEWPORT_MARGIN = 8;

/** Vertical offset used when the menu is anchored below a tab. */
const ANCHOR_GAP = 2;

export type CopyPathHandler = (path: string) => void;

/**
 * Singleton context menu for the tab bar.
 *
 * The menu exists only while open: opening builds the element and installs the
 * global dismissal listeners, closing removes both. The controller never
 * switches tabs; it only reports the path of the tab that was right-clicked.
 */
export class TabContextMenu {
  private menu: HTMLDivElement | null = null;
  private path: string | null = null;
  private returnFocus: HTMLElement | null = null;

  private readonly onPointerDown = (event: Event): void => {
    if (this.menu && !this.menu.contains(event.target as Node)) {
      this.close(false);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close(true);
  };

  private readonly onViewportChange = (): void => {
    this.close(false);
  };

  constructor(
    private readonly onCopyPath: CopyPathHandler,
    private readonly host: HTMLElement = document.body,
  ) {}

  public get isOpen(): boolean {
    return this.menu !== null;
  }

  /**
   * Opens the menu for `path`. Re-opening while open replaces the previous
   * target, so right-clicking another tab never leaves two menus behind.
   */
  public open(
    path: string,
    anchor: TabMenuAnchor,
    returnFocus: HTMLElement | null = null,
  ): void {
    this.close(false);

    const menu = document.createElement("div");
    menu.className = "tab-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Tab actions");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Copy absolute path";
    item.addEventListener("click", () => {
      const target = this.path;
      this.close(true);
      if (target !== null) this.onCopyPath(target);
    });

    menu.appendChild(item);
    this.menu = menu;
    this.path = path;
    this.returnFocus = returnFocus;

    // Appended before measuring: an element outside the document has no box.
    this.host.appendChild(menu);
    this.position(menu, anchor);

    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("blur", this.onViewportChange);
    window.addEventListener("resize", this.onViewportChange);

    item.focus();
  }

  /** Removes the menu and every listener it installed. */
  public close(restoreFocus = false): void {
    const menu = this.menu;
    if (!menu) return;

    this.menu = null;
    this.path = null;

    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("blur", this.onViewportChange);
    window.removeEventListener("resize", this.onViewportChange);

    menu.remove();

    const target = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  /** Places the menu at the pointer, or below the tab for keyboard opens. */
  private position(menu: HTMLDivElement, anchor: TabMenuAnchor): void {
    const rect = menu.getBoundingClientRect();
    const origin =
      "rect" in anchor
        ? { x: anchor.rect.left, y: anchor.rect.bottom + ANCHOR_GAP }
        : anchor;

    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;

    menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(origin.x, maxLeft))}px`;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(origin.y, maxTop))}px`;
  }
}
```

### [NEW FILE] `src/tab-menu.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TabContextMenu } from "./tab-menu";

/** Dispatches a bubbling event from `target`, as the webview would. */
function fire(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

/** A DOMRect with explicit geometry; happy-dom has no layout engine. */
function makeRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("TabContextMenu", () => {
  let onCopyPath: ReturnType<typeof vi.fn>;
  let menu: TabContextMenu;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    document.body.replaceChildren();
    onCopyPath = vi.fn();
    menu = new TabContextMenu((path) => onCopyPath(path));

    trigger = document.createElement("button");
    trigger.textContent = "tab";
    document.body.appendChild(trigger);
    trigger.focus();
  });

  afterEach(() => {
    menu.close();
    vi.restoreAllMocks();
  });

  it("opens an accessible menu and moves focus into it", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 }, trigger);

    const element = document.querySelector(".tab-menu");
    expect(element?.getAttribute("role")).toBe("menu");
    expect(element?.getAttribute("aria-label")).toBe("Tab actions");

    const item = element?.querySelector<HTMLButtonElement>(".tab-menu-item");
    expect(item?.textContent).toBe("Copy absolute path");
    expect(item?.getAttribute("role")).toBe("menuitem");
    expect(document.activeElement).toBe(item);
    expect(menu.isOpen).toBe(true);
  });

  it("reports the path and closes when the item is clicked", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 }, trigger);
    document.querySelector<HTMLButtonElement>(".tab-menu-item")?.click();

    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onCopyPath).toHaveBeenCalledWith("/tmp/a.md");
    expect(document.querySelector(".tab-menu")).toBeNull();
    expect(menu.isOpen).toBe(false);
  });

  it("keeps only one menu when another tab is opened", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 });
    menu.open("/tmp/b.md", { x: 30, y: 40 });

    expect(document.querySelectorAll(".tab-menu")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>(".tab-menu-item")?.click();

    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onCopyPath).toHaveBeenCalledWith("/tmp/b.md");
  });

  it("positions at the pointer", () => {
    menu.open("/tmp/a.md", { x: 120, y: 80 });

    const element = document.querySelector<HTMLDivElement>(".tab-menu");
    expect(element?.style.left).toBe("120px");
    expect(element?.style.top).toBe("80px");
  });

  it("opens below a tab rectangle for keyboard invocation", () => {
    menu.open("/tmp/a.md", { rect: makeRect(40, 40, 100, 20) });

    const element = document.querySelector<HTMLDivElement>(".tab-menu");
    expect(element?.style.left).toBe("40px");
    expect(element?.style.top).toBe("62px");
  });

  it("clamps the menu inside the viewport", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      makeRect(0, 0, 200, 80),
    );

    menu.open("/tmp/a.md", { x: 5000, y: 5000 });

    const element = document.querySelector<HTMLDivElement>(".tab-menu");
    expect(element?.style.left).toBe(`${window.innerWidth - 200 - 8}px`);
    expect(element?.style.top).toBe(`${window.innerHeight - 80 - 8}px`);
  });

  it("closes on an outside pointer-down", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 });
    fire(document.body, "pointerdown");

    expect(document.querySelector(".tab-menu")).toBeNull();
  });

  it("stays open for a pointer-down inside the menu", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 });
    const item = document.querySelector<HTMLButtonElement>(".tab-menu-item");
    if (item) fire(item, "pointerdown");

    expect(document.querySelector(".tab-menu")).not.toBeNull();
  });

  it("closes on Escape and returns focus to the tab", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 }, trigger);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(document.querySelector(".tab-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the window blurs or resizes", () => {
    for (const type of ["blur", "resize"]) {
      menu.open("/tmp/a.md", { x: 10, y: 20 });
      window.dispatchEvent(new Event(type));
      expect(document.querySelector(".tab-menu")).toBeNull();
    }
  });

  it("closes when the page scrolls", () => {
    menu.open("/tmp/a.md", { x: 10, y: 20 });
    fire(document, "scroll");
    expect(document.querySelector(".tab-menu")).toBeNull();
  });
});
```

### [MODIFY] `src/style.css` — append

```css
/* --------------------------------------------------------------------------
   Tab context menu — one item, positioned at the pointer or below a tab
   -------------------------------------------------------------------------- */

.tab-menu {
  position: fixed;
  z-index: 20;
  min-width: 190px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}

.tab-menu-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  color: var(--text-primary);
  border: 0;
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.tab-menu-item:hover,
.tab-menu-item:focus-visible {
  background: var(--accent-color);
  color: var(--bg-primary);
  outline: none;
}
```

### Phase 2 verification

```bash
npm run typecheck
npm run test:web -- tab-menu
```

Done when all menu tests pass and the menu element disappears from the DOM on
every dismissal path.

## Phase 3 — AppState wiring

**Goal:** connect the menu to tabs, move the tooltip to the whole tab, and run
the clipboard action with toast feedback.

**Files:**
- `src/main.ts` — [MODIFY]

### [MODIFY] `src/main.ts` — imports

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { copyText } from "./copy-code";
import { FindController } from "./find-bar";
import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import { InboxModel, type InboxSeed } from "./inbox-model";
import { InboxPanel, type InboxStatus, type ScanProgress } from "./inbox-panel";
import {
  applyMermaidTheme,
  isTailing,
  marked,
  renderMarkdown,
} from "./markdown";
import { MetadataView } from "./metadata-jump";
import {
  createPreferenceWriter,
  loadPreferences,
  type Preferences,
  type ThemeMode,
} from "./preferences";
import { fileName, isUnderAny } from "./project";
import { TabContextMenu } from "./tab-menu";
import { createToggleButton } from "./toolbar";
import { extractHeadings } from "./toc";
import { TocPanel } from "./toc-panel";
import { ThemeController } from "./theme";
import { ToastHost } from "./toast";
```

### [MODIFY] `src/main.ts` — fields and constructor

```ts
  private readonly writer = createPreferenceWriter();
  private readonly tocPanel: TocPanel;
  private readonly find: FindController;
  private readonly tabMenu: TabContextMenu;
  private readonly toast = new ToastHost();
  private readonly metadata: MetadataView;
  private readonly theme: ThemeController;
```

Inside the constructor, directly after `this.find = new FindController({ ... });`:

```ts
    this.tabMenu = new TabContextMenu((path) => {
      void this.copyTabPath(path);
    });
```

### [MODIFY] `src/main.ts` — clipboard action

Add after `closeTab()`:

```ts
  /** Copies the tab's absolute path and reports the outcome with a toast. */
  private async copyTabPath(path: string): Promise<void> {
    const copied = await copyText(path);
    this.toast.show(
      copied ? "Path copied" : "Copy failed",
      copied ? "info" : "error",
    );
  }
```

### [MODIFY] `src/main.ts` — `renderTabs()`

Replace the existing click/keydown block and the `title.title` assignment with:

```ts
      item.title = tab.deletedOnDisk
        ? `${tab.path} (deleted on disk)`
        : tab.path;
      item.addEventListener("click", () => this.setActiveTab(tab.path));
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        // A keyboard-opened menu may be followed by the webview's own
        // contextmenu event; never reposition an already-open menu to (0, 0).
        if (this.tabMenu.isOpen) return;
        this.tabMenu.open(
          tab.path,
          { x: event.clientX, y: event.clientY },
          item,
        );
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.setActiveTab(tab.path);
          return;
        }
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
          this.tabMenu.open(
            tab.path,
            { rect: item.getBoundingClientRect() },
            item,
          );
        }
      });
```

The `title` span keeps only its text content:

```ts
      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.filename;
```

Why this shape:

- `item.title` makes the native tooltip cover the whole tab (padding, dot and
  close affordance included), not just the filename span.
- `event.preventDefault()` suppresses the webview menu only where a tab handles
  the event; text selection elsewhere is unaffected.
- The `isOpen` guard handles engines that dispatch a native `contextmenu` event
  after `Shift+F10` even though the keydown was consumed. By that point a real
  second mouse right-click has already closed the menu during its pointer-down,
  so the guard only suppresses the duplicate keyboard event.
- Right-click never calls `setActiveTab`, so background tabs stay in the
  background.
- `returnFocus: item` lets Escape restore keyboard focus to the tab.

### Phase 3 verification

```bash
npm run typecheck
npm run test:web
npm run tauri dev -- ./README.md
```

Manual checklist:

- Right-click a background tab: menu appears at the cursor and the active
  document does not change.
- Click **Copy absolute path**: the toast reads “Path copied”; paste into a
  terminal or editor and confirm the absolute path (including the deleted-on-disk
  suffix? No — the copied value is `tab.path`, without the suffix).
- Hover any part of a tab: the native tooltip shows the absolute path; a deleted
  tab appends ` (deleted on disk)`.
- Press `Shift+F10` and the ContextMenu key on a focused tab: the menu opens
  below the tab; Escape closes it and focus returns to the tab.
- Open a menu, then click elsewhere / resize the window / scroll the tab bar:
  the menu closes.
- Repeat in sidebar layout and with the menu near the right and bottom edges:
  it stays fully inside the window.
- Force failure (optional): redefining `navigator.clipboard.writeText` to reject
  and `document.execCommand` to return `false` while the menu action runs must
  show “Copy failed” with the error tone.

## Phase 4 — User documentation

**Goal:** document the new affordance where users look for features and in the
architecture map.

**Files:**
- `README.md` — [MODIFY]

Add to the **Features** list, after the unread-tab indicator or the tab-layout
bullets:

```md
- **Copy a tab's path** — right-click any tab (or press `Shift+F10` / the
  ContextMenu key) to copy the document's absolute path. Hovering a tab shows
  the same path as a tooltip, and a short toast confirms the copy.
```

Add to the **Architecture** file map, in alphabetical position:

```md
  tab-menu.ts         Right-click menu for tabs: positioning, dismissal, focus
  toast.ts            Transient themed status messages
```

## Phase 5 — Housekeeping, full validation, and implementation report

**Goal:** finish the repository-level work and record what was implemented.

### 5.1 Housekeeping

- `.gitignore`: no new file types, directories, or build artifacts are
  introduced; **no change required**.
- `README.md`: updated in Phase 4.
- `CHANGELOG.md`: add under `## [Unreleased]` → `### Added`:

```md
- Tab context menu: right-click any tab (or press `Shift+F10` / the ContextMenu
  key) to copy the document's absolute path to the clipboard. Copying confirms
  with a transient toast, and hovering anywhere on a tab now shows its full path
  as a tooltip.
```

### 5.2 Full validation

```bash
npm run typecheck
npm run test:web
npm test
npm run lint:rs
```

`npm run lint:rs` is included because the project treats clippy as a gate even
though this change does not touch Rust. Stop and fix any regression before
writing the report.

### 5.3 Implementation report

Create `_ai/backlog/reports/261024_1006__IMPLEMENTATION_REPORT__tab_context_menu_copy_path.md`:

```markdown
---
filename: "_ai/backlog/reports/261024_1006__IMPLEMENTATION_REPORT__tab_context_menu_copy_path.md"
title: "Report: Tab context menu: copy absolute path with tooltip and toast feedback"
createdAt: 2026-10-24 10:06
updatedAt: 2026-10-24 10:06
planFile: "_ai/backlog/active/261024_1006__IMPLEMENTATION_PLAN__tab_context_menu_copy_path.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 0
filesModified: 0
filesDeleted: 0
tags: [ui, tabs, clipboard, context-menu, accessibility]
documentType: IMPLEMENTATION_REPORT
---
```

Body sections, in this order:

1. **Summary** — 2–3 sentences on the shipped tab context menu.
2. **Files Changed** — new (`src/tab-menu.ts`, `src/toast.ts` and their tests),
   modified (`src/main.ts`, `src/style.css`, `README.md`, `CHANGELOG.md`), and
   the report itself; fill the frontmatter counts with real numbers.
3. **Key Changes** — menu lifecycle, tooltip move, keyboard trigger, clipboard
   reuse, toast feedback.
4. **Deviations from Plan** — anything that changed, or “None”.
5. **Technical Decisions** — only decisions made during implementation that the
   plan did not pin down.
6. **Testing Notes** — commands run plus the manual webview checklist results.
7. **Usage Examples** — the right-click and `Shift+F10` flows.
8. **Documentation Updates** — README features + architecture, CHANGELOG entry.
9. **Next Steps** — optional, e.g. additional menu items (filename, folder,
   reveal) if requested later.

### Phase 5 done criteria

- All validation commands pass.
- Report exists with accurate counts and no unresolved blockers.
- No files were committed, branched, or pushed unless the user asked.

## Requirement Coverage

| Requirement | Phases |
| --- | --- |
| Right-click a tab opens a themed menu with **Copy absolute path** | 2, 3 |
| Copy uses the absolute canonical path already stored on the tab | 3 |
| Success and failure produce transient toast feedback | 1, 3 |
| Hovering the whole tab shows the path tooltip | 3 |
| Right-click does not activate a background tab | 2, 3 |
| Keyboard access, focus handling, Escape and outside dismissal | 2, 3 |
| Menu stays inside the viewport and follows the app theme | 1, 2 |
| Unit tests, docs, changelog, and implementation report | 1, 2, 3, 4, 5 |

## Risks and Mitigations

- **WebKitGTK clipboard permissions** — `copyText()` already falls back to a
  staged textarea plus `execCommand`; the menu action introduces no new path.
- **happy-dom lacks layout** — clamping tests stub `getBoundingClientRect`;
  the real edge behavior is covered by the manual checklist.
- **Watcher re-renders replace tab elements while the menu is open** — the menu
  keeps the path, not the element; Escape restores focus only when the original
  tab is still connected (`isConnected` guard).
- **Right-click on the close affordance** — the contextmenu event bubbles to the
  tab and opens the path menu; closing still requires a left click, so there is
  no accidental close.
