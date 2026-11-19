import { describe, expect, it } from "vitest";

import type { InboxEntry } from "./inbox-model";
import { bindInboxRow, createInboxRow } from "./sidebar-rows";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path: "/home/u/devel/docdeck/_ai/plan.md",
    filename: "plan.md",
    modifiedTime: NOW - 60_000,
    changedAt: NOW,
    unread: false,
    deleted: false,
    inventoryHidden: false,
    origin: "config",
    ...overrides,
  };
}

describe("inbox row anatomy", () => {
  it("builds a main activation button and sibling bookmark button", () => {
    const row = createInboxRow();
    expect(row.className).toBe("inbox-row");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.querySelector(".inbox-row-main")?.tagName).toBe("BUTTON");
    expect(row.querySelector(".inbox-bookmark")?.tagName).toBe("BUTTON");
    expect(row.querySelector(".inbox-row-main .inbox-bookmark")).toBeNull();
  });

  it("binds unread, deleted and bookmark state", () => {
    const row = createInboxRow();
    bindInboxRow(
      row,
      entry({ unread: true }),
      new Set(["/home/u/devel/docdeck/_ai/plan.md"]),
      "/home/u/devel/docdeck/_ai/plan.md",
      NOW,
      true,
    );

    expect(row.classList.contains("unread")).toBe(true);
    expect(row.classList.contains("open")).toBe(true);
    expect(row.classList.contains("active")).toBe(true);
    expect(row.querySelector(".inbox-filename")?.textContent).toBe("plan.md");
    expect(row.querySelector(".inbox-project")?.textContent).toBe("docdeck");
    expect(row.querySelector(".inbox-dot")).not.toBeNull();

    const star = row.querySelector<HTMLButtonElement>(".inbox-bookmark")!;
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.getAttribute("aria-label")).toBe("Remove bookmark for plan.md");
    expect(star.textContent).toBe("★");
  });

  it("renders an empty star and no unread marker for a plain row", () => {
    const row = createInboxRow();
    bindInboxRow(row, entry(), new Set(), null, NOW, false);

    expect(row.classList.contains("unread")).toBe(false);
    expect(
      row.querySelector<HTMLButtonElement>(".inbox-bookmark")?.textContent,
    ).toBe("☆");
    expect(
      row.querySelector<HTMLButtonElement>(".inbox-bookmark")?.getAttribute(
        "aria-label",
      ),
    ).toBe("Bookmark plan.md");
  });

  it("keeps a deleted row visible and titled as deleted", () => {
    const row = createInboxRow();
    bindInboxRow(row, entry({ deleted: true }), new Set(), null, NOW, false);

    expect(row.classList.contains("deleted")).toBe(true);
    expect(
      row.querySelector(".inbox-filename")?.getAttribute("title"),
    ).toContain("deleted on disk");
  });
});
