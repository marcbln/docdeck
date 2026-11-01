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
  it("handles Windows separators, mixed slashes and drive roots", () => {
    expect(fileName("C:\\devel\\docdeck\\_ai\\plan.md")).toBe("plan.md");
    expect(fileName("C:/devel/docdeck/_ai/plan.md")).toBe("plan.md");
    expect(parentPath("C:\\devel\\docdeck\\plan.md")).toBe(
      "C:\\devel\\docdeck",
    );
    expect(parentPath("C:\\plan.md")).toBe("C:");
    expect(projectName("C:\\devel\\docdeck\\_ai\\backlog\\plan.md")).toBe(
      "docdeck",
    );
    expect(isUnder("C:\\devel\\docdeck\\_ai\\plan.md", "C:\\devel\\docdeck")).toBe(
      true,
    );
    expect(
      isUnder("C:\\devel\\docdeck\\_ai\\plan.md", "C:\\devel\\other"),
    ).toBe(false);
    expect(compactPath("C:\\devel\\docdeck\\_ai\\backlog\\plan.md", 24)).toContain(
      "plan.md",
    );
  });

  it("treats a backslash as a literal character in Unix-shaped paths", () => {
    expect(fileName("/home/u/weird\\name.md")).toBe("weird\\name.md");
    expect(projectName("/home/u/weird\\name.md")).toBeNull();
    expect(isUnder("/home/u/a\\b.md", "/home/u")).toBe(true);
  });

  it("compares Windows roots case-insensitively", () => {
    expect(isUnder("C:\\Devel\\Docdeck\\_ai\\a.md", "c:\\devel\\docdeck")).toBe(true);
  });
});
