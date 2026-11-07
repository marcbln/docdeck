import { describe, expect, it } from "vitest";

import { composeWindowTitle } from "./window-title";

describe("composeWindowTitle", () => {
  it("uses exactly docdeck when no document is active", () => {
    expect(composeWindowTitle(null)).toBe("docdeck");
  });

  it("puts the project, filename and app name in order", () => {
    expect(
      composeWindowTitle("/home/marc/devel/ruleman/_ai/backlog/README.md"),
    ).toBe("ruleman — README.md — docdeck");
  });

  it("omits the project for paths outside _ai", () => {
    expect(composeWindowTitle("/home/marc/notes/todo.md")).toBe(
      "todo.md — docdeck",
    );
  });

  it("uses the deepest _ai segment", () => {
    expect(composeWindowTitle("/a/_ai/x/b/_ai/plan.md")).toBe(
      "b — plan.md — docdeck",
    );
  });

  it("omits the project when _ai is at the path root", () => {
    expect(composeWindowTitle("/_ai/plan.md")).toBe("plan.md — docdeck");
  });

  it("does not treat a file named _ai.md as a project folder", () => {
    expect(composeWindowTitle("/work/_ai.md")).toBe("_ai.md — docdeck");
  });

  it("handles Windows-shaped paths", () => {
    expect(composeWindowTitle("C:\\work\\_ai\\spec.md")).toBe(
      "work — spec.md — docdeck",
    );
  });

  it("preserves long and Unicode filenames verbatim", () => {
    const name = `${"ü".repeat(80)}-計画.md`;
    expect(composeWindowTitle(`/p/_ai/${name}`)).toBe(
      `p — ${name} — docdeck`,
    );
  });

  it("uses one em dash surrounded by single spaces", () => {
    expect(
      composeWindowTitle("/p/_ai/one.md").split(" — "),
    ).toHaveLength(3);
  });
});
