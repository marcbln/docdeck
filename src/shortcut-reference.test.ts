import { describe, expect, it } from "vitest";

import { buildShortcutReference } from "./shortcut-reference";
import { FIXED_SHORTCUTS } from "./shortcuts";

function entryById(groups: ReturnType<typeof buildShortcutReference>, id: string) {
  return groups.flatMap((group) => group.entries).find((entry) => entry.id === id);
}

describe("shortcut reference", () => {
  it("lists every registered shortcut exactly once", () => {
    const groups = buildShortcutReference("other");
    const entries = groups.flatMap((group) => group.entries);
    const registeredIds = entries
      .map((entry) => entry.id)
      .filter((id) => FIXED_SHORTCUTS.some((shortcut) => shortcut.id === id));

    expect(registeredIds.sort()).toEqual(
      FIXED_SHORTCUTS.map((shortcut) => shortcut.id).sort(),
    );
  });

  it("keeps entry ids unique and every row filled in", () => {
    const entries = buildShortcutReference("other").flatMap(
      (group) => group.entries,
    );

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.keys.every((key) => key.length > 0)).toBe(true);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("formats platform modifiers the same way the app does", () => {
    const mac = buildShortcutReference("mac");
    const other = buildShortcutReference("other");

    expect(entryById(mac, "reopen-tab")?.keys).toEqual(["Cmd+Shift+T"]);
    expect(entryById(other, "reopen-tab")?.keys).toEqual(["Ctrl+Shift+T"]);
    // Close is deliberately Ctrl-only so Cmd+W stays an OS action.
    expect(entryById(mac, "close-tab")?.keys).toEqual(["Ctrl+W"]);
    expect(entryById(other, "close-tab")?.keys).toEqual(["Ctrl+W"]);
  });

  it("includes interactions that are not modifier chords", () => {
    const groups = buildShortcutReference("other");

    expect(entryById(groups, "help")?.keys).toEqual(["?"]);
    expect(entryById(groups, "context-menu")?.keys).toEqual([
      "Shift+F10",
      "Menu",
    ]);
    expect(entryById(groups, "middle-click")?.keys).toEqual(["Middle click"]);
    expect(entryById(groups, "escape")?.keys).toEqual(["Esc"]);
  });

  it("groups rows by task without empty sections", () => {
    const groups = buildShortcutReference("other");

    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
    for (const group of groups) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });
});

describe("Changed `_ai` shortcut group", () => {
  it("lists the refresh chord and row activation", () => {
    const groups = buildShortcutReference("other");
    const group = groups.find((candidate) => candidate.id === "changed-ai");
    expect(group).toBeDefined();
    expect(group!.title).toBe("Changed `_ai`");

    const refresh = entryById(groups, "refresh-changed");
    expect(refresh?.keys).toEqual(["Ctrl+Shift+R"]);
    expect(refresh?.description.length).toBeGreaterThan(0);

    const activate = entryById(groups, "activate-changed-row");
    expect(activate?.keys).toEqual(["Enter", "Space"]);
    expect(activate?.description.length).toBeGreaterThan(0);
  });

  it("uses the macOS modifier for the refresh chord", () => {
    const mac = buildShortcutReference("mac");
    expect(entryById(mac, "refresh-changed")?.keys).toEqual([
      "Cmd+Shift+R",
    ]);
  });
});
