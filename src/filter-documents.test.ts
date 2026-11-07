import { describe, expect, it } from "vitest";

import { filterEntries } from "./filter-documents";
import type { InboxEntry } from "./inbox-model";

function entry(path: string): InboxEntry {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: 1_000,
    changedAt: 0,
    unread: false,
    deleted: false,
    inventoryHidden: false,
    origin: "config",
  };
}

const entries = [
  entry("/devel/docdeck/_ai/backlog/plan.md"),
  entry("/devel/shop/_ai/archive/report.md"),
  entry("/devel/docdeck/docs/README.md"),
  entry("/notes/groceries.md"),
];

describe("filterEntries", () => {
  it("matches a filename substring case-insensitively", () => {
    expect(filterEntries(entries, "PLAN").map((item) => item.filename)).toEqual([
      "plan.md",
    ]);
  });

  it("matches a full-path substring", () => {
    expect(
      filterEntries(entries, "docs/").map((item) => item.filename),
    ).toEqual(["README.md"]);
  });

  it("matches a project name segment", () => {
    const matches = filterEntries(entries, "shop").map((item) => item.filename);
    expect(matches).toEqual(["report.md"]);
  });

  it("preserves the input order", () => {
    const matches = filterEntries(entries, "devel");
    expect(matches.map((item) => item.path)).toEqual(
      entries.slice(0, 3).map((item) => item.path),
    );
  });

  it("treats punctuation literally", () => {
    expect(filterEntries(entries, "*.md")).toEqual([]);
    expect(filterEntries(entries, "groceries.")).toHaveLength(1);
  });

  it("returns every entry for an empty or whitespace term", () => {
    expect(filterEntries(entries, "")).toHaveLength(entries.length);
    expect(filterEntries(entries, "   ")).toHaveLength(entries.length);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterEntries(entries, "no-such-document")).toEqual([]);
  });

  it("never mutates the input entries", () => {
    const before = JSON.parse(JSON.stringify(entries));
    filterEntries(entries, "plan");
    expect(entries).toEqual(before);
  });

  it("stays fast on a 10,000-entry inventory", () => {
    const large: InboxEntry[] = Array.from({ length: 10_000 }, (_, index) =>
      entry(`/devel/project-${index % 50}/_ai/backlog/doc-${index}.md`),
    );

    // Warm up, then take the best of three: a single wall-clock sample is
    // dominated by scheduler preemption when the suite runs in parallel.
    filterEntries(large, "warmup");
    let elapsed = Number.POSITIVE_INFINITY;
    let matches: InboxEntry[] = [];
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      matches = filterEntries(large, "doc-9999");
      elapsed = Math.min(elapsed, performance.now() - started);
    }

    expect(matches).toHaveLength(1);
    expect(elapsed).toBeLessThan(250);
  });
});
