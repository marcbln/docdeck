/**
 * Session-scoped inbox state.
 *
 * Pure and DOM-free: `main.ts` owns the transitions, the sidebar renders it, and
 * tests read it directly. One row per canonical path.
 */

export interface InboxEntry {
  path: string;
  filename: string;
  /** Filesystem modification time, epoch ms. */
  modifiedTime: number;
  /**
   * When the session observed this document change, epoch ms.
   *
   * `0` means the document is inventory only: it was seeded by a scan or opened
   * manually, not touched by an agent since launch. Recent activity is selected
   * from this field rather than `modifiedTime`, so a scan that finishes after a
   * clear cannot surface pre-clear files as new.
   */
  changedAt: number;
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

/** Where a running scan currently is, as streamed by the backend. */
export interface ScanProgress {
  path: string;
  directories: number;
  files: number;
}

/** Everything the sidebar needs to explain the current watch state. */
export interface InboxStatus {
  configPath: string;
  configFound: boolean;
  error: string | null;
  warnings: string[];
  truncated: boolean;
  loading: boolean;
  progress: ScanProgress | null;
}

export class InboxModel {
  private readonly entries = new Map<string, InboxEntry>();

  /** Injectable clock so observation times are deterministic in tests. */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Inventory merge (startup or a session folder). Unseen rows stay plain and
   * are never counted as recent; an existing row keeps its observation time.
   */
  merge(seeds: Iterable<InboxSeed>): boolean {
    let changed = false;
    for (const seed of seeds) {
      const existing = this.entries.get(seed.path);
      if (!existing) {
        this.entries.set(seed.path, {
          ...seed,
          changedAt: 0,
          unread: false,
          deleted: false,
        });
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
   * A settled write or a manual open.
   *
   * `markUnread` is false for the active document, whose change is already on
   * screen. `recordChange` is false for a manual open, which must not appear in
   * Recently Changed; watcher writes leave it true.
   */
  upsert(
    seed: InboxSeed,
    markUnread = true,
    recordChange = true,
  ): boolean {
    const existing = this.entries.get(seed.path);
    const observedAt = recordChange ? this.now() : 0;

    if (!existing) {
      this.entries.set(seed.path, {
        ...seed,
        changedAt: observedAt,
        unread: markUnread,
        deleted: false,
      });
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
    if (recordChange) existing.changedAt = this.now();
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
    entry.changedAt = this.now();
    return true;
  }

  /**
   * Acknowledges every change observed at or before `cutoff`.
   *
   * Inventory rows (`changedAt === 0`) are ignored, and changes after the cutoff
   * keep their unread state.
   */
  acknowledgeThrough(cutoff: number): void {
    for (const entry of this.entries.values()) {
      if (entry.changedAt > 0 && entry.changedAt <= cutoff) {
        entry.unread = false;
      }
    }
  }

  /** Restores unread flags captured before a clear (undo). */
  restoreUnread(flags: Readonly<Record<string, boolean>>): void {
    for (const [path, unread] of Object.entries(flags)) {
      const entry = this.entries.get(path);
      if (entry) entry.unread = unread;
    }
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
