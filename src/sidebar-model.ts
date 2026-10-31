/**
 * Pure view-model helpers for the left sidebar.
 *
 * DOM-free by design: the panel renders these values and the tests exercise the
 * ordering, dedupe, clear and undo rules without touching a document.
 */

import type { InboxEntry } from "./inbox-model";

export type BrowseMode = "all" | "recent";

/** The subset of a tab the Open Documents list needs. */
export interface TabLike {
  path: string;
  filename: string;
  modifiedTime: number;
  hasUnreadUpdate: boolean;
  deletedOnDisk: boolean;
}

export interface OpenRow {
  path: string;
  filename: string;
  modifiedTime: number;
  unread: boolean;
  deleted: boolean;
  active: boolean;
}

/** A snapshot taken before clearing; enough to restore the exact unread state. */
export interface ClearSnapshot {
  /** The `clearedAt` value before this clear. */
  clearedAt: number;
  /** Unread flag for every doc that was visible in Recently Changed. */
  unread: Record<string, boolean>;
}

/**
 * Projects the tab registry into rows.
 *
 * Manual order follows the map's insertion order. Auto-Sort orders by the most
 * recent write, with the path as a stable tiebreaker.
 */
export function buildOpenRows(
  tabs: Iterable<TabLike>,
  activePath: string | null,
  autoSort: boolean,
): OpenRow[] {
  const rows: OpenRow[] = [...tabs].map((tab) => ({
    path: tab.path,
    filename: tab.filename,
    modifiedTime: tab.modifiedTime,
    unread: tab.hasUnreadUpdate,
    deleted: tab.deletedOnDisk,
    active: tab.path === activePath,
  }));

  if (autoSort) {
    rows.sort(
      (a, b) =>
        b.modifiedTime - a.modifiedTime || a.path.localeCompare(b.path),
    );
  }

  return rows;
}

/**
 * Distinct documents observed after the clear floor, newest first.
 *
 * One row per path by construction (the model stores one entry per path), and
 * deleted documents stay in the list until the floor moves past them.
 */
export function selectRecent(
  entries: readonly InboxEntry[],
  clearedAt: number,
): InboxEntry[] {
  return entries
    .filter((entry) => entry.changedAt > clearedAt)
    .sort(
      (a, b) =>
        b.changedAt - a.changedAt || a.path.localeCompare(b.path),
    );
}

/** Captures the unread flags of the rows that are about to be cleared. */
export function snapshotRecent(
  entries: readonly InboxEntry[],
  clearedAt: number,
): ClearSnapshot {
  const unread: Record<string, boolean> = {};
  for (const entry of selectRecent(entries, clearedAt)) {
    unread[entry.path] = entry.unread;
  }
  return { clearedAt, unread };
}
