import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollToAnchor, SCROLL_OFFSET_PX } from "./scroll";

describe("scrollToAnchor", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("returns false when the target does not exist", () => {
    const pane = document.createElement("div");
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo;

    expect(scrollToAnchor(pane, "missing")).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls the pane with the sticky-header offset", () => {
    document.body.innerHTML = '<h2 id="target">Target</h2>';
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const target = document.getElementById("target");
    if (!target) throw new Error("test fixture missing");

    target.getBoundingClientRect = () => ({ top: 120 } as DOMRect);
    pane.getBoundingClientRect = () => ({ top: 20 } as DOMRect);
    Object.defineProperty(pane, "scrollTop", { value: 7, writable: true });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo;

    expect(scrollToAnchor(pane, "target")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 120 - 20 + 7 - SCROLL_OFFSET_PX,
      behavior: "smooth",
    });
  });
});
