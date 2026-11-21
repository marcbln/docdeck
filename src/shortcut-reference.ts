/**
 * Display model for the keyboard-shortcuts help dialog.
 *
 * The registry in `shortcuts.ts` stays the single source of truth for chords
 * the app matches. This module only attaches human-readable labels and groups,
 * and adds the interactions that are not modifier chords (Escape, the
 * context-menu key and middle-click) so the overlay describes the real
 * surface instead of a subset of it.
 *
 * `shortcuts.test.ts` cannot see omissions here, so
 * `shortcut-reference.test.ts` walks the registry and fails when a registered
 * shortcut has no entry.
 */

import {
  formatShortcut,
  shortcutById,
  shortcutPlatform,
  type ShortcutPlatform,
} from "./shortcuts";

export interface ShortcutReferenceEntry {
  /** Stable identifier, matching a registry id or a literal interaction id. */
  id: string;
  /** One or more alternative key labels, rendered as separate `<kbd>`s. */
  keys: readonly string[];
  /** One line explaining what the shortcut does. */
  description: string;
}

export interface ShortcutReferenceGroup {
  id: string;
  title: string;
  entries: readonly ShortcutReferenceEntry[];
}

/**
 * Builds the grouped list shown in the Shortcuts tab.
 *
 * Registered chords are formatted through `formatShortcut` so the dialog and
 * the menus can never disagree about `Cmd` versus `Ctrl`. A missing registry
 * id is a programming error and throws rather than silently dropping a row.
 */
export function buildShortcutReference(
  platform: ShortcutPlatform = shortcutPlatform(),
): ShortcutReferenceGroup[] {
  const registered = (
    id: string,
    description: string,
  ): ShortcutReferenceEntry => {
    const definition = shortcutById(id);
    if (definition === undefined) {
      throw new Error(`Unknown shortcut in the reference: ${id}`);
    }
    return { id, keys: [formatShortcut(definition, platform)], description };
  };

  const literal = (
    id: string,
    keys: readonly string[],
    description: string,
  ): ShortcutReferenceEntry => ({ id, keys, description });

  return [
    {
      id: "documents",
      title: "Documents",
      entries: [
        registered("close-tab", "Close the active document"),
        registered("reopen-tab", "Reopen the most recently closed document"),
        registered("next-tab", "Activate the next open document"),
        registered("previous-tab", "Activate the previous open document"),
      ],
    },
    {
      id: "reading",
      title: "Reading",
      entries: [
        registered("find", "Find text in the active document"),
        registered(
          "toggle-bookmark",
          "Bookmark or unbookmark the active document",
        ),
      ],
    },
    {
      id: "panels",
      title: "Panels and help",
      entries: [
        registered("toggle-log", "Show or hide the event log"),
        literal("help", ["?"], "Show this help"),
      ],
    },
    {
      id: "lists",
      title: "Lists and menus",
      entries: [
        literal(
          "context-menu",
          ["Shift+F10", "Menu"],
          "Open a document's tab menu",
        ),
        literal(
          "middle-click",
          ["Middle click"],
          "Close a document or dismiss a browse row",
        ),
        literal(
          "escape",
          ["Esc"],
          "Close the current dialog, menu, log or find bar",
        ),
      ],
    },
  ];
}
