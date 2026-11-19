/**
 * Stateful owner of the bookmark collection.
 *
 * Persistence, session resolutions, undo and the notification-filter seam live
 * here. Everything is injectable (storage, clock, id generator, sync callback)
 * so the rules are tested without Tauri, a real clock or a browser download.
 */

import type { HeadingResolution } from "./bookmark-anchors";
import {
  addDocument,
  addSection as addSectionToCollection,
  cloneCollection,
  createSectionId,
  emptyCollection,
  findSectionByAnchor,
  hasDocument,
  notificationPaths,
  reanchorSection as reanchorInCollection,
  removeDocument as removeDocumentFromCollection,
  removeSection as removeSectionFromCollection,
  removeSectionsByAnchor,
  renamePath,
  type BookmarkCollection,
  type DocumentBookmark,
  type RemovedBookmark,
  type SectionAnchor,
  type SectionBookmark,
} from "./bookmarks-model";
import {
  BookmarkStore,
  type BookmarkStorage,
} from "./bookmarks-storage";

export interface NotificationBookmarkFilter {
  enabled: boolean;
  paths: string[];
}

export type NotificationSync = (
  filter: NotificationBookmarkFilter,
) => void | Promise<void>;

export interface BookmarksControllerOptions {
  storage?: BookmarkStorage;
  writeDelayMs?: number;
  now?: () => number;
  /** Injected for deterministic ids; defaults to `sec-<time>-<sequence>`. */
  createId?: (addedAt: number) => string;
  syncNotifications?: NotificationSync;
  /** Reads the current preference; defaults to false. */
  notificationEnabled?: () => boolean;
  /** Repaint hook after a durable mutation or resolution change. */
  onChange?: () => void;
  onNotificationError?: (error: unknown) => void;
}

export class BookmarksController {
  private readonly store: BookmarkStore;
  private collection: BookmarkCollection;
  private removed: RemovedBookmark | null = null;
  private readonly resolutions = new Map<string, HeadingResolution>();
  private sequence = 0;

  private readonly now: () => number;
  private readonly createId: (addedAt: number) => string;
  private readonly syncNotificationsCallback: NotificationSync | undefined;
  private readonly notificationEnabled: () => boolean;
  private readonly onChange: (() => void) | undefined;
  private readonly onNotificationError: ((error: unknown) => void) | undefined;

  constructor(options: BookmarksControllerOptions = {}) {
    this.store = new BookmarkStore(options.storage, options.writeDelayMs);
    this.collection = this.store.load() ?? emptyCollection();
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      ((addedAt: number) => createSectionId(addedAt, ++this.sequence));
    this.syncNotificationsCallback = options.syncNotifications;
    this.notificationEnabled = options.notificationEnabled ?? (() => false);
    this.onChange = options.onChange;
    this.onNotificationError = options.onNotificationError;
  }

  // -- reads ----------------------------------------------------------------

  get documents(): readonly DocumentBookmark[] {
    return this.collection.documents;
  }

  get sections(): readonly SectionBookmark[] {
    return this.collection.sections;
  }

  get canUndo(): boolean {
    return this.removed !== null;
  }

  get lastRemoved(): RemovedBookmark | null {
    return this.removed;
  }

  get snapshot(): BookmarkCollection {
    return cloneCollection(this.collection);
  }

  isDocumentBookmarked(path: string): boolean {
    return hasDocument(this.collection, path);
  }

  sectionsForPath(path: string): SectionBookmark[] {
    return this.collection.sections.filter((bookmark) => bookmark.path === path);
  }

  sectionById(id: string): SectionBookmark | undefined {
    return this.collection.sections.find((bookmark) => bookmark.id === id);
  }

  /** Session resolution for a section id, if one has been computed. */
  getResolution(id: string): HeadingResolution | undefined {
    return this.resolutions.get(id);
  }

  /** Snapshot for the view; never persisted. */
  get resolutionMap(): ReadonlyMap<string, HeadingResolution> {
    return this.resolutions;
  }

  /**
   * Counts section bookmarks that currently resolve to the same path + slug.
   *
   * The view uses this for the `Shared` annotation; ids are kept so the outline
   * can remove every bookmark targeting one heading.
   */
  sharedTargets(): Map<string, string[]> {
    const shared = new Map<string, string[]>();
    for (const section of this.collection.sections) {
      const resolution = this.resolutions.get(section.id);
      if (resolution?.kind !== "resolved") continue;
      const key = `${section.path}\u0000${resolution.slug}`;
      const ids = shared.get(key) ?? [];
      ids.push(section.id);
      shared.set(key, ids);
    }
    return shared;
  }

  notificationFilter(): NotificationBookmarkFilter {
    return {
      enabled: this.notificationEnabled(),
      paths: notificationPaths(this.collection),
    };
  }

  // -- document mutations ---------------------------------------------------

  /** Returns true when the document is bookmarked afterwards. */
  toggleDocument(path: string): boolean {
    if (this.collection.documents.some((bookmark) => bookmark.path === path)) {
      this.removeDocument(path);
      return false;
    }
    this.addDocument(path);
    return true;
  }

  addDocument(path: string): DocumentBookmark {
    const addedAt = this.now();
    addDocument(this.collection, path, addedAt);
    this.afterMutation();
    return { path, addedAt };
  }

  removeDocument(path: string): DocumentBookmark | null {
    const removed = removeDocumentFromCollection(this.collection, path);
    if (removed === null) return null;
    this.removed = { kind: "document", bookmark: removed };
    this.afterMutation();
    return removed;
  }

  // -- section mutations ----------------------------------------------------

