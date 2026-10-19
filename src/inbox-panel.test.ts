import { describe, expect, it, vi } from "vitest";

import type { InboxEntry } from "./inbox-model";
import { InboxPanel, type InboxStatus } from "./inbox-panel";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    path: "/home/u/devel/docdeck/_ai/backlog/plan.md",
    filename: "plan.md",
    modifiedTime: NOW - 60_000,
    unread: false,
    deleted: false,
    ...overrides,
  };
}

function status(overrides: Partial<InboxStatus> = {}): InboxStatus {
  return {
    configPath: "/home/u/.config/docdeck/config.toml",
    configFound: true,
    error: null,
    warnings: [],
    truncated: false,
    loading: false,
    ...overrides,
  };
}

function mount(onOpen = vi.fn()): { root: HTMLElement; onOpen: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  const panel = new InboxPanel(root, { onOpen, now: () => NOW });
  panel.render([entry()], status(), new Set(), null);
  return { root, onOpen };
}

function render(
  entries: InboxEntry[],
  panelStatus: InboxStatus,
  openPaths: Set<string> = new Set(),
  activePath: string | null = null,
  onOpen = vi.fn(),
): HTMLElement {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  new InboxPanel(root, { onOpen, now: () => NOW }).render(
    entries,
    panelStatus,
    openPaths,
    activePath,
  );
  return root;
}

describe("InboxPanel", () => {
  it("renders the row anatomy: project chip, filename, parent, relative time", () => {
    const root = mount().root;

    expect(root.querySelector(".inbox-project")?.textContent).toBe("docdeck");
    expect(root.querySelector(".inbox-filename")?.textContent).toBe("plan.md");
    expect(root.querySelector(".inbox-parent")?.textContent).toBe(
      "/home/u/devel/docdeck/_ai/backlog",
    );
    expect(root.querySelector(".inbox-time")?.textContent).toBe("1m ago");
  });

  it("renders rows in the order given and counts unread files", () => {
    const root = render(
      [
        entry({ path: "/a/old.md", filename: "old.md", modifiedTime: NOW - 90_000 }),
        entry({ path: "/a/new.md", filename: "new.md", modifiedTime: NOW - 60_000, unread: true }),
      ],
      status(),
    );

    const names = [...root.querySelectorAll(".inbox-filename")].map((node) => node.textContent);
    expect(names).toEqual(["old.md", "new.md"]);
    expect(root.querySelector(".inbox-count")?.textContent).toBe("2 files · 1 new");
    expect(root.querySelectorAll(".inbox-row.unread").length).toBe(1);
  });

  it("marks open and active rows", () => {
    const path = "/home/u/devel/docdeck/_ai/backlog/plan.md";
    const root = render([entry()], status(), new Set([path]), path);

    expect(root.querySelector(".inbox-row")?.classList.contains("open")).toBe(true);
    expect(root.querySelector(".inbox-row")?.classList.contains("active")).toBe(true);
  });

  it("marks deleted rows", () => {
    const root = render([entry({ deleted: true })], status());
    expect(root.querySelector(".inbox-row")?.classList.contains("deleted")).toBe(true);
  });

  it("opens on click and on Enter", () => {
    const onOpen = vi.fn();
    const root = render([entry()], status(), new Set(), null, onOpen);
    const row = root.querySelector(".inbox-row") as HTMLElement;

    row.click();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith("/home/u/devel/docdeck/_ai/backlog/plan.md");
  });

  it("shows a loading line before the scan resolves", () => {
    const root = render([], status({ loading: true }));
    expect(root.querySelector(".inbox-loading")?.textContent).toContain("Scanning");
  });

  it("shows a config parse error", () => {
    const root = render([], status({ error: "config.toml: expected `=`" }));
    expect(root.querySelector(".inbox-error")?.textContent).toContain("Config error");
  });

  it("shows the setup hint with the config path when the file is missing", () => {
    const root = render([], status({ configFound: false }));
    expect(root.querySelector(".inbox-hint")?.textContent).toContain(
      "/home/u/.config/docdeck/config.toml",
    );
  });

  it("collapses warnings into a details list and flags truncation", () => {
    const root = render(
      [],
      status({ warnings: ["first warning", "second warning"], truncated: true }),
    );

    expect(root.querySelector(".inbox-warnings summary")?.textContent).toBe("2 warnings");
    expect(root.querySelectorAll(".inbox-warnings li").length).toBe(2);
    expect(root.querySelector(".inbox-truncated")).not.toBeNull();
  });

  it("shows an empty message when nothing matches", () => {
    const root = render([], status());
    expect(root.querySelector(".inbox-empty")).not.toBeNull();
  });
});
