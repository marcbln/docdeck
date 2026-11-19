import { describe, expect, it } from "vitest";

import { captureAnchor } from "./bookmark-anchors";
import {
  addDocument,
  addSection,
  emptyCollection,
  type BookmarkCollection,
  type SectionAnchor,
} from "./bookmarks-model";
import { buildBookmarkView } from "./bookmarks-view";
import type { InboxEntry } from "./inbox-model";
import type { Heading } from "./toc";

function entry(path: string, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: 100,
    changedAt: 0,
    unread: false,
    deleted: false,
    inventoryHidden: false,
    origin: "config",
    ...overrides,
  };
}

const HEADINGS: Heading[] = [
  { depth: 1, text: "Scope", slug: "scope" },
  { depth: 2, text: "Risks", slug: "risks" },
  { depth: 2, text: "Risks", slug: "risks-1" },
  { depth: 2, text: "Open questions", slug: "open-questions" },
];

function anchor(index: number): SectionAnchor {
  return captureAnchor(HEADINGS, index);
}

function collection(): BookmarkCollection {
  return emptyCollection();
}

describe("bookmark view documents", () => {
  it("returns an empty view for an empty collection", () => {
    const view = buildBookmarkView({
      collection: collection(),
      inventory: [],
    });
    expect(view.rows).toEqual([]);
    expect(view.documents).toEqual([]);
    expect(view.totalCount).toBe(0);
  });

  it("derives availability, filename and project from the inventory", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/home/u/devel/docdeck/_ai/plan.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/home/u/devel/docdeck/_ai/plan.md", { modifiedTime: 500 })],
    });
    expect(view.documents[0]).toMatchObject({
      path: "/home/u/devel/docdeck/_ai/plan.md",
      filename: "plan.md",
      project: "docdeck",
      modifiedTime: 500,
      available: true,
      documentBookmarked: true,
      sectionCount: 0,
    });
  });

  it("orders available documents by modified time then path", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/a.md", 1);
    addDocument(bookmarks, "/b.md", 1);
    addDocument(bookmarks, "/c.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [
        entry("/a.md", { modifiedTime: 100 }),
        entry("/b.md", { modifiedTime: 300 }),
        entry("/c.md", { modifiedTime: 300 }),
      ],
    });
    expect(view.documents.map((document) => document.path)).toEqual([
      "/b.md",
      "/c.md",
      "/a.md",
    ]);
  });

  it("puts unavailable documents last with a filename fallback", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/gone/zeta.md", 1);
    addDocument(bookmarks, "/live/a.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/live/a.md", { modifiedTime: 50 })],
    });
    expect(view.documents.map((document) => document.path)).toEqual([
      "/live/a.md",
      "/gone/zeta.md",
    ]);
    expect(view.documents[1]).toMatchObject({
      available: false,
      filename: "zeta.md",
      unread: false,
    });
  });

  it("treats a deleted inventory row as unavailable", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/a.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md", { deleted: true })],
    });
    expect(view.documents[0].available).toBe(false);
  });

  it("keeps a section-only document as a container with an empty star", () => {
    const bookmarks = collection();
    addSection(bookmarks, "/a.md", anchor(1), 1, "s1");
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md")],
    });
    expect(view.documents[0]).toMatchObject({
      path: "/a.md",
      documentBookmarked: false,
      sectionCount: 1,
    });
    expect(view.totalCount).toBe(1);
  });

  it("counts document and section markers separately", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/a.md", 1);
    addSection(bookmarks, "/a.md", anchor(1), 1, "s1");
    addSection(bookmarks, "/b.md", anchor(2), 1, "s2");
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md"), entry("/b.md")],
    });
    expect(view.totalCount).toBe(3);
    expect(view.documentCount).toBe(2);
    expect(view.sectionCount).toBe(2);
  });
});

describe("bookmark view filtering", () => {
  function filtered(term: string) {
    const bookmarks = collection();
    addDocument(bookmarks, "/home/u/devel/docdeck/_ai/plan.md", 1);
    addSection(bookmarks, "/home/u/devel/docdeck/_ai/plan.md", anchor(1), 1, "s1");
    addSection(bookmarks, "/home/u/devel/docdeck/_ai/plan.md", anchor(3), 1, "s2");
    addDocument(bookmarks, "/home/u/other/_ai/notes.md", 1);
    return buildBookmarkView({
      collection: bookmarks,
      inventory: [
        entry("/home/u/devel/docdeck/_ai/plan.md"),
        entry("/home/u/other/_ai/notes.md"),
      ],
      filterTerm: term,
    });
  }

  it("keeps all sections when the document matches", () => {
    const view = filtered("docdeck");
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0].sections).toHaveLength(2);
  });

  it("keeps only matching sections when the section text matches", () => {
    const view = filtered("open questions");
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0].path).toBe("/home/u/devel/docdeck/_ai/plan.md");
    expect(view.documents[0].sections.map((section) => section.id)).toEqual([
      "s2",
    ]);
  });

  it("matches the full path and is case-insensitive and trimmed", () => {
    expect(filtered("  NOTES.MD  ").documents[0].path).toBe(
      "/home/u/other/_ai/notes.md",
    );
  });

  it("returns no rows when nothing matches", () => {
    const view = filtered("nothing-here");
    expect(view.rows).toEqual([]);
    expect(view.totalCount).toBe(4);
  });
});

