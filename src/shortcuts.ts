/**
 * Shared application shortcut metadata and input guards.
 *
 * There is deliberately no configurable state here in feature 005: the registry
 * describes the fixed shortcuts so `Ctrl`/`Cmd`+`D` is not hard-coded in
 * `main.ts`, and so feature 006 can validate a user-chosen copy shortcut
 * against the same list instead of inventing a second parser.
 */

export type ShortcutPlatform = "mac" | "other";

export type ShortcutModifier = "ctrl" | "ctrlOrCmd";

export interface ShortcutDefinition {
  /** Stable identifier; feature 006 uses it to exclude the shortcut being edited. */
  id: string;
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** `ctrl` is Ctrl-only; `ctrlOrCmd` accepts Ctrl or Cmd. */
  modifier: ShortcutModifier;
  /** Whether Shift must be held. */
  shift: boolean;
}

/**
 * Every fixed shortcut the reader can reach from the global key handler.
 *
 * Find (`Ctrl`/`Cmd`+`F`) is included because the find bar handles it at the
 * window level; it is still a fixed shortcut that a remappable copy shortcut
 * must not take.
 */
export const FIXED_SHORTCUTS: readonly ShortcutDefinition[] = Object.freeze([
  { id: "toggle-bookmark", key: "d", modifier: "ctrlOrCmd", shift: false },
  { id: "next-tab", key: "Tab", modifier: "ctrl", shift: false },
  { id: "previous-tab", key: "Tab", modifier: "ctrl", shift: true },
  { id: "reopen-tab", key: "t", modifier: "ctrlOrCmd", shift: true },
  { id: "toggle-log", key: "`", modifier: "ctrlOrCmd", shift: false },
  { id: "find", key: "f", modifier: "ctrlOrCmd", shift: false },
]);

export function shortcutById(id: string): ShortcutDefinition | undefined {
  return FIXED_SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/** Detects the platform whose conventional modifier name should be shown. */
export function shortcutPlatform(
  userAgent: string = typeof navigator === "undefined"
    ? ""
    : navigator.userAgent,
): ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent) ? "mac" : "other";
}

function keyLabel(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Human-readable label used in menus and settings (`Ctrl+Shift+C` / `Cmd+…`). */
export function formatShortcut(
  definition: ShortcutDefinition,
  platform: ShortcutPlatform = shortcutPlatform(),
): string {
  const modifier =
    definition.modifier === "ctrl"
      ? "Ctrl"
      : platform === "mac"
        ? "Cmd"
        : "Ctrl";
  const parts = [modifier];
  if (definition.shift) parts.push("Shift");
  parts.push(keyLabel(definition.key));
  return parts.join("+");
}

/** Menu hint form, including the brackets, e.g. `(Ctrl+Shift+C)`. */
export function formatShortcutHint(
  definition: ShortcutDefinition,
  platform: ShortcutPlatform = shortcutPlatform(),
): string {
  return `(${formatShortcut(definition, platform)})`;
}

/**
 * Whether a keyboard event is this shortcut.
 *
 * Alt combinations never match: they belong to menus, not app shortcuts.
 */
export function matchesShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  definition: ShortcutDefinition,
): boolean {
  if (event.altKey) return false;
  if (event.shiftKey !== definition.shift) return false;

  const modifierDown =
    definition.modifier === "ctrl"
      ? event.ctrlKey && !event.metaKey
      : event.ctrlKey || event.metaKey;
  if (!modifierDown) return false;

  return event.key.toLowerCase() === definition.key.toLowerCase();
}

/** True when the event target is an editable field or region. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  ) {
    return true;
  }
  if (target.isContentEditable) return true;
  return target.closest('[contenteditable="true"]') !== null;
}

/**
 * True while any modal dialog is mounted.
 *
 * Every docdeck dialog (browse, config, summary, Mermaid fullscreen and the
 * bookmark picker) carries this pair of attributes, so one predicate covers
 * them all without a per-controller registry.
 */
export function isModalOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
