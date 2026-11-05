/** The bits of a keyboard event the tab-cycling shortcut cares about. */
export interface TabCycleEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

export type TabCycleDirection = "next" | "previous";

/**
 * Ctrl+Tab steps forward and Ctrl+Shift+Tab steps backward, matching the
 * browser tab-cycle shortcut. Cmd is deliberately rejected: on macOS Cmd+Tab
 * belongs to the application switcher.
 */
export function tabCycleDirection(
  event: TabCycleEventLike,
): TabCycleDirection | null {
  if (event.altKey) return null;
  if (!event.ctrlKey || event.metaKey) return null;
  if (event.key !== "Tab") return null;
  return event.shiftKey ? "previous" : "next";
}

/**
 * The path next to `activePath` in `paths`, wrapping at both ends. Returns
 * `null` only when there are no tabs. A missing or inactive `activePath`
 * starts from the first tab (forward) or the last tab (backward).
 */
export function adjacentTabPath(
  paths: readonly string[],
  activePath: string | null,
  direction: TabCycleDirection,
): string | null {
  if (paths.length === 0) return null;

  const current = activePath === null ? -1 : paths.indexOf(activePath);
  if (current === -1) {
    return direction === "next" ? paths[0] : paths[paths.length - 1];
  }

  const step = direction === "next" ? 1 : -1;
  return paths[(current + step + paths.length) % paths.length];
}
