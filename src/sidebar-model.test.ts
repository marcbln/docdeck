import { describe, expect, it } from "vitest";

import type { InboxEntry } from "./inbox-model";
import {
  buildOpenRows,
  selectRecent,
  snapshotRecent,
  type TabLike,
} from "./sidebar-model";

function tab(path: string, modifiedTime: number, overrides: Partial<TabLike> = {}): TabLike {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime,
    hasUnreadUpdate: false,
    deletedOnDisk: false,
    ...overrides,
  };
}

function recent(path: string, changedAt: number, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: changedAt,
    changedAt,
    unread: true,
    deleted: false,
    ...overrides,
  };
}

describe("buildOpenRows", () => {
  it("keeps insertion order without Auto-Sort", () => {
    const rows = buildOpenRows(
      [tab("/a/first.md", 1_000), tab("/a/second.md", 9_000)],
      null,
      false,
    );

    expect(rows.map((row) => row.filename)).toEqual(["first.md", "second.md"]);
  });

  it("orders by modification time with Auto-Sort", () => {
    const rows = buildOpenRows(
      [tab("/a/first.md", 1_000), tab("/a/second.md", 9_000)],
      null,
      true,
    );

    expect(rows.map((row) => row.filename)).toEqual(["second.md", "first.md"]);
  });

  it("projects active, unread and deleted state", () => {
    const [row] = buildOpenRows(
      [
        tab("/a/plan.md", 1_000, {
          hasUnreadUpdate: true,
          deletedOnDisk: true,
        }),
      ],
      "/a/plan.md",
      false,
    );

    expect(row).toMatchObject({
      active: true,
      unread: true,
      deleted: true,
    });
  });
});

describe("selectRecent", () => {
  it("keeps only observations after the clear floor", () => {
    const entries = [recent("/a/old.md", 1_000), recent("/a/new.md", 3_000)];

    expect(selectRecent(entries, 2_000).map((row) => row.filename)).toEqual([
      "new.md",
    ]);
  });

  it("sorts newest first with path as the tie-breaker", () => {
    const entries = [
      recent("/a/old.md", 1_000),
      recent("/a/b.md", 2_000),
      recent("/a/a.md", 2_000),
    ];

    expect(selectRecent(entries, 0).map((row) => row.filename)).toEqual([
      "a.md",
      "b.md",
      "old.md",
    ]);
  });

  it("includes deleted documents until the floor moves past them", () => {
    const entries = [recent("/a/gone.md", 1_000, { deleted: true })];

    expect(selectRecent(entries, 0)).toHaveLength(1);
    expect(selectRecent(entries, 1_000)).toHaveLength(0);
  });
});

describe("snapshotRecent", () => {
  it("captures the unread flags of exactly the visible rows", () => {
    const entries = [
      recent("/a/old.md", 1_000, { unread: true }),
      recent("/a/new.md", 3_000, { unread: false }),
    ];

    expect(snapshotRecent(entries, 2_000)).toEqual({
      clearedAt: 2_000,
      unread: { "/a/new.md": false },
    });
  });
});
