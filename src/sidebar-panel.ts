import { InboxBrowser } from "./browse-modal";
import type {
  BookmarkDocumentView,
  BookmarkRow,
  BookmarkSectionView,
  BookmarkView,
} from "./bookmarks-view";
import type {
  ChangedRow,
  ChangedViewState,
} from "./changed-ai-model";
import {
  bindChangedRow,
  createChangedRow,
  createRepositoryErrorBanner,
  createScopeBanner,
  createStatePanel,
} from "./changed-ai-rows";
import type { InboxEntry } from "./inbox-model";
import type { SummaryStatus } from "./summary-model";
import { bindInboxRow, createInboxRow } from "./sidebar-rows";
import type { BrowseMode, BrowseView, OpenRow } from "./sidebar-model";
import { VirtualList } from "./virtual-list";

/** Everything the sidebar needs for one paint. */
export interface SidebarViewState {
  openRows: OpenRow[];
  /** `"changed"` is transient and never persisted. */
  browseMode: BrowseView;
  inventory: InboxEntry[];
  recent: InboxEntry[];
  openPaths: ReadonlySet<string>;
  activePath: string | null;
  /** Path playing the brief active-write acknowledgement pulse, if any. */
  activeUpdatePath: string | null;
  /** Actionable setup hint path, or null when no hint should render. */
  configHintPath: string | null;
  openCollapsed: boolean;
  browseCollapsed: boolean;
  canUndo: boolean;
  /** Session-only filter term; empty means the full list. */
  filterTerm: string;
  /** Whether the summary agent is configured and usable. */
  summary: SummaryStatus;
  /** True while a summary request is in flight. */
  summaryBusy: boolean;
  /** Composed Bookmarks rows for the current filter. */
  bookmarks: BookmarkView;
  /** Every document marker, independent of the active filter. */
  bookmarkedPaths: ReadonlySet<string>;
  /** Whether popups are limited to bookmarked documents. */
  bookmarkNotificationsOnly: boolean;
  /** The changed-view snapshot; its `rows` are unfiltered. */
  changed: ChangedViewState;
  /** Rows after the shared filter, in model order. */
  changedRows: ChangedRow[];
  now: number;
}

export interface SidebarPanelOptions {
  onOpen(path: string): void;
  onClose(path: string): void;
  /** Dismisses one row from the currently visible browse list. */
  onDismiss(path: string, mode: BrowseMode): void;
  /** Closes every document in the Open Documents pane. */
  onCloseAll(): void;
  onClear(): void;
  onUndo(): void;
  onSummarize(): void;
  onModeChange(mode: BrowseView): void;
  /** Called whenever the browse filter changes (including clear/Escape). */
  onFilterChange(term: string): void;
  /** Opens or focuses one changed document; never bulk-opens. */
  onChangedActivate(row: ChangedRow): void;
  /** Re-reads git for the changed view. */
  onRefreshChanged(): void;
  /** Returns a scoped changed view to every watched repository. */
  onShowAllChanged(): void;
  /** Toggles a document bookmark without opening or focusing it. */
  onToggleDocumentBookmark(path: string): void;
  /** Opens/focuses a document and scrolls to a section bookmark. */
  onSectionActivate(section: BookmarkSectionView): void;
  onSectionRemove(id: string): void;
  onSectionReanchor(id: string): void;
  /** Persists the bookmark-only notification preference. */
  onBookmarkNotificationsChange(enabled: boolean): void;
  onToggleSection(section: "open" | "browse", collapsed: boolean): void;
  onContextMenu(
    path: string,
    anchor: { x: number; y: number } | { rect: DOMRect },
    target: HTMLElement,
  ): void;
  /** Injectable clock so relative times are deterministic in tests. */
  now?: () => number;
  /** Test seam for the inline list; production measures the scroll host. */
  viewportHeight?: number;
  /** Test seam for the pop-out inventory. */
  modalViewportHeight?: number;
}

/** The left sidebar: Open Documents stacked above the browse list. */
export class SidebarPanel {
  private state: SidebarViewState;

  private readonly openSection: HTMLElement;
  private readonly openHeader: HTMLButtonElement;
  private readonly openCount: HTMLSpanElement;
  private readonly openBody: HTMLDivElement;
  private readonly openToolbar: HTMLDivElement;
  private readonly clearAllBtn: HTMLButtonElement;
  private readonly openList: HTMLUListElement;

  private readonly browseSection: HTMLElement;
  private readonly browseHeader: HTMLButtonElement;
  private readonly browseCount: HTMLSpanElement;
  private readonly browseBody: HTMLDivElement;
  private readonly modeAll: HTMLButtonElement;
  private readonly modeRecent: HTMLButtonElement;
  private readonly modeBookmarks: HTMLButtonElement;
  private readonly modeChanged: HTMLButtonElement;
  private readonly modeBookmarksCount: HTMLSpanElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly summaryBtn: HTMLButtonElement;
  private readonly popoutBtn: HTMLButtonElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterClear: HTMLButtonElement;
  private readonly filterCount: HTMLSpanElement;
  private readonly hintHost: HTMLDivElement;
  private readonly browseScroll: HTMLDivElement;
  private readonly browseList: HTMLUListElement;
  private readonly browseEmpty: HTMLParagraphElement;
  private readonly bookmarksScroll: HTMLDivElement;
  private readonly bookmarksList: HTMLUListElement;
  private readonly bookmarksEmpty: HTMLParagraphElement;
  private readonly bookmarksSettings: HTMLDivElement;
  private readonly bookmarkNotifications: HTMLInputElement;
  private readonly bookmarkNotificationsNote: HTMLParagraphElement;

