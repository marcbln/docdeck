import { describe, expect, it } from "vitest";

import { captureAnchor, resolveHeading } from "./bookmark-anchors";
import type { SectionAnchor } from "./bookmarks-model";
import type { Heading } from "./toc";

function headings(...texts: string[]): Heading[] {
  const used = new Map<string, number>();
  return texts.map((text) => {
    const base = text.toLowerCase().replace(/\s+/g, "-") || "section";
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return {
      depth: 2,
      text,
      slug: seen === 0 ? base : `${base}-${seen}`,
    };
  });
}

function anchorFor(texts: string[], index: number): SectionAnchor {
  return captureAnchor(headings(...texts), index);
}

function resolvedAnchor(text: string, index: number): SectionAnchor {
  return anchorFor(["Scope", text, "After"], index);
}

describe("captureAnchor", () => {
  it("captures text, depth, order and a nearest-first two-heading window", () => {
    const outline: Heading[] = [
      { depth: 1, text: "A", slug: "a" },
      { depth: 2, text: "B", slug: "b" },
      { depth: 3, text: "Target", slug: "target" },
      { depth: 4, text: "C", slug: "c" },
      { depth: 2, text: "D", slug: "d" },
    ];

    expect(captureAnchor(outline, 2)).toEqual({
      text: "Target",
      depth: 3,
      before: ["B", "A"],
      after: ["C", "D"],
      ordinal: 0,
      order: 2,
    });
  });

  it("counts earlier headings with the same normalized text", () => {
    const outline = headings("X", " Y ", "X", "X");
    expect(captureAnchor(outline, 2).ordinal).toBe(1);
    expect(captureAnchor(outline, 3).ordinal).toBe(2);
  });

  it("leaves context empty at the document edges", () => {
    const outline = headings("First", "Last");
    expect(captureAnchor(outline, 0).before).toEqual([]);
    expect(captureAnchor(outline, 1).after).toEqual([]);
  });

  it("clamps an out-of-range depth and rejects a missing index", () => {
    const outline: Heading[] = [{ depth: 9, text: "Deep", slug: "deep" }];
    expect(captureAnchor(outline, 0).depth).toBe(4);
    expect(() => captureAnchor([], 0)).toThrow(RangeError);
  });
});

describe("resolveHeading", () => {
  it("resolves a unique heading by text", () => {
    const outline = headings("Scope", "Risks", "After");
    const resolution = resolveHeading(anchorFor(["Scope", "Risks", "After"], 1), outline);
    expect(resolution).toMatchObject({
      kind: "resolved",
      index: 1,
      slug: "risks",
      via: "text",
    });
  });

  it("distinguishes duplicate text by the two-heading context window", () => {
    const original = ["A", "B", "X", "C", "X", "D"];
    const outline = headings(...original);
    const resolution = resolveHeading(anchorFor(original, 2), outline);
    expect(resolution).toMatchObject({ kind: "resolved", index: 2, via: "text" });
  });

  it("is stale when both duplicate candidates have identical context", () => {
    const outline = headings("A", "X", "A", "A", "X", "A", "A");
    expect(resolveHeading(anchorFor(["A", "X", "A", "A", "X", "A", "A"], 1), outline)).toEqual({
      kind: "stale",
      reason: "ambiguous",
    });
  });

  it("keeps the original target when a same-text heading is inserted before it", () => {
    const original = ["B", "X", "C", "D"];
    const outline = headings("B", "X", "X", "C", "D");
    const resolution = resolveHeading(anchorFor(original, 1), outline);
    expect(resolution).toMatchObject({ kind: "resolved", index: 2, via: "text" });
  });

  it("does not move to a duplicate inserted before a final heading with no context", () => {
    const original = ["X"];
    const outline = headings("X", "X");
    // Both candidates have empty sides, so the evidence ties and occurrence is
    // not allowed to break a positive tie.
    expect(resolveHeading(anchorFor(original, 0), outline)).toEqual({
      kind: "stale",
      reason: "ambiguous",
    });
  });

  it("follows a heading through reordering by text", () => {
    const original = ["A", "X", "B", "C"];
    const outline = headings("A", "B", "X", "C");
    expect(resolveHeading(anchorFor(original, 1), outline)).toMatchObject({
      kind: "resolved",
      index: 2,
      via: "text",
    });
  });

  it("re-anchors edited text with unique context", () => {
    const original = ["A", "B", "X", "C", "D"];
    const outline = headings("A", "B", "Y", "C", "D");
    expect(resolveHeading(anchorFor(original, 2), outline)).toMatchObject({
      kind: "resolved",
      index: 2,
      via: "context",
      slug: "y",
    });
  });

  it("is stale for ambiguous context after an edit", () => {
    const outline = headings("A", "B", "Y", "C", "A", "B", "Z", "C");
    expect(resolveHeading(anchorFor(["A", "B", "X", "C"], 2), outline)).toEqual({
      kind: "stale",
      reason: "ambiguous",
    });
  });

  it("is stale when the heading is deleted", () => {
    const outline = headings("A", "B", "C");
    expect(resolveHeading(anchorFor(["A", "B", "X", "C"], 2), outline)).toEqual({
      kind: "stale",
      reason: "missing",
    });
  });

  it("does not re-anchor across a depth change", () => {
    const outline: Heading[] = [
      { depth: 2, text: "A", slug: "a" },
      { depth: 2, text: "B", slug: "b" },
      { depth: 3, text: "Y", slug: "y" },
      { depth: 2, text: "C", slug: "c" },
    ];
    expect(resolveHeading(anchorFor(["A", "B", "X", "C"], 2), outline)).toEqual({
      kind: "stale",
      reason: "missing",
    });
  });

  it("resolves an empty heading text uniquely", () => {
    const outline = headings("A", "", "C");
    expect(resolveHeading(anchorFor(["A", "", "C"], 1), outline)).toMatchObject({
      kind: "resolved",
      index: 1,
    });
  });

  it("handles one heading and no headings", () => {
    const one = headings("Only");
    expect(resolveHeading(anchorFor(["Only"], 0), one)).toMatchObject({
      kind: "resolved",
      index: 0,
    });
    expect(resolveHeading(anchorFor(["Only"], 0), [])).toEqual({
      kind: "stale",
      reason: "missing",
    });
  });

  it("uses occurrence only when every candidate has zero context evidence", () => {
    const outline = headings("A", "X", "B", "X", "C");
    const anchor: SectionAnchor = {
      text: "X",
      depth: 4,
      before: ["Z"],
      after: ["Y"],
      ordinal: 1,
      order: 1,
    };
    expect(resolveHeading(anchor, outline)).toMatchObject({
      kind: "resolved",
      index: 3,
      via: "occurrence",
      slug: "x-1",
    });
  });

  it("never gives a stale resolution a slug", () => {
    const resolution = resolveHeading(
      resolvedAnchor("Gone", 1),
      headings("Scope", "After"),
    );
    expect(resolution.kind).toBe("stale");
    expect("slug" in resolution).toBe(false);
  });
});
