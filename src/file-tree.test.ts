import { describe, expect, it } from "vitest";

import { buildTree } from "./file-tree";

describe("buildTree", () => {
  it("nests files under their directories", () => {
    const tree = buildTree("/ai", [
      "/ai/backlog/active/plan.md",
      "/ai/backlog/reports/status.md",
      "/ai/README.md",
    ]);

    expect(tree.children.map((child) => child.name)).toEqual([
      "backlog",
      "README.md",
    ]);

    const backlog = tree.children[0];
    if (backlog?.kind !== "directory") throw new Error("expected a directory");
    expect(backlog.children.map((child) => child.name)).toEqual([
      "active",
      "reports",
    ]);
  });

  it("sorts directories before files at every level", () => {
    const tree = buildTree("/ai", ["/ai/zebra.md", "/ai/alpha/one.md"]);
    expect(tree.children.map((child) => child.kind)).toEqual([
      "directory",
      "file",
    ]);
    expect(tree.children.map((child) => child.name)).toEqual([
      "alpha",
      "zebra.md",
    ]);
  });

  it("ignores paths outside the root", () => {
    const tree = buildTree("/ai", ["/elsewhere/plan.md"]);
    expect(tree.children).toHaveLength(0);
  });

  it("handles files directly under the root", () => {
    const tree = buildTree("/ai", ["/ai/plan.md"]);
    expect(tree.children).toEqual([
      { kind: "file", name: "plan.md", path: "/ai/plan.md" },
    ]);
  });
});