describe("bookmark view sections and statuses", () => {
  function withSections() {
    const bookmarks = collection();
    addDocument(bookmarks, "/a.md", 1);
    addSection(bookmarks, "/a.md", anchor(1), 10, "s1");
    addSection(bookmarks, "/a.md", anchor(2), 11, "s2");
    return bookmarks;
  }

  it("nests sections under their document in document order", () => {
    const view = buildBookmarkView({
      collection: withSections(),
      inventory: [entry("/a.md")],
    });
    expect(view.rows.map((row) => row.kind)).toEqual([
      "document",
      "section",
      "section",
    ]);
    expect(
      view.rows
        .filter((row) => row.kind === "section")
        .map((row) => (row.kind === "section" ? row.section.id : "")),
    ).toEqual(["s1", "s2"]);
  });

  it("marks sections without a resolution as unverified", () => {
    const view = buildBookmarkView({
      collection: withSections(),
      inventory: [entry("/a.md")],
    });
    expect(view.documents[0].sections.map((section) => section.status)).toEqual([
      "unverified",
      "unverified",
    ]);
  });

  it("marks exact and occurrence resolutions as current", () => {
    const bookmarks = withSections();
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md")],
      resolutions: new Map([
        [
          "s1",
          {
            kind: "resolved" as const,
            index: 1,
            slug: "risks",
            text: "Risks",
            depth: 2,
            via: "text" as const,
          },
        ],
        [
          "s2",
          {
            kind: "resolved" as const,
            index: 2,
            slug: "risks-1",
            text: "Risks",
            depth: 2,
            via: "occurrence" as const,
          },
        ],
      ]),
    });
    expect(view.documents[0].sections.map((section) => section.status)).toEqual([
      "current",
      "current",
    ]);
  });

  it("marks context and picker resolutions as re-anchored", () => {
    const bookmarks = withSections();
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md")],
      resolutions: new Map([
        [
          "s1",
          {
            kind: "resolved" as const,
            index: 3,
            slug: "open-questions",
            text: "Open questions",
            depth: 2,
            via: "context" as const,
          },
        ],
        [
          "s2",
          {
            kind: "resolved" as const,
            index: 2,
            slug: "risks-1",
            text: "Risks",
            depth: 2,
            via: "picker" as const,
          },
        ],
      ]),
    });
    expect(view.documents[0].sections.map((section) => section.status)).toEqual([
      "re-anchored",
      "re-anchored",
    ]);
    expect(view.documents[0].sections[0]).toBeDefined();
    expect(
      view.documents[0].sections.find((section) => section.id === "s1"),
    ).toMatchObject({
      text: "Open questions",
      order: 3,
      headingSlug: "open-questions",
    });
  });

  it("marks stale and unavailable sections without a slug", () => {
    const bookmarks = withSections();
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md")],
      resolutions: new Map([
        ["s1", { kind: "stale" as const, reason: "missing" as const }],
      ]),
    });
    expect(view.documents[0].sections[0]).toMatchObject({
      status: "stale",
      headingSlug: null,
    });

    const unavailable = buildBookmarkView({
      collection: bookmarks,
      inventory: [],
      resolutions: new Map([
        [
          "s1",
          {
            kind: "resolved" as const,
            index: 1,
            slug: "risks",
            text: "Risks",
            depth: 2,
            via: "text" as const,
          },
        ],
      ]),
    });
    expect(
      unavailable.documents[0].sections.map((section) => section.status),
    ).toEqual(["unavailable", "unavailable"]);
  });

  it("annotates a shared target on both rows and keeps both", () => {
    const bookmarks = withSections();
    const shared = {
      kind: "resolved" as const,
      index: 2,
      slug: "risks-1",
      text: "Risks",
      depth: 2,
      via: "text" as const,
    };
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md")],
      resolutions: new Map([
        ["s1", shared],
        ["s2", shared],
      ]),
    });
    expect(view.documents[0].sections.map((section) => section.status)).toEqual([
      "shared",
      "shared",
    ]);
    expect(view.documents[0].sections.map((section) => section.sharedWith)).toEqual([
      1, 1,
    ]);
    expect(view.documents[0].sections[0].headingSlug).toBe("risks-1");
  });
});

describe("bookmark view unread", () => {
  it("uses an injected unread resolver for available documents", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/a.md", 1);
    addDocument(bookmarks, "/b.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [entry("/a.md"), entry("/b.md")],
      unread: (path) => path === "/a.md",
    });
    expect(view.documents[0]).toMatchObject({ path: "/a.md", unread: true });
    expect(view.documents[1]).toMatchObject({ path: "/b.md", unread: false });
  });

  it("suppresses unread for unavailable documents", () => {
    const bookmarks = collection();
    addDocument(bookmarks, "/gone.md", 1);
    const view = buildBookmarkView({
      collection: bookmarks,
      inventory: [],
      unread: () => true,
    });
    expect(view.documents[0]).toMatchObject({ available: false, unread: false });
  });
});
