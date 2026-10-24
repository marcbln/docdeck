import { beforeEach, describe, expect, it } from "vitest";

import {
  findMatches,
  flattenSearchableText,
  locate,
  matchToRange,
} from "./find-text";

function mount(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe("flattenSearchableText", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps inline text contiguous", () => {
    const root = mount("<p>Hello <strong>world</strong></p>");
    const searched = flattenSearchableText(root);

    expect(searched.text).toBe("Hello world");
    expect(locate(searched, 6)).toMatchObject({ offset: 0 });
  });

  it("separates block elements so matches cannot cross them", () => {
    const root = mount("<p>foo</p><p>bar</p>");
    const searched = flattenSearchableText(root);

    expect(searched.text).toBe("foo\nbar");
    expect(findMatches(searched.text, "foo bar", false)).toEqual([]);
  });

  it("ignores indentation whitespace between block elements", () => {
    const root = mount("<div>\n  <p>foo</p>\n  <p>bar</p>\n</div>");
    const searched = flattenSearchableText(root);

    expect(searched.text).toBe("foo\nbar");
    expect(findMatches(searched.text, " ", false)).toEqual([]);
  });

  it("treats a source line break inside prose as a space", () => {
    const root = mount("<p>foo\nbar</p>");

    expect(findMatches(flattenSearchableText(root).text, "foo bar", false))
      .toHaveLength(1);
  });

  it("keeps line breaks inside pre so code lines stay separate", () => {
    const root = mount("<pre><code>const x\nconst y</code></pre>");

    expect(findMatches(flattenSearchableText(root).text, "x const", false))
      .toEqual([]);
  });

  it("skips app chrome, hidden content and scripts", () => {
    const root = mount(`
      <p>visible</p>
      <button class="code-copy">⧉</button>
      <p class="deleted-banner">This file was deleted on disk.</p>
      <p hidden>secret</p>
      <details><summary>Summary</summary><p>folded</p></details>
      <script>scripted</script>
    `);
    const text = flattenSearchableText(root).text;

    expect(text).toContain("visible");
    expect(text).toContain("Summary");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("folded");
    expect(text).not.toContain("scripted");
    expect(text).not.toContain("⧉");
  });

  it("searches the content of an open details element", () => {
    const root = mount(
      "<details open><summary>Summary</summary><p>shown</p></details>",
    );

    expect(flattenSearchableText(root).text).toContain("shown");
  });

  it("excludes Mermaid SVG labels because WebKitGTK cannot paint them", () => {
    const root = mount(
      '<div class="mermaid"><svg><text>Flow</text></svg></div>',
    );

    expect(flattenSearchableText(root).text).not.toContain("Flow");
  });
});

describe("findMatches", () => {
  it("is case-insensitive by default and exact when asked", () => {
    expect(findMatches("Foo foo", "foo", false)).toHaveLength(2);
    expect(findMatches("Foo foo", "foo", true)).toHaveLength(1);
  });

  it("treats regex metacharacters literally", () => {
    expect(findMatches("a.b axb", "a.b", false)).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatches("anything", "", false)).toEqual([]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa", false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("matchToRange", () => {
  it("spans inline elements", () => {
    const root = mount("<p>foo <strong>bar</strong></p>");
    const searched = flattenSearchableText(root);
    const match = findMatches(searched.text, "foo bar", false)[0];
    const range = matchToRange(searched, match);

    expect(range?.toString()).toBe("foo bar");
  });

  it("returns null when an endpoint falls on a synthetic break", () => {
    const root = mount("<p>foo</p><p>bar</p>");
    const searched = flattenSearchableText(root);

    expect(matchToRange(searched, { start: 3, end: 6 })).toBeNull();
  });
});
