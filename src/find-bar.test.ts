import { beforeEach, describe, expect, it } from "vitest";

import { FindController, type HighlightSink } from "./find-bar";

class FakeHighlights implements HighlightSink {
  readonly entries = new Map<string, Range[]>();

  set(name: string, ranges: Range[]): void {
    this.entries.set(name, ranges);
  }

  clear(name: string): void {
    this.entries.delete(name);
  }
}

function mountDocument(html: string): {
  scrollParent: HTMLElement;
  viewer: HTMLElement;
} {
  document.body.replaceChildren();

  const scrollParent = document.createElement("main");
  const viewer = document.createElement("article");
  viewer.innerHTML = html;
  scrollParent.appendChild(viewer);
  document.body.appendChild(scrollParent);

  return { scrollParent, viewer };
}

function openFind(scrollParent: HTMLElement): HTMLInputElement {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
  );

  const input = scrollParent.querySelector<HTMLInputElement>(".find-bar-input");
  if (!input) throw new Error("find input was not mounted");
  return input;
}

function counter(scrollParent: HTMLElement): HTMLElement {
  const element = scrollParent.querySelector<HTMLElement>(".find-bar-count");
  if (!element) throw new Error("find counter was not mounted");
  return element;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

describe("FindController", () => {
  let highlights: FakeHighlights;

  beforeEach(() => {
    highlights = new FakeHighlights();
  });

  it("does not open without a document", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => false,
      highlights,
    });

    openFind(scrollParent);

    expect(find.isOpen()).toBe(false);
    find.destroy();
  });

  it("paints all matches and steps through them with wraparound", () => {
    const { scrollParent, viewer } = mountDocument(
      "<p>alpha beta alpha</p>",
    );
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(scrollParent);

    type(input, "alpha");

    expect(counter(scrollParent).textContent).toBe("1/2");
    expect(highlights.entries.get("docdeck-find-match")).toHaveLength(1);
    expect(highlights.entries.get("docdeck-find-current")).toHaveLength(1);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(counter(scrollParent).textContent).toBe("2/2");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
    );
    expect(counter(scrollParent).textContent).toBe("1/2");

    find.destroy();
  });

  it("re-runs the search when the case toggle changes", () => {
    const { scrollParent, viewer } = mountDocument("<p>Alpha alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(scrollParent);

    type(input, "alpha");
    expect(counter(scrollParent).textContent).toBe("1/2");

    const caseButton =
      scrollParent.querySelector<HTMLButtonElement>(".find-bar-case");
    if (!caseButton) throw new Error("case button was not mounted");
    caseButton.click();

    expect(caseButton.getAttribute("aria-pressed")).toBe("true");
    expect(counter(scrollParent).textContent).toBe("1/1");

    find.destroy();
  });

  it("closes on Escape, clears the query and removes highlights", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(scrollParent);

    type(input, "alpha");
    expect(highlights.entries.size).toBe(2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(find.isOpen()).toBe(false);
    expect(input.value).toBe("");
    expect(highlights.entries.size).toBe(0);
    expect(counter(scrollParent).textContent).toBe("0/0");

    find.destroy();
  });

  it("keeps the query and selects the nearest match after a repaint", () => {
    const { scrollParent, viewer } = mountDocument(
      "<p>alpha beta alpha</p>",
    );
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(scrollParent);

    type(input, "alpha");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    const anchor = find.captureAnchor();
    viewer.innerHTML = "<p>new alpha</p><p>alpha</p>";
    find.refresh(anchor);

    expect(find.isOpen()).toBe(true);
    expect(counter(scrollParent).textContent).toBe("2/2");

    find.destroy();
  });

  it("scrolls a match into view when it is outside the viewport", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });

    const rangePrototype = Range.prototype as unknown as {
      getBoundingClientRect?: () => DOMRect;
    };
    const originalRangeRect = rangePrototype.getBoundingClientRect;
    const originalViewRect = scrollParent.getBoundingClientRect;

    rangePrototype.getBoundingClientRect = () =>
      ({
        top: 500,
        bottom: 520,
        height: 20,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 500,
        toJSON: () => ({}),
      }) as DOMRect;
    scrollParent.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 400,
        height: 400,
        left: 0,
        right: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const input = openFind(scrollParent);
    type(input, "alpha");

    expect(scrollParent.scrollTop).toBeGreaterThan(0);

    if (originalRangeRect) {
      rangePrototype.getBoundingClientRect = originalRangeRect;
    } else {
      delete rangePrototype.getBoundingClientRect;
    }
    scrollParent.getBoundingClientRect = originalViewRect;

    find.destroy();
  });

  it("removes the global listener on destroy", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });

    find.destroy();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
    );

    expect(find.isOpen()).toBe(false);
  });
});
