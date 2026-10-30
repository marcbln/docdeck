import { describe, expect, it } from "vitest";

import {
  InboxModel,
  sectionInbox,
  type InboxEntry,
  type InboxSeed,
} from "./inbox-model";

function seed(path: string, modifiedTime: number): InboxSeed {
  return { path, filename: path.split("/").pop() ?? path, modifiedTime };
}

function row(path: string, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: 1_000,
    unread: false,
    deleted: false,
    ...overrides,
  };
}

describe("sectionInbox", () => {
  it("puts unread and deleted rows under changed", () => {
    const sections = sectionInbox(
      [
        row("/a/unread.md", { unread: true }),
        row("/a/deleted.md", { deleted: true }),
        row("/a/plain.md"),
      ],
      new Set(),
    );

    expect(sections.changed.map((item) => item.filename)).toEqual([
      "unread.md",
      "deleted.md",
    ]);
    expect(sections.opened).toEqual([]);
  });

  it("puts open plain rows under opened and never duplicates a changed row", () => {
    const openPaths = new Set(["/a/open.md", "/a/unread.md"]);
    const sections = sectionInbox(
      [row("/a/unread.md", { unread: true }), row("/a/open.md")],
      openPaths,
    );

    expect(sections.changed.map((item) => item.filename)).toEqual(["unread.md"]);
    expect(sections.opened.map((item) => item.filename)).toEqual(["open.md"]);
  });

  it("keeps the given newest-first order in both sections", () => {
    const sections = sectionInbox(
      [
        row("/a/new.md", { unread: true }),
        row("/a/open-new.md"),
        row("/a/old.md", { unread: true }),
        row("/a/open-old.md"),
      ],
      new Set(["/a/open-new.md", "/a/open-old.md"]),
    );

    expect(sections.changed.map((item) => item.filename)).toEqual([
      "new.md",
      "old.md",
    ]);
    expect(sections.opened.map((item) => item.filename)).toEqual([
      "open-new.md",
      "open-old.md",
    ]);
  });
});

describe("InboxModel", () => {
  it("starts every seeded row plain", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.get("/a/plan.md")).toMatchObject({ unread: false, deleted: false });
    expect(inbox.unreadCount()).toBe(0);
  });

  it("marks settled writes unread and reports changes", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.upsert(seed("/a/plan.md", 2_000))).toBe(true);
    expect(inbox.get("/a/plan.md")?.unread).toBe(true);
    expect(inbox.unreadCount()).toBe(1);

    // A duplicate event for the same state is not a change.
    expect(inbox.upsert(seed("/a/plan.md", 2_000))).toBe(false);
  });

  it("adds unseen files as unread", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/new.md", 1_000));

    expect(inbox.get("/a/new.md")).toMatchObject({ unread: true, deleted: false });
  });

  it("can update the active document without marking it unread", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    inbox.upsert(seed("/a/plan.md", 2_000), false);

    expect(inbox.get("/a/plan.md")).toMatchObject({ unread: false, modifiedTime: 2_000 });
  });

  it("clears unread on read and on markDeleted keeps the row", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    expect(inbox.markRead("/a/plan.md")).toBe(true);
    expect(inbox.unreadCount()).toBe(0);

    expect(inbox.markDeleted("/a/plan.md")).toBe(true);
    expect(inbox.get("/a/plan.md")?.deleted).toBe(true);
    expect(inbox.markDeleted("/a/plan.md")).toBe(false);
  });

  it("revives a deleted row on the next write", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));
    inbox.markDeleted("/a/plan.md");

    inbox.upsert(seed("/a/plan.md", 2_000));

    expect(inbox.get("/a/plan.md")).toMatchObject({ deleted: false, unread: true });
  });

  it("sorts newest first with path as the tie-breaker", () => {
    const inbox = new InboxModel();
    inbox.replace([
      seed("/a/old.md", 1_000),
      seed("/a/b.md", 2_000),
      seed("/a/a.md", 2_000),
    ]);

    expect(inbox.entriesSorted().map((entry) => entry.filename)).toEqual([
      "a.md",
      "b.md",
      "old.md",
    ]);
  });

  it("merge leaves existing unread state intact", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    inbox.merge([seed("/a/plan.md", 1_000), seed("/b/new.md", 2_000)]);

    expect(inbox.get("/a/plan.md")?.unread).toBe(true);
    expect(inbox.get("/b/new.md")?.unread).toBe(false);
  });

  it("replace clears previous unread state", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.unreadCount()).toBe(0);
    expect(inbox.size()).toBe(1);
  });
});
