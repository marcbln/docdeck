import { describe, expect, it } from "vitest";

import {
  compactPath,
  fileName,
  isUnder,
  isUnderAny,
  parentPath,
  projectName,
} from "./project";

describe("path helpers", () => {
  it("splits file names and parents", () => {
    expect(fileName("/home/u/devel/plan.md")).toBe("plan.md");
    expect(fileName("plan.md")).toBe("plan.md");
    expect(parentPath("/home/u/devel/plan.md")).toBe("/home/u/devel");
    expect(parentPath("/plan.md")).toBe("/");
    expect(parentPath("plan.md")).toBe("");
  });

  it("compares whole components", () => {
    expect(isUnder("/a/b.md", "/a")).toBe(true);
    expect(isUnder("/a", "/a")).toBe(true);
    expect(isUnder("/ab/b.md", "/a")).toBe(false);
    expect(isUnderAny("/a/b.md", ["/x", "/a"])).toBe(true);
    expect(isUnderAny("/a/b.md", ["/ab", "/b"])).toBe(false);
  });

  it("finds a project chip only when an _ai segment exists", () => {
    expect(projectName("/home/u/devel/docdeck/_ai/backlog/plan.md")).toBe("docdeck");
    expect(projectName("/home/u/devel/x/_ai/notes/_ai/z.md")).toBe("notes");
    expect(projectName("/home/u/notes/plan.md")).toBeNull();
    expect(projectName("_ai/plan.md")).toBeNull();
  });

  it("compacts long paths from the middle", () => {
    const long = "/home/user/devel/project/_ai/backlog/deep/file.md";
    const compacted = compactPath(long, 24);
    expect(compacted).toBe("…/backlog/deep/file.md");
    expect(compactPath("/tmp/a.md", 48)).toBe("/tmp/a.md");
  });
});
