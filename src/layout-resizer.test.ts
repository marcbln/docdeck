import { afterEach, describe, expect, it, vi } from "vitest";

import { LayoutResizer, type LayoutResizerOptions } from "./layout-resizer";

interface Harness {
  handle: HTMLElement;
  resizer: LayoutResizer;
  size(): number;
  setSize: ReturnType<typeof vi.fn>;
  onPersist: ReturnType<typeof vi.fn>;
}

function mount(overrides: Partial<LayoutResizerOptions> = {}): Harness {
  document.body.innerHTML =
    '<div id="handle" role="separator" tabindex="0"></div>';
  const handle = document.getElementById("handle") as HTMLElement;
  let current = 300;
  const setSize = vi.fn((value: number) => {
    current = value;
  });
  const onPersist = vi.fn();

  const resizer = new LayoutResizer({
    handle,
    orientation: "vertical",
    axis: "x",
    getSize: () => current,
    setSize,
    getBounds: () => ({ min: 200, max: 600 }),
    getDefault: () => 300,
    onPersist,
    label: "Resize the document sidebar",
    ...overrides,
  });

  return {
    handle,
    resizer,
    size: () => current,
    setSize,
    onPersist,
  };
}

function pointer(
  type: string,
  target: EventTarget,
  init: MouseEventInit = {},
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LayoutResizer", () => {
  it("announces itself as an adjustable separator", () => {
    const { handle } = mount();

    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe(
      "Resize the document sidebar",
    );
    expect(handle.getAttribute("aria-valuemin")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("600");
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
  });

  it("drags vertically, clamps, and persists only on release", () => {
    const { handle, size, onPersist } = mount();

    pointer("pointerdown", handle, { button: 0, clientX: 100 });
    pointer("pointermove", window, { clientX: 200 });

    expect(size()).toBe(400);
    expect(onPersist).not.toHaveBeenCalled();

    pointer("pointermove", window, { clientX: 900 });
    expect(size()).toBe(600);

    pointer("pointerup", window, { clientX: 900 });
    expect(size()).toBe(600);
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledWith(600);
  });

  it("does not persist when no drag started", () => {
    const { onPersist } = mount();
    pointer("pointerup", window, {});
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("restores the default on double-click", () => {
    const { handle, size, onPersist } = mount({
      getSize: () => 480,
    });

    pointer("dblclick", handle, {});

    expect(size()).toBe(300);
    expect(onPersist).toHaveBeenCalledWith(300);
  });

  it("adjusts with the arrow keys by 10 px", () => {
    const { handle, size, resizer } = mount();
    resizer.refresh();

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(size()).toBe(310);

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(size()).toBe(300);
  });

  it("uses the inverted horizontal direction for the event log", () => {
    const { handle, size } = mount({
      orientation: "horizontal",
      axis: "y",
      invert: true,
      getSize: () => 200,
      getBounds: () => ({ min: 100, max: 480 }),
      getDefault: () => 200,
    });

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(size()).toBe(210);

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(size()).toBe(200);
  });

  it("uses a two-unit step for the sidebar split", () => {
    const { handle, size } = mount({
      orientation: "horizontal",
      axis: "y",
      step: 2,
      getSize: () => 50,
      getBounds: () => ({ min: 15, max: 85 }),
      getDefault: () => 50,
    });

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(size()).toBe(52);
  });

  it("jumps to the minimum and maximum with Home and End", () => {
    const { handle, size } = mount();

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(size()).toBe(200);

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(size()).toBe(600);
  });

  it("restores the default with Enter and Space", () => {
    const { handle } = mount({ getSize: () => 500 });

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(handle.getAttribute("aria-valuenow")).toBe("300");

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
  });

  it("updates aria-valuenow after every change", () => {
    const { handle } = mount();

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(handle.getAttribute("aria-valuenow")).toBe("310");
  });

  it("becomes inert when its pane is hidden or collapsed", () => {
    const { handle, resizer, size } = mount();

    resizer.setEnabled(false);

    expect(handle.hidden).toBe(true);
    expect(handle.tabIndex).toBe(-1);
    expect(handle.getAttribute("aria-disabled")).toBe("true");

    pointer("pointerdown", handle, { button: 0, clientX: 100 });
    pointer("pointermove", window, { clientX: 200 });
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(size()).toBe(300);

    resizer.setEnabled(true);
    expect(handle.hidden).toBe(false);
    expect(handle.tabIndex).toBe(0);
    expect(handle.hasAttribute("aria-disabled")).toBe(false);
  });

  it("scales pointer movement through getScale", () => {
    const { handle, size } = mount({
      orientation: "horizontal",
      axis: "y",
      getSize: () => 50,
      getBounds: () => ({ min: 15, max: 85 }),
      getDefault: () => 50,
      getScale: () => 0.5,
    });

    pointer("pointerdown", handle, { button: 0, clientY: 100 });
    pointer("pointermove", window, { clientY: 120 });

    expect(size()).toBe(60);
  });

  it("never invokes a document render path", () => {
    const { handle, setSize, onPersist } = mount();

    pointer("pointerdown", handle, { button: 0, clientX: 100 });
    pointer("pointermove", window, { clientX: 300 });

    expect(setSize).toHaveBeenCalled();
    expect(onPersist).not.toHaveBeenCalled();
  });
});
