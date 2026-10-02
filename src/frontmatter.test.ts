import { describe, expect, it } from "vitest";

import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns the body untouched when there is no frontmatter", () => {
    const source = "# Title\n\nBody.\n";
    expect(splitFrontmatter(source)).toEqual({ raw: null, body: source });
  });

  it("splits a leading frontmatter block from the body", () => {
    const { raw, body } = splitFrontmatter("---\ntitle: Plan\n---\n\n# Heading\n");
    expect(raw).toBe("title: Plan");
    expect(body.trim()).toBe("# Heading");
  });

  it("ignores a thematic break further down the document", () => {
    const source = "# Title\n\nSome text.\n\n---\n\nMore text.\n";
    expect(splitFrontmatter(source).raw).toBeNull();
  });

  it("tolerates CRLF line endings", () => {
    const { raw, body } = splitFrontmatter("---\r\ntitle: Plan\r\n---\r\n\r\n# H\r\n");
    expect(raw).toBe("title: Plan");
    expect(body.trim()).toBe("# H");
  });

  it("handles an unterminated block as absent", () => {
    const source = "---\ntitle: Plan\n\n# Heading\n";
    expect(splitFrontmatter(source).raw).toBeNull();
  });

  it("returns null raw for an empty document", () => {
    expect(splitFrontmatter("")).toEqual({ raw: null, body: "" });
  });
});

describe("parseFrontmatterRows", () => {
  it("parses scalar keys in document order", () => {
    const rows = parseFrontmatterRows('title: "A Plan"\nstatus: draft\n');
    expect(rows).toEqual([
      { key: "title", value: "A Plan", depth: 0, kind: "scalar" },
      { key: "status", value: "draft", depth: 0, kind: "scalar" },
    ]);
  });

  it("keeps an unquoted date-like value as a string", () => {
    const rows = parseFrontmatterRows("createdAt: 2026-10-01 21:16\n");
    expect(rows[0]?.value).toBe("2026-10-01 21:16");
  });

  it("formats a list inline", () => {
    const rows = parseFrontmatterRows("tags: [rust, tauri]\n");
    expect(rows[0]).toEqual({
      key: "tags",
      value: "[rust, tauri]",
      depth: 0,
      kind: "list",
    });
  });

  it("flattens a nested map into indented sub-rows", () => {
    const rows = parseFrontmatterRows("meta:\n  nested: true\n");
    expect(rows).toEqual([
      { key: "meta", value: "{…}", depth: 0, kind: "object" },
      { key: "nested", value: "true", depth: 1, kind: "scalar" },
    ]);
  });

  it("marks a valueless key as empty", () => {
    const rows = parseFrontmatterRows("emptyValue:\n");
    expect(rows[0]).toEqual({
      key: "emptyValue",
      value: null,
      depth: 0,
      kind: "empty",
    });
  });

  it("degrades malformed YAML to a single raw row", () => {
    const rows = parseFrontmatterRows("a: [unclosed\nb: 1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.malformed).toBe(true);
    expect(rows[0]?.value).toBe("a: [unclosed\nb: 1");
  });

  it("degrades a non-mapping block to a raw row", () => {
    expect(parseFrontmatterRows("just a string")[0]?.malformed).toBe(true);
  });
});