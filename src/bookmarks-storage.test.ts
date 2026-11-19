import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCollection, type BookmarkCollection } from "./bookmarks-model";
import {
  BookmarkStore,
  decode,
  STORAGE_KEY,
  type BookmarkStorage,
} from "./bookmarks-storage";

class MemoryStorage implements BookmarkStorage {
  values = new Map<string, string>();
  failWrites = false;
  failReads = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("read blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, documents: [], sections: [], ...overrides });
}

const SECTION = {
  id: "sec-1",
  path: "/docs/a.md",
  addedAt: 100,
  anchor: {
    text: "Risks",
    depth: 2,
    before: ["Scope"],
    after: ["Questions"],
    ordinal: 0,
    order: 3,
  },
};

describe("decode", () => {
  it("returns null for an absent key", () => {
    expect(decode(null)).toBeNull();
  });

  it("returns null for corrupt JSON, a non-object envelope or a wrong version", () => {
    expect(decode("{broken")).toBeNull();
    expect(decode('"text"')).toBeNull();
    expect(decode(JSON.stringify({ version: 2, documents: [], sections: [] }))).toBeNull();
  });

  it("treats missing or non-array fields as empty arrays", () => {
    expect(decode(JSON.stringify({ version: 1 }))).toEqual(emptyCollection());
    expect(
      decode(
        JSON.stringify({
          version: 1,
          documents: "nope",
          sections: { not: "an array" },
        }),
      ),
    ).toEqual(emptyCollection());
  });

  it("keeps the valid field when the other one is malformed", () => {
    const decoded = decode(
      payload({ documents: "nope", sections: [SECTION] }),
    );
    expect(decoded?.documents).toEqual([]);
    expect(decoded?.sections).toHaveLength(1);
  });

  it("decodes a valid document and section", () => {
    const decoded = decode(
      payload({
        documents: [{ path: "/docs/a.md", addedAt: 10 }],
        sections: [SECTION],
      }),
    );
    expect(decoded?.documents).toEqual([{ path: "/docs/a.md", addedAt: 10 }]);
    expect(decoded?.sections[0]).toEqual(SECTION);
  });

  it("drops malformed document entries while valid siblings survive", () => {
    const decoded = decode(
      payload({
        documents: [
          { path: "", addedAt: 1 },
          { path: "/ok.md", addedAt: 2 },
          { path: "/bad.md", addedAt: "soon" },
          null,
        ],
      }),
    );
    expect(decoded?.documents).toEqual([{ path: "/ok.md", addedAt: 2 }]);
  });

  it("drops malformed section entries while valid siblings survive", () => {
    const variants = [
      { ...SECTION, id: "" },
      { ...SECTION, path: "" },
      { ...SECTION, addedAt: Number.NaN },
      { ...SECTION, anchor: null },
      { ...SECTION, anchor: { ...SECTION.anchor, depth: 5 } },
      { ...SECTION, anchor: { ...SECTION.anchor, depth: 0 } },
      { ...SECTION, anchor: { ...SECTION.anchor, depth: 1.5 } },
      { ...SECTION, anchor: { ...SECTION.anchor, before: ["a", "b", "c"] } },
      { ...SECTION, anchor: { ...SECTION.anchor, after: [1] } },
      { ...SECTION, anchor: { ...SECTION.anchor, ordinal: -1 } },
      { ...SECTION, anchor: { ...SECTION.anchor, order: 1.2 } },
      { ...SECTION, anchor: { ...SECTION.anchor, text: 3 } },
    ];
    const decoded = decode(
      payload({ sections: [...variants, { ...SECTION, id: "valid" }] }),
    );
    expect(decoded?.sections.map((section) => section.id)).toEqual(["valid"]);
  });

  it("keeps the first duplicate document path and section id", () => {
    const decoded = decode(
      payload({
        documents: [
          { path: "/a.md", addedAt: 1 },
          { path: "/a.md", addedAt: 2 },
        ],
        sections: [
          { ...SECTION, id: "same", addedAt: 1 },
          { ...SECTION, id: "same", addedAt: 2 },
        ],
      }),
    );
    expect(decoded?.documents).toEqual([{ path: "/a.md", addedAt: 1 }]);
    expect(decoded?.sections).toHaveLength(1);
    expect(decoded?.sections[0].addedAt).toBe(1);
  });

  it("allows an empty heading text", () => {
    const decoded = decode(
      payload({
        sections: [
          { ...SECTION, anchor: { ...SECTION.anchor, text: "" } },
        ],
      }),
    );
    expect(decoded?.sections[0].anchor.text).toBe("");
  });
});

describe("BookmarkStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function collectionWith(path: string): BookmarkCollection {
    const collection = emptyCollection();
    collection.documents.push({ path, addedAt: 1 });
    return collection;
  }

  it("reads through the storage and tolerates read failure", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STORAGE_KEY,
      payload({ documents: [{ path: "/a.md", addedAt: 1 }] }),
    );
    const store = new BookmarkStore(storage);
    expect(store.load()?.documents).toHaveLength(1);

    storage.failReads = true;
    expect(store.load()).toBeNull();
  });

  it("coalesces rapid schedules into one trailing write", () => {
    const storage = new MemoryStorage();
    const store = new BookmarkStore(storage, 250);

    store.schedule(collectionWith("/a.md"));
    vi.advanceTimersByTime(100);
    store.schedule(collectionWith("/b.md"));
    vi.advanceTimersByTime(249);
    expect(storage.values.has(STORAGE_KEY)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) as string).documents).toEqual([
      { path: "/b.md", addedAt: 1 },
    ]);
  });

  it("writes immediately on flush and cancels the debounce", () => {
    const storage = new MemoryStorage();
    const store = new BookmarkStore(storage, 250);

    store.schedule(collectionWith("/a.md"));
    store.flush(collectionWith("/b.md"));
    expect(JSON.parse(storage.values.get(STORAGE_KEY) as string).documents).toEqual([
      { path: "/b.md", addedAt: 1 },
    ]);

    vi.advanceTimersByTime(500);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) as string).documents).toEqual([
      { path: "/b.md", addedAt: 1 },
    ]);
  });

  it("flushes a pending value when called without an argument", () => {
    const storage = new MemoryStorage();
    const store = new BookmarkStore(storage, 250);
    store.schedule(collectionWith("/a.md"));
    store.flush();
    expect(storage.values.has(STORAGE_KEY)).toBe(true);
  });

  it("ignores write failures and keeps operating", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const store = new BookmarkStore(storage, 10);

    expect(() => {
      store.schedule(collectionWith("/a.md"));
      vi.advanceTimersByTime(10);
      store.flush(collectionWith("/b.md"));
    }).not.toThrow();
  });

  it("round-trips through decode after a restart", () => {
    const storage = new MemoryStorage();
    const first = new BookmarkStore(storage, 10);
    const collection = emptyCollection();
    collection.sections.push(SECTION as never);
    first.flush(collection);

    const second = new BookmarkStore(storage, 10);
    expect(second.load()).toEqual(collection);
  });
});
