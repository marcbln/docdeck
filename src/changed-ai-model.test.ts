import { describe, expect, it } from "vitest";

import {
  changedBadgeLabels,
  changedContext,
  changedRepositoryErrors,
  changedStateMessage,
  deriveChangedRows,
  emptyChangedViewState,
  selectChangedState,
  type ChangedAiReport,
  type ChangedDocument,
  type ChangedRepository,
} from "./changed-ai-model";

function document(
  path: string,
  overrides: Partial<ChangedDocument> = {},
): ChangedDocument {
  return {
    path,
    repositoryRoot: "/devel/docdeck",
    staged: false,
    unstaged: false,
    untracked: false,
    modifiedTime: 1_000,
    ...overrides,
  };
}

function repository(
  root: string,
  documents: ChangedDocument[] = [],
  overrides: Partial<ChangedRepository> = {},
): ChangedRepository {
  return {
    root,
    documents,
    error: null,
    errorCode: null,
    ...overrides,
  };
}

function report(overrides: Partial<ChangedAiReport> = {}): ChangedAiReport {
  return {
    scope: null,
    scopeError: null,
    watchedRoots: 2,
    aiFolders: 2,
    repositories: [repository("/devel/docdeck")],
    gitAvailable: true,
    discoveryTruncated: false,
    ...overrides,
  };
}

describe("deriveChangedRows", () => {
  it("flattens repositories into one row per canonical path", () => {
    const duplicate = document("/devel/docdeck/_ai/backlog/plan.md", {
      staged: true,
    });
    const rows = deriveChangedRows(
      report({
        repositories: [
          repository("/devel/docdeck", [duplicate]),
          repository("/devel/docdeck", [
            document("/devel/docdeck/_ai/backlog/plan.md", {
              unstaged: true,
              modifiedTime: 2_000,
            }),
          ]),
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].staged).toBe(true);
    expect(rows[0].unstaged).toBe(true);
    expect(rows[0].modifiedTime).toBe(2_000);
  });

  it("orders newest first, then by path, with unknown times last", () => {
    const rows = deriveChangedRows(
      report({
        repositories: [
          repository("/devel/docdeck", [
            document("/devel/docdeck/_ai/backlog/c.md", { modifiedTime: 500 }),
            document("/devel/docdeck/_ai/backlog/b.md", { modifiedTime: 500 }),
            document("/devel/docdeck/_ai/backlog/a.md", { modifiedTime: 9_000 }),
            document("/devel/docdeck/_ai/backlog/z.md", { modifiedTime: null }),
          ]),
        ],
      }),
    );

    expect(rows.map((row) => row.filename)).toEqual([
      "a.md",
      "b.md",
      "c.md",
      "z.md",
    ]);
  });

  it("labels the project and keeps the _ai-relative context", () => {
    const rows = deriveChangedRows(
      report({
        repositories: [
          repository("/devel/shop", [
            document("/devel/shop/_ai/backlog/plan.md"),
            document("/devel/shop/pkg/sub/_ai/deep/notes.md"),
          ]),
        ],
      }),
    );

    expect(rows.map((row) => row.project)).toEqual(["shop", "sub"]);
    expect(rows.map((row) => row.context)).toEqual([
      "backlog/plan.md",
      "deep/notes.md",
    ]);
  });

  it("falls back to the repository basename when no project segment exists", () => {
    const rows = deriveChangedRows(
      report({
        repositories: [
          repository("/devel/worktree", [document("/_ai/plan.md")]),
        ],
      }),
    );

    expect(rows[0].project).toBe("worktree");
    expect(rows[0].context).toBe("plan.md");
  });

  it("badges are text and never mutually exclusive for a live edit", () => {
    const rows = deriveChangedRows(
      report({
        repositories: [
          repository("/devel/docdeck", [
            document("/devel/docdeck/_ai/a.md", { staged: true }),
            document("/devel/docdeck/_ai/b.md", { unstaged: true }),
            document("/devel/docdeck/_ai/c.md", { untracked: true }),
            document("/devel/docdeck/_ai/d.md", {
              staged: true,
              unstaged: true,
            }),
          ]),
        ],
      }),
    );

    const labels = rows.map((row) => changedBadgeLabels(row));
    expect(labels).toContainEqual(["Staged"]);
    expect(labels).toContainEqual(["Unstaged"]);
    expect(labels).toContainEqual(["New"]);
    expect(labels).toContainEqual(["Staged", "Unstaged"]);
  });
});

describe("changedContext", () => {
  it("uses the deepest _ai component", () => {
    expect(changedContext("/devel/a/_ai/backlog/plan.md")).toBe(
      "backlog/plan.md",
    );
    expect(changedContext("/devel/a/pkg/sub/_ai/x/deep.md")).toBe("x/deep.md");
  });

  it("handles Windows-shaped paths and never returns empty", () => {
    expect(changedContext("C:\\work\\proj\\_ai\\backlog\\plan.md")).toBe(
      "backlog\\plan.md",
    );
    expect(changedContext("/plan.md")).toBe("plan.md");
  });
});

describe("selectChangedState", () => {
  it("starts idle with no rows", () => {
    const state = emptyChangedViewState();
    expect(state.status).toBe("idle");
    expect(state.rows).toEqual([]);
    expect(state.loadedAt).toBeNull();
  });

  it("is ready when rows exist and every repository was read", () => {
    const state = selectChangedState(
      report({
        repositories: [
          repository("/devel/docdeck", [
            document("/devel/docdeck/_ai/plan.md"),
          ]),
        ],
      }),
      42,
    );

    expect(state.status).toBe("ready");
    expect(state.rows).toHaveLength(1);
    expect(state.loadedAt).toBe(42);
  });

  it("is partial when rows exist beside a repository error", () => {
    const state = selectChangedState(
      report({
        repositories: [
          repository("/devel/alpha", [
            document("/devel/alpha/_ai/a.md"),
          ]),
          repository("/devel/beta", [], {
            error: "git status timed out",
            errorCode: "timeout",
          }),
        ],
      }),
      1,
    );

    expect(state.status).toBe("partial");
    expect(state.rows).toHaveLength(1);
    expect(changedRepositoryErrors(state.repositories)).toEqual([
      "/devel/beta: git status timed out",
    ]);
  });

  it("is partial when only errors came back", () => {
    const state = selectChangedState(
      report({
        repositories: [
          repository("/devel/beta", [], {
            error: "git status timed out",
            errorCode: "timeout",
          }),
        ],
      }),
      1,
    );

    expect(state.status).toBe("partial");
    expect(state.rows).toEqual([]);
  });

  it("is empty when repositories were read and nothing is uncommitted", () => {
    const state = selectChangedState(report(), 1);
    expect(state.status).toBe("empty");
    expect(changedStateMessage(state)).toBe(
      "No uncommitted `_ai` documents in 1 repository.",
    );
  });

  it("is no-repository when no watched _ai folder exists", () => {
    const state = selectChangedState(
      report({ aiFolders: 0, repositories: [] }),
      1,
    );
    expect(state.status).toBe("no-repository");
    expect(changedStateMessage(state)).toBe(
      "No watched `_ai` folder is inside a git repository.",
    );
  });

  it("is no-repository when watched _ai folders resolve to no work tree", () => {
    const state = selectChangedState(report({ repositories: [] }), 1);
    expect(state.status).toBe("no-repository");
  });

  it("scope-error wins, drops the scope and names the requested path", () => {
    const state = selectChangedState(
      report({
        scope: { requested: "/nope", repository: "/nope" },
        scopeError: "/nope/missing",
        repositories: [],
      }),
      1,
    );

    expect(state.status).toBe("scope-error");
    expect(state.scope).toBeNull();
    expect(state.rows).toEqual([]);
    expect(changedStateMessage(state)).toBe(
      "No git repository contains `/nope/missing`.",
    );
  });

  it("git-missing is error before row counting", () => {
    const state = selectChangedState(
      report({
        gitAvailable: false,
        repositories: [
          repository("/devel/docdeck", [], {
            error: "git is not installed or could not be started",
            errorCode: "git-missing",
          }),
        ],
      }),
      1,
    );

    expect(state.status).toBe("error");
    expect(state.rows).toEqual([]);
    expect(changedStateMessage(state)).toBe(
      "git is not installed or could not be started.",
    );
  });

  it("carries the discovery truncation flag", () => {
    const state = selectChangedState(report({ discoveryTruncated: true }), 1);
    expect(state.discoveryTruncated).toBe(true);
  });

  it("describes loading with the repository count", () => {
    const state = selectChangedState(report({ watchedRoots: 3 }), null);
    state.status = "loading";
    expect(changedStateMessage(state)).toBe(
      "Reading git status in 1 repository…",
    );
  });
});
