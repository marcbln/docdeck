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
  let onCopyPath: ReturnType<typeof vi.fn<(path: string) => void>>;
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
