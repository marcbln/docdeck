import { describe, expect, it } from "vitest";

import {
  addDocument,
  addSection,
  cloneCollection,
  emptyCollection,
  findSectionByAnchor,
  hasDocument,
  normalizeHeadingText,
  notificationPaths,
  reanchorSection,
  removeDocument,
  removeSection,
  removeSectionsByAnchor,
  removedBookmarkLabel,
  renamePath,
  sectionAnchorKey,
  sectionIdentity,
  sectionsForPath,
  toggleDocument,
  type SectionAnchor,
} from "./bookmarks-model";

function anchor(overrides: Partial<SectionAnchor> = {}): SectionAnchor {
  return {
    text: "Risks",
    depth: 2,
    before: ["Scope"],
    after: ["Open questions"],
    ordinal: 0,
    order: 3,
    ...overrides,
  };
}

describe("document bookmarks", () => {
  it("adds once, detects presence and ignores duplicates", () => {
    const collection = emptyCollection();
    expect(hasDocument(collection, "/a.md")).toBe(false);
    expect(addDocument(collection, "/a.md", 10)).toBe(true);
    expect(addDocument(collection, "/a.md", 20)).toBe(false);
    expect(collection.documents).toEqual([{ path: "/a.md", addedAt: 10 }]);
  });

  it("toggles by adding then removing and returning the snapshot", () => {
    const collection = emptyCollection();
    expect(toggleDocument(collection, "/a.md", 10)).toEqual({
      added: true,
      removed: null,
    });
    expect(toggleDocument(collection, "/a.md", 20)).toEqual({
      added: false,
      removed: { path: "/a.md", addedAt: 10 },
    });
    expect(collection.documents).toEqual([]);
  });

  it("removing a document leaves its sections intact", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a.md", 10);
    addSection(collection, "/a.md", anchor(), 20, "s1");
    expect(removeDocument(collection, "/a.md")).toEqual({
      path: "/a.md",
      addedAt: 10,
    });
    expect(collection.sections).toHaveLength(1);
  });
});

describe("section bookmarks", () => {
  it("normalizes heading text for comparison", () => {
    expect(normalizeHeadingText("  Risks \t and   Mitigations ")).toBe(
      "Risks and Mitigations",
    );
  });

  it("treats whitespace-only differences as the same anchor", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor(), 10, "s1");
    const duplicate = addSection(
      collection,
      "/a.md",
      anchor({ text: "  Risks " }),
      20,
      "s2",
    );
    expect(duplicate.id).toBe("s1");
    expect(collection.sections).toHaveLength(1);
  });

  it("keeps anchors on different paths or with different context distinct", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor(), 10, "s1");
    addSection(collection, "/b.md", anchor(), 10, "s2");
    addSection(collection, "/a.md", anchor({ before: ["Timeline"] }), 10, "s3");
    expect(collection.sections).toHaveLength(3);
  });

  it("does not include order in the identity", () => {
    const first = anchor({ order: 3 });
    const moved = anchor({ order: 9 });
    expect(sectionAnchorKey(first)).toBe(sectionAnchorKey(moved));
    expect(sectionIdentity("/a.md", first)).toBe(
      sectionIdentity("/a.md", moved),
    );
  });

  it("finds and removes by id and by anchor", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor(), 10, "s1");
    expect(findSectionByAnchor(collection, "/a.md", anchor())?.id).toBe("s1");
    expect(removeSection(collection, "missing")).toBeNull();

    const duplicate = cloneCollection(collection);
    duplicate.sections.push({
      ...duplicate.sections[0],
      id: "s2",
    });
    expect(removeSectionsByAnchor(duplicate, "/a.md", anchor())).toHaveLength(2);
    expect(duplicate.sections).toEqual([]);
  });

  it("re-anchors without changing id, path or addedAt", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor(), 10, "s1");
    const next = anchor({ text: "Threats", depth: 3, order: 8 });
    expect(reanchorSection(collection, "s1", next)).toBe(true);
    expect(collection.sections[0]).toMatchObject({
      id: "s1",
      path: "/a.md",
      addedAt: 10,
      anchor: next,
    });
    expect(reanchorSection(collection, "missing", next)).toBe(false);
  });

  it("returns sections for one path in collection order", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor({ order: 4 }), 10, "s2");
    addSection(
      collection,
      "/a.md",
      anchor({ order: 1, text: "Threats" }),
      11,
      "s1",
    );
    addSection(collection, "/b.md", anchor(), 12, "s3");
    expect(sectionsForPath(collection, "/a.md").map((s) => s.id)).toEqual([
      "s2",
      "s1",
    ]);
  });
});

describe("rename", () => {
  it("re-keys document and section paths in one pass", () => {
    const collection = emptyCollection();
    addDocument(collection, "/old.md", 10);
    addSection(collection, "/old.md", anchor(), 20, "s1");

    expect(renamePath(collection, "/old.md", "/new.md")).toBe(true);
    expect(collection.documents).toEqual([{ path: "/new.md", addedAt: 10 }]);
    expect(collection.sections[0]).toMatchObject({
      id: "s1",
      path: "/new.md",
      addedAt: 20,
    });
  });

  it("dedupes a pre-existing target marker and keeps the earlier addedAt", () => {
    const collection = emptyCollection();
    addDocument(collection, "/old.md", 30);
    addDocument(collection, "/new.md", 10);

    renamePath(collection, "/old.md", "/new.md");
    expect(collection.documents).toEqual([{ path: "/new.md", addedAt: 10 }]);
  });

  it("is a no-op for an empty or identical path", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a.md", 1);
    expect(renamePath(collection, "/a.md", "/a.md")).toBe(false);
    expect(renamePath(collection, "", "/b.md")).toBe(false);
  });
});

describe("notification paths", () => {
  it("returns sorted unique document and section paths", () => {
    const collection = emptyCollection();
    addDocument(collection, "/z.md", 1);
    addDocument(collection, "/a.md", 1);
    addSection(collection, "/z.md", anchor(), 1, "s1");
    addSection(collection, "/m.md", anchor(), 1, "s2");
    expect(notificationPaths(collection)).toEqual(["/a.md", "/m.md", "/z.md"]);
  });
});

describe("undo labels", () => {
  it("names documents, sections and multi-removals", () => {
    expect(
      removedBookmarkLabel({
        kind: "document",
        bookmark: { path: "/x/plan.md", addedAt: 1 },
      }),
    ).toContain("plan.md");
    expect(
      removedBookmarkLabel({
        kind: "section",
        bookmark: { id: "s1", path: "/x/plan.md", addedAt: 1, anchor: anchor() },
      }),
    ).toContain("Risks");
    expect(
      removedBookmarkLabel({
        kind: "sections",
        bookmarks: [
          { id: "s1", path: "/x/plan.md", addedAt: 1, anchor: anchor() },
          { id: "s2", path: "/x/plan.md", addedAt: 1, anchor: anchor() },
        ],
      }),
    ).toContain("2 section bookmarks");
  });
});

describe("cloneCollection", () => {
  it("deep-copies anchors so mutations do not leak", () => {
    const collection = emptyCollection();
    addSection(collection, "/a.md", anchor(), 1, "s1");
    const copy = cloneCollection(collection);
    copy.sections[0].anchor.before.push("Changed");
    expect(collection.sections[0].anchor.before).toEqual(["Scope"]);
  });
});
