import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Acknowledgements,
  SCHEMA_VERSION,
  STORAGE_KEY,
  decode,
  unreadFor,
  type AckStorage,
} from "./acknowledgements";

class MemoryStorage implements AckStorage {
  readonly data = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.data.set(key, value);
  }

  seed(value: unknown): void {
    this.data.set(STORAGE_KEY, JSON.stringify(value));
  }
}

function clocked(): { acks: Acknowledgements; storage: MemoryStorage; set: (n: number) => void } {
  const storage = new MemoryStorage();
  let now = 1_000;
  const acks = new Acknowledgements(storage, () => now, 10);
  return {
    acks,
    storage,
    set: (value) => {
      now = value;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("acknowledgement decoding", () => {
  it("treats absent history as a first launch", () => {
    expect(decode(null)).toBeNull();
  });

  it("rejects corrupt JSON", () => {
    expect(decode("{not json")).toBeNull();
  });

  it("rejects a different schema version", () => {
    expect(decode(JSON.stringify({ version: 2, entries: {} }))).toBeNull();
  });

  it("drops a malformed entry while keeping valid ones", () => {
    const decoded = decode(
      JSON.stringify({
        version: SCHEMA_VERSION,
        entries: {
          "/a/good.md": { mtime: 10, at: 20 },
          "/a/bad.md": { mtime: "yesterday", at: 20 },
          "/a/missing.md": "nope",
        },
      }),
    );

    expect(decoded?.entries).toEqual({ "/a/good.md": { mtime: 10, at: 20 } });
  });
});

describe("unread rule", () => {
  it("is read on first launch regardless of history", () => {
    expect(unreadFor(9_999, undefined, false)).toBe(false);
  });

  it("is unread when the document mtime advanced past the acknowledgement", () => {
    expect(unreadFor(2_000, { mtime: 1_000, at: 0 }, true)).toBe(true);
    expect(unreadFor(1_000, { mtime: 1_000, at: 0 }, true)).toBe(false);
    expect(unreadFor(500, { mtime: 1_000, at: 0 }, true)).toBe(false);
  });

  it("is unread for a watched path with no entry once a store exists", () => {
    expect(unreadFor(1_000, undefined, true)).toBe(true);
  });
});

describe("Acknowledgements", () => {
  it("marks nothing unread before the baseline", () => {
    const { acks } = clocked();
    expect(acks.hasStore).toBe(false);
    expect(
      acks.unreadFlags([
        { path: "/a/one.md", modifiedTime: 1_000 },
        { path: "/a/two.md", modifiedTime: 2_000 },
      ]),
    ).toEqual({ "/a/one.md": false, "/a/two.md": false });
  });

  it("seeds a baseline on first launch and marks nothing unread", () => {
    const { acks } = clocked();
    acks.seedBaseline([
      { path: "/a/one.md", modifiedTime: 1_000 },
      { path: "/a/two.md", modifiedTime: 2_000 },
    ]);

    expect(acks.hasStore).toBe(true);
    expect(acks.size()).toBe(2);
    expect(acks.unreadFlags([{ path: "/a/one.md", modifiedTime: 1_000 }])).toEqual({
      "/a/one.md": false,
    });
  });

  it("does not overwrite an existing baseline", () => {
    const { acks } = clocked();
    acks.seedBaseline([{ path: "/a/one.md", modifiedTime: 1_000 }]);
    acks.acknowledge("/a/one.md", 5_000);

    acks.seedBaseline([{ path: "/a/one.md", modifiedTime: 1_000 }]);

    expect(acks.get("/a/one.md")?.mtime).toBe(5_000);
  });

  it("derives unread flags for changed, unchanged and new documents", () => {
    const { acks, storage } = clocked();
    storage.seed({
      version: SCHEMA_VERSION,
      entries: {
        "/a/changed.md": { mtime: 1_000, at: 1 },
        "/a/unchanged.md": { mtime: 2_000, at: 1 },
      },
    });
    const loaded = new Acknowledgements(storage, () => 1, 10);

    expect(
      loaded.unreadFlags([
        { path: "/a/changed.md", modifiedTime: 1_500 },
        { path: "/a/unchanged.md", modifiedTime: 2_000 },
        { path: "/a/new.md", modifiedTime: 2_000 },
      ]),
    ).toEqual({
      "/a/changed.md": true,
      "/a/unchanged.md": false,
      "/a/new.md": true,
    });
    void acks;
  });

  it("acknowledging a document clears unread and persists", () => {
    vi.useFakeTimers();
    const { acks, storage } = clocked();
    acks.seedBaseline([]);
    acks.acknowledge("/a/plan.md", 4_000);

    vi.advanceTimersByTime(10);

    const written = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(written.entries["/a/plan.md"]).toMatchObject({ mtime: 4_000 });
    expect(acks.unreadFlags([{ path: "/a/plan.md", modifiedTime: 4_000 }])).toEqual({
      "/a/plan.md": false,
    });
  });

  it("debounces writes and flushes on demand", () => {
    vi.useFakeTimers();
    const { acks, storage } = clocked();
    acks.seedBaseline([]);
    acks.acknowledge("/a/one.md", 1);
    acks.acknowledge("/a/two.md", 2);
    acks.acknowledge("/a/three.md", 3);

    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(10);
    expect(storage.writes).toBe(1);

    acks.acknowledge("/a/four.md", 4);
    expect(storage.writes).toBe(1);
    acks.flush();
    expect(storage.writes).toBe(2);
  });

  it("moves an acknowledgement across a rename", () => {
    const { acks } = clocked();
    acks.seedBaseline([{ path: "/a/old.md", modifiedTime: 1_000 }]);
    acks.acknowledge("/a/old.md", 2_000);

    acks.move("/a/old.md", "/a/new.md");

    expect(acks.get("/a/old.md")).toBeUndefined();
    expect(acks.get("/a/new.md")?.mtime).toBe(2_000);
  });

  it("prunes history for documents that are no longer watched", () => {
    const { acks } = clocked();
    acks.seedBaseline([
      { path: "/a/keep.md", modifiedTime: 1 },
      { path: "/a/gone.md", modifiedTime: 1 },
    ]);

    acks.prune(["/a/keep.md"]);

    expect(acks.size()).toBe(1);
    expect(acks.get("/a/gone.md")).toBeUndefined();
  });

  it("recovers from corrupt storage as a first launch", () => {
    const storage = new MemoryStorage();
    storage.data.set(STORAGE_KEY, "{broken");

    const acks = new Acknowledgements(storage, () => 1, 10);

    expect(acks.hasStore).toBe(false);
    // The first successful inventory seeds a fresh baseline.
    acks.seedBaseline([{ path: "/a/plan.md", modifiedTime: 5_000 }]);
    expect(acks.unreadFlags([{ path: "/a/plan.md", modifiedTime: 5_000 }])).toEqual({
      "/a/plan.md": false,
    });
  });

  it("never persists session activity fields", () => {
    const { acks, storage } = clocked();
    acks.seedBaseline([{ path: "/a/plan.md", modifiedTime: 1 }]);
    acks.flush();

    const written = storage.getItem(STORAGE_KEY)!;
    expect(written).not.toContain("changedAt");
    expect(written).not.toContain("clearedAt");
  });
});