  private readonly changedToolbar: HTMLDivElement;
  private readonly changedRefreshBtn: HTMLButtonElement;
  private readonly changedScopeHost: HTMLDivElement;
  private readonly changedErrorHost: HTMLDivElement;
  private readonly changedStateHost: HTMLDivElement;
  private readonly changedScroll: HTMLDivElement;
  private readonly changedList: HTMLUListElement;
  private readonly changedEmpty: HTMLParagraphElement;

  private readonly splitHost: HTMLDivElement;
  private splitPercent = 50;
  private browseVisible = true;

  private readonly virtual: VirtualList<InboxEntry>;
  private readonly bookmarksVirtual: VirtualList<BookmarkRow>;
  private readonly changedVirtual: VirtualList<ChangedRow>;
  private browser: InboxBrowser | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: SidebarPanelOptions,
  ) {
    this.state = {
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
        ready: false,
        provider: null,
        model: null,
        problem: "Checking summary configuration…",
        configPath: "",
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
      changed: {
        status: "idle",
        rows: [],
        repositories: [],
        scope: null,
        scopeError: null,
        gitAvailable: true,
        discoveryTruncated: false,
        watchedRoots: 0,
        aiFolders: 0,
        loadedAt: null,
      },
      changedRows: [],
      now: Date.now(),
    };

    this.openSection = document.createElement("section");
    this.openSection.className = "sidebar-section sidebar-section--open";
    this.openSection.dataset.section = "open";

    this.openHeader = document.createElement("button");
    this.openHeader.className = "sidebar-section-header";
    this.openHeader.type = "button";
    this.openHeader.setAttribute("aria-expanded", "true");
    const openLabel = document.createElement("span");
    openLabel.className = "sidebar-section-title";
    openLabel.textContent = "Open documents";
    this.openCount = document.createElement("span");
    this.openCount.className = "sidebar-section-count";
    this.openHeader.append(openLabel, this.openCount);

    this.openBody = document.createElement("div");
    this.openBody.className = "sidebar-section-body";
    this.openToolbar = document.createElement("div");
    this.openToolbar.className = "sidebar-open-toolbar";
    this.clearAllBtn = this.actionButton(
      "Clear all",
      "Close all open documents",
      "clear-all",
    );
    this.openToolbar.append(this.clearAllBtn);
    this.openList = document.createElement("ul");
    this.openList.className = "sidebar-open-list";
    this.openList.setAttribute("role", "list");
    this.openBody.append(this.openToolbar, this.openList);
    this.openSection.append(this.openHeader, this.openBody);

    this.browseSection = document.createElement("section");
    this.browseSection.className = "sidebar-section sidebar-section--browse";
    this.browseSection.dataset.section = "browse";

    this.browseHeader = document.createElement("button");
    this.browseHeader.className = "sidebar-section-header";
    this.browseHeader.type = "button";
    this.browseHeader.setAttribute("aria-expanded", "true");
    const browseLabel = document.createElement("span");
    browseLabel.className = "sidebar-section-title";
    browseLabel.textContent = "Browse";
    this.browseCount = document.createElement("span");
    this.browseCount.className = "sidebar-section-count";
    this.browseHeader.append(browseLabel, this.browseCount);

    this.browseBody = document.createElement("div");
    this.browseBody.className = "sidebar-section-body sidebar-section-body--browse";

    const toolbar = document.createElement("div");
    toolbar.className = "sidebar-browse-toolbar";

    const modes = document.createElement("div");
    modes.className = "sidebar-mode-switch";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Browse mode");
    this.modeAll = this.modeButton("all", "All");
    this.modeRecent = this.modeButton("recent", "Recently changed");
    this.modeBookmarks = this.modeButton("bookmarks", "Bookmarks");
    this.modeBookmarksCount = document.createElement("span");
    this.modeBookmarksCount.className = "sidebar-mode-count";
    this.modeBookmarks.append(this.modeBookmarksCount);
    this.modeChanged = this.modeButton("changed", "Changed `_ai`");
    this.modeChanged.setAttribute("aria-label", "Changed `_ai` documents");
    modes.append(
      this.modeAll,
      this.modeRecent,
      this.modeBookmarks,
      this.modeChanged,
    );

    const actions = document.createElement("div");
    actions.className = "sidebar-browse-actions";
    this.clearBtn = this.actionButton("Clear", "Clear recently changed", "clear");
    this.undoBtn = this.actionButton("Undo", "Undo the last clear", "undo");
    this.summaryBtn = this.actionButton(
      "✨",
      "Summarize recent changes",
      "summary",
    );
    this.summaryBtn.setAttribute(
      "aria-label",
      "Summarize recently changed documents",
    );
    this.popoutBtn = this.actionButton(
      "⤢",
      "Open the full-height inventory",
      "popout",
    );
    this.popoutBtn.setAttribute("aria-label", "Open the full-height inventory");
    actions.append(this.clearBtn, this.undoBtn, this.summaryBtn, this.popoutBtn);
    toolbar.append(modes, actions);

    const filterRow = document.createElement("div");
    filterRow.className = "sidebar-filter";
    const filterLabel = document.createElement("label");
    filterLabel.className = "sidebar-filter-label";
    filterLabel.textContent = "Filter";
    filterLabel.htmlFor = "sidebar-filter-input";
    this.filterInput = document.createElement("input");
    this.filterInput.id = "sidebar-filter-input";
    this.filterInput.className = "sidebar-filter-input";
    this.filterInput.type = "search";
    this.filterInput.placeholder = "Filter by name, folder or project";
    this.filterInput.setAttribute("aria-label", "Filter documents");
    this.filterClear = document.createElement("button");
    this.filterClear.type = "button";
    this.filterClear.className = "sidebar-filter-clear";
    this.filterClear.textContent = "×";
    this.filterClear.setAttribute("aria-label", "Clear the document filter");
    this.filterClear.title = "Clear the filter";
    this.filterClear.hidden = true;
    this.filterCount = document.createElement("span");
    this.filterCount.id = "sidebar-filter-count";
    this.filterCount.className = "visually-hidden";
    filterRow.append(
      filterLabel,
      this.filterInput,
      this.filterClear,
      this.filterCount,
    );

    this.hintHost = document.createElement("div");
    this.hintHost.className = "sidebar-hint-host";

    this.changedToolbar = document.createElement("div");
    this.changedToolbar.className = "sidebar-changed-toolbar";
    this.changedRefreshBtn = this.actionButton(
      "⟳ Refresh",
      "Refresh changed `_ai` documents",
      "refresh-changed",
    );
    this.changedRefreshBtn.setAttribute(
      "aria-label",
      "Refresh changed `_ai` documents",
    );
    this.changedToolbar.append(this.changedRefreshBtn);
    this.changedToolbar.hidden = true;

    this.changedScopeHost = document.createElement("div");
    this.changedScopeHost.className = "sidebar-changed-scope-host";
    this.changedErrorHost = document.createElement("div");
    this.changedErrorHost.className = "sidebar-changed-error-host";
    this.changedStateHost = document.createElement("div");
    this.changedStateHost.className = "sidebar-changed-state-host";

    this.bookmarksSettings = document.createElement("div");
    this.bookmarksSettings.className = "sidebar-bookmarks-settings";
    const settingRow = document.createElement("label");
    settingRow.className = "sidebar-bookmark-setting";
    this.bookmarkNotifications = document.createElement("input");
    this.bookmarkNotifications.type = "checkbox";
    this.bookmarkNotifications.className = "sidebar-bookmark-notifications";
    this.bookmarkNotifications.id = "bookmark-notifications-only";
    const settingLabel = document.createElement("span");
    settingLabel.textContent = "Notify only for bookmarked documents";
    settingRow.append(this.bookmarkNotifications, settingLabel);
    this.bookmarkNotificationsNote = document.createElement("p");
    this.bookmarkNotificationsNote.className = "sidebar-bookmark-setting-note";
    this.bookmarkNotificationsNote.id = "bookmark-notifications-note";
    this.bookmarkNotifications.setAttribute(
      "aria-describedby",
      "bookmark-notifications-note",
    );
    this.bookmarksSettings.append(settingRow, this.bookmarkNotificationsNote);

    this.browseScroll = document.createElement("div");
    this.browseScroll.className = "sidebar-browse-scroll";
    this.browseList = document.createElement("ul");
    this.browseList.className = "inbox-list inbox-list--virtual";
    this.browseEmpty = document.createElement("p");
    this.browseEmpty.className = "inbox-empty sidebar-browse-empty";

    this.bookmarksScroll = document.createElement("div");
    this.bookmarksScroll.className = "sidebar-bookmarks-scroll";
    this.bookmarksList = document.createElement("ul");
    this.bookmarksList.className =
      "inbox-list inbox-list--virtual bookmark-list";
    this.bookmarksEmpty = document.createElement("p");
    this.bookmarksEmpty.className = "inbox-empty sidebar-bookmarks-empty";

    this.browseScroll.append(this.browseList);
    this.bookmarksScroll.append(this.bookmarksList);

    this.changedScroll = document.createElement("div");
    this.changedScroll.className = "sidebar-changed-scroll";
    this.changedList = document.createElement("ul");
    this.changedList.className = "inbox-list inbox-list--virtual changed-list";
    this.changedList.setAttribute("role", "list");
    this.changedEmpty = document.createElement("p");
    this.changedEmpty.className = "inbox-empty sidebar-changed-empty";
    this.changedScroll.append(this.changedList);
    this.changedScroll.hidden = true;

    this.browseBody.append(
      toolbar,
      filterRow,
      this.changedToolbar,
      this.changedScopeHost,
      this.changedErrorHost,
      this.changedStateHost,
      this.bookmarksSettings,
      this.hintHost,
      this.browseScroll,
      this.browseEmpty,
      this.bookmarksScroll,
      this.bookmarksEmpty,
      this.changedScroll,
      this.changedEmpty,
    );

    this.browseSection.append(this.browseHeader, this.browseBody);

    this.splitHost = document.createElement("div");
    this.splitHost.className = "sidebar-split";
    this.splitHost.setAttribute("role", "separator");
    this.splitHost.setAttribute("aria-orientation", "horizontal");
    this.splitHost.setAttribute(
      "aria-label",
      "Resize the Open documents and Browse sections",
    );
    this.splitHost.setAttribute("aria-valuemin", "15");
    this.splitHost.setAttribute("aria-valuemax", "85");
    this.splitHost.setAttribute("aria-valuenow", "50");
    this.splitHost.tabIndex = 0;

    this.root.replaceChildren(
      this.openSection,
      this.splitHost,
      this.browseSection,
    );

    this.virtual = new VirtualList<InboxEntry>(this.browseList, this.browseScroll, {
      createRow: createInboxRow,
      bindRow: (row, entry) =>
        bindInboxRow(
          row,
          entry,
          this.state.openPaths,
          this.state.activePath,
          this.state.now,
          this.state.bookmarkedPaths.has(entry.path),
        ),
      onActivate: (entry) => this.options.onOpen(entry.path),
      viewportHeight: options.viewportHeight,
    });

    this.bookmarksVirtual = new VirtualList<BookmarkRow>(
      this.bookmarksList,
      this.bookmarksScroll,
      {
        createRow: () => document.createElement("li"),
        bindRow: (row, item) => this.bindBookmarkRow(row, item),
        rowSelector: ".inbox-row, .bookmark-section-row",
        activationSelector: ".inbox-row-main, .bookmark-section-open",
        viewportHeight: options.viewportHeight,
      },
    );

    this.changedVirtual = new VirtualList<ChangedRow>(
      this.changedList,
      this.changedScroll,
      {
        createRow: createChangedRow,
        bindRow: (row, item) =>
          bindChangedRow(row, item, this.state.now, (activated) =>
            this.options.onChangedActivate(activated),
          ),
        rowHeight: 56,
        rowSelector: ".changed-row",
        activationSelector: ".changed-row-main",
        viewportHeight: options.viewportHeight,
      },
    );

    this.bindEvents();
  }

  render(state: SidebarViewState): void {
    this.state = state;
    this.renderOpenSection();
    this.renderBrowseSection();
    this.renderSplit();
    this.browser?.setBookmarkedPaths(this.state.bookmarkedPaths);
  }

  /** The Open/Browse boundary, wired to a `LayoutResizer` by `main.ts`. */
  get splitHandle(): HTMLElement {
    return this.splitHost;
  }

  /** Applies the Open documents share of the sidebar's usable height. */
  setSidebarSplit(percent: number): void {
    this.splitPercent = Math.min(85, Math.max(15, percent));
    this.splitHost.setAttribute("aria-valuenow", String(this.splitPercent));
    this.applySplit();
  }

  /** Repaints after being shown or after a window resize. */
  refresh(): void {
    this.virtual.refresh();
    this.bookmarksVirtual.refresh();
    this.changedVirtual.refresh();
    this.browser?.refresh();
  }

  /** Shows or hides the browse section; Open Documents is never hidden. */
  setBrowseVisible(visible: boolean): void {
    this.browseVisible = visible;
    this.browseSection.hidden = !visible;
    this.renderSplit();
  }

  destroy(): void {
    this.virtual.destroy();
    this.bookmarksVirtual.destroy();
    this.changedVirtual.destroy();
    this.browser?.destroy();
  }

  private modeButton(mode: BrowseView, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar-mode";
    button.dataset.mode = mode;
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => this.options.onModeChange(mode));
    return button;
  }

  private actionButton(
    label: string,
    title: string,
    action: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar-action";
    button.dataset.action = action;
    button.textContent = label;
    button.title = title;
    return button;
  }

  private bindEvents(): void {
    this.openHeader.addEventListener("click", () => {
      this.options.onToggleSection("open", !this.state.openCollapsed);
    });
    this.browseHeader.addEventListener("click", () => {
      this.options.onToggleSection("browse", !this.state.browseCollapsed);
    });

    this.openList.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const close = target?.closest<HTMLElement>(".sidebar-row-close");
      const bookmark = target?.closest<HTMLElement>(".sidebar-row-bookmark");
      const row = target?.closest<HTMLElement>(".sidebar-row");
      const path = row?.dataset.path;
      if (!path) return;
      if (close) {
        event.stopPropagation();
        this.options.onClose(path);
        return;
      }
      if (bookmark) {
        event.stopPropagation();
        this.options.onToggleDocumentBookmark(path);
        return;
      }
      const control = target?.closest<HTMLElement>("button, a");
      if (control && !control.matches(".sidebar-row-main")) return;
      this.options.onOpen(path);
    });

    this.openList.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".sidebar-row",
      );
      const path = row?.dataset.path;
      if (!path) return;
      event.preventDefault();
      this.options.onClose(path);
    });

    this.openList.addEventListener("keydown", (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".sidebar-row",
      );
      const path = row?.dataset.path;
      if (!path) return;
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        this.options.onContextMenu(
          path,
          { rect: row.getBoundingClientRect() },
          row,
        );
      }
    });

    this.openList.addEventListener("contextmenu", (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".sidebar-row",
      );
      const path = row?.dataset.path;
      if (!path || !row) return;
      event.preventDefault();
      this.options.onContextMenu(
        path,
        { x: event.clientX, y: event.clientY },
        row,
      );
    });

    const browseContextMenu = (event: MouseEvent): void => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const index = row ? Number(row.dataset.index) : NaN;
      const item = Number.isInteger(index)
        ? this.browseItems()[index]
        : undefined;
      if (!row || item === undefined) return;
      event.preventDefault();
      this.options.onContextMenu(
        item.path,
        { x: event.clientX, y: event.clientY },
        row,
      );
    };
    this.browseList.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target?.closest(".inbox-bookmark")) return;
      const row = target.closest<HTMLElement>(".inbox-row");
      const index = row ? Number(row.dataset.index) : NaN;
      const item = Number.isInteger(index)
        ? this.browseItems()[index]
        : undefined;
      if (item !== undefined) {
        this.options.onToggleDocumentBookmark(item.path);
      }
    });

    this.browseList.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const index = row ? Number(row.dataset.index) : NaN;
      const item = Number.isInteger(index)
        ? this.browseItems()[index]
        : undefined;
      if (!row || item === undefined) return;
      event.preventDefault();
      this.options.onDismiss(
        item.path,
        this.state.browseMode === "recent" ? "recent" : "all",
      );
    });

    this.browseList.addEventListener("contextmenu", browseContextMenu);
    this.browseList.addEventListener("keydown", (event) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      ) {
        return;
      }
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const index = row ? Number(row.dataset.index) : NaN;
      const item = Number.isInteger(index)
        ? this.browseItems()[index]
        : undefined;
      if (!row || item === undefined) return;
      event.preventDefault();
      this.options.onContextMenu(
        item.path,
        { rect: row.getBoundingClientRect() },
        row,
      );
    });

    this.bookmarksList.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const row = target?.closest<HTMLElement>(
        ".inbox-row, .bookmark-section-row",
      );
      const item = this.bookmarkItem(row);
      if (!row || item === undefined) return;

      if (item.kind === "document") {
        if (target?.closest(".inbox-bookmark")) {
          this.options.onToggleDocumentBookmark(item.document.path);
          return;
        }
        if (!item.document.available) return;
        const control = target?.closest<HTMLElement>("button, a");
        if (control && !control.matches(".inbox-row-main")) return;
        this.options.onOpen(item.document.path);
        return;
      }

      const action = target?.closest<HTMLElement>("[data-bookmark-action]");
      if (action) {
        if (action.dataset.bookmarkAction === "reanchor") {
          this.options.onSectionReanchor(item.section.id);
        } else {
          this.options.onSectionRemove(item.section.id);
        }
        return;
      }

      const control = target?.closest<HTMLElement>("button, a");
      if (control && !control.matches(".bookmark-section-open")) return;
      this.options.onSectionActivate(item.section);
    });

    const bookmarkMenu = (
      row: HTMLElement,
      item: BookmarkRow,
      anchor: { x: number; y: number } | { rect: DOMRect },
    ): void => {
      if (item.kind !== "document") return;
      this.options.onContextMenu(item.document.path, anchor, row);
    };
    this.bookmarksList.addEventListener("contextmenu", (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const item = this.bookmarkItem(row);
      if (!row || item === undefined) return;
      event.preventDefault();
      bookmarkMenu(row, item, { x: event.clientX, y: event.clientY });
    });
    this.bookmarksList.addEventListener("keydown", (event) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      ) {
        return;
      }
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const item = this.bookmarkItem(row);
      if (!row || item === undefined) return;
      event.preventDefault();
      bookmarkMenu(row, item, { rect: row.getBoundingClientRect() });
    });

    this.bookmarkNotifications.addEventListener("change", () => {
      this.options.onBookmarkNotificationsChange(
        this.bookmarkNotifications.checked,
      );
    });

    this.filterInput.addEventListener("input", () => {
      this.options.onFilterChange(this.filterInput.value);
    });
    this.filterInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.filterInput.value.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.filterInput.value = "";
      this.options.onFilterChange("");
    });
    this.filterClear.addEventListener("click", () => {
      this.filterInput.value = "";
      this.options.onFilterChange("");
      this.filterInput.focus();
    });

    this.clearBtn.addEventListener("click", () => this.options.onClear());
    this.clearAllBtn.addEventListener("click", () => this.options.onCloseAll());
    this.undoBtn.addEventListener("click", () => this.options.onUndo());
    this.summaryBtn.addEventListener("click", () => this.options.onSummarize());
    this.popoutBtn.addEventListener("click", () => this.openPopout());
    this.changedRefreshBtn.addEventListener("click", () =>
      this.options.onRefreshChanged(),
    );
  }

  private openPopout(): void {
    this.browser ??= new InboxBrowser({
      onOpen: (path) => this.options.onOpen(path),
      onToggleBookmark: (path) =>
        this.options.onToggleDocumentBookmark(path),
      now: this.options.now,
      viewportHeight: this.options.modalViewportHeight,
    });
    const term = this.state.filterTerm.trim();
    const emptyMessage =
      term.length > 0
        ? `No documents match “${term}”.`
        : "No documents match the configured watches.";
    this.browser.open(
      this.state.inventory,
      this.state.openPaths,
      this.state.activePath,
      emptyMessage,
      this.state.bookmarkedPaths,
    );
  }

  private renderOpenSection(): void {
    this.openCount.textContent = String(this.state.openRows.length);
    this.openHeader.setAttribute(
      "aria-expanded",
      String(!this.state.openCollapsed),
    );
    this.openSection.classList.toggle("collapsed", this.state.openCollapsed);
    this.openBody.hidden = this.state.openCollapsed;
    this.openToolbar.hidden = this.state.openRows.length === 0;
    this.clearAllBtn.disabled = this.state.openRows.length === 0;

    const fragment = document.createDocumentFragment();
    if (this.state.openRows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sidebar-open-empty";
      empty.textContent = "No open documents. Open one from the list below.";
      fragment.append(empty);
    }

    for (const row of this.state.openRows) {
      fragment.append(this.openRow(row));
    }
    this.openList.replaceChildren(fragment);
  }

  private openRow(row: OpenRow): HTMLElement {
    const item = document.createElement("li");
    item.className = "sidebar-row";
    item.dataset.path = row.path;
    item.tabIndex = -1;
    if (row.active) item.classList.add("active");
    if (row.unread) item.classList.add("unread");
    if (row.deleted) item.classList.add("deleted");
    if (row.path === this.state.activeUpdatePath) {
      item.classList.add("active-update");
    }
    item.title = row.deleted ? `${row.path} (deleted on disk)` : row.path;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "sidebar-row-main";
    main.setAttribute("aria-current", row.active ? "true" : "false");
    main.setAttribute("aria-label", row.filename);

    const dot = document.createElement("span");
    dot.className = "tab-dot";

    const title = document.createElement("span");
    title.className = "sidebar-row-title";
    title.textContent = row.filename;
    main.append(dot, title);

    const bookmarked = this.state.bookmarkedPaths.has(row.path);
    const bookmark = document.createElement("button");
    bookmark.type = "button";
    bookmark.className = "sidebar-row-bookmark";
    bookmark.setAttribute("aria-pressed", String(bookmarked));
    bookmark.setAttribute(
      "aria-label",
      bookmarked
        ? `Remove bookmark for ${row.filename}`
        : `Bookmark ${row.filename}`,
    );
    bookmark.title = bookmarked ? "Remove bookmark" : "Bookmark document";
    bookmark.textContent = bookmarked ? "★" : "☆";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "sidebar-row-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Close ${row.filename}`);
    close.title = `Close ${row.filename}`;

    item.append(main, bookmark, close);
    return item;
  }

  private browseItems(): InboxEntry[] {
    if (
      this.state.browseMode === "bookmarks" ||
      this.state.browseMode === "changed"
    ) {
      return [];
    }
    return this.state.browseMode === "recent"
      ? this.state.recent
      : this.state.inventory;
  }

  private bookmarkItem(
    row: HTMLElement | null | undefined,
  ): BookmarkRow | undefined {
    if (row === null || row === undefined) return undefined;
    const index = Number(row.dataset.index);
    if (!Number.isInteger(index)) return undefined;
    return this.state.bookmarks.rows[index];
  }

  private bindBookmarkRow(row: HTMLElement, item: BookmarkRow): void {
    if (item.kind === "document") {
      this.renderBookmarkDocumentRow(row, item.document);
      return;
    }
    this.renderBookmarkSectionRow(row, item.section);
  }

  private renderBookmarkDocumentRow(
    row: HTMLElement,
    documentView: BookmarkDocumentView,
  ): void {
    const built = createInboxRow();
    row.className = built.className;
    row.replaceChildren(...built.childNodes);
    row.dataset.kind = "document";

    bindInboxRow(
      row,
      {
        path: documentView.path,
        filename: documentView.filename,
        modifiedTime: documentView.modifiedTime,
        changedAt: 0,
        unread: documentView.unread,
        deleted: !documentView.available,
        inventoryHidden: false,
        origin: "manual",
      },
      this.state.openPaths,
      this.state.activePath,
      this.state.now,
      documentView.documentBookmarked,
    );

    row.classList.add("bookmark-document");
    if (!documentView.available) {
      row.classList.add("unavailable");
      const main = row.querySelector<HTMLButtonElement>(".inbox-row-main");
      if (main) {
        main.disabled = true;
        main.setAttribute("aria-disabled", "true");
      }
      const time = row.querySelector<HTMLTimeElement>(".inbox-time");
      if (time) {
        time.textContent = "Unavailable";
        time.removeAttribute("datetime");
      }
    }

    if (documentView.sectionCount > 0) {
      const top = row.querySelector<HTMLElement>(".inbox-row-top");
      const count = document.createElement("span");
      count.className = "bookmark-section-count";
      count.textContent = String(documentView.sectionCount);
      count.title = `${documentView.sectionCount} section bookmark${
        documentView.sectionCount === 1 ? "" : "s"
      }`;
      top?.append(count);
    }

    if (!documentView.available) {
      const top = row.querySelector<HTMLElement>(".inbox-row-top");
      const badge = document.createElement("span");
      badge.className = "bookmark-unavailable-badge";
      badge.textContent = "Unavailable";
      top?.append(badge);
    }
  }

  private static readonly SECTION_STATUS_LABELS: Record<
    BookmarkSectionView["status"],
    string
  > = {
    unavailable: "Unavailable",
    stale: "Not found",
    unverified: "Not checked",
    "re-anchored": "Moved",
    shared: "Shared",
    current: "",
  };

  private renderBookmarkSectionRow(
    row: HTMLElement,
    section: BookmarkSectionView,
  ): void {
    row.className = "bookmark-section-row";
    row.dataset.kind = "section";
    row.dataset.path = section.path;
    row.dataset.sectionId = section.id;
    row.style.setProperty("--bookmark-depth", String(section.depth));

    const open = document.createElement("button");
    open.type = "button";
    open.className = "bookmark-section-open";
    open.setAttribute(
      "aria-label",
      `Open bookmark “${section.text}” in ${
        section.path.split("/").pop() ?? section.path
      }`,
    );

    const text = document.createElement("span");
    text.className = "bookmark-section-text";
    text.textContent = section.text.length > 0 ? section.text : "(untitled heading)";

    const statusLabel = SidebarPanel.SECTION_STATUS_LABELS[section.status];
    const status = document.createElement("span");
    status.className = "bookmark-section-status";
    status.textContent = statusLabel;
    status.hidden = statusLabel.length === 0;
    if (statusLabel.length > 0) {
      status.classList.add(`status-${section.status}`);
      if (section.status === "stale") {
        status.title = "The heading this bookmark pointed at is no longer present.";
      } else if (section.status === "unverified") {
        status.title = "Open the document to check whether the heading still exists.";
      } else if (section.status === "shared") {
        status.title = "Another bookmark points at the same heading.";
      } else if (section.status === "re-anchored") {
        status.title = "The heading changed; the bookmark followed its context.";
      }
    }
    open.append(text, status);
    if (section.status === "unavailable") {
      open.disabled = true;
      open.setAttribute("aria-disabled", "true");
    }

    row.append(open);

    if (section.status === "stale") {
      const reanchor = document.createElement("button");
      reanchor.type = "button";
      reanchor.className = "bookmark-section-action";
      reanchor.dataset.bookmarkAction = "reanchor";
      reanchor.textContent = "Re-anchor";
      reanchor.setAttribute(
        "aria-label",
        `Re-anchor bookmark “${section.text}” in ${
          section.path.split("/").pop() ?? section.path
        }`,
      );
      row.append(reanchor);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "bookmark-section-action";
    remove.dataset.bookmarkAction = "remove";
    remove.textContent = "Remove";
    remove.setAttribute(
      "aria-label",
      `Remove bookmark “${section.text}” from ${
        section.path.split("/").pop() ?? section.path
      }`,
    );
    row.append(remove);
  }

  private renderBrowseSection(): void {
    const isRecent = this.state.browseMode === "recent";
    const isBookmarks = this.state.browseMode === "bookmarks";
    const isChanged = this.state.browseMode === "changed";
    const items = this.browseItems();
    const changedRows = this.state.changedRows;
    const changedFilteredEmpty =
      isChanged &&
      this.state.filterTerm.trim().length > 0 &&
      changedRows.length === 0 &&
      this.state.changed.status !== "loading" &&
      this.state.changed.status !== "refreshing" &&
      this.state.changed.status !== "scope-error" &&
      this.state.changed.status !== "error";

    this.browseCount.textContent = String(
      isChanged
        ? changedRows.length
        : isBookmarks
          ? this.state.bookmarks.totalCount
          : items.length,
    );
    this.browseHeader.setAttribute(
      "aria-expanded",
      String(!this.state.browseCollapsed),
    );
    this.browseSection.classList.toggle("collapsed", this.state.browseCollapsed);
    this.browseBody.hidden = this.state.browseCollapsed;

    const allActive = !isRecent && !isBookmarks && !isChanged;
    this.modeAll.classList.toggle("active", allActive);
    this.modeRecent.classList.toggle("active", isRecent);
    this.modeBookmarks.classList.toggle("active", isBookmarks);
    this.modeChanged.classList.toggle("active", isChanged);
    this.modeAll.setAttribute("aria-pressed", String(allActive));
    this.modeRecent.setAttribute("aria-pressed", String(isRecent));
    this.modeBookmarks.setAttribute("aria-pressed", String(isBookmarks));
    this.modeChanged.setAttribute("aria-pressed", String(isChanged));
    this.modeBookmarksCount.textContent = String(this.state.bookmarks.totalCount);
    const total = this.state.bookmarks.totalCount;
    this.modeBookmarks.setAttribute(
      "aria-label",
      `Bookmarks, ${total} bookmark${total === 1 ? "" : "s"}`,
    );

    if (this.filterInput.value !== this.state.filterTerm) {
      this.filterInput.value = this.state.filterTerm;
    }
    this.filterInput.placeholder = isBookmarks
      ? "Filter bookmarks by document or heading"
      : isChanged
        ? "Filter changed `_ai` documents by name or project"
        : "Filter by name, folder or project";
    this.filterClear.hidden = this.state.filterTerm.trim().length === 0;
    this.filterInput.setAttribute(
      "aria-describedby",
      this.state.filterTerm.trim().length === 0 ? "" : "sidebar-filter-count",
    );
    this.filterCount.textContent =
      this.state.filterTerm.trim().length === 0
        ? ""
        : `${
            isChanged
              ? changedRows.length
              : isBookmarks
                ? this.state.bookmarks.rows.length
                : items.length
          } matching`;

    const hideBrowseActions = isBookmarks || isChanged;
    this.clearBtn.hidden = hideBrowseActions;
    this.undoBtn.hidden = hideBrowseActions;
    this.summaryBtn.hidden = hideBrowseActions;
    this.popoutBtn.hidden = hideBrowseActions;
    this.changedToolbar.hidden = !isChanged;
    const changedBusy =
      this.state.changed.status === "loading" ||
      this.state.changed.status === "refreshing";
    this.changedRefreshBtn.disabled = changedBusy;

    this.clearBtn.disabled = !isRecent || this.state.recent.length === 0;
    this.undoBtn.disabled = !this.state.canUndo;
    this.summaryBtn.disabled =
      !isRecent ||
      this.state.recent.length === 0 ||
      this.state.summaryBusy ||
      !this.state.summary.ready;
    this.summaryBtn.title = this.summaryTitle();
    this.popoutBtn.disabled = this.state.inventory.length === 0;

    this.bookmarksSettings.hidden = !isBookmarks;
    this.bookmarkNotifications.checked =
      this.state.bookmarkNotificationsOnly;
    this.bookmarkNotificationsNote.textContent =
      this.state.bookmarks.totalCount === 0
        ? "No bookmarks yet, so no change notifications will appear."
        : "Popups are limited to bookmarked documents. The tray dot still reflects every change.";

    this.browseScroll.hidden = isBookmarks || isChanged;
    this.bookmarksScroll.hidden = !isBookmarks;
    this.changedScroll.hidden = !isChanged;
    this.hintHost.hidden = isBookmarks || isChanged;

    this.renderHint();
    if (!isBookmarks && !isChanged) this.renderBrowseEmpty(items);
    else this.browseEmpty.hidden = true;
    this.renderBookmarksEmpty();
    this.renderChangedSection(isChanged, changedFilteredEmpty);

    this.virtual.setItems(
      this.state.browseCollapsed || isBookmarks || isChanged ? [] : items,
    );
    this.bookmarksVirtual.setItems(
      isBookmarks && !this.state.browseCollapsed
        ? this.state.bookmarks.rows
        : [],
    );
    this.changedVirtual.setItems(
      isChanged && !this.state.browseCollapsed ? changedRows : [],
    );
  }

  /** Paints the scope banner, repository errors and one explicit state. */
  private renderChangedSection(
    isChanged: boolean,
    filteredEmpty: boolean,
  ): void {
    if (!isChanged) {
      this.changedScopeHost.replaceChildren();
      this.changedScopeHost.hidden = true;
      this.changedErrorHost.replaceChildren();
      this.changedErrorHost.hidden = true;
      this.changedStateHost.replaceChildren();
      this.changedStateHost.hidden = true;
      this.changedEmpty.hidden = true;
      this.changedScroll.setAttribute("aria-busy", "false");
      return;
    }

    const state = this.state.changed;
    const busy = state.status === "loading" || state.status === "refreshing";
    this.changedScroll.setAttribute("aria-busy", String(busy));

    if (state.scope !== null) {
      this.changedScopeHost.replaceChildren(
        createScopeBanner(state.scope, () =>
          this.options.onShowAllChanged(),
        ),
      );
      this.changedScopeHost.hidden = false;
    } else {
      this.changedScopeHost.replaceChildren();
      this.changedScopeHost.hidden = true;
    }

    const errors = createRepositoryErrorBanner(state.repositories);
    this.changedErrorHost.replaceChildren(errors);
    this.changedErrorHost.hidden = errors.hidden;

    if (filteredEmpty) {
      this.changedStateHost.replaceChildren();
      this.changedStateHost.hidden = true;
      this.changedEmpty.hidden = false;
      this.changedEmpty.replaceChildren();
      const text = document.createElement("span");
      text.textContent = `No documents match “${this.state.filterTerm.trim()}”.`;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sidebar-inline-action";
      clear.textContent = "Clear filter";
      clear.addEventListener("click", () => {
        this.filterInput.value = "";
        this.options.onFilterChange("");
      });
      this.changedEmpty.append(text, clear);
      return;
    }

    this.changedEmpty.hidden = true;
    this.changedStateHost.hidden = false;
    this.changedStateHost.replaceChildren(
      createStatePanel(state, {
        onShowAll: () => this.options.onShowAllChanged(),
      }),
    );
  }

  private renderBookmarksEmpty(): void {
    if (this.state.browseMode !== "bookmarks") {
      this.bookmarksEmpty.hidden = true;
      return;
    }

    if (this.state.bookmarks.rows.length > 0 || this.state.browseCollapsed) {
      this.bookmarksEmpty.hidden = true;
      return;
    }

    this.bookmarksEmpty.hidden = false;
    this.bookmarksEmpty.replaceChildren();
    const term = this.state.filterTerm.trim();

    if (term.length > 0) {
      const text = document.createElement("span");
      text.textContent = `No bookmarks match “${term}”.`;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sidebar-inline-action";
      clear.textContent = "Clear filter";
      clear.addEventListener("click", () => {
        this.filterInput.value = "";
        this.options.onFilterChange("");
      });
      this.bookmarksEmpty.append(text, clear);
      return;
    }

    const text = document.createElement("span");
    text.textContent =
      "No bookmarks yet. Use the star on a document or heading, the header bookmark button, or Ctrl/Cmd+D.";
    const browseAll = document.createElement("button");
    browseAll.type = "button";
    browseAll.className = "sidebar-inline-action";
    browseAll.textContent = "Browse all documents";
    browseAll.addEventListener("click", () =>
      this.options.onModeChange("all"),
    );
    this.bookmarksEmpty.append(text, browseAll);
  }

  private renderSplit(): void {
    const inert =
      !this.browseVisible ||
      this.state.openCollapsed ||
      this.state.browseCollapsed;

    this.splitHost.hidden = inert;
    this.splitHost.tabIndex = inert ? -1 : 0;
    if (inert) {
      this.splitHost.setAttribute("aria-disabled", "true");
    } else {
      this.splitHost.removeAttribute("aria-disabled");
    }

    this.applySplit();
  }

  private applySplit(): void {
    const stacked =
      this.state.openCollapsed || this.state.browseCollapsed || !this.browseVisible;
    this.openSection.style.flexBasis = stacked ? "auto" : `${this.splitPercent}%`;
  }

  /** Renders only the actionable first-run hint; all watch chatter lives in
   *  the status bar and event log. */
  private renderHint(): void {
    const configPath = this.state.configHintPath;
    if (configPath === null) {
      this.hintHost.replaceChildren();
      return;
    }
    this.hintHost.replaceChildren(this.setupHint(configPath));
  }

  private renderBrowseEmpty(items: readonly InboxEntry[]): void {
    if (items.length > 0) {
      this.browseEmpty.hidden = true;
      return;
    }

    this.browseEmpty.hidden = false;
    this.browseEmpty.replaceChildren();

    if (this.state.filterTerm.trim().length > 0) {
      const text = document.createElement("span");
      text.textContent = `No documents match “${this.state.filterTerm.trim()}”.`;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sidebar-inline-action";
      clear.textContent = "Clear filter";
      clear.addEventListener("click", () => {
        this.filterInput.value = "";
        this.options.onFilterChange("");
      });
      this.browseEmpty.append(text, clear);
      return;
    }

    if (this.state.browseMode === "recent") {
      const text = document.createElement("span");
      text.textContent = "No changes since launch.";
      const switchToAll = document.createElement("button");
      switchToAll.type = "button";
      switchToAll.className = "sidebar-inline-action";
      switchToAll.textContent = "Browse all documents";
      switchToAll.addEventListener("click", () =>
        this.options.onModeChange("all"),
      );
      this.browseEmpty.append(text, switchToAll);
    } else {
      this.browseEmpty.textContent = "No documents match the configured watches.";
    }
  }

  private summaryTitle(): string {
    if (this.state.summaryBusy) return "Summarizing recent changes…";
    if (!this.state.summary.ready) {
      return this.state.summary.problem ?? "Configure [summary] to summarize changes";
    }
    if (this.state.browseMode !== "recent") {
      return "Switch to Recently changed to summarize";
    }
    if (this.state.recent.length === 0) return "No recent changes to summarize";
    return `Summarize ${this.state.recent.length} recent change${
      this.state.recent.length === 1 ? "" : "s"
    }`;
  }


  private setupHint(configPath: string): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "inbox-hint";

    const message = document.createElement("p");
    message.textContent = `No config found at ${configPath}. Create it to watch files on every launch:`;

    const example = document.createElement("code");
    example.textContent = 'watch = ["~/devel/*/_ai"]\nexclude = ["**/archive/**"]';

    hint.append(message, example);
    return hint;
  }

}
