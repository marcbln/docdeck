import { describe, expect, it } from "vitest";

import { InboxModel, type InboxSeed } from "./inbox-model";

function seed(path: string, modifiedTime: number): InboxSeed {
  return { path, filename: path.split("/").pop() ?? path, modifiedTime };
}

function clocked(start = 1_000): { model: InboxModel; set: (n: number) => void; now: () => number } {
  let now = start;
  return {
    model: new InboxModel(() => now),
    set: (n) => {
      now = n;
    },
    now: () => now,
  };
}

describe("InboxModel", () => {
  it("starts every seeded row plain and not recent", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.get("/a/plan.md")).toMatchObject({
      unread: false,
      deleted: false,
      changedAt: 0,
    });
    expect(inbox.unreadCount()).toBe(0);
  });

  it("marks settled writes unread and records the observation time", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.replace([seed("/a/plan.md", 1_000)]);

    set(2_500);
    expect(inbox.upsert(seed("/a/plan.md", 2_000))).toBe(true);
    expect(inbox.get("/a/plan.md")).toMatchObject({
      unread: true,
      changedAt: 2_500,
    });
    expect(inbox.unreadCount()).toBe(1);
  });

  it("does not bump changedAt for a duplicate event", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert(seed("/a/plan.md", 1_000));

    set(2_000);
    expect(inbox.upsert(seed("/a/plan.md", 1_000))).toBe(false);
    expect(inbox.get("/a/plan.md")?.changedAt).toBe(1_000);
  });

  it("adds unseen files as unread", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/new.md", 1_000));

    expect(inbox.get("/a/new.md")).toMatchObject({
      unread: true,
      deleted: false,
    });
  });

  it("can update the active document without marking it unread", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    inbox.upsert(seed("/a/plan.md", 2_000), false);

    expect(inbox.get("/a/plan.md")).toMatchObject({
      unread: false,
      modifiedTime: 2_000,
    });
  });

  it("does not record a manual open as recent activity", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/opened.md", 1_000), false, false);

    expect(inbox.get("/a/opened.md")?.changedAt).toBe(0);
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

  it("records a deletion as recent activity", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.replace([seed("/a/plan.md", 1_000)]);

    set(3_000);
    inbox.markDeleted("/a/plan.md");

    expect(inbox.get("/a/plan.md")?.changedAt).toBe(3_000);
  });

  it("revives a deleted row on the next write", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));
    inbox.markDeleted("/a/plan.md");

    inbox.upsert(seed("/a/plan.md", 2_000));

    expect(inbox.get("/a/plan.md")).toMatchObject({
      deleted: false,
      unread: true,
    });
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

  it("merge leaves existing unread state and observation time intact", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert(seed("/a/plan.md", 1_000));

    set(5_000);
    inbox.merge([seed("/a/plan.md", 1_000), seed("/b/new.md", 2_000)]);

    expect(inbox.get("/a/plan.md")).toMatchObject({
      unread: true,
      changedAt: 1_000,
    });
    expect(inbox.get("/b/new.md")).toMatchObject({
      unread: false,
      changedAt: 0,
    });
  });

  it("replace clears previous unread state and observations", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/plan.md", 1_000));

    inbox.replace([seed("/a/plan.md", 1_000)]);

    expect(inbox.unreadCount()).toBe(0);
    expect(inbox.get("/a/plan.md")?.changedAt).toBe(0);
    expect(inbox.size()).toBe(1);
  });

  it("acknowledges changes up to the cutoff only", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert(seed("/a/early.md", 1_000));
    set(2_000);
    inbox.upsert(seed("/a/late.md", 2_000));

    inbox.acknowledgeThrough(1_500);

    expect(inbox.get("/a/early.md")?.unread).toBe(false);
    expect(inbox.get("/a/late.md")?.unread).toBe(true);
  });

  it("leaves inventory rows untouched when acknowledging", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/plan.md", 1_000)]);

    inbox.acknowledgeThrough(9_999);

    expect(inbox.get("/a/plan.md")?.unread).toBe(false);
    expect(inbox.get("/a/plan.md")?.changedAt).toBe(0);
  });

  it("restores unread flags captured before a clear", () => {
    const inbox = new InboxModel();
    inbox.upsert(seed("/a/one.md", 1_000));
    inbox.upsert(seed("/a/two.md", 1_000));
    inbox.markRead("/a/two.md");

    inbox.restoreUnread({ "/a/one.md": true, "/a/two.md": true });

    expect(inbox.get("/a/one.md")?.unread).toBe(true);
    expect(inbox.get("/a/two.md")?.unread).toBe(true);
  });

  it("reload keeps manual rows, rescans session rows and replaces config rows", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.merge([
      { ...seed("/a/manual.md", 1_000), origin: "manual" },
      { ...seed("/a/session.md", 1_000), origin: "session" },
      { ...seed("/a/config.md", 1_000), origin: "config" },
    ]);
    inbox.upsert(seed("/a/config.md", 2_000));
    inbox.upsert(seed("/a/session.md", 2_000));
    const configChangedAt = inbox.get("/a/config.md")?.changedAt;
    const sessionChangedAt = inbox.get("/a/session.md")?.changedAt;

    set(5_000);
    inbox.reconcile([
      { ...seed("/a/config.md", 2_000), origin: "config" },
      { ...seed("/a/session.md", 3_000), origin: "session" },
      { ...seed("/a/new.md", 4_000), origin: "config" },
    ]);

    expect(inbox.get("/a/manual.md")).toBeDefined();
    expect(inbox.get("/a/config.md")?.changedAt).toBe(configChangedAt);
    expect(inbox.get("/a/config.md")?.unread).toBe(true);
    expect(inbox.get("/a/session.md")?.modifiedTime).toBe(3_000);
    expect(inbox.get("/a/session.md")?.changedAt).toBe(sessionChangedAt);
    expect(inbox.get("/a/new.md")).toMatchObject({
      origin: "config",
      unread: true,
      changedAt: 0,
    });
    expect(inbox.unreadCount()).toBe(3);
  });

  it("reload removes departed config and session rows but never manual ones", () => {
    const inbox = new InboxModel();
    inbox.merge([
      { ...seed("/a/manual.md", 1_000), origin: "manual" },
      { ...seed("/a/gone-config.md", 1_000), origin: "config" },
      { ...seed("/a/gone-session.md", 1_000), origin: "session" },
    ]);

    inbox.reconcile([{ ...seed("/a/keep.md", 1_000), origin: "config" }]);

    expect(inbox.has("/a/manual.md")).toBe(true);
    expect(inbox.has("/a/gone-config.md")).toBe(false);
    expect(inbox.has("/a/gone-session.md")).toBe(false);
    expect(inbox.has("/a/keep.md")).toBe(true);
  });

  it("reload never duplicates a path", () => {
    const inbox = new InboxModel();
    inbox.merge([{ ...seed("/a/one.md", 1_000), origin: "config" }]);

    inbox.reconcile([
      { ...seed("/a/one.md", 1_000), origin: "config" },
      { ...seed("/a/one.md", 1_000), origin: "config" },
    ]);

    expect(inbox.size()).toBe(1);
  });

  it("never marks a surviving document unread just because it reloaded", () => {
    const inbox = new InboxModel();
    inbox.merge([{ ...seed("/a/plan.md", 1_000), origin: "config" }]);
    inbox.markRead("/a/plan.md");

    inbox.reconcile([{ ...seed("/a/plan.md", 1_000), origin: "config" }]);

    expect(inbox.get("/a/plan.md")?.unread).toBe(false);
  });

  it("applies acknowledgement flags without touching changedAt or order", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.merge([{ ...seed("/a/one.md", 3_000), origin: "config" }]);
    set(2_000);
    inbox.upsert(seed("/a/one.md", 3_000));
    const changedAt = inbox.get("/a/one.md")?.changedAt;
    const order = inbox.entriesSorted().map((entry) => entry.path);

    inbox.applyUnread({ "/a/one.md": false });

    expect(inbox.get("/a/one.md")?.unread).toBe(false);
    expect(inbox.get("/a/one.md")?.changedAt).toBe(changedAt);
    expect(inbox.entriesSorted().map((entry) => entry.path)).toEqual(order);
  });

  it("moves one row on rename carrying unread and changedAt", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert({ ...seed("/a/old.md", 1_000), origin: "config" });
    set(2_000);

    expect(inbox.rename("/a/old.md", "/a/new.md")).toBe(true);

    expect(inbox.has("/a/old.md")).toBe(false);
    expect(inbox.get("/a/new.md")).toMatchObject({
      path: "/a/new.md",
      filename: "new.md",
      unread: true,
      changedAt: 1_000,
      origin: "config",
    });
    expect(inbox.size()).toBe(1);
  });

  it("removes a row that moved out and adds a created row unread", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert(seed("/a/old.md", 1_000));

    set(2_000);
    expect(inbox.removeForMoveOut("/a/old.md")).toBe(true);
    expect(inbox.has("/a/old.md")).toBe(false);

    expect(
      inbox.addCreated({ path: "/a/new.md", filename: "new.md", modifiedTime: 2_000 }),
    ).toBe(true);
    expect(inbox.get("/a/new.md")).toMatchObject({
      unread: true,
      changedAt: 2_000,
      deleted: false,
    });
  });

  it("dismisses one recent row and brings it back on the next change", () => {
    const { model: inbox, set } = clocked(1_000);
    inbox.upsert(seed("/a/one.md", 1_000));
    inbox.upsert(seed("/a/two.md", 1_000));

    expect(inbox.dismissRecent("/a/one.md")).toBe(true);
    expect(inbox.get("/a/one.md")).toMatchObject({
      changedAt: 0,
      unread: false,
    });
    expect(inbox.get("/a/two.md")?.changedAt).toBe(1_000);
    expect(inbox.dismissRecent("/a/one.md")).toBe(false);

    set(2_000);
    expect(inbox.upsert(seed("/a/one.md", 2_000))).toBe(true);
    expect(inbox.get("/a/one.md")?.changedAt).toBe(2_000);
  });

  it("hides one inventory row until the document changes again", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/one.md", 1_000), seed("/a/two.md", 1_000)]);

    expect(inbox.dismissInventory("/a/one.md")).toBe(true);
    expect(inbox.get("/a/one.md")?.inventoryHidden).toBe(true);
    expect(inbox.get("/a/two.md")?.inventoryHidden).toBe(false);
    expect(inbox.dismissInventory("/a/one.md")).toBe(false);

    expect(inbox.upsert(seed("/a/one.md", 2_000))).toBe(true);
    expect(inbox.get("/a/one.md")?.inventoryHidden).toBe(false);
  });

  it("keeps an inventory row hidden across a reload with no change", () => {
    const inbox = new InboxModel();
    inbox.replace([seed("/a/one.md", 1_000)]);
    inbox.dismissInventory("/a/one.md");

    inbox.reconcile([seed("/a/one.md", 1_000)]);

    expect(inbox.get("/a/one.md")?.inventoryHidden).toBe(true);
  });
});
