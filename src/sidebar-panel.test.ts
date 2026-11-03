import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxEntry } from "./inbox-model";
import type { OpenRow } from "./sidebar-model";
import { SidebarPanel, type SidebarViewState } from "./sidebar-panel";

const NOW = 1_800_000_000_000;
const VIEWPORT = 480;

function openRow(path: string, overrides: Partial<OpenRow> = {}): OpenRow {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: NOW,
    unread: false,
    deleted: false,
    active: false,
    ...overrides,
  };
}

function entry(
  path: string,
  changedAt: number,
  overrides: Partial<InboxEntry> = {},
): InboxEntry {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    modifiedTime: changedAt,
    changedAt,
    unread: false,
    deleted: false,
    origin: "manual",
    ...overrides,
  };
}

function state(overrides: Partial<SidebarViewState> = {}): SidebarViewState {
  return {
    openRows: [],
    browseMode: "recent",
    inventory: [],
    recent: [],
    openPaths: new Set(),
    activePath: null,
    activeUpdatePath: null,
    status: {
      configPath: "/home/u/.config/docdeck/config.toml",
      configFound: true,
      error: null,
      warnings: [],
      truncated: false,
      loading: false,
      progress: null,
      lastReload: null,
    },
    openCollapsed: false,
    browseCollapsed: false,
    canUndo: false,
    filterTerm: "",
    summary: {
      ready: true,
      provider: "openai",
      model: "gpt-test",
      problem: null,
      configPath: "/home/u/.config/docdeck/config.toml",
    },
    summaryBusy: false,
    now: NOW,
    ...overrides,
  };
}

