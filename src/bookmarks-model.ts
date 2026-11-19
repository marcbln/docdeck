/**
 * Pure bookmark collection state.
 *
 * DOM-free and storage-free: the controller owns persistence and session
 * resolution, the view composes rows, and tests exercise every rule without a
 * browser or a document.
 */

export const BOOKMARK_SCHEMA_VERSION = 1 as const;

export type BookmarkDepth = 1 | 2 | 3 | 4;

/** The minimum information needed to find the same heading after edits. */
export interface SectionAnchor {
  /** Plain heading text; may be empty for an image-only heading. */
  text: string;
  depth: BookmarkDepth;
  /** Up to two previous outline headings, nearest first. */
  before: string[];
  /** Up to two next outline headings, nearest first. */
  after: string[];
  /** Occurrence among headings with the same normalized text (0-based). */
  ordinal: number;
  /** Outline index at capture; display fallback only. */
  order: number;
}

export interface DocumentBookmark {
  path: string;
  addedAt: number;
}

export interface SectionBookmark {
  id: string;
  path: string;
  addedAt: number;
  anchor: SectionAnchor;
}

export interface BookmarkCollection {
  version: typeof BOOKMARK_SCHEMA_VERSION;
  documents: DocumentBookmark[];
  sections: SectionBookmark[];
}

/** Single-slot undo record; session-only and never persisted. */
export type RemovedBookmark =
  | { kind: "document"; bookmark: DocumentBookmark }
  | { kind: "section"; bookmark: SectionBookmark }
  | { kind: "sections"; bookmarks: SectionBookmark[] };

/** Default undo toast text for each snapshot shape. */
export function removedBookmarkLabel(removed: RemovedBookmark): string {
  switch (removed.kind) {
    case "document":
      return `Removed bookmark for ${fileName(removed.bookmark.path)}`;
    case "section":
      return `Removed bookmark for “${removed.bookmark.anchor.text}”`;
    case "sections":
      return removed.bookmarks.length === 1
        ? `Removed bookmark for “${removed.bookmarks[0].anchor.text}”`
        : `Removed ${removed.bookmarks.length} section bookmarks`;
  }
}

/** A fresh, mutable empty collection. */
export function emptyCollection(): BookmarkCollection {
  return { version: BOOKMARK_SCHEMA_VERSION, documents: [], sections: [] };
}

/** Auto-generated section ids are stable within one controller session. */
export function createSectionId(addedAt: number, sequence: number): string {
  return `sec-${addedAt}-${sequence}`;
}

function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** Heading comparison normalizes edge whitespace and internal runs. */
export function normalizeHeadingText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Anchor identity for dedupe.
 *
 * `order` is deliberately absent: inserting a heading before the target must
 * not make the same heading look like a different bookmark.
 */
export function sectionAnchorKey(anchor: SectionAnchor): string {
  return JSON.stringify([
    normalizeHeadingText(anchor.text),
    anchor.depth,
    anchor.before.map(normalizeHeadingText),
    anchor.after.map(normalizeHeadingText),
    anchor.ordinal,
  ]);
}

export function sectionIdentity(path: string, anchor: SectionAnchor): string {
  return `${path}\u0000${sectionAnchorKey(anchor)}`;
}

export function hasDocument(
  collection: BookmarkCollection,
  path: string,
): boolean {
  return collection.documents.some((bookmark) => bookmark.path === path);
}

export function addDocument(
  collection: BookmarkCollection,
  path: string,
  addedAt: number,
): boolean {
  if (hasDocument(collection, path)) return false;
  collection.documents.push({ path, addedAt });
  return true;
}

export function removeDocument(
  collection: BookmarkCollection,
  path: string,
): DocumentBookmark | null {
  const index = collection.documents.findIndex(
    (bookmark) => bookmark.path === path,
  );
  if (index === -1) return null;
  const [removed] = collection.documents.splice(index, 1);
  return removed;
}

export function toggleDocument(
  collection: BookmarkCollection,
  path: string,
  addedAt: number,
): { added: boolean; removed: DocumentBookmark | null } {
  const removed = removeDocument(collection, path);
  if (removed !== null) return { added: false, removed };
  addDocument(collection, path, addedAt);
  return { added: true, removed: null };
}

