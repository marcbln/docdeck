/** How many closed documents remain available to reopen in one session. */
export const MAX_CLOSED_TABS = 25;

/** The bits of a keyboard event the reopen shortcut cares about. */
export interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/**
 * Ctrl+Shift+T on Linux/Windows and Cmd+Shift+T on macOS, matching the
 * browser shortcut for reopening the most recently closed tab.
 */
export function isReopenClosedTabShortcut(event: ShortcutEventLike): boolean {
  if (event.altKey) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false;
  return event.key.toLowerCase() === "t";
}

/**
 * A session-scoped stack of paths closed by the user, most recent last.
 *
 * One row per path: closing a path that is already in the stack moves it to
 * the top instead of creating a duplicate that the shortcut would reopen
 * twice.
 */
export class ClosedTabs {
  private readonly paths: string[] = [];

  record(path: string): void {
    this.forget(path);
    this.paths.push(path);
    if (this.paths.length > MAX_CLOSED_TABS) this.paths.shift();
  }

  /** Removes and returns the most recently closed path. */
  take(): string | undefined {
    return this.paths.pop();
  }

  /** Drops a path that was opened again manually. */
  forget(path: string): void {
    const index = this.paths.lastIndexOf(path);
    if (index !== -1) this.paths.splice(index, 1);
  }

  size(): number {
    return this.paths.length;
  }
}
