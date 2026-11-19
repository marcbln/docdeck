import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureAnchor } from "./bookmark-anchors";
import type { SectionAnchor } from "./bookmarks-model";
import { BookmarksController } from "./bookmarks-controller";
import type { BookmarkStorage } from "./bookmarks-storage";
import type { Heading } from "./toc";

class MemoryStorage implements BookmarkStorage {
  values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
}

const HEADINGS: Heading[] = [
  { depth: 1, text: "Scope", slug: "scope" },
  { depth: 2, text: "Risks", slug: "risks" },
  { depth: 2, text: "Risks", slug: "risks-1" },
  { depth: 2, text: "Open questions", slug: "open-questions" },
];

function anchor(index = 1): SectionAnchor {
  return captureAnchor(HEADINGS, index);
}

function controller(
  storage = new MemoryStorage(),
  overrides: Partial<ConstructorParameters<typeof BookmarksController>[0]> = {},
): BookmarksController {
  return new BookmarksController({
    storage,
    writeDelayMs: 10,
    now: () => 1_000,
    createId: (() => {
      let n = 0;
      return () => `sec-${++n}`;
    })(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BookmarksController documents", () => {
  it("starts empty for an absent key", () => {
    const bookmarks = controller();
    expect(bookmarks.documents).toEqual([]);
    expect(bookmarks.sections).toEqual([]);
    expect(bookmarks.canUndo).toBe(false);
  });

  it("toggles a document and records a removal snapshot", () => {
    const bookmarks = controller();
    expect(bookmarks.toggleDocument("/a.md")).toBe(true);
    expect(bookmarks.isDocumentBookmarked("/a.md")).toBe(true);

    expect(bookmarks.toggleDocument("/a.md")).toBe(false);
    expect(bookmarks.isDocumentBookmarked("/a.md")).toBe(false);
    expect(bookmarks.canUndo).toBe(true);
    expect(bookmarks.lastRemoved).toMatchObject({
      kind: "document",
      bookmark: { path: "/a.md", addedAt: 1_000 },
    });
  });

  it("undoes a document removal exactly", () => {
    const bookmarks = controller();
    bookmarks.addDocument("/a.md");
    bookmarks.removeDocument("/a.md");
    expect(bookmarks.undo()).toBe(true);
    expect(bookmarks.documents).toEqual([{ path: "/a.md", addedAt: 1_000 }]);
    expect(bookmarks.canUndo).toBe(false);
    expect(bookmarks.undo()).toBe(false);
  });

  it("keeps section bookmarks when a document bookmark is removed", () => {
    const bookmarks = controller();
    bookmarks.addDocument("/a.md");
    bookmarks.addSection("/a.md", anchor());
    bookmarks.removeDocument("/a.md");
    expect(bookmarks.documents).toEqual([]);
    expect(bookmarks.sections).toHaveLength(1);
  });

  it("replaces the single undo snapshot on the next removal", () => {
    const bookmarks = controller();
    bookmarks.addDocument("/a.md");
    bookmarks.addDocument("/b.md");
    bookmarks.removeDocument("/a.md");
    bookmarks.removeDocument("/b.md");
    expect(bookmarks.undo()).toBe(true);
    expect(bookmarks.documents).toEqual([{ path: "/b.md", addedAt: 1_000 }]);
  });
});

describe("BookmarksController sections", () => {
  it("adds, deduplicates by anchor and toggles off", () => {
    const bookmarks = controller();
    const first = bookmarks.addSection("/a.md", anchor());
    const duplicate = bookmarks.addSection("/a.md", anchor());
    expect(duplicate.id).toBe(first.id);
    expect(bookmarks.sections).toHaveLength(1);

    expect(bookmarks.toggleSection("/a.md", anchor())).toHaveLength(1);
    expect(bookmarks.sections).toEqual([]);
    expect(bookmarks.lastRemoved?.kind).toBe("section");
  });

  it("adds through toggle when the anchor is new", () => {
    const bookmarks = controller();
    expect(bookmarks.toggleSection("/a.md", anchor())).toEqual([]);
    expect(bookmarks.sections).toHaveLength(1);
  });

  it("restores the exact anchor and id on undo", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/a.md", anchor(2));
    bookmarks.removeSection(section.id);
    expect(bookmarks.undo()).toBe(true);
    expect(bookmarks.sections[0]).toEqual(section);
  });

  it("re-anchors without changing id, path or addedAt", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/a.md", anchor());
    const next = anchor(2);
    expect(bookmarks.reanchorSection(section.id, next)).toBe(true);
    expect(bookmarks.sectionById(section.id)).toMatchObject({
      id: section.id,
      path: "/a.md",
      addedAt: 1_000,
      anchor: next,
    });
  });

  it("removes several sections as one undo record", () => {
    const bookmarks = controller();
    const first = bookmarks.addSection("/a.md", anchor(1));
    const second = bookmarks.addSection("/a.md", anchor(2));
    expect(bookmarks.removeSections([first.id, second.id])).toHaveLength(2);
    expect(bookmarks.lastRemoved?.kind).toBe("sections");
    expect(bookmarks.undo()).toBe(true);
    expect(bookmarks.sections.map((section) => section.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });
});

describe("BookmarksController rename and persistence", () => {
  it("re-keys document and section paths", () => {
    const bookmarks = controller();
    bookmarks.addDocument("/old.md");
    const section = bookmarks.addSection("/old.md", anchor());
    expect(bookmarks.rename("/old.md", "/new.md")).toBe(true);
    expect(bookmarks.documents[0].path).toBe("/new.md");
    expect(bookmarks.sectionById(section.id)?.path).toBe("/new.md");
  });

  it("does not report a change for an unrelated rename", () => {
    const bookmarks = controller();
    expect(bookmarks.rename("/missing.md", "/new.md")).toBe(false);
  });

  it("restores bookmarks after a storage restart", () => {
    const storage = new MemoryStorage();
    const first = controller(storage);
    first.addDocument("/a.md");
    const section = first.addSection("/a.md", anchor());
    first.flush();

    const second = controller(storage);
    expect(second.documents).toEqual([{ path: "/a.md", addedAt: 1_000 }]);
    expect(second.sections).toHaveLength(1);
    expect(second.sections[0].id).toBe(section.id);
    expect(second.canUndo).toBe(false);
  });

  it("keeps working when persistence fails", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const bookmarks = controller(storage);
    expect(() => {
      bookmarks.toggleDocument("/a.md");
      vi.advanceTimersByTime(10);
    }).not.toThrow();
    expect(bookmarks.isDocumentBookmarked("/a.md")).toBe(true);
  });
});

describe("BookmarksController session state", () => {
  it("stores and clears resolutions by section id", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/a.md", anchor());
    bookmarks.setResolution(section.id, {
      kind: "resolved",
      index: 2,
      slug: "risks-1",
      text: "Risks",
      depth: 2,
      via: "text",
    });
    expect(bookmarks.getResolution(section.id)?.kind).toBe("resolved");
    bookmarks.clearResolution(section.id);
    expect(bookmarks.getResolution(section.id)).toBeUndefined();
  });

  it("computes shared targets from resolved slugs", () => {
    const bookmarks = controller();
    const first = bookmarks.addSection("/a.md", anchor(1));
    const second = bookmarks.addSection("/a.md", anchor(2));
    bookmarks.setResolution(first.id, {
      kind: "resolved",
      index: 2,
      slug: "risks-1",
      text: "Risks",
      depth: 2,
      via: "text",
    });
    bookmarks.setResolution(second.id, {
      kind: "resolved",
      index: 2,
      slug: "risks-1",
      text: "Risks",
      depth: 2,
      via: "text",
    });
    expect(bookmarks.sharedTargets().get("/a.md\u0000risks-1")?.sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("replaces several resolutions in one batch", () => {
    const bookmarks = controller();
    const first = bookmarks.addSection("/a.md", anchor(1));
    const second = bookmarks.addSection("/a.md", anchor(2));
    bookmarks.setResolutions([
      [
        first.id,
        {
          kind: "stale",
          reason: "missing",
        },
      ],
      [
        second.id,
        {
          kind: "resolved",
          index: 2,
          slug: "risks-1",
          text: "Risks",
          depth: 2,
          via: "context",
        },
      ],
    ]);
    expect(bookmarks.getResolution(first.id)).toEqual({
      kind: "stale",
      reason: "missing",
    });
    expect(bookmarks.getResolution(second.id)).toMatchObject({
      kind: "resolved",
      via: "context",
    });
  });

  it("keeps session resolutions across a rename by section id", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/old.md", anchor());
    bookmarks.setResolution(section.id, {
      kind: "resolved",
      index: 1,
      slug: "risks",
      text: "Risks",
      depth: 2,
      via: "text",
    });

    bookmarks.rename("/old.md", "/new.md");

    expect(bookmarks.getResolution(section.id)).toMatchObject({
      kind: "resolved",
      slug: "risks",
    });
    expect(bookmarks.sectionById(section.id)?.path).toBe("/new.md");
  });

  it("drops a removed section's resolution", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/a.md", anchor());
    bookmarks.setResolution(section.id, {
      kind: "stale",
      reason: "missing",
    });
    bookmarks.removeSection(section.id);
    expect(bookmarks.getResolution(section.id)).toBeUndefined();
  });

  it("drops resolutions for documents that are no longer active", () => {
    const bookmarks = controller();
    const active = bookmarks.addSection("/a.md", anchor(1));
    const closed = bookmarks.addSection("/b.md", anchor(2));
    bookmarks.setResolution(active.id, {
      kind: "resolved",
      index: 1,
      slug: "risks",
      text: "Risks",
      depth: 2,
      via: "text",
    });
    bookmarks.setResolution(closed.id, {
      kind: "resolved",
      index: 2,
      slug: "risks-1",
      text: "Risks",
      depth: 2,
      via: "text",
    });

    bookmarks.retainResolutionsForPath("/a.md");

    expect(bookmarks.getResolution(active.id)?.kind).toBe("resolved");
    expect(bookmarks.getResolution(closed.id)).toBeUndefined();

    bookmarks.retainResolutionsForPath(null);
    expect(bookmarks.getResolution(active.id)).toBeUndefined();
  });

  it("keeps a stale symbol distinct from a shared one", () => {
    const bookmarks = controller();
    const section = bookmarks.addSection("/a.md", anchor());
    bookmarks.setResolution(section.id, {
      kind: "stale",
      reason: "ambiguous",
    });
    expect(bookmarks.sharedTargets().size).toBe(0);
    expect(bookmarks.notificationFilter().paths).toEqual(["/a.md"]);
  });
});

describe("BookmarksController notification filter", () => {
  it("sends sorted unique document and section-only paths", () => {
    const sync = vi.fn();
    const bookmarks = controller(new MemoryStorage(), { syncNotifications: sync });

    bookmarks.addDocument("/z.md");
    bookmarks.addDocument("/a.md");
    bookmarks.addSection("/m.md", anchor());

    expect(sync).toHaveBeenLastCalledWith({
      enabled: false,
      paths: ["/a.md", "/m.md", "/z.md"],
    });
  });

  it("re-syncs on add, remove, undo, rename and a preference change", () => {
    const sync = vi.fn();
    let enabled = false;
    const bookmarks = controller(new MemoryStorage(), {
      syncNotifications: sync,
      notificationEnabled: () => enabled,
    });

    bookmarks.addDocument("/a.md");
    bookmarks.removeDocument("/a.md");
    bookmarks.undo();
    bookmarks.rename("/a.md", "/b.md");
    enabled = true;
    bookmarks.syncNotifications();

    expect(sync).toHaveBeenCalledTimes(5);
    expect(sync).toHaveBeenLastCalledWith({
      enabled: true,
      paths: ["/b.md"],
    });
  });

  it("sends section-only paths and deduplicates them with document paths", () => {
    const sync = vi.fn();
    const bookmarks = controller(new MemoryStorage(), { syncNotifications: sync });
    bookmarks.addDocument("/a.md");
    bookmarks.addSection("/a.md", anchor(1));
    bookmarks.addSection("/b.md", anchor(2));

    expect(sync).toHaveBeenLastCalledWith({
      enabled: false,
      paths: ["/a.md", "/b.md"],
    });
  });

  it("keeps the bookmark action successful when the sync throws", () => {
    const onNotificationError = vi.fn();
    const bookmarks = controller(new MemoryStorage(), {
      syncNotifications: () => {
        throw new Error("ipc down");
      },
      onNotificationError,
    });

    expect(() => bookmarks.toggleDocument("/a.md")).not.toThrow();
    expect(bookmarks.isDocumentBookmarked("/a.md")).toBe(true);
    expect(onNotificationError).toHaveBeenCalledTimes(1);
  });

  it("reports an async sync rejection without breaking the action", async () => {
    const onNotificationError = vi.fn();
    const bookmarks = controller(new MemoryStorage(), {
      syncNotifications: () => Promise.reject(new Error("ipc down")),
      onNotificationError,
    });

    bookmarks.addDocument("/a.md");
    await Promise.resolve();

    expect(bookmarks.isDocumentBookmarked("/a.md")).toBe(true);
    expect(onNotificationError).toHaveBeenCalledTimes(1);
  });
});