export function sectionsForPath(
  collection: BookmarkCollection,
  path: string,
): SectionBookmark[] {
  return collection.sections.filter((bookmark) => bookmark.path === path);
}

export function findSectionByAnchor(
  collection: BookmarkCollection,
  path: string,
  anchor: SectionAnchor,
): SectionBookmark | undefined {
  const identity = sectionIdentity(path, anchor);
  return collection.sections.find(
    (bookmark) => sectionIdentity(bookmark.path, bookmark.anchor) === identity,
  );
}

/**
 * Adds a section unless an identical anchor already exists for the same path.
 *
 * Returns the existing bookmark when it is a duplicate.
 */
export function addSection(
  collection: BookmarkCollection,
  path: string,
  anchor: SectionAnchor,
  addedAt: number,
  id: string,
): SectionBookmark {
  const existing = findSectionByAnchor(collection, path, anchor);
  if (existing !== undefined) return existing;
  const bookmark: SectionBookmark = { id, path, addedAt, anchor };
  collection.sections.push(bookmark);
  return bookmark;
}

export function removeSection(
  collection: BookmarkCollection,
  id: string,
): SectionBookmark | null {
  const index = collection.sections.findIndex((bookmark) => bookmark.id === id);
  if (index === -1) return null;
  const [removed] = collection.sections.splice(index, 1);
  return removed;
}

/** Removes every section bookmark with this path and anchor identity. */
export function removeSectionsByAnchor(
  collection: BookmarkCollection,
  path: string,
  anchor: SectionAnchor,
): SectionBookmark[] {
  const identity = sectionIdentity(path, anchor);
  const removed: SectionBookmark[] = [];
  collection.sections = collection.sections.filter((bookmark) => {
    if (sectionIdentity(bookmark.path, bookmark.anchor) !== identity) {
      return true;
    }
    removed.push(bookmark);
    return false;
  });
  return removed;
}

export function reanchorSection(
  collection: BookmarkCollection,
  id: string,
  anchor: SectionAnchor,
): boolean {
  const bookmark = collection.sections.find((candidate) => candidate.id === id);
  if (bookmark === undefined) return false;
  bookmark.anchor = anchor;
  return true;
}

/**
 * Re-keys a document marker and every section path after a rename.
 *
 * A pre-existing document marker at the target wins: the earlier `addedAt` is
 * kept and the duplicate is discarded. Section ids, anchors and timestamps do
 * not change.
 */
export function renamePath(
  collection: BookmarkCollection,
  oldPath: string,
  newPath: string,
): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false;

  const oldDocument = collection.documents.find(
    (bookmark) => bookmark.path === oldPath,
  );
  const targetIndex = collection.documents.findIndex(
    (bookmark) => bookmark.path === newPath,
  );

  let changed = false;
  if (oldDocument !== undefined) {
    changed = true;
    if (targetIndex === -1) {
      oldDocument.path = newPath;
    } else {
      const target = collection.documents[targetIndex];
      target.addedAt = Math.min(target.addedAt, oldDocument.addedAt);
      collection.documents = collection.documents.filter(
        (bookmark) => bookmark !== oldDocument,
      );
    }
  }

  for (const bookmark of collection.sections) {
    if (bookmark.path === oldPath) {
      bookmark.path = newPath;
      changed = true;
    }
  }
  return changed;
}

/** Sorted, deduplicated document paths that qualify for notifications. */
export function notificationPaths(
  collection: BookmarkCollection,
): string[] {
  const paths = new Set<string>();
  for (const bookmark of collection.documents) paths.add(bookmark.path);
  for (const bookmark of collection.sections) paths.add(bookmark.path);
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function cloneCollection(
  collection: BookmarkCollection,
): BookmarkCollection {
  return {
    version: BOOKMARK_SCHEMA_VERSION,
    documents: collection.documents.map((bookmark) => ({ ...bookmark })),
    sections: collection.sections.map((bookmark) => ({
      ...bookmark,
      anchor: {
        ...bookmark.anchor,
        before: [...bookmark.anchor.before],
        after: [...bookmark.anchor.after],
      },
    })),
  };
}
