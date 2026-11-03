import { afterEach, describe, expect, it, vi } from "vitest";

import { InboxBrowser } from "./browse-modal";
import type { InboxEntry } from "./inbox-model";
import { ROW_HEIGHT } from "./virtual-list";

const NOW = 1_800_000_000_000;
const VIEWPORT = 480;

function entry(index: number): InboxEntry {
  return {
    path: `/a/doc-${index}.md`,
    filename: `doc-${index}.md`,
    modifiedTime: NOW - index * 1_000,
    changedAt: NOW - index * 1_000,
    unread: false,
    deleted: false,
    inventoryHidden: false,
    origin: "manual",
  };
}

function entries(count: number): InboxEntry[] {
  return Array.from({ length: count }, (_, index) => entry(index));
}

function openBrowser(
  all: InboxEntry[],
  onOpen = vi.fn(),
): InboxBrowser {
  const browser = new InboxBrowser({ onOpen, now: () => NOW, viewportHeight: VIEWPORT });
  browser.open(all, new Set(), null);
  return browser;
}

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".inbox-overlay");
  if (!element) throw new Error("modal did not open");
  return element;
}

function rowPaths(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>(".inbox-row")].map(
    (row) => row.dataset.path ?? "",
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("InboxBrowser", () => {
  it("shows the complete inventory in a windowed list", () => {
    const all = entries(1_000);
    openBrowser(all);

    const modal = overlay();
    expect(modal.querySelector(".inbox-modal-title")?.textContent).toBe(
      "All files",
    );
    expect(modal.querySelector(".inbox-modal-count")?.textContent).toBe(
      "1000 files",
    );
    expect(rowPaths(modal)[0]).toBe(all[0].path);
    expect(modal.querySelectorAll(".inbox-row").length).toBe(22);
    expect(
      (modal.querySelector(".inbox-list") as HTMLElement).style.height,
    ).toBe(`${1_000 * ROW_HEIGHT}px`);
  });

  it("moves the window on scroll", async () => {
    const all = entries(1_000);
    openBrowser(all);
    const modal = overlay();
    const body = modal.querySelector(".inbox-modal-body") as HTMLElement;

    body.scrollTop = 400 * ROW_HEIGHT;
    body.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const paths = rowPaths(modal);
    expect(paths[0]).toBe(all[394].path);
    expect(paths[paths.length - 1]).toBe(all[415].path);
  });

  it("opens a row and closes the modal", () => {
    const all = entries(10);
    const onOpen = vi.fn();
    openBrowser(all, onOpen);

    (overlay().querySelector(".inbox-row") as HTMLElement).click();

    expect(onOpen).toHaveBeenCalledWith(all[0].path);
    expect(document.querySelector(".inbox-overlay")).toBeNull();
  });

  it("closes on Escape, the close button and a backdrop click", () => {
    let browser = openBrowser(entries(10));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".inbox-overlay")).toBeNull();
    browser.destroy();

    browser = openBrowser(entries(10));
    (overlay().querySelector(".inbox-modal-close") as HTMLButtonElement).click();
    expect(document.querySelector(".inbox-overlay")).toBeNull();
    browser.destroy();

    browser = openBrowser(entries(10));
    overlay().click();
    expect(document.querySelector(".inbox-overlay")).toBeNull();
    browser.destroy();
  });

  it("shows an empty message when nothing matches", () => {
    openBrowser([]);
    expect(overlay().querySelector(".inbox-empty")).not.toBeNull();
  });
  it("shows the filtered set and its filtered empty state", () => {
    const browser = new InboxBrowser({
      onOpen: vi.fn(),
      now: () => NOW,
      viewportHeight: VIEWPORT,
    });

    browser.open([], new Set(), null, "No documents match “plan”.");

    expect(document.querySelector(".inbox-modal-count")?.textContent).toBe("0 files");
    const empty = document.querySelector<HTMLElement>(".inbox-empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe("No documents match “plan”.");
  });

  it("counts only the inventory it was given", () => {
    const browser = new InboxBrowser({ onOpen: vi.fn(), now: () => NOW, viewportHeight: VIEWPORT });
    browser.open([entry(0), entry(1)], new Set(), null, "ignored");

    expect(document.querySelector(".inbox-modal-count")?.textContent).toBe("2 files");
  });
});
