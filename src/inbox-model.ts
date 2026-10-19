/**
 * Session-scoped inbox state.
 *
 * Pure and DOM-free: `main.ts` owns the transitions, the panel renders it, and
 * tests read it directly. One row per canonical path.
 */

export interface InboxEntry {
  path: string;
  filename: string;
  modifiedTime: number;
  /** Changed since docdeck started and not looked at. */
  unread: boolean;
  /** Deleted on disk; kept visible until it reappears or the session ends. */
  deleted: boolean;
}

export interface InboxSeed {
  path: string;
  filename: string;
  modifiedTime: number;
}

export class InboxModel {
  private readonly entries = new Map<string, InboxEntry>();

  /** Inventory (startup or a session folder): unseen rows stay plain. */
  merge(seeds: Iterable<InboxSeed>): boolean {
    let changed = false;
    for (const seed of seeds) {
      const existing = this.entries.get(seed.path);
      if (!existing) {
        this.entries.set(seed.path, { ...seed, unread: false, deleted: false });
        changed = true;
        continue;
      }
      if (
        existing.filename !== seed.filename ||
        existing.modifiedTime !== seed.modifiedTime ||
        existing.deleted
      ) {
        existing.filename = seed.filename;
        existing.modifiedTime = seed.modifiedTime;
        existing.deleted = false;
        changed = true;
      }
    }
    return changed;
  }

  /** Replaces the whole inventory and clears all session unread state. */
  replace(seeds: Iterable<InboxSeed>): void {
    this.entries.clear();
    this.merge(seeds);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): InboxEntry | undefined {
    return this.entries.get(path);
  }

  /**
   * A settled create/write. `markUnread` is false for the active document,
   * whose change is already on screen.
   */
  upsert(seed: InboxSeed, markUnread = true): boolean {
    const existing = this.entries.get(seed.path);
    if (!existing) {
      this.entries.set(seed.path, { ...seed, unread: markUnread, deleted: false });
      return true;
    }

    const changed =
      existing.filename !== seed.filename ||
      existing.modifiedTime !== seed.modifiedTime ||
      existing.deleted ||
      (markUnread && !existing.unread);
    if (!changed) return false;

    existing.filename = seed.filename;
    existing.modifiedTime = seed.modifiedTime;
    existing.deleted = false;
    if (markUnread) existing.unread = true;
    return true;
  }

  markRead(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry || !entry.unread) return false;
    entry.unread = false;
    return true;
  }

  markDeleted(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry || entry.deleted) return false;
    entry.deleted = true;
    return true;
  }

  /** Newest first; ties broken by path so the order is total and stable. */
  entriesSorted(): InboxEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => b.modifiedTime - a.modifiedTime || a.path.localeCompare(b.path),
    );
  }

  unreadCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.unread) count += 1;
    }
    return count;
  }

  size(): number {
    return this.entries.size;
  }
}
