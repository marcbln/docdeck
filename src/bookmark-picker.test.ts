import { afterEach, describe, expect, it, vi } from "vitest";

import { BookmarkPicker } from "./bookmark-picker";
import type { Heading } from "./toc";

const HEADINGS: Heading[] = [
  { depth: 1, text: "Scope", slug: "scope" },
  { depth: 2, text: "Risks", slug: "risks" },
  { depth: 3, text: "Mitigations", slug: "mitigations" },
];

function picker(): BookmarkPicker {
  return new BookmarkPicker();
}

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    ".bookmark-picker-overlay",
  );
  if (!element) throw new Error("picker did not open");
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
});

describe("BookmarkPicker", () => {
  it("opens a modal with the current headings and indentation", () => {
    picker().open({
      path: "/docs/plan.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
    });

    const modal = overlay();
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.getAttribute("aria-label")).toBe("Re-anchor bookmark");
    expect(modal.querySelector(".inbox-modal-title")?.textContent).toBe(
      "Re-anchor bookmark",
    );
    expect(modal.querySelector(".bookmark-picker-meta")?.textContent).toBe(
      "plan.md — “Risks”",
    );

    const items = [...modal.querySelectorAll<HTMLButtonElement>(".bookmark-picker-item")];
    expect(items.map((item) => item.textContent)).toEqual([
      "Scope",
      "Risks",
      "Mitigations",
    ]);
    expect(items[0].classList.contains("depth-1")).toBe(true);
    expect(items[2].classList.contains("depth-3")).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it("reports the selected heading and restores focus", () => {
    const onSelect = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const openPicker = picker();
    openPicker.open({
      path: "/docs/plan.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect,
      onRemove: vi.fn(),
      returnFocus: trigger,
    });

    document.querySelectorAll<HTMLButtonElement>(".bookmark-picker-item")[2].click();

    expect(onSelect).toHaveBeenCalledWith(2);
    expect(document.querySelector(".bookmark-picker-overlay")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("marks the current heading", () => {
    picker().open({
      path: "/docs/plan.md",
      sectionText: "Risks",
      headings: HEADINGS,
      currentIndex: 1,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
    });

    const items = document.querySelectorAll<HTMLButtonElement>(
      ".bookmark-picker-item",
    );
    expect(items[1].classList.contains("current")).toBe(true);
    expect(items[1].getAttribute("aria-current")).toBe("true");
  });

  it("cancels on Escape without changing the anchor and restores focus", () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    picker().open({
      path: "/docs/plan.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect,
      onRemove,
      returnFocus: trigger,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.querySelector(".bookmark-picker-overlay")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("cancels on an overlay click and the close button", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);

    let openPicker = picker();
    openPicker.open({
      path: "/a.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      returnFocus: trigger,
    });
    overlay().click();
    expect(document.querySelector(".bookmark-picker-overlay")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    openPicker = picker();
    openPicker.open({
      path: "/a.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      returnFocus: trigger,
    });
    (
      document.querySelector(".inbox-modal-close") as HTMLButtonElement
    ).click();
    expect(document.querySelector(".bookmark-picker-overlay")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("offers Remove bookmark when the outline is empty", () => {
    const onRemove = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);

    picker().open({
      path: "/a.md",
      sectionText: "Gone",
      headings: [],
      onSelect: vi.fn(),
      onRemove,
      returnFocus: trigger,
    });

    expect(
      document.querySelector(".bookmark-picker-empty")?.textContent,
    ).toBe("This document has no headings to anchor to.");
    const remove = document.querySelector<HTMLButtonElement>(
      ".bookmark-picker-remove",
    )!;
    expect(remove.textContent).toBe("Remove bookmark");
    remove.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".bookmark-picker-overlay")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps only one picker mounted", () => {
    const openPicker = picker();
    openPicker.open({
      path: "/a.md",
      sectionText: "Risks",
      headings: HEADINGS,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
    });
    openPicker.open({
      path: "/b.md",
      sectionText: "Scope",
      headings: HEADINGS,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
    });

    expect(document.querySelectorAll(".bookmark-picker-overlay")).toHaveLength(1);
  });
});
