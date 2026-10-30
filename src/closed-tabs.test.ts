import { describe, expect, it } from "vitest";

import {
  ClosedTabs,
  MAX_CLOSED_TABS,
  isReopenClosedTabShortcut,
} from "./closed-tabs";

function shortcut(overrides: Partial<Parameters<typeof isReopenClosedTabShortcut>[0]> = {}) {
  return {
    key: "t",
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    ...overrides,
  };
}

describe("isReopenClosedTabShortcut", () => {
  it("matches Ctrl+Shift+T and Cmd+Shift+T", () => {
    expect(isReopenClosedTabShortcut(shortcut())).toBe(true);
    expect(
      isReopenClosedTabShortcut(shortcut({ ctrlKey: false, metaKey: true })),
    ).toBe(true);
    expect(isReopenClosedTabShortcut(shortcut({ key: "T" }))).toBe(true);
  });

  it("requires both the modifier and Shift", () => {
    expect(isReopenClosedTabShortcut(shortcut({ shiftKey: false }))).toBe(false);
    expect(
      isReopenClosedTabShortcut(shortcut({ ctrlKey: false, metaKey: false })),
    ).toBe(false);
  });

  it("ignores other keys and Alt combinations", () => {
    expect(isReopenClosedTabShortcut(shortcut({ key: "r" }))).toBe(false);
    expect(isReopenClosedTabShortcut(shortcut({ altKey: true }))).toBe(false);
  });
});

describe("ClosedTabs", () => {
  it("returns closed paths in most-recent-first order", () => {
    const closed = new ClosedTabs();
    closed.record("/a.md");
    closed.record("/b.md");

    expect(closed.take()).toBe("/b.md");
    expect(closed.take()).toBe("/a.md");
    expect(closed.take()).toBeUndefined();
  });

  it("moves a repeatedly closed path to the top without duplicating it", () => {
    const closed = new ClosedTabs();
    closed.record("/a.md");
    closed.record("/b.md");
    closed.record("/a.md");

    expect(closed.size()).toBe(2);
    expect(closed.take()).toBe("/a.md");
    expect(closed.take()).toBe("/b.md");
  });

  it("forgets a path that was opened manually again", () => {
    const closed = new ClosedTabs();
    closed.record("/a.md");
    closed.record("/b.md");

    closed.forget("/a.md");

    expect(closed.size()).toBe(1);
    expect(closed.take()).toBe("/b.md");
  });

  it("keeps only the newest paths up to the cap", () => {
    const closed = new ClosedTabs();
    for (let index = 0; index <= MAX_CLOSED_TABS; index += 1) {
      closed.record(`/doc-${index}.md`);
    }

    expect(closed.size()).toBe(MAX_CLOSED_TABS);
    expect(closed.take()).toBe(`/doc-${MAX_CLOSED_TABS}.md`);
  });
});
