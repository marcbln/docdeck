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
  all: InboxEntry[] = [entry({ unread: true })],
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
    modalViewportHeight: VIEWPORT,
  });
  panel.render(all, status(), new Set(), null);
  return { root, panel, onOpen };
}

function render(
  all: InboxEntry[],
  panelStatus: InboxStatus = status(),
  openPaths: Set<string> = new Set(),
  activePath: string | null = null,
  onOpen = vi.fn(),
): HTMLElement {
  const mounted = mount(all, onOpen);
  mounted.panel.render(all, panelStatus, openPaths, activePath);
  return mounted.root;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rowPaths(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>(".inbox-row")].map(
    (row) => row.dataset.path ?? "",
  );
}

function sectionNames(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll<HTMLElement>(".inbox-section"),
  ].map((section) => section.dataset.section ?? "");
}

describe("InboxPanel", () => {
  it("renders the row anatomy: project chip, filename, parent, relative time", () => {
    const { root } = mount();

    expect(root.querySelector(".inbox-project")?.textContent).toBe("docdeck");
    expect(root.querySelector(".inbox-filename")?.textContent).toBe("plan.md");
    expect(root.querySelector(".inbox-parent")?.textContent).toBe(
      "/home/u/devel/docdeck/_ai/backlog",
    );
    expect(root.querySelector(".inbox-time")?.textContent).toBe("1m ago");
  });

  it("shows changed and opened sections without duplicating a row", () => {
    const all = [
      entry({ path: "/a/changed.md", filename: "changed.md", unread: true }),
      entry({ path: "/a/opened.md", filename: "opened.md" }),
      entry({ path: "/a/both.md", filename: "both.md", unread: true }),
      entry({ path: "/a/hidden.md", filename: "hidden.md" }),
    ];
    const root = render(
      all,
      status(),
      new Set(["/a/opened.md", "/a/both.md"]),
    );

    expect(sectionNames(root)).toEqual(["change-detected", "opened"]);
    expect(
      [...root.querySelectorAll("[data-section='change-detected'] .inbox-filename")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["changed.md", "both.md"]);
    expect(
      [...root.querySelectorAll("[data-section='opened'] .inbox-filename")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["opened.md"]);
    expect(root.querySelector(".inbox-count")?.textContent).toBe(
      "2 changed · 1 open",
    );
    expect(root.querySelector(".inbox-browse")?.textContent).toBe("All files (4)");
  });

  it("treats deleted files as changes", () => {
    const root = render([entry({ deleted: true })], status());

    expect(sectionNames(root)).toEqual(["change-detected"]);
    expect(root.querySelector(".inbox-row")?.classList.contains("deleted")).toBe(
      true,
    );
  });

  it("hides unchanged watched files behind the All-files modal", () => {
    const root = render(entries(4), status());

    expect(root.querySelectorAll(".inbox-row").length).toBe(0);
    expect(root.querySelector(".inbox-empty")?.textContent).toContain(
      "No changes or open documents",
    );
    expect(root.querySelector(".inbox-browse")?.textContent).toBe("All files (4)");
  });

  it("marks open and active rows", () => {
    const path = "/home/u/devel/docdeck/_ai/backlog/plan.md";
    const root = render([entry()], status(), new Set([path]), path);

    expect(root.querySelector(".inbox-row")?.classList.contains("open")).toBe(
      true,
    );
    expect(root.querySelector(".inbox-row")?.classList.contains("active")).toBe(
      true,
    );
  });

  it("opens on click and on Enter", () => {
    const onOpen = vi.fn();
    const root = render([entry({ unread: true })], status(), new Set(), null, onOpen);
    const row = root.querySelector(".inbox-row") as HTMLElement;

    row.click();
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(
      "/home/u/devel/docdeck/_ai/backlog/plan.md",
    );
  });

  it("shows a loading line before the scan resolves", () => {
    const root = render([], status({ loading: true }));
    expect(root.querySelector(".inbox-loading")?.textContent).toContain(
      "Scanning",
    );
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
    expect(root.querySelector(".inbox-error")?.textContent).toContain(
      "Config error",
    );
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

    expect(root.querySelector(".inbox-warnings summary")?.textContent).toBe(
      "2 warnings",
    );
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
    const all = [
      entry({ path: firstPath, filename: "first.md" }),
      entry({ path: secondPath, filename: "second.md" }),
    ];
    const { root, panel } = mount(all);
    panel.render(all, status(), new Set([firstPath, secondPath]), null);
    const before = root.querySelectorAll(".inbox-row");

    panel.setActive(null, secondPath);
    const after = root.querySelectorAll(".inbox-row");

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[1].classList.contains("active")).toBe(true);
  });

  it("clears the previous row's active class and marks the new row open", () => {
    const firstPath = "/a/first.md";
    const secondPath = "/a/second.md";
    const all = [
      entry({ path: firstPath, filename: "first.md" }),
      entry({ path: secondPath, filename: "second.md" }),
    ];
    const { root, panel } = mount(all);
    panel.render(all, status(), new Set([firstPath, secondPath]), null);
    panel.setActive(null, firstPath);

    panel.setActive(firstPath, secondPath);
    const rows = root.querySelectorAll(".inbox-row");

    expect(rows[0].classList.contains("active")).toBe(false);
    expect(rows[1].classList.contains("active")).toBe(true);
    expect(rows[1].classList.contains("open")).toBe(true);
  });

  it("removes the unread marker from a newly activated row", () => {
    const firstPath = "/a/first.md";
    const secondPath = "/a/second.md";
    const all = [
      entry({ path: firstPath, filename: "first.md", unread: true }),
      entry({ path: secondPath, filename: "second.md", unread: true }),
    ];
    const { root, panel } = mount(all);
    panel.render(all, status(), new Set([firstPath, secondPath]), null);

    panel.setActive(null, secondPath);
    const rows = root.querySelectorAll(".inbox-row");

    expect(rows[1].classList.contains("unread")).toBe(false);
  });

  it("replaces only the status host when progress changes", () => {
    const { root, panel } = mount();
    const row = root.querySelector(".inbox-row");
    const sections = root.querySelector(".inbox-sections");

    panel.setProgress({ path: "/topdata/shop/_ai", directories: 42, files: 7 });

    expect(root.querySelector(".inbox-row")).toBe(row);
    expect(root.querySelector(".inbox-sections")).toBe(sections);
    expect(root.querySelector(".inbox-loading")?.textContent).toContain(
      "/topdata/shop/_ai",
    );
  });

  it("releases listeners on destroy", () => {
    const { panel } = mount();
    expect(() => panel.destroy()).not.toThrow();
  });
});

describe("InboxBrowser", () => {
  function openModal(root: HTMLElement): HTMLElement {
    (root.querySelector(".inbox-browse") as HTMLButtonElement).click();
    const overlay = document.querySelector<HTMLElement>(".inbox-overlay");
    if (!overlay) throw new Error("modal did not open");
    return overlay;
  }

  it("only shows the complete inventory after clicking the button", () => {
    const all = entries(1_000);
    const { root } = mount(all);
    expect(document.querySelector(".inbox-overlay")).toBeNull();

    const overlay = openModal(root);

    expect(overlay.querySelector(".inbox-modal-title")?.textContent).toBe(
      "All files",
    );
    expect(overlay.querySelector(".inbox-modal-count")?.textContent).toBe(
      "1000 files",
    );
    expect(rowPaths(overlay)[0]).toBe(all[0].path);
    expect(overlay.querySelectorAll(".inbox-row").length).toBe(22);
    expect(
      (overlay.querySelector(".inbox-list") as HTMLElement).style.height,
    ).toBe("48000px");
  });

  it("moves the window on scroll", async () => {
    const all = entries(1_000);
    const { root } = mount(all);
    const overlay = openModal(root);
    const body = overlay.querySelector(".inbox-modal-body") as HTMLElement;
    body.scrollTop = 400 * ROW_HEIGHT;

    body.dispatchEvent(new Event("scroll"));
    await nextFrame();

    const paths = rowPaths(overlay);
    expect(paths[0]).toBe(all[394].path);
    expect(paths[paths.length - 1]).toBe(all[415].path);
  });

  it("opens a row and closes the modal", () => {
    const all = entries(10);
    const onOpen = vi.fn();
    const { root } = mount(all, onOpen);
    const overlay = openModal(root);

    (overlay.querySelector(".inbox-row") as HTMLElement).click();

    expect(onOpen).toHaveBeenCalledWith(all[0].path);
    expect(document.querySelector(".inbox-overlay")).toBeNull();
  });

  it("closes on Escape, the close button and a backdrop click", () => {
    const { root } = mount(entries(10));

    let overlay = openModal(root);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.isConnected).toBe(false);

    overlay = openModal(root);
    (overlay.querySelector(".inbox-modal-close") as HTMLButtonElement).click();
    expect(overlay.isConnected).toBe(false);

    overlay = openModal(root);
    overlay.click();
    expect(overlay.isConnected).toBe(false);
  });

  it("disables the All-files button when no files match", () => {
    const { root } = mount([]);
    expect((root.querySelector(".inbox-browse") as HTMLButtonElement).disabled).toBe(
      true,
    );
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
