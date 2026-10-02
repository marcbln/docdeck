import { Marked } from "marked";
import { describe, expect, it } from "vitest";

import { extractHeadings, slugify } from "./toc";

const marked = new Marked();

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Problem Statement")).toBe("problem-statement");
  });

  it("strips inline markdown syntax", () => {
    expect(slugify("**Bold** and `code`")).toBe("bold-and-code");
  });

  it("folds accents and keeps unicode letters", () => {
    expect(slugify("café naïve")).toBe("cafe-naive");
  });

  it("collapses punctuation runs to a single dash", () => {
    expect(slugify("Ünïcödé — “quoted” 100%")).toBe("unicode-quoted-100");
  });

  it("returns a fallback when no slug survives", () => {
    expect(slugify("—")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("extractHeadings", () => {
  it("returns nothing for a document with no headings", () => {
    expect(extractHeadings(marked, "Just a paragraph.")).toEqual([]);
  });

  it("captures text with inline markdown removed", () => {
    const headings = extractHeadings(marked, "## **Bold** and `code` heading\n");
    expect(headings[0]).toEqual({
      depth: 2,
      text: "Bold and code heading",
      slug: "bold-and-code-heading",
    });
  });

  it("excludes headings deeper than the cap", () => {
    const headings = extractHeadings(marked, "#### four\n\n##### five\n");
    expect(headings.map((h) => h.depth)).toEqual([4]);
  });

  it("honours an explicit depth cap", () => {
    expect(extractHeadings(marked, "## two\n", 2)).toHaveLength(1);
    expect(extractHeadings(marked, "## two\n", 1)).toHaveLength(0);
  });

  it("disambiguates duplicate heading slugs", () => {
    const headings = extractHeadings(marked, "## Setup\n\n## Setup\n\n## Setup\n");
    expect(headings.map((h) => h.slug)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("does not leak inline html into the slug", () => {
    const headings = extractHeadings(marked, "## A <em>b</em> c\n");
    expect(headings[0]?.text).toBe("A b c");
    expect(headings[0]?.slug).toBe("a-b-c");
  });

  it("reads link text rather than the href", () => {
    const headings = extractHeadings(marked, "## [link](http://x) here\n");
    expect(headings[0]?.text).toBe("link here");
  });
});