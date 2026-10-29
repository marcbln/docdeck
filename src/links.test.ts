import { describe, expect, it } from "vitest";

import { classifyLink, isMarkdownPath } from "./links";

describe("classifyLink", () => {
  it("keeps external URLs untouched", () => {
    expect(classifyLink("https://example.com/a?b=1#c")).toEqual({
      kind: "external",
      url: "https://example.com/a?b=1#c",
    });
    expect(classifyLink("//example.com/x")).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
  });

  it("separates fragments, mail and local paths", () => {
    expect(classifyLink("#intro")).toEqual({
      kind: "fragment",
      fragment: "intro",
    });
    expect(classifyLink("#sec%20tion")).toEqual({
      kind: "fragment",
      fragment: "sec tion",
    });
    expect(classifyLink("mailto:a@example.com")).toEqual({
      kind: "mailto",
      url: "mailto:a@example.com",
    });
    expect(classifyLink("./other.md#part")).toEqual({
      kind: "local",
      path: "./other.md",
      fragment: "part",
    });
    expect(classifyLink("../assets/diagram.png?raw=1")).toEqual({
      kind: "local",
      path: "../assets/diagram.png",
      fragment: null,
    });
  });

  it("treats absolute and Windows paths as local", () => {
    expect(classifyLink("/home/marc/doc.md")).toEqual({
      kind: "local",
      path: "/home/marc/doc.md",
      fragment: null,
    });
    expect(classifyLink("C:\\docs\\plan.md")).toEqual({
      kind: "local",
      path: "C:\\docs\\plan.md",
      fragment: null,
    });
  });

  it("converts file URLs to local paths", () => {
    expect(classifyLink("file:///home/marc/a%20b/doc.md#top")).toEqual({
      kind: "local",
      path: "/home/marc/a b/doc.md",
      fragment: "top",
    });
    expect(classifyLink("file:///C:/Users/marc/doc.md")).toEqual({
      kind: "local",
      path: "C:/Users/marc/doc.md",
      fragment: null,
    });
  });

  it("blocks unsafe and unknown schemes", () => {
    expect(classifyLink("javascript:alert(1)").kind).toBe("blocked");
    expect(classifyLink("data:text/html,x").kind).toBe("blocked");
    expect(classifyLink("ftp://example.com/x").kind).toBe("blocked");
  });

  it("treats empty, bare-hash and malformed-escape links predictably", () => {
    expect(classifyLink("")).toEqual({ kind: "empty" });
    expect(classifyLink("  #  ")).toEqual({ kind: "empty" });
    expect(classifyLink("./100%.md")).toEqual({
      kind: "local",
      path: "./100%.md",
      fragment: null,
    });
  });
});

describe("isMarkdownPath", () => {
  it("accepts md and markdown case-insensitively", () => {
    expect(isMarkdownPath("/a/plan.md")).toBe(true);
    expect(isMarkdownPath("/a/PLAN.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("/a/plan.txt")).toBe(false);
  });
});
