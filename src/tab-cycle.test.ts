import { describe, expect, it } from "vitest";

import {
  adjacentTabPath,
  tabCycleDirection,
  type TabCycleEventLike,
} from "./tab-cycle";

function shortcut(
  overrides: Partial<TabCycleEventLike> = {},
): TabCycleEventLike {
  return {
    key: "Tab",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("tabCycleDirection", () => {
  it("maps Ctrl+Tab to next and Ctrl+Shift+Tab to previous", () => {
    expect(tabCycleDirection(shortcut())).toBe("next");
    expect(tabCycleDirection(shortcut({ shiftKey: true }))).toBe("previous");
  });

  it("requires Ctrl and rejects Cmd, Alt and other keys", () => {
    expect(tabCycleDirection(shortcut({ ctrlKey: false }))).toBeNull();
    expect(
      tabCycleDirection(shortcut({ ctrlKey: false, metaKey: true })),
    ).toBeNull();
    expect(
      tabCycleDirection(shortcut({ metaKey: true, ctrlKey: true })),
    ).toBeNull();
    expect(tabCycleDirection(shortcut({ altKey: true }))).toBeNull();
    expect(tabCycleDirection(shortcut({ key: "t" }))).toBeNull();
  });
});

describe("adjacentTabPath", () => {
  const paths = ["/a.md", "/b.md", "/c.md"];

  it("steps forward and backward through the list", () => {
    expect(adjacentTabPath(paths, "/a.md", "next")).toBe("/b.md");
    expect(adjacentTabPath(paths, "/b.md", "previous")).toBe("/a.md");
  });

  it("wraps around both ends", () => {
    expect(adjacentTabPath(paths, "/c.md", "next")).toBe("/a.md");
    expect(adjacentTabPath(paths, "/a.md", "previous")).toBe("/c.md");
  });

  it("starts at the first or last tab when the active path is unknown", () => {
    expect(adjacentTabPath(paths, null, "next")).toBe("/a.md");
    expect(adjacentTabPath(paths, "/missing.md", "next")).toBe("/a.md");
    expect(adjacentTabPath(paths, null, "previous")).toBe("/c.md");
    expect(adjacentTabPath(paths, "/missing.md", "previous")).toBe("/c.md");
  });

  it("returns the only tab in either direction", () => {
    expect(adjacentTabPath(["/a.md"], "/a.md", "next")).toBe("/a.md");
    expect(adjacentTabPath(["/a.md"], "/a.md", "previous")).toBe("/a.md");
  });

  it("returns null when there are no tabs", () => {
    expect(adjacentTabPath([], null, "next")).toBeNull();
    expect(adjacentTabPath([], "/a.md", "previous")).toBeNull();
  });
});
