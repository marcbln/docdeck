import { describe, expect, it, vi } from "vitest";

import type { InboxEntry } from "./inbox-model";
import {
  InboxPanel,
  OVERSCAN,
  ROW_HEIGHT,
  visibleRange,
  type InboxStatus,
} from "./inbox-panel";

const NOW = 1_800_000_000_000;
const VIEWPORT = 480;

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

function entries(count: number): InboxEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({
      path: `/a/doc-${index}.md`,
      filename: `doc-${index}.md`,
      modifiedTime: NOW - index * 1_000,
    }),
  );
}

function status(overrides: Partial<InboxStatus> = {}): InboxStatus {
  return {
    configPath: "/home/u/.config/docdeck/config.toml",
    configFound: true,
    error: null,
    warnings: [],
    truncated: false,
    loading: false,
    progress: null,
    ...overrides,
  };
}

function mount(
  entries: InboxEntry[] = [entry()],
  onOpen = vi.fn(),
): {
  root: HTMLElement;
  panel: InboxPanel;
  onOpen: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  const panel = new InboxPanel(root, {
    onOpen,
    now: () => NOW,
    viewportHeight: VIEWPORT,
  });
  panel.render(entries, status(), new Set(), null);
  return { root, panel, onOpen };
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
  new InboxPanel(root, {
    onOpen,
    now: () => NOW,
    viewportHeight: VIEWPORT,
  }).render(entries, panelStatus, openPaths, activePath);
  return root;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rowPaths(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".inbox-row")].map(
    (row) => row.dataset.path ?? "",
  );
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

  it("names the path currently being scanned", () => {
    const root = render(
      [],
      status({
        loading: true,
        progress: { path: "/topdata/shop/_ai", directories: 42, files: 7 },
      }),
    );

    const line = root.querySelector(".inbox-loading");
    expect(line?.textContent).toContain("/topdata/shop/_ai");
    expect(line?.textContent).toContain("42 folders");
    expect(line?.textContent).toContain("7 files");
    expect(line?.getAttribute("title")).toBe("/topdata/shop/_ai");
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

  it("moves the active class without replacing other rows", () => {
    const firstPath = "/a/first.md";
    const secondPath = "/a/second.md";
    const { root, panel } = mount([
      entry({ path: firstPath, filename: "first.md" }),
      entry({ path: secondPath, filename: "second.md" }),
    ]);
    const before = root.querySelectorAll(".inbox-row");

    panel.setActive(null, secondPath, 1);
    const after = root.querySelectorAll(".inbox-row");

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[1].classList.contains("active")).toBe(true);
  });

  it("clears the previous row's active class and marks the new row open", () => {
    const firstPath = "/a/first.md";
    const secondPath = "/a/second.md";
    const { root, panel } = mount([
      entry({ path: firstPath, filename: "first.md" }),
      entry({ path: secondPath, filename: "second.md" }),
    ]);
    panel.setActive(null, firstPath, 0);

    panel.setActive(firstPath, secondPath, 0);
    const rows = root.querySelectorAll(".inbox-row");

    expect(rows[0].classList.contains("active")).toBe(false);
    expect(rows[1].classList.contains("active")).toBe(true);
    expect(rows[1].classList.contains("open")).toBe(true);
  });

  it("removes unread from a newly activated row and updates the header", () => {
    const firstPath = "/a/first.md";
    const secondPath = "/a/second.md";
    const { root, panel } = mount([
      entry({ path: firstPath, filename: "first.md", unread: true }),
      entry({ path: secondPath, filename: "second.md", unread: true }),
    ]);
    expect(root.querySelector(".inbox-count")?.textContent).toBe("2 files · 2 new");

    panel.setActive(null, secondPath, 1);
    const rows = root.querySelectorAll(".inbox-row");

    expect(rows[1].classList.contains("unread")).toBe(false);
    expect(root.querySelector(".inbox-count")?.textContent).toBe("2 files · 1 new");
  });

  it("replaces only the status host when progress changes", () => {
    const { root, panel } = mount();
    const row = root.querySelector(".inbox-row");
    const list = root.querySelector(".inbox-list");

    panel.setProgress({ path: "/topdata/shop/_ai", directories: 42, files: 7 });

    expect(root.querySelector(".inbox-row")).toBe(row);
    expect(root.querySelector(".inbox-list")).toBe(list);
    expect(root.querySelector(".inbox-loading")?.textContent).toContain("/topdata/shop/_ai");
  });

  it("renders only the visible window of a large inbox", () => {
    const all = entries(1_000);
    const { root } = mount(all);

    expect(root.querySelectorAll(".inbox-row").length).toBe(22);
    expect((root.querySelector(".inbox-list") as HTMLElement).style.height).toBe(
      "48000px",
    );
  });

  it("moves the window on scroll", async () => {
    const all = entries(1_000);
    const { root } = mount(all);
    root.scrollTop = 400 * ROW_HEIGHT;

    root.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const paths = rowPaths(root);
    expect(paths[0]).toBe(all[394].path);
    expect(paths[paths.length - 1]).toBe(all[415].path);
  });

  it("binds an offscreen row with its active state when it scrolls in", async () => {
    const all = entries(1_000);
    const { root, panel } = mount(all);

    panel.setActive(null, all[500].path, 0);
    expect(root.querySelector(".inbox-row.active")).toBeNull();

    root.scrollTop = 500 * ROW_HEIGHT;
    root.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const row = root.querySelector<HTMLElement>(".inbox-row.active");
    expect(row?.dataset.path).toBe(all[500].path);
  });

  it("reuses row nodes and re-binds their content on a data render", () => {
    const all = entries(100);
    const { root, panel } = mount(all);
    const before = root.querySelector(".inbox-row");

    const changed = all.map((item, index) =>
      index === 0 ? { ...item, modifiedTime: NOW - 120_000 } : item,
    );
    panel.render(changed, status(), new Set(), null);

    const after = root.querySelector(".inbox-row");
    expect(after).toBe(before);
    expect(after?.querySelector(".inbox-time")?.textContent).toBe("2m ago");
  });

  it("renders no rows for an empty inbox", () => {
    const { root } = mount([]);

    expect(root.querySelectorAll(".inbox-row").length).toBe(0);
    expect(root.querySelector(".inbox-empty")).not.toBeNull();
    expect((root.querySelector(".inbox-list") as HTMLElement).style.height).toBe("0px");
  });

  it("releases listeners on destroy", () => {
    const { panel } = mount();
    expect(() => panel.destroy()).not.toThrow();
  });
});

describe("visibleRange", () => {
  it("returns an empty range when there is nothing to show", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 0, OVERSCAN)).toEqual({
      start: 0,
      end: 0,
    });
    expect(visibleRange(0, 0, ROW_HEIGHT, 100, OVERSCAN)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("renders fewer rows than the window when the inbox is small", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 5, OVERSCAN)).toEqual({
      start: 0,
      end: 5,
    });
  });

  it("starts at the top with overscan for a fresh scroll", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN)).toEqual({
      start: 0,
      end: 22,
    });
  });

  it("tracks a middle scroll offset", () => {
    expect(
      visibleRange(400 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 394, end: 416 });
  });

  it("clamps to the end of the list", () => {
    expect(
      visibleRange(10_000 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 978, end: 1_000 });
  });

  it("handles a single row and fractional offsets", () => {
    expect(visibleRange(0, VIEWPORT, ROW_HEIGHT, 1, OVERSCAN)).toEqual({
      start: 0,
      end: 1,
    });
    expect(
      visibleRange(10.5 * ROW_HEIGHT, VIEWPORT, ROW_HEIGHT, 1_000, OVERSCAN),
    ).toEqual({ start: 4, end: 26 });
  });
});
