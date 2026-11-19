import { afterEach, describe, expect, it } from "vitest";

import {
  FIXED_SHORTCUTS,
  formatShortcut,
  formatShortcutHint,
  isModalOpen,
  isTypingTarget,
  matchesShortcut,
  shortcutById,
  shortcutPlatform,
} from "./shortcuts";

function key(
  value: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, ...init });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shortcut registry", () => {
  it("registers the document bookmark shortcut against the copy shortcut", () => {
    const bookmark = shortcutById("toggle-bookmark");
    expect(bookmark).toBeDefined();
    expect(formatShortcut(bookmark!, "other")).toBe("Ctrl+D");
    expect(formatShortcut(bookmark!, "mac")).toBe("Cmd+D");
  });

  it("keeps every fixed shortcut identifiable", () => {
    expect(new Set(FIXED_SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(
      FIXED_SHORTCUTS.length,
    );
  });

  it("formats Ctrl and Cmd labels consistently", () => {
    const reopen = shortcutById("reopen-tab")!;
    expect(formatShortcut(reopen, "other")).toBe("Ctrl+Shift+T");
    expect(formatShortcut(reopen, "mac")).toBe("Cmd+Shift+T");
    expect(formatShortcutHint(reopen, "other")).toBe("(Ctrl+Shift+T)");
  });

  it("detects macOS from the user agent", () => {
    expect(shortcutPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
      "mac",
    );
    expect(shortcutPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });
});

describe("shortcut matching", () => {
  it("matches Ctrl+D and Cmd+D but not unmodified D", () => {
    const bookmark = shortcutById("toggle-bookmark")!;
    expect(matchesShortcut(key("d", { ctrlKey: true }), bookmark)).toBe(true);
    expect(matchesShortcut(key("D", { metaKey: true }), bookmark)).toBe(true);
    expect(matchesShortcut(key("d"), bookmark)).toBe(false);
  });

  it("requires the exact shift state", () => {
    const reopen = shortcutById("reopen-tab")!;
    expect(
      matchesShortcut(key("t", { ctrlKey: true, shiftKey: true }), reopen),
    ).toBe(true);
    expect(matchesShortcut(key("t", { ctrlKey: true }), reopen)).toBe(false);
  });

  it("keeps Ctrl+Tab distinct from Ctrl+Shift+Tab", () => {
    const next = shortcutById("next-tab")!;
    const previous = shortcutById("previous-tab")!;
    expect(matchesShortcut(key("Tab", { ctrlKey: true }), next)).toBe(true);
    expect(matchesShortcut(key("Tab", { ctrlKey: true }), previous)).toBe(
      false,
    );
    expect(
      matchesShortcut(
        key("Tab", { ctrlKey: true, shiftKey: true }),
        previous,
      ),
    ).toBe(true);
  });

  it("rejects Alt combinations", () => {
    const bookmark = shortcutById("toggle-bookmark")!;
    expect(
      matchesShortcut(key("d", { ctrlKey: true, altKey: true }), bookmark),
    ).toBe(false);
  });
});

describe("input guards", () => {
  it("treats inputs, textareas, selects and contenteditable as typing targets", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const nested = document.createElement("span");
    editable.append(nested);

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(nested)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("detects a mounted modal dialog", () => {
    expect(isModalOpen()).toBe(false);

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.append(overlay);

    expect(isModalOpen()).toBe(true);
  });

  it("ignores non-modal dialogs", () => {
    const panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    document.body.append(panel);
    expect(isModalOpen()).toBe(false);
  });
});
