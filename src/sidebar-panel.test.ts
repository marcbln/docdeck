import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxEntry } from "./inbox-model";
import type { OpenRow } from "./sidebar-model";
import { SidebarPanel, type SidebarViewState } from "./sidebar-panel";
import { addDocument, emptyCollection } from "./bookmarks-model";
import { buildBookmarkView } from "./bookmarks-view";
import type { SectionAnchor } from "./bookmarks-model";
import { addSection } from "./bookmarks-model";

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
    inventoryHidden: false,
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
    configHintPath: null,
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
    bookmarks: {
      rows: [],
      documents: [],
      documentCount: 0,
      sectionCount: 0,
      totalCount: 0,
    },
    bookmarkedPaths: new Set(),
    bookmarkNotificationsOnly: false,
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
  onDismiss: ReturnType<typeof vi.fn>;
  onModeChange: ReturnType<typeof vi.fn>;
  onFilterChange: ReturnType<typeof vi.fn>;
  onToggleSection: ReturnType<typeof vi.fn>;
  onToggleDocumentBookmark: ReturnType<typeof vi.fn>;
  onSectionActivate: ReturnType<typeof vi.fn>;
  onSectionRemove: ReturnType<typeof vi.fn>;
  onSectionReanchor: ReturnType<typeof vi.fn>;
  onBookmarkNotificationsChange: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = '<aside id="sidebar"></aside>';
  const root = document.getElementById("sidebar") as HTMLElement;
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onCloseAll = vi.fn();
  const onClear = vi.fn();
  const onUndo = vi.fn();
  const onSummarize = vi.fn();
  const onDismiss = vi.fn();
  const onModeChange = vi.fn();
  const onFilterChange = vi.fn();
  const onToggleSection = vi.fn();
  const onToggleDocumentBookmark = vi.fn();
  const onSectionActivate = vi.fn();
  const onSectionRemove = vi.fn();
  const onSectionReanchor = vi.fn();
  const onBookmarkNotificationsChange = vi.fn();
  const panel = new SidebarPanel(root, {
    onOpen,
    onClose,
    onDismiss,
    onCloseAll,
    onClear,
    onUndo,
    onSummarize,
    onModeChange,
    onFilterChange,
    onToggleDocumentBookmark,
    onSectionActivate,
    onSectionRemove,
    onSectionReanchor,
    onBookmarkNotificationsChange,
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
    onDismiss,
    onCloseAll,
    onClear,
    onUndo,
    onSummarize,
    onModeChange,
    onFilterChange,
    onToggleSection,
    onToggleDocumentBookmark,
    onSectionActivate,
    onSectionRemove,
    onSectionReanchor,
    onBookmarkNotificationsChange,
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
    expect(row.querySelector(".sidebar-row-main")?.getAttribute("aria-current")).toBe("true");
    expect(row.querySelector(".tab-dot")).not.toBeNull();
    expect(row.querySelector(".sidebar-row-close")).not.toBeNull();
    expect(row.querySelector(".sidebar-row-main")).not.toBeNull();
    expect(row.querySelector(".sidebar-row-bookmark")).not.toBeNull();
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

  it("toggles a browse row's bookmark without opening it", () => {
    const { root, onToggleDocumentBookmark, onOpen } = mount(
      state({
        browseMode: "all",
        inventory: [entry("/a/one.md", NOW)],
      }),
    );
    const star = root.querySelector<HTMLButtonElement>(".inbox-bookmark")!;
    expect(star.getAttribute("aria-pressed")).toBe("false");

    star.click();

    expect(onToggleDocumentBookmark).toHaveBeenCalledWith("/a/one.md");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("dismisses a browse row on middle-click without opening it", () => {
    const { root, onDismiss, onOpen } = mount(
      state({ browseMode: "recent", recent: [entry("/a/new.md", NOW)] }),
    );
    const row = root.querySelector<HTMLElement>(".inbox-row")!;

    row.dispatchEvent(
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );

    expect(onDismiss).toHaveBeenCalledWith("/a/new.md", "recent");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("reports the visible browse mode when dismissing", () => {
    const { root, onDismiss } = mount(
      state({
        browseMode: "all",
        inventory: [entry("/a/one.md", NOW)],
      }),
    );
    const row = root.querySelector<HTMLElement>(".inbox-row")!;

    row.dispatchEvent(
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );

    expect(onDismiss).toHaveBeenCalledWith("/a/one.md", "all");
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
    const main = root.querySelector<HTMLButtonElement>(".sidebar-row-main")!;

    main.click();

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

  it("keeps scan and watch chatter out of the sidebar", () => {
    const { root } = mount(
      state({
        configHintPath: null,
        recent: [entry("/a/new.md", NOW)],
      }),
    );

    const text = root.textContent ?? "";
    expect(text).not.toContain("Scanning");
    expect(text).not.toContain("Configuration reloaded");
    expect(text).not.toContain("warning");
    expect(text).not.toContain("truncated");
    expect(text).not.toContain("Last reload failed");
  });

  it("shows the setup hint with the path and example TOML", () => {
    const { root } = mount(
      state({ configHintPath: "/home/u/.config/docdeck/config.toml" }),
    );

    const hint = root.querySelector(".inbox-hint");
    expect(hint?.textContent).toContain(
      "/home/u/.config/docdeck/config.toml",
    );
    expect(hint?.querySelector("code")?.textContent).toContain("watch =");
  });

  it("suppresses the hint when configHintPath is null", () => {
    const { root } = mount(state({ configHintPath: null }));
    expect(root.querySelector(".inbox-hint")).toBeNull();
  });

  it("renders the Open/Browse split separator", () => {
    const { root } = mount();
    const split = root.querySelector<HTMLElement>(".sidebar-split")!;

    expect(split).not.toBeNull();
    expect(split.getAttribute("role")).toBe("separator");
    expect(split.getAttribute("aria-orientation")).toBe("horizontal");
    expect(split.getAttribute("aria-label")).toContain("Open documents");
    expect(split.getAttribute("aria-valuemin")).toBe("15");
    expect(split.getAttribute("aria-valuemax")).toBe("85");
    expect(split.getAttribute("aria-valuenow")).toBe("50");
  });

  it("makes the split inert when a section is collapsed", () => {
    const { root } = mount(state({ openCollapsed: true }));
    const split = root.querySelector<HTMLElement>(".sidebar-split")!;

    expect(split.hidden).toBe(true);
    expect(split.tabIndex).toBe(-1);
    expect(split.getAttribute("aria-disabled")).toBe("true");
  });

  it("applies split size updates", () => {
    const { root, panel } = mount();
    panel.setSidebarSplit(35);

    const split = root.querySelector<HTMLElement>(".sidebar-split")!;
    expect(split.getAttribute("aria-valuenow")).toBe("35");
  });

  it("releases listeners on destroy", () => {
    const { panel } = mount();
    expect(() => panel.destroy()).not.toThrow();
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

  it("reports the bookmark mode and marker count", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a/plan.md", 1);
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry("/a/plan.md", NOW)],
    });
    const { root, onModeChange } = mount(
      state({
        browseMode: "bookmarks",
        bookmarks,
        bookmarkedPaths: new Set(["/a/plan.md"]),
      }),
    );

    const mode = root.querySelector<HTMLButtonElement>(
      ".sidebar-mode[data-mode='bookmarks']",
    )!;
    expect(mode.getAttribute("aria-pressed")).toBe("true");
    expect(mode.getAttribute("aria-label")).toBe("Bookmarks, 1 bookmark");
    expect(mode.querySelector(".sidebar-mode-count")?.textContent).toBe("1");

    const all = root.querySelector<HTMLButtonElement>(
      ".sidebar-mode[data-mode='all']",
    )!;
    all.click();
    expect(onModeChange).toHaveBeenCalledWith("all");
  });

  it("renders bookmark document rows and toggles their star without opening", () => {
    const collection = emptyCollection();
    addDocument(collection, "/home/u/devel/docdeck/_ai/plan.md", 1);
    const path = "/home/u/devel/docdeck/_ai/plan.md";
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry(path, NOW)],
    });
    const { root, onOpen, onToggleDocumentBookmark } = mount(
      state({
        browseMode: "bookmarks",
        bookmarks,
        bookmarkedPaths: new Set([path]),
        activePath: null,
      }),
    );

    const row = root.querySelector<HTMLElement>(".inbox-row")!;
    expect(row.classList.contains("bookmark-document")).toBe(true);
    const star = row.querySelector<HTMLButtonElement>(".inbox-bookmark")!;
    expect(star.getAttribute("aria-pressed")).toBe("true");

    star.click();
    expect(onToggleDocumentBookmark).toHaveBeenCalledWith(path);
    expect(onOpen).not.toHaveBeenCalled();

    (row.querySelector(".inbox-row-main") as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith(path);
  });

  it("shows the empty bookmarks state with a recovery action", () => {
    const { root, onModeChange } = mount(
      state({ browseMode: "bookmarks", bookmarks: buildBookmarkView({
        collection: emptyCollection(),
        inventory: [],
      }) }),
    );

    const empty = root.querySelector(".sidebar-bookmarks-empty");
    expect(empty?.textContent).toContain("No bookmarks yet");
    expect(empty?.textContent).toContain("Ctrl/Cmd+D");
    (empty?.querySelector(".sidebar-inline-action") as HTMLButtonElement).click();
    expect(onModeChange).toHaveBeenCalledWith("all");
  });

  it("shows the filtered-empty bookmarks state with Clear filter", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a/plan.md", 1);
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry("/a/plan.md", NOW)],
      filterTerm: "nothing",
    });
    const { root, onFilterChange } = mount(
      state({
        browseMode: "bookmarks",
        filterTerm: "nothing",
        bookmarks,
        bookmarkedPaths: new Set(["/a/plan.md"]),
      }),
    );

    const empty = root.querySelector(".sidebar-bookmarks-empty");
    expect(empty?.textContent).toContain("No bookmarks match “nothing”");
    (empty?.querySelector(".sidebar-inline-action") as HTMLButtonElement).click();
    expect(onFilterChange).toHaveBeenLastCalledWith("");
  });

  it("hides Recent-only actions and the popout in bookmarks mode", () => {
    const { root } = mount(state({ browseMode: "bookmarks" }));

    for (const action of ["clear", "undo", "summary", "popout"]) {
      expect(
        root.querySelector<HTMLButtonElement>(
          `.sidebar-action[data-action='${action}']`,
        )?.hidden,
      ).toBe(true);
    }
  });

  it("shows the bookmark notification setting and its effect note", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a/plan.md", 1);
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry("/a/plan.md", NOW)],
    });
    const { root, onBookmarkNotificationsChange } = mount(
      state({
        browseMode: "bookmarks",
        bookmarks,
        bookmarkedPaths: new Set(["/a/plan.md"]),
        bookmarkNotificationsOnly: true,
      }),
    );

    const settings = root.querySelector<HTMLElement>(
      ".sidebar-bookmarks-settings",
    )!;
    expect(settings.hidden).toBe(false);
    const checkbox = settings.querySelector<HTMLInputElement>(
      ".sidebar-bookmark-notifications",
    )!;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.getAttribute("aria-describedby")).toBe(
      "bookmark-notifications-note",
    );
    expect(settings.textContent).toContain("Notify only for bookmarked documents");
    expect(settings.textContent).toContain("tray dot");

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(onBookmarkNotificationsChange).toHaveBeenCalledWith(false);
  });

  it("explains bookmark-only notifications when no bookmarks exist", () => {
    const { root } = mount(
      state({
        browseMode: "bookmarks",
        bookmarkNotificationsOnly: true,
        bookmarks: buildBookmarkView({
          collection: emptyCollection(),
          inventory: [],
        }),
      }),
    );

    expect(
      root.querySelector(".sidebar-bookmark-setting-note")?.textContent,
    ).toContain("No bookmarks yet");
  });

  it("renders section rows with statuses, indentation and actions", () => {
    const anchor: SectionAnchor = {
      text: "Risks",
      depth: 3,
      before: ["Scope"],
      after: ["Questions"],
      ordinal: 0,
      order: 1,
    };
    const collection = emptyCollection();
    addDocument(collection, "/a/plan.md", 1);
    addSection(collection, "/a/plan.md", anchor, 1, "s1");
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry("/a/plan.md", NOW)],
      resolutions: new Map([
        ["s1", { kind: "stale" as const, reason: "missing" as const }],
      ]),
    });
    const { root, onSectionActivate, onSectionRemove, onSectionReanchor, onOpen } =
      mount(
        state({
          browseMode: "bookmarks",
          bookmarks,
          bookmarkedPaths: new Set(["/a/plan.md"]),
        }),
      );

    const row = root.querySelector<HTMLElement>(".bookmark-section-row")!;
    expect(row.style.getPropertyValue("--bookmark-depth")).toBe("3");
    expect(row.querySelector(".bookmark-section-status")?.textContent).toBe(
      "Not found",
    );

    const open = row.querySelector<HTMLButtonElement>(".bookmark-section-open")!;
    open.click();
    expect(onSectionActivate).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    row.querySelector<HTMLButtonElement>(
      "[data-bookmark-action='reanchor']",
    )!.click();
    expect(onSectionReanchor).toHaveBeenCalledWith("s1");
    expect(onSectionActivate).toHaveBeenCalledTimes(1);

    row.querySelector<HTMLButtonElement>(
      "[data-bookmark-action='remove']",
    )!.click();
    expect(onSectionRemove).toHaveBeenCalledWith("s1");
  });

  it("uses text badges for unverified, moved, shared and unavailable sections", () => {
    const anchor: SectionAnchor = {
      text: "Risks",
      depth: 2,
      before: [],
      after: [],
      ordinal: 0,
      order: 1,
    };

    function statusFor(
      resolutions: Parameters<typeof buildBookmarkView>[0]["resolutions"],
      inventory: InboxEntry[],
    ): string {
      const collection = emptyCollection();
      addSection(collection, "/a/plan.md", anchor, 1, "s1");
      const bookmarks = buildBookmarkView({
        collection,
        inventory,
        resolutions,
      });
      const { root } = mount(
        state({ browseMode: "bookmarks", bookmarks }),
      );
      return (
        root.querySelector(".bookmark-section-status")?.textContent ?? ""
      );
    }

    expect(statusFor(undefined, [entry("/a/plan.md", NOW)])).toBe("Not checked");
    expect(
      statusFor(
        new Map([
          [
            "s1",
            {
              kind: "resolved",
              index: 1,
              slug: "risks",
              text: "Risks",
              depth: 2,
              via: "context",
            },
          ],
        ]),
        [entry("/a/plan.md", NOW)],
      ),
    ).toBe("Moved");

    const sharedCollection = emptyCollection();
    addSection(sharedCollection, "/a/plan.md", anchor, 1, "s1");
    addSection(
      sharedCollection,
      "/a/plan.md",
      { ...anchor, text: "Other" },
      1,
      "s2",
    );
    const shared = buildBookmarkView({
      collection: sharedCollection,
      inventory: [entry("/a/plan.md", NOW)],
      resolutions: new Map([
        [
          "s1",
          {
            kind: "resolved",
            index: 1,
            slug: "risks",
            text: "Risks",
            depth: 2,
            via: "text" as const,
          },
        ],
        [
          "s2",
          {
            kind: "resolved",
            index: 1,
            slug: "risks",
            text: "Risks",
            depth: 2,
            via: "text" as const,
          },
        ],
      ]),
    });
    const { root: sharedRoot } = mount(
      state({ browseMode: "bookmarks", bookmarks: shared }),
    );
    expect(
      sharedRoot.querySelector(".bookmark-section-status")?.textContent,
    ).toBe("Shared");

    expect(statusFor(undefined, [])).toBe("Unavailable");
  });
  it("shows the same unread marker on bookmark document rows", () => {
    const collection = emptyCollection();
    addDocument(collection, "/a/plan.md", 1);
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [entry("/a/plan.md", NOW, { unread: true })],
    });
    const { root } = mount(
      state({
        browseMode: "bookmarks",
        bookmarks,
        bookmarkedPaths: new Set(["/a/plan.md"]),
      }),
    );

    const row = root.querySelector<HTMLElement>(".inbox-row")!;
    expect(row.classList.contains("unread")).toBe(true);
    expect(row.querySelector(".inbox-dot")).not.toBeNull();
    expect(row.querySelector(".inbox-filename")?.textContent).toBe("plan.md");
  });

  it("suppresses the unread marker for an unavailable bookmark", () => {
    const collection = emptyCollection();
    addDocument(collection, "/gone.md", 1);
    const bookmarks = buildBookmarkView({
      collection,
      inventory: [
        entry("/gone.md", NOW, { unread: true, deleted: true }),
      ],
    });
    const { root } = mount(
      state({
        browseMode: "bookmarks",
        bookmarks,
        bookmarkedPaths: new Set(["/gone.md"]),
      }),
    );

    const row = root.querySelector<HTMLElement>(".inbox-row")!;
    expect(row.classList.contains("unread")).toBe(false);
    expect(row.classList.contains("unavailable")).toBe(true);
    expect(row.querySelector(".bookmark-unavailable-badge")?.textContent).toBe(
      "Unavailable",
    );
  });
});