import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyChangedViewState,
  type ChangedRow,
  type ChangedViewState,
} from "./changed-ai-model";
import {
  bindChangedRow,
  createChangedRow,
  createRepositoryErrorBanner,
  createScopeBanner,
  createStatePanel,
} from "./changed-ai-rows";
import { formatExactTime } from "./relative-time";

const NOW = 1_800_000_000_000;

function row(overrides: Partial<ChangedRow> = {}): ChangedRow {
  return {
    path: "/devel/docdeck/_ai/backlog/plan.md",
    filename: "plan.md",
    project: "docdeck",
    context: "backlog/plan.md",
    staged: true,
    unstaged: true,
    untracked: false,
    modifiedTime: NOW - 120_000,
    repositoryRoot: "/devel/docdeck",
    ...overrides,
  };
}

function viewState(overrides: Partial<ChangedViewState> = {}): ChangedViewState {
  return {
    ...emptyChangedViewState(),
    status: "ready",
    rows: [row()],
    ...overrides,
  };
}

function mountRow(
  item: ChangedRow = row(),
  onActivate?: (item: ChangedRow) => void,
): { row: HTMLElement; main: HTMLButtonElement } {
  const element = createChangedRow();
  bindChangedRow(element, item, NOW, onActivate);
  document.body.append(element);
  return {
    row: element,
    main: element.querySelector<HTMLButtonElement>(".changed-row-main")!,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("changed row", () => {
  it("shows project, filename, context, text badges and an exact time", () => {
    const { row: element, main } = mountRow();

    expect(element.dataset.path).toBe(
      "/devel/docdeck/_ai/backlog/plan.md",
    );
    expect(element.querySelector(".project-chip")?.textContent).toBe(
      "docdeck",
    );
    expect(element.querySelector(".changed-row-filename")?.textContent).toBe(
      "plan.md",
    );
    expect(element.querySelector(".changed-row-context")?.textContent).toBe(
      "backlog/plan.md",
    );
    expect(
      [...element.querySelectorAll(".change-badge")].map(
        (badge) => badge.textContent,
      ),
    ).toEqual(["Staged", "Unstaged"]);

    const time = element.querySelector<HTMLTimeElement>("time")!;
    expect(time.dateTime).toBe(new Date(NOW - 120_000).toISOString());
    expect(time.textContent).toBe("2m ago");
    expect(time.title).toBe(formatExactTime(NOW - 120_000));
    expect(main.title).toBe("/devel/docdeck/_ai/backlog/plan.md");
  });

  it("composes the accessible name from the visible content", () => {
    const { main } = mountRow(
      row({ staged: false, unstaged: false, untracked: true }),
    );
    expect(main.getAttribute("aria-label")).toBe(
      "plan.md, docdeck, New, 2m ago",
    );
  });

  it("has no dismiss, star, unread or bulk control", () => {
    const { row: element } = mountRow();

    expect(element.querySelectorAll("button")).toHaveLength(1);
    expect(element.querySelector(".inbox-bookmark")).toBeNull();
    expect(element.querySelector(".changed-row-close")).toBeNull();
    expect(element.querySelector(".inbox-dot")).toBeNull();
    expect(element.querySelector(".unread")).toBeNull();
  });

  it("activates exactly once on click, Enter or Space", () => {
    const onActivate = vi.fn();
    const { main } = mountRow(row(), onActivate);

    main.click();
    expect(onActivate).toHaveBeenCalledTimes(1);

    main.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(2);

    main.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(3);

    main.dispatchEvent(
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it("drives the same callback from the virtual list's activation selector", () => {
    const onActivate = vi.fn();
    const { row: element } = mountRow(row(), onActivate);
    expect(element.matches(".changed-row")).toBe(true);
    expect(
      element.querySelector(".changed-row-main")?.matches(".changed-row-main"),
    ).toBe(true);
  });
});

describe("scope banner", () => {
  it("names the repository and root with one return action", () => {
    const onShowAll = vi.fn();
    const banner = createScopeBanner(
      { requested: "/devel/beta", repository: "/devel/beta" },
      onShowAll,
    );

    expect(banner.textContent).toContain("beta");
    expect(banner.textContent).toContain("/devel/beta");
    const buttons = banner.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe(
      "Show all watched repositories",
    );

    buttons[0].click();
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });
});

describe("state panel", () => {
  it("is a polite live region, busy while loading", () => {
    const panel = createStatePanel(
      viewState({
        status: "loading",
        rows: [],
        repositories: [],
        watchedRoots: 2,
      }),
    );

    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.getAttribute("aria-live")).toBe("polite");
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.textContent).toBe("Reading git status in 2 repositories…");
  });

  it("not busy after the report arrives", () => {
    const panel = createStatePanel(viewState());
    expect(panel.getAttribute("aria-busy")).toBe("false");
    expect(panel.textContent).toBe("1 changed `_ai` document");
  });

  it("renders the empty and no-repository copy distinctly", () => {
    const empty = createStatePanel(
      viewState({
        status: "empty",
        rows: [],
        repositories: [
          {
            root: "/devel/docdeck",
            documents: [],
            error: null,
            errorCode: null,
          },
        ],
        aiFolders: 1,
      }),
    );
    expect(empty.textContent).toBe(
      "No uncommitted `_ai` documents in 1 repository.",
    );

    const none = createStatePanel(
      viewState({ status: "no-repository", rows: [], repositories: [] }),
    );
    expect(none.textContent).toBe(
      "No watched `_ai` folder is inside a git repository.",
    );
  });

  it("offers the single return action for a scope error", () => {
    const onShowAll = vi.fn();
    const panel = createStatePanel(
      viewState({
        status: "scope-error",
        rows: [],
        repositories: [],
        scopeError: "/nope/missing",
      }),
      { onShowAll },
    );

    expect(panel.textContent).toContain(
      "No git repository contains `/nope/missing`.",
    );
    const buttons = panel.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("appends the discovery truncation warning", () => {
    const panel = createStatePanel(
      viewState({ discoveryTruncated: true }),
    );
    expect(panel.textContent).toContain("entry limit");
  });
});

describe("repository error banner", () => {
  it("names one failing repository per line and hides when clean", () => {
    const clean = createRepositoryErrorBanner([
      {
        root: "/devel/alpha",
        documents: [],
        error: null,
        errorCode: null,
      },
    ]);
    expect(clean.hidden).toBe(true);
    expect(clean.querySelectorAll(".changed-repo-error")).toHaveLength(0);

    const failing = createRepositoryErrorBanner([
      {
        root: "/devel/alpha",
        documents: [],
        error: null,
        errorCode: null,
      },
      {
        root: "/devel/beta",
        documents: [],
        error: "git status timed out",
        errorCode: "timeout",
      },
    ]);
    expect(failing.hidden).toBe(false);
    const lines = [...failing.querySelectorAll(".changed-repo-error")];
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("/devel/beta");
    expect(lines[0].textContent).toContain("git status timed out");
  });
});