  /** Returns the existing bookmark when the anchor is already bookmarked. */
  addSection(path: string, anchor: SectionAnchor): SectionBookmark {
    const addedAt = this.now();
    const created = addSectionToCollection(
      this.collection,
      path,
      anchor,
      addedAt,
      this.createId(addedAt),
    );
    this.afterMutation();
    return created;
  }

  /** Toggles by anchor identity; returns removed bookmarks (empty on add). */
  toggleSection(path: string, anchor: SectionAnchor): SectionBookmark[] {
    const existing = findSectionByAnchor(this.collection, path, anchor);
    if (existing === undefined) {
      this.addSection(path, anchor);
      return [];
    }
    return this.removeSectionsByAnchor(path, anchor);
  }

  removeSection(id: string): SectionBookmark | null {
    const bookmark = this.sectionById(id);
    if (bookmark === undefined) return null;
    const removed = removeSectionFromCollection(this.collection, id);
    if (removed === null) return null;
    this.resolutions.delete(id);
    this.removed = { kind: "section", bookmark: removed };
    this.afterMutation();
    return removed;
  }

  removeSections(ids: readonly string[]): SectionBookmark[] {
    const removed: SectionBookmark[] = [];
    const wanted = new Set(ids);
    for (const bookmark of this.collection.sections) {
      if (wanted.has(bookmark.id)) removed.push(bookmark);
    }
    if (removed.length === 0) return [];

    const remove = new Set(removed.map((bookmark) => bookmark.id));
    this.collection.sections = this.collection.sections.filter(
      (bookmark) => !remove.has(bookmark.id),
    );
    for (const bookmark of removed) this.resolutions.delete(bookmark.id);

    this.removed =
      removed.length === 1
        ? { kind: "section", bookmark: removed[0] }
        : { kind: "sections", bookmarks: removed };
    this.afterMutation();
    return removed;
  }

  private removeSectionsByAnchor(
    path: string,
    anchor: SectionAnchor,
  ): SectionBookmark[] {
    const removed = removeSectionsByAnchor(this.collection, path, anchor);
    if (removed.length === 0) return [];
    for (const bookmark of removed) this.resolutions.delete(bookmark.id);
    this.removed =
      removed.length === 1
        ? { kind: "section", bookmark: removed[0] }
        : { kind: "sections", bookmarks: removed };
    this.afterMutation();
    return removed;
  }

  /** Replaces an anchor after a picker choice; keeps id/path/addedAt. */
  reanchorSection(id: string, anchor: SectionAnchor): boolean {
    if (!reanchorInCollection(this.collection, id, anchor)) return false;
    this.removed = null;
    this.afterMutation();
    return true;
  }

  // -- undo -----------------------------------------------------------------

  /** Restores the most recently removed bookmark(s) exactly. */
  undo(): boolean {
    const removed = this.removed;
    if (removed === null) return false;
    this.removed = null;

    if (removed.kind === "document") {
      if (!hasDocument(this.collection, removed.bookmark.path)) {
        this.collection.documents.push({ ...removed.bookmark });
      }
    } else {
      const bookmarks =
        removed.kind === "section" ? [removed.bookmark] : removed.bookmarks;
      for (const bookmark of bookmarks) {
        if (
          !this.collection.sections.some(
            (candidate) => candidate.id === bookmark.id,
          )
        ) {
          this.collection.sections.push({
            ...bookmark,
            anchor: {
              ...bookmark.anchor,
              before: [...bookmark.anchor.before],
              after: [...bookmark.anchor.after],
            },
          });
        }
      }
    }

    this.afterMutation();
    return true;
  }

  // -- rename ---------------------------------------------------------------

  /** Re-keys document and section bookmarks after a settled watcher rename. */
  rename(oldPath: string, newPath: string): boolean {
    if (!renamePath(this.collection, oldPath, newPath)) return false;
    this.afterMutation();
    return true;
  }

  // -- session resolutions --------------------------------------------------

  setResolution(id: string, resolution: HeadingResolution): void {
    this.resolutions.set(id, resolution);
    this.onChange?.();
  }

  /** Replaces several resolutions with one repaint. */
  setResolutions(
    entries: Iterable<readonly [string, HeadingResolution]>,
  ): void {
    let changed = false;
    for (const [id, resolution] of entries) {
      this.resolutions.set(id, resolution);
      changed = true;
    }
    if (changed) this.onChange?.();
  }

  /**
   * Drops resolutions for every document except `path`.
   *
   * Closed documents must read as "not checked": keeping a resolution for a
   * document that is no longer on screen would claim a validity we did not
   * re-check.
   */
  retainResolutionsForPath(path: string | null): void {
    const keep = new Set(
      this.collection.sections
        .filter((section) => section.path === path)
        .map((section) => section.id),
    );
    let changed = false;
    for (const id of [...this.resolutions.keys()]) {
      if (!keep.has(id)) {
        this.resolutions.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange?.();
  }

  clearResolution(id: string): void {
    if (this.resolutions.delete(id)) this.onChange?.();
  }

  clearAllResolutions(): void {
    if (this.resolutions.size === 0) return;
    this.resolutions.clear();
    this.onChange?.();
  }

  // -- persistence and notifications ---------------------------------------

  /** Sends the current path set to Rust; failures never break a bookmark action. */
  syncNotifications(): void {
    const callback = this.syncNotificationsCallback;
    if (callback === undefined) return;
    try {
      const result = callback(this.notificationFilter());
      if (result instanceof Promise) {
        void result.catch((error: unknown) =>
          this.onNotificationError?.(error),
        );
      }
    } catch (error) {
      this.onNotificationError?.(error);
    }
  }

  flush(): void {
    this.store.flush(this.collection);
  }

  private afterMutation(): void {
    this.store.schedule(this.collection);
    this.syncNotifications();
    this.onChange?.();
  }
}
