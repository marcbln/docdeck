/**
 * Versioned persistence for the bookmark collection.
 *
 * `localStorage` is the only store. Decoding validates the envelope once and
 * each entry independently, so a corrupt record costs the reader that
 * bookmark, not the whole collection, and never blocks startup.
 */

import {
  BOOKMARK_SCHEMA_VERSION,
  type BookmarkCollection,
  type SectionAnchor,
  type SectionBookmark,
  type DocumentBookmark,
} from "./bookmarks-model";

export const STORAGE_KEY = "docdeck.bookmarks.v1";

/** The subset of `localStorage` this module needs; injectable for tests. */
export interface BookmarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULT_WRITE_DELAY_MS = 250;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((part) => typeof part === "string")
  );
}

function isDepth(value: unknown): value is SectionAnchor["depth"] {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 4
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function decodeAnchor(value: unknown): SectionAnchor | null {
  if (typeof value !== "object" || value === null) return null;
  const anchor = value as Record<string, unknown>;
  if (typeof anchor.text !== "string") return null;
  if (!isDepth(anchor.depth)) return null;
  if (!isStringArray(anchor.before, 2)) return null;
  if (!isStringArray(anchor.after, 2)) return null;
  if (!isNonNegativeInteger(anchor.ordinal)) return null;
  if (!isNonNegativeInteger(anchor.order)) return null;
  return {
    text: anchor.text,
    depth: anchor.depth,
    before: [...anchor.before],
    after: [...anchor.after],
    ordinal: anchor.ordinal,
    order: anchor.order,
  };
}

function decodeDocument(value: unknown): DocumentBookmark | null {
  if (typeof value !== "object" || value === null) return null;
  const bookmark = value as Record<string, unknown>;
  if (!isNonEmptyString(bookmark.path)) return null;
  if (!isFiniteNumber(bookmark.addedAt)) return null;
  return { path: bookmark.path, addedAt: bookmark.addedAt };
}

function decodeSection(value: unknown): SectionBookmark | null {
  if (typeof value !== "object" || value === null) return null;
  const bookmark = value as Record<string, unknown>;
  if (!isNonEmptyString(bookmark.id)) return null;
  if (!isNonEmptyString(bookmark.path)) return null;
  if (!isFiniteNumber(bookmark.addedAt)) return null;
  const anchor = decodeAnchor(bookmark.anchor);
  if (anchor === null) return null;
  return {
    id: bookmark.id,
    path: bookmark.path,
    addedAt: bookmark.addedAt,
    anchor,
  };
}

/**
 * Decodes a stored payload.
 *
 * Returns `null` only for an absent key, invalid JSON, a non-object envelope or
 * a wrong version. A valid envelope with missing/non-array fields decodes to an
 * empty collection, and invalid entries are dropped individually.
 */
export function decode(raw: string | null): BookmarkCollection | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== BOOKMARK_SCHEMA_VERSION) return null;

  const documents: DocumentBookmark[] = [];
  const seenPaths = new Set<string>();
  if (Array.isArray(record.documents)) {
    for (const value of record.documents) {
      const bookmark = decodeDocument(value);
      if (bookmark === null || seenPaths.has(bookmark.path)) continue;
      seenPaths.add(bookmark.path);
      documents.push(bookmark);
    }
  }

  const sections: SectionBookmark[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(record.sections)) {
    for (const value of record.sections) {
      const bookmark = decodeSection(value);
      if (bookmark === null || seenIds.has(bookmark.id)) continue;
      seenIds.add(bookmark.id);
      sections.push(bookmark);
    }
  }

  return { version: BOOKMARK_SCHEMA_VERSION, documents, sections };
}

/**
 * Debounced whole-collection writer.
 *
 * The collection is bounded by the feature's "few hundred" assumption, so a
 * single trailing write is cheaper than per-entry bookkeeping.
 */
export class BookmarkStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: BookmarkCollection | null = null;

  constructor(
    private readonly storage: BookmarkStorage = window.localStorage,
    private readonly writeDelayMs = DEFAULT_WRITE_DELAY_MS,
  ) {}

  /** Reads the current collection; `null` means absent or unreadable. */
  load(): BookmarkCollection | null {
    try {
      return decode(this.storage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  /** Queues one trailing write; a newer call replaces the pending value. */
  schedule(collection: BookmarkCollection): void {
    this.pending = collection;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const value = this.pending;
      this.pending = null;
      if (value !== null) this.write(value);
    }, this.writeDelayMs);
  }

  /** Writes immediately, cancelling any pending debounce. */
  flush(collection?: BookmarkCollection): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const value = collection ?? this.pending;
    this.pending = null;
    if (value !== null) this.write(value);
  }

  private write(collection: BookmarkCollection): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(collection));
    } catch {
      // Quota or a restricted webview: keep the in-memory collection working.
    }
  }
}
