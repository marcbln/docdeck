/**
 * Session-scoped inbox state.
 *
 * Pure and DOM-free: `main.ts` owns the transitions, the sidebar renders it, and
 * tests read it directly. One row per canonical path.
 */

/** Which source owns an inventory row. Reload replaces `config`, rescans
 *  `session`, and never removes `manual` rows. */
export type InboxOrigin = "config" | "session" | "manual";

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
  /** Provenance for reload reconciliation. */
  origin: InboxOrigin;
}

export interface InboxSeed {
  path: string;
  filename: string;
  modifiedTime: number;
  /** Defaults to `manual` when omitted. */
  origin?: InboxOrigin;
}

/** Where a running scan currently is, as streamed by the backend. */
export interface ScanProgress {
  path: string;
  directories: number;
  files: number;
}

/** The outcome of the most recent reload, shown next to the config status. */
export interface ReloadSummary {
  at: number;
  ok: boolean;
  error: string | null;
  warnings: string[];
  truncated: boolean;
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
  lastReload: ReloadSummary | null;
}

/** The payload the backend sends when a configuration reload settles. */
export interface ReloadResult {
  generation: number;
  at: number;
  path: string;
  found: boolean;
  revision: string;
  watch: string[];
  exclude: string[];
  roots: string[];
  entries: InboxSeed[];
  warnings: string[];
  error: string | null;
  truncated: boolean;
}

function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
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
          path: seed.path,
          filename: seed.filename,
          modifiedTime: seed.modifiedTime,
          changedAt: 0,
          unread: false,
          deleted: false,
          origin: seed.origin ?? "manual",
        });
        changed = true;
        continue;
      }
      if (
        existing.filename !== seed.filename ||
        existing.modifiedTime !== seed.modifiedTime ||
        existing.deleted ||
        (seed.origin !== undefined && seed.origin !== existing.origin)
      ) {
        existing.filename = seed.filename;
        existing.modifiedTime = seed.modifiedTime;
        existing.deleted = false;
        if (seed.origin !== undefined) existing.origin = seed.origin;
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
        path: seed.path,
        filename: seed.filename,
        modifiedTime: seed.modifiedTime,
        changedAt: observedAt,
        unread: markUnread,
        deleted: false,
        origin: seed.origin ?? "manual",
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
    if (seed.origin !== undefined) existing.origin = seed.origin;
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

  /**
   * Origin-aware reload reconciliation.
   *
   * Config and session rows are replaced by the new result, manual rows are
   * kept, and surviving paths keep `unread`/`changedAt` (a reload never marks
   * an existing document unread). Newly matched paths enter unread.
   */
  reconcile(seeds: Iterable<InboxSeed>): boolean {
    const incoming = new Map<string, InboxSeed>();
    for (const seed of seeds) {
      incoming.set(seed.path, seed);
    }

    let changed = false;
    for (const [path, entry] of this.entries) {
      if (entry.origin === "manual") continue;
      if (!incoming.has(path)) {
        this.entries.delete(path);
        changed = true;
      }
    }

    for (const seed of incoming.values()) {
      const existing = this.entries.get(seed.path);
      if (!existing) {
        this.entries.set(seed.path, {
          path: seed.path,
          filename: seed.filename,
          modifiedTime: seed.modifiedTime,
          changedAt: 0,
          unread: true,
          deleted: false,
          origin: seed.origin ?? "config",
        });
        changed = true;
        continue;
      }

      const origin =
        existing.origin === "manual" ? "manual" : seed.origin ?? existing.origin;
      if (
        existing.filename !== seed.filename ||
        existing.modifiedTime !== seed.modifiedTime ||
        existing.deleted ||
        existing.origin !== origin
      ) {
        existing.filename = seed.filename;
        existing.modifiedTime = seed.modifiedTime;
        existing.deleted = false;
        existing.origin = origin;
        changed = true;
      }
    }

    return changed;
  }

  /** Applies acknowledgement-derived unread flags without touching `changedAt`. */
  applyUnread(flags: Readonly<Record<string, boolean>>): boolean {
    let changed = false;
    for (const [path, unread] of Object.entries(flags)) {
      const entry = this.entries.get(path);
      if (entry && entry.unread !== unread) {
        entry.unread = unread;
        changed = true;
      }
    }
    return changed;
  }

  /** Sets one path's unread flag, leaving observation time untouched. */
  setUnread(path: string, unread: boolean): boolean {
    const entry = this.entries.get(path);
    if (!entry || entry.unread === unread) return false;
    entry.unread = unread;
    return true;
  }

  /**
   * Moves one row after a rename, carrying unread/changedAt/origin.
   *
   * Returns false when there was no row to move (or no new path).
   */
  rename(oldPath: string, newPath: string): boolean {
    const entry = this.entries.get(oldPath);
    if (!entry || !newPath || oldPath === newPath) return false;
    this.entries.delete(oldPath);
    entry.path = newPath;
    entry.filename = fileName(newPath);
    entry.deleted = false;
    this.entries.set(newPath, entry);
    return true;
  }

  /** Removes a row whose document left every watched location. */
  removeForMoveOut(path: string): boolean {
    return this.entries.delete(path);
  }

  /** Adds a newly created/moved-in document as unread work. */
  addCreated(seed: InboxSeed): boolean {
    const existing = this.entries.get(seed.path);
    if (existing) {
      return this.upsert(seed, true, true);
    }
    this.entries.set(seed.path, {
      path: seed.path,
      filename: seed.filename,
      modifiedTime: seed.modifiedTime,
      changedAt: this.now(),
      unread: true,
      deleted: false,
      origin: seed.origin ?? "manual",
    });
    return true;
  }

  /** Prunes rows whose path is not in `paths` (used after a successful reload). */
  retainOnly(paths: Iterable<string>): boolean {
    const keep = new Set(paths);
    let changed = false;
    for (const path of [...this.entries.keys()]) {
      if (!keep.has(path)) {
        this.entries.delete(path);
        changed = true;
      }
    }
    return changed;
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
