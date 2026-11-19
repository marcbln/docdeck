/**
 * Composition of the bookmark collection, inventory and session resolutions
 * into the rows the Bookmarks view renders.
 *
 * Pure and DOM-free: availability, ordering, status, filtering and counts are
 * derived here so the panel stays a thin renderer.
 */

import type { HeadingResolution } from "./bookmark-anchors";
import {
  hasDocument,
  type BookmarkCollection,
  type SectionBookmark,
} from "./bookmarks-model";
import type { InboxEntry } from "./inbox-model";
import { fileName, projectName } from "./project";

export type SectionStatus =
  | "unavailable"
  | "stale"
  | "unverified"
  | "re-anchored"
  | "current"
  | "shared";

export interface BookmarkSectionView {
  id: string;
  path: string;
  /** Resolved current text, else the stored anchor text. */
  text: string;
  depth: number;
  order: number;
  status: SectionStatus;
  /** Count of other bookmarks resolving to the same heading (0 when none). */
  sharedWith: number;
  /** Present only when resolved and activatable. */
  headingSlug: string | null;
}

export interface BookmarkDocumentView {
  path: string;
  filename: string;
  project: string | null;
  modifiedTime: number;
  available: boolean;
  unread: boolean;
  documentBookmarked: boolean;
  sections: BookmarkSectionView[];
  sectionCount: number;
}

export type BookmarkRow =
  | { kind: "document"; document: BookmarkDocumentView }
  | { kind: "section"; section: BookmarkSectionView };

export interface BookmarkViewInput {
  collection: BookmarkCollection;
  inventory: readonly InboxEntry[];
  /** Shared browse filter; trimmed and case-insensitive. */
  filterTerm?: string;
  /** Session resolutions keyed by section id. */
  resolutions?: ReadonlyMap<string, HeadingResolution>;
  /** Optional unread resolver; defaults to the inventory flag. */
  unread?: (path: string, entry: InboxEntry | undefined) => boolean;
}

export interface BookmarkView {
  rows: BookmarkRow[];
  documents: BookmarkDocumentView[];
  documentCount: number;
  sectionCount: number;
  /** Full collection marker count, independent of the active filter. */
  totalCount: number;
}

function matchesDocument(
  document: BookmarkDocumentView,
  needle: string,
): boolean {
  if (document.filename.toLowerCase().includes(needle)) return true;
  if (document.path.toLowerCase().includes(needle)) return true;
  return document.project !== null && document.project.toLowerCase().includes(needle);
}

function sharedSlugCounts(
  resolutions: ReadonlyMap<string, HeadingResolution>,
  sections: readonly SectionBookmark[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const resolution = resolutions.get(section.id);
    if (resolution?.kind !== "resolved") continue;
    const key = `${section.path}\u0000${resolution.slug}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sectionView(
  section: SectionBookmark,
  available: boolean,
  resolutions: ReadonlyMap<string, HeadingResolution>,
  shared: Map<string, number>,
): BookmarkSectionView {
  const resolution = resolutions.get(section.id);
  let status: SectionStatus;
  let sharedWith = 0;
  let headingSlug: string | null = null;
  let text = section.anchor.text;
  let depth: number = section.anchor.depth;
  let order = section.anchor.order;

  if (!available) {
    status = "unavailable";
  } else if (resolution === undefined) {
    status = "unverified";
  } else if (resolution.kind === "stale") {
    status = "stale";
  } else {
    const key = `${section.path}\u0000${resolution.slug}`;
    const count = shared.get(key) ?? 1;
    sharedWith = Math.max(0, count - 1);
    status =
      count > 1
        ? "shared"
        : resolution.via === "context" || resolution.via === "picker"
          ? "re-anchored"
          : "current";
    headingSlug = resolution.slug;
    text = resolution.text;
    depth = resolution.depth;
    order = resolution.index;
  }

  return {
    id: section.id,
    path: section.path,
    text,
    depth,
    order,
    status,
    sharedWith,
    headingSlug,
  };
}

/**
 * Builds the document and section rows for the Bookmarks view.
 *
 * Filtering keeps a matching document with every section; a non-matching
 * document survives only as a container for matching sections.
 */
export function buildBookmarkView(input: BookmarkViewInput): BookmarkView {
  const inventory = new Map(
    input.inventory.map((entry) => [entry.path, entry] as const),
  );
  const resolutions = input.resolutions ?? new Map();
  const shared = sharedSlugCounts(resolutions, input.collection.sections);
  const needle = (input.filterTerm ?? "").trim().toLowerCase();

  const paths = new Set<string>();
  for (const bookmark of input.collection.documents) paths.add(bookmark.path);
  for (const bookmark of input.collection.sections) paths.add(bookmark.path);

  const documents: BookmarkDocumentView[] = [];
  for (const path of paths) {
    const entry = inventory.get(path);
    const available = entry !== undefined && entry.deleted === false;
    const sections = input.collection.sections
      .filter((bookmark) => bookmark.path === path)
      .sort((a, b) => {
        const aResolution = resolutions.get(a.id);
        const bResolution = resolutions.get(b.id);
        const aOrder =
          aResolution?.kind === "resolved" ? aResolution.index : a.anchor.order;
        const bOrder =
          bResolution?.kind === "resolved" ? bResolution.index : b.anchor.order;
        return (
          aOrder - bOrder ||
          a.addedAt - b.addedAt ||
          a.id.localeCompare(b.id)
        );
      })
      .map((bookmark) =>
        sectionView(bookmark, available, resolutions, shared),
      );

    const document: BookmarkDocumentView = {
      path,
      filename: entry?.filename ?? fileName(path),
      project: projectName(path),
      modifiedTime: entry?.modifiedTime ?? 0,
      available,
      unread:
        available &&
        (input.unread
          ? input.unread(path, entry)
          : (entry?.unread ?? false)),
      documentBookmarked: hasDocument(input.collection, path),
      sections,
      sectionCount: sections.length,
    };

    if (needle.length === 0) {
      documents.push(document);
      continue;
    }

    const documentMatches = matchesDocument(document, needle);
    const matchingSections = documentMatches
      ? sections
      : sections.filter((section) =>
          section.text.toLowerCase().includes(needle),
        );

    if (!documentMatches && matchingSections.length === 0) continue;
    documents.push({
      ...document,
      sections: matchingSections,
      sectionCount: matchingSections.length,
    });
  }

  documents.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.available) {
      return (
        b.modifiedTime - a.modifiedTime || a.path.localeCompare(b.path)
      );
    }
    return (
      a.filename.localeCompare(b.filename) || a.path.localeCompare(b.path)
    );
  });

  const rows: BookmarkRow[] = [];
  let sectionCount = 0;
  for (const document of documents) {
    rows.push({ kind: "document", document });
    for (const section of document.sections) {
      rows.push({ kind: "section", section });
      sectionCount += 1;
    }
  }

  return {
    rows,
    documents,
    documentCount: documents.length,
    sectionCount,
    totalCount:
      input.collection.documents.length + input.collection.sections.length,
  };
}

/** The mode badge count, independent of the active filter. */
export function bookmarkMarkerCount(collection: BookmarkCollection): number {
  return collection.documents.length + collection.sections.length;
}
