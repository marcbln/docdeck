import { describe, expect, it } from "vitest";

import {
  OVERSCAN,
  ROW_HEIGHT,
  VirtualList,
  visibleRange,
} from "./virtual-list";

const VIEWPORT = 480;

describe("visibleRange", () => {
  it("returns an empty range when there is nothing to show", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 0, OVERSCAN)).toEqual({
      start: 0,
      end: 0,
    });
    expect(visibleRange(0, 0, ROW_HEIGHT, 100, OVERSCAN)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("renders fewer rows than the window when the list is small", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 5, OVERSCAN)).toEqual({
      start: 0,
      end: 5,
    });
  });

  it("starts at the top with overscan for a fresh scroll", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN)).toEqual({
      start: 0,
      end: 22,
    });
  });

  it("tracks a middle scroll offset", () => {
    expect(
      visibleRange(400 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 394, end: 416 });
  });

  it("clamps to the end of the list", () => {
    expect(
      visibleRange(10_000 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 978, end: 1_000 });
  });

  it("handles a single row and fractional offsets", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 1, OVERSCAN)).toEqual({
      start: 0,
      end: 1,
    });
    expect(
      visibleRange(10.5 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 4, end: 26 });
  });
});

describe("VirtualList", () => {
  function mount<T>(items: T[]): {
    list: HTMLUListElement;
    host: HTMLDivElement;
    virtual: VirtualList<T>;
    activated: T[];
  } {
    document.body.innerHTML =
      '<div id="host" style="height: 480px"><ul id="list"></ul></div>';
    const host = document.getElementById("host") as HTMLDivElement;
    const list = document.getElementById("list") as HTMLUListElement;
    const activated: T[] = [];
    const virtual = new VirtualList<T>(list, host, {
      viewportHeight: VIEWPORT,
      createRow: () => {
        const row = document.createElement("li");
        row.className = "inbox-row";
        row.tabIndex = 0;
        const name = document.createElement("span");
        name.className = "inbox-filename";
        row.append(name);
        return row;
      },
      bindRow: (row, item) => {
        row.dataset.path = String(item);
        row.querySelector(".inbox-filename")!.textContent = String(item);
      },
      onActivate: (item) => activated.push(item),
    });
    virtual.setItems(items);
    return { list, host, virtual, activated };
  }

  it("renders only the visible window", () => {
    const { list } = mount(Array.from({ length: 10_000 }, (_, i) => `doc-${i}`));

    expect(list.querySelectorAll(".inbox-row").length).toBe(22);
    expect(list.style.height).toBe(`${10_000 * ROW_HEIGHT}px`);
  });

  it("activates a row on click and Enter", () => {
    const { list, activated } = mount(["a", "b"]);
    const row = list.querySelector(".inbox-row") as HTMLElement;

    row.click();
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(activated).toEqual(["a", "a"]);
  });

  it("releases listeners without throwing on destroy", () => {
    const { virtual } = mount(["a"]);
    expect(() => virtual.destroy()).not.toThrow();
  });
});