function mount(next: SidebarViewState = state()): {
  root: HTMLElement;
  panel: SidebarPanel;
  onOpen: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onCloseAll: ReturnType<typeof vi.fn>;
  onClear: ReturnType<typeof vi.fn>;
  onUndo: ReturnType<typeof vi.fn>;
  onSummarize: ReturnType<typeof vi.fn>;
  onModeChange: ReturnType<typeof vi.fn>;
  onFilterChange: ReturnType<typeof vi.fn>;
  onToggleSection: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = '<aside id="sidebar"></aside>';
  const root = document.getElementById("sidebar") as HTMLElement;
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onCloseAll = vi.fn();
  const onClear = vi.fn();
  const onUndo = vi.fn();
  const onSummarize = vi.fn();
  const onModeChange = vi.fn();
  const onFilterChange = vi.fn();
  const onToggleSection = vi.fn();
  const panel = new SidebarPanel(root, {
    onOpen,
    onClose,
    onCloseAll,
    onClear,
    onUndo,
    onSummarize,
    onModeChange,
    onFilterChange,
    onToggleSection,
    onContextMenu: vi.fn(),
    now: () => NOW,
    viewportHeight: VIEWPORT,
    modalViewportHeight: VIEWPORT,
  });
  panel.render(next);
  return {
    root,
    panel,
    onOpen,
    onClose,
    onCloseAll,
    onClear,
    onUndo,
    onSummarize,
    onModeChange,
    onFilterChange,
    onToggleSection,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SidebarPanel", () => {
  it("stacks Open documents above Browse", () => {
    const { root } = mount();

    expect(
      [...root.querySelectorAll<HTMLElement>(".sidebar-section")].map(
        (section) => section.dataset.section,
      ),
    ).toEqual(["open", "browse"]);
  });

  it("renders open rows with active, unread and deleted state", () => {
    const { root } = mount(
      state({
        openRows: [
          openRow("/a/plan.md", {
            active: true,
            unread: true,
            deleted: true,
          }),
        ],
      }),
    );

    const row = root.querySelector<HTMLElement>(".sidebar-row")!;
    expect(row.dataset.path).toBe("/a/plan.md");
    expect(row.classList.contains("active")).toBe(true);
    expect(row.classList.contains("unread")).toBe(true);
    expect(row.classList.contains("deleted")).toBe(true);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.querySelector(".tab-dot")).not.toBeNull();
    expect(row.querySelector(".sidebar-row-close")).not.toBeNull();
  });

  it("shows an empty state when no document is open", () => {
    const { root } = mount();
    expect(root.querySelector(".sidebar-open-empty")?.textContent).toContain(
      "No open documents",
    );
  });

  it("opens a row on click and closes from the close control", () => {
    const { root, onOpen, onClose } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const row = root.querySelector<HTMLElement>(".sidebar-row")!;

    row.click();
    expect(onOpen).toHaveBeenCalledWith("/a/plan.md");

    (row.querySelector(".sidebar-row-close") as HTMLElement).click();
    expect(onClose).toHaveBeenCalledWith("/a/plan.md");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("closes a row on middle-click", () => {
    const { root, onClose, onOpen } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const row = root.querySelector<HTMLElement>(".sidebar-row")!;

    row.dispatchEvent(
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );

    expect(onClose).toHaveBeenCalledWith("/a/plan.md");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes every open document from the pane's clear-all control", () => {
    const { root, onCloseAll } = mount(
      state({ openRows: [openRow("/a/one.md"), openRow("/a/two.md")] }),
    );
    const clearAll = root.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='clear-all']",
    )!;

    expect(clearAll.disabled).toBe(false);
    clearAll.click();
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

  it("hides clear-all when no document is open", () => {
    const { root } = mount();
    const toolbar = root.querySelector<HTMLElement>(".sidebar-open-toolbar")!;
    const clearAll = toolbar.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='clear-all']",
    )!;

    expect(toolbar.hidden).toBe(true);
    expect(clearAll.disabled).toBe(true);
  });

  it("activates a focused row with Enter", () => {
    const { root, onOpen } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const row = root.querySelector<HTMLElement>(".sidebar-row")!;

    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onOpen).toHaveBeenCalledWith("/a/plan.md");
  });

  it("reflects the browse mode and switches on demand", () => {
    const { root, onModeChange } = mount(state({ browseMode: "recent" }));
    const all = root.querySelector<HTMLButtonElement>(".sidebar-mode[data-mode='all']")!;
    const recent = root.querySelector<HTMLButtonElement>(
      ".sidebar-mode[data-mode='recent']",
    )!;

    expect(recent.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");

    all.click();
    expect(onModeChange).toHaveBeenCalledWith("all");
  });

  it("renders the inventory in All Documents with open markers", () => {
    const { root } = mount(
      state({
        browseMode: "all",
        inventory: [entry("/a/one.md", NOW), entry("/a/two.md", NOW - 1)],
        openPaths: new Set(["/a/two.md"]),
      }),
    );

    const rows = [...root.querySelectorAll<HTMLElement>(".inbox-row")];
    expect(rows.map((row) => row.dataset.path)).toEqual(["/a/one.md", "/a/two.md"]);
    expect(rows[1].classList.contains("open")).toBe(true);
  });

  it("renders only the visible window of a large inventory", () => {
    const inventory = Array.from({ length: 10_000 }, (_, index) =>
      entry(`/a/doc-${index}.md`, NOW - index),
    );
    const { root } = mount(state({ browseMode: "all", inventory }));

    expect(root.querySelectorAll(".inbox-row").length).toBe(22);
  });

  it("enables Clear only for a non-empty recent list", () => {
    const { root, onClear } = mount(
      state({ browseMode: "recent", recent: [entry("/a/new.md", NOW)] }),
    );
    const clear = root.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='clear']",
    )!;

    expect(clear.disabled).toBe(false);
    clear.click();
    expect(onClear).toHaveBeenCalledTimes(1);

    const { root: emptyRoot } = mount(state({ browseMode: "recent" }));
    expect(
      emptyRoot.querySelector<HTMLButtonElement>(
        ".sidebar-action[data-action='clear']",
      )!.disabled,
    ).toBe(true);
  });

  it("enables Undo only while a snapshot exists", () => {
    const { root, onUndo } = mount(state({ canUndo: true }));
    const undo = root.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='undo']",
    )!;

    expect(undo.disabled).toBe(false);
    undo.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("enables Summarize only when configured and recent changes exist", () => {
    const { root, onSummarize } = mount(
      state({
        browseMode: "recent",
        recent: [entry("/a/new.md", NOW)],
      }),
    );
    const summarize = root.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='summary']",
    )!;

    expect(summarize.disabled).toBe(false);
    summarize.click();
    expect(onSummarize).toHaveBeenCalledTimes(1);

    const { root: unconfigured } = mount(
      state({
        browseMode: "recent",
        recent: [entry("/a/new.md", NOW)],
        summary: {
          ready: false,
          provider: null,
          model: null,
          problem: "Add a [summary] section",
          configPath: "/c.toml",
        },
      }),
    );
    const disabled = unconfigured.querySelector<HTMLButtonElement>(
      ".sidebar-action[data-action='summary']",
    )!;
    expect(disabled.disabled).toBe(true);
    expect(disabled.title).toContain("[summary]");

    const { root: busy } = mount(
      state({
        browseMode: "recent",
        recent: [entry("/a/new.md", NOW)],
        summaryBusy: true,
      }),
    );
    expect(
      busy.querySelector<HTMLButtonElement>(
        ".sidebar-action[data-action='summary']",
      )!.disabled,
    ).toBe(true);
  });

  it("explains an empty recent list and offers the full inventory", () => {
    const { root, onModeChange } = mount(state({ browseMode: "recent" }));

    expect(root.querySelector(".sidebar-browse-empty")?.textContent).toContain(
      "No changes since launch",
    );
    (root.querySelector(".sidebar-inline-action") as HTMLButtonElement).click();
    expect(onModeChange).toHaveBeenCalledWith("all");
  });

  it("toggles a section without rebuilding the other", () => {
    const { root, onToggleSection } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const header = root.querySelector<HTMLButtonElement>(
      ".sidebar-section[data-section='open'] .sidebar-section-header",
    )!;

    header.click();
    expect(onToggleSection).toHaveBeenCalledWith("open", true);
  });

  it("hides only the browse section", () => {
    const { root, panel } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const browse = root.querySelector<HTMLElement>(
      ".sidebar-section[data-section='browse']",
    )!;

    panel.setBrowseVisible(false);
    expect(browse.hidden).toBe(true);
    expect(
      root.querySelector(".sidebar-section[data-section='open']")?.hasAttribute("hidden"),
    ).toBe(false);
  });

  it("updates the status line without replacing open rows", () => {
    const { root, panel } = mount(
      state({ openRows: [openRow("/a/plan.md")] }),
    );
    const row = root.querySelector(".sidebar-row");

    panel.setProgress({ path: "/topdata/shop/_ai", directories: 42, files: 7 });

    expect(root.querySelector(".sidebar-row")).toBe(row);
    expect(root.querySelector(".inbox-loading")?.textContent).toContain(
      "/topdata/shop/_ai",
    );
  });

  it("shows a config error and a setup hint", () => {
    const { root } = mount(
      state({
        status: {
          configPath: "/home/u/.config/docdeck/config.toml",
          configFound: false,
          error: null,
          warnings: [],
          truncated: false,
          loading: false,
          progress: null,
          lastReload: null,
        },
      }),
    );

    expect(root.querySelector(".inbox-hint")?.textContent).toContain(
      "/home/u/.config/docdeck/config.toml",
    );
  });

  it("releases listeners on destroy", () => {
    const { panel } = mount();
    expect(() => panel.destroy()).not.toThrow();
  });

  it("renders the last reload outcome near the config status", () => {
    const { root } = mount(
      state({
        status: {
          ...state().status,
          lastReload: {
            at: NOW - 5_000,
            ok: true,
            error: null,
            warnings: [],
            truncated: false,
          },
        },
      }),
    );

    expect(root.querySelector(".inbox-reload")?.textContent).toContain(
      "Configuration reloaded",
    );
  });

  it("renders a failed reload with its error", () => {
    const { root } = mount(
      state({
        status: {
          ...state().status,
          lastReload: {
            at: NOW,
            ok: false,
            error: "expected value at line 1",
            warnings: [],
            truncated: false,
          },
        },
      }),
    );

    expect(root.querySelector(".inbox-reload")?.textContent).toContain(
      "Last reload failed: expected value at line 1",
    );
  });

  it("emits filter changes and clears with Escape", () => {
    const { root, onFilterChange } = mount();
    const input = root.querySelector<HTMLInputElement>("#sidebar-filter-input");
    expect(input).not.toBeNull();

    input!.value = "plan";
    input!.dispatchEvent(new Event("input"));
    expect(onFilterChange).toHaveBeenLastCalledWith("plan");

    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onFilterChange).toHaveBeenLastCalledWith("");
    expect(input!.value).toBe("");
  });

  it("shows the filtered empty state with a clear action", () => {
    const { root, onFilterChange } = mount(
      state({ filterTerm: "nothing", inventory: [], recent: [] }),
    );

    const empty = root.querySelector(".sidebar-browse-empty");
    expect(empty?.textContent).toContain("No documents match “nothing”");

    root.querySelector<HTMLButtonElement>(".sidebar-browse-empty .sidebar-inline-action")!.click();

    expect(onFilterChange).toHaveBeenLastCalledWith("");
  });

  it("keeps the filter input value in sync with state", () => {
    const { root } = mount(state({ filterTerm: "alpha" }));
    const input = root.querySelector<HTMLInputElement>("#sidebar-filter-input");
    expect(input?.value).toBe("alpha");
  });
});
