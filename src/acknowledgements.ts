/**
 * Cross-session unread acknowledgements.
 *
 * A document is unread when its current filesystem mtime is newer than the
 * mtime recorded the last time the reader reviewed it. The recorded mtime (not
 * wall-clock review time) makes the rule immune to clock changes, time zones and
 * files with future mtimes.
 *
 * Pure state plus a debounced writer; no DOM access beyond `localStorage`.
 */

export const STORAGE_KEY = "docdeck.acknowledgements.v1";
export const SCHEMA_VERSION = 1;
const DEFAULT_WRITE_DELAY_MS = 250;

export interface AcknowledgementRecord {
  /** Document mtime observed when the document was reviewed. */
  mtime: number;
  /** Wall-clock review time; diagnostics only. */
  at: number;
}

export interface AcknowledgementStore {
  version: 1;
  entries: Record<string, AcknowledgementRecord>;
}

/** The subset of `localStorage` this module needs; injectable for tests. */
export interface AckStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DatedDocument {
  path: string;
  modifiedTime: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Decodes stored JSON, validating per entry.
 *
 * Returns `null` for anything that is not a version-1 store: corrupt JSON, a
 * wrong version, or a malformed envelope. One bad entry is dropped while the
 * valid ones survive, so a single corrupt record never costs the reader their
 * whole history.
 */
export function decode(raw: string | null): AcknowledgementStore | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== SCHEMA_VERSION) return null;
  if (typeof record.entries !== "object" || record.entries === null) return null;

  const entries: Record<string, AcknowledgementRecord> = {};
  for (const [path, value] of Object.entries(
    record.entries as Record<string, unknown>,
  )) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (!isFiniteNumber(entry.mtime) || !isFiniteNumber(entry.at)) continue;
    entries[path] = { mtime: entry.mtime, at: entry.at };
  }

  return { version: SCHEMA_VERSION, entries };
}

/**
 * The unread rule.
 *
 * No stored history at all is a first launch: nothing is unread. Once a store
 * exists, a watched path with no acknowledgement is new or re-added work.
 */
export function unreadFor(
  modifiedTime: number,
  record: AcknowledgementRecord | undefined,
  hasStore: boolean,
): boolean {
  if (!hasStore) return false;
  if (record === undefined) return true;
  return modifiedTime > record.mtime;
}

export class Acknowledgements {
  private store: AcknowledgementStore;
  private storeExists: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: AckStorage = window.localStorage,
    private readonly now: () => number = Date.now,
    private readonly writeDelayMs = DEFAULT_WRITE_DELAY_MS,
  ) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    const decoded = decode(raw);
    this.storeExists = decoded !== null;
    this.store = decoded ?? { version: SCHEMA_VERSION, entries: {} };
  }

  /** Whether a valid store existed at construction time. */
  get hasStore(): boolean {
    return this.storeExists;
  }

  get(path: string): AcknowledgementRecord | undefined {
    return this.store.entries[path];
  }

  /**
   * Unread flags for the given inventory.
   *
   * Before the first successful inventory load has seeded a baseline, nothing
   * is unread; afterwards an absent entry means new work.
   */
  unreadFlags(entries: Iterable<DatedDocument>): Record<string, boolean> {
    const flags: Record<string, boolean> = {};
    for (const entry of entries) {
      flags[entry.path] = unreadFor(
        entry.modifiedTime,
        this.store.entries[entry.path],
        this.storeExists,
      );
    }
    return flags;
  }

  /**
   * Establishes the first-launch baseline: every currently watched document is
   * acknowledged at its current mtime, so nothing is unread merely because
   * history was absent.
   */
  seedBaseline(entries: Iterable<DatedDocument>): void {
    if (this.storeExists) return;
    const at = this.now();
    for (const entry of entries) {
      this.store.entries[entry.path] = { mtime: entry.modifiedTime, at };
    }
    this.storeExists = true;
    this.scheduleWrite();
  }

  /** Records that the reader reviewed `path` at its current mtime. */
  acknowledge(path: string, mtime: number): void {
    this.store.entries[path] = { mtime, at: this.now() };
    this.storeExists = true;
    this.scheduleWrite();
  }

  /** Carries an acknowledgement across a rename or move. */
  move(oldPath: string, newPath: string): void {
    const record = this.store.entries[oldPath];
    if (record === undefined || oldPath === newPath) return;
    delete this.store.entries[oldPath];
    this.store.entries[newPath] = record;
    this.scheduleWrite();
  }

  /** Drops history for paths that are no longer watched. */
  prune(watchedPaths: Iterable<string>): void {
    const keep = new Set(watchedPaths);
    let changed = false;
    for (const path of Object.keys(this.store.entries)) {
      if (!keep.has(path)) {
        delete this.store.entries[path];
        changed = true;
      }
    }
    if (changed) this.scheduleWrite();
  }

  /** Number of stored acknowledgements; test and diagnostic helper. */
  size(): number {
    return Object.keys(this.store.entries).length;
  }

  /** Serialized payload, exactly the shape written to storage. */
  snapshot(): AcknowledgementStore {
    return {
      version: SCHEMA_VERSION,
      entries: { ...this.store.entries },
    };
  }

  /** Writes now, cancelling any pending debounce (used on pagehide). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.write();
  }

  private scheduleWrite(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.writeDelayMs);
  }

  private write(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch {
      // Persistence is best effort; a restricted webview must not break review.
    }
  }
}
