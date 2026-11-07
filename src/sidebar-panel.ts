import { InboxBrowser } from "./browse-modal";
import type { InboxEntry } from "./inbox-model";
import type { SummaryStatus } from "./summary-model";
import { bindInboxRow, createInboxRow } from "./sidebar-rows";
import type { BrowseMode, OpenRow } from "./sidebar-model";
import { VirtualList } from "./virtual-list";

/** Everything the sidebar needs for one paint. */
export interface SidebarViewState {
  openRows: OpenRow[];
  browseMode: BrowseMode;
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
  onModeChange(mode: BrowseMode): void;
  /** Called whenever the browse filter changes (including clear/Escape). */
  onFilterChange(term: string): void;
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
  private readonly clearBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly summaryBtn: HTMLButtonElement;
  private readonly popoutBtn: HTMLButtonElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterClear: HTMLButtonElement;
  private readonly hintHost: HTMLDivElement;
  private readonly browseScroll: HTMLDivElement;
  private readonly browseList: HTMLUListElement;
  private readonly browseEmpty: HTMLParagraphElement;

  private readonly splitHost: HTMLDivElement;
  private splitPercent = 50;
  private browseVisible = true;

  private readonly virtual: VirtualList<InboxEntry>;
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
    modes.append(this.modeAll, this.modeRecent);

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
    filterRow.append(filterLabel, this.filterInput, this.filterClear);

    this.hintHost = document.createElement("div");
    this.hintHost.className = "sidebar-hint-host";

    this.browseScroll = document.createElement("div");
    this.browseScroll.className = "sidebar-browse-scroll";
    this.browseList = document.createElement("ul");
    this.browseList.className = "inbox-list inbox-list--virtual";
    this.browseEmpty = document.createElement("p");
    this.browseEmpty.className = "inbox-empty sidebar-browse-empty";
    this.browseScroll.append(this.browseList);
    this.browseBody.append(
      toolbar,
      filterRow,
      this.hintHost,
      this.browseScroll,
      this.browseEmpty,
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
        ),
      onActivate: (entry) => this.options.onOpen(entry.path),
      viewportHeight: options.viewportHeight,
    });

    this.bindEvents();
  }

  render(state: SidebarViewState): void {
    this.state = state;
    this.renderOpenSection();
    this.renderBrowseSection();
    this.renderSplit();
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
    this.browser?.destroy();
  }

  private modeButton(mode: BrowseMode, label: string): HTMLButtonElement {
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
      const row = target?.closest<HTMLElement>(".sidebar-row");
      const path = row?.dataset.path;
      if (!path) return;
      if (close) {
        event.stopPropagation();
        this.options.onClose(path);
        return;
      }
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

    this.openList.addEventListener("keydown", (event) => {      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".sidebar-row",
      );
      const path = row?.dataset.path;
      if (!path || event.target !== row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.options.onOpen(path);
        return;
      }
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
      this.options.onDismiss(item.path, this.state.browseMode);
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
  }

  private openPopout(): void {
    this.browser ??= new InboxBrowser({
      onOpen: (path) => this.options.onOpen(path),
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
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    if (row.active) item.classList.add("active");
    if (row.unread) item.classList.add("unread");
    if (row.deleted) item.classList.add("deleted");
    if (row.path === this.state.activeUpdatePath) {
      item.classList.add("active-update");
    }
    item.title = row.deleted ? `${row.path} (deleted on disk)` : row.path;
    item.setAttribute("aria-current", row.active ? "true" : "false");

    const dot = document.createElement("span");
    dot.className = "tab-dot";

    const title = document.createElement("span");
    title.className = "sidebar-row-title";
    title.textContent = row.filename;

    const close = document.createElement("span");
    close.className = "sidebar-row-close";
    close.textContent = "×";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", `Close ${row.filename}`);

    item.append(dot, title, close);
    return item;
  }

  private browseItems(): InboxEntry[] {
    return this.state.browseMode === "recent"
      ? this.state.recent
      : this.state.inventory;
  }

  private renderBrowseSection(): void {
    const isRecent = this.state.browseMode === "recent";
    const items = this.browseItems();

    this.browseCount.textContent = String(items.length);
    this.browseHeader.setAttribute(
      "aria-expanded",
      String(!this.state.browseCollapsed),
    );
    this.browseSection.classList.toggle("collapsed", this.state.browseCollapsed);
    this.browseBody.hidden = this.state.browseCollapsed;

    this.modeAll.classList.toggle("active", !isRecent);
    this.modeRecent.classList.toggle("active", isRecent);
    this.modeAll.setAttribute("aria-pressed", String(!isRecent));
    this.modeRecent.setAttribute("aria-pressed", String(isRecent));

    if (this.filterInput.value !== this.state.filterTerm) {
      this.filterInput.value = this.state.filterTerm;
    }
    this.filterClear.hidden = this.state.filterTerm.trim().length === 0;
    this.filterInput.setAttribute(
      "aria-describedby",
      this.state.filterTerm.trim().length === 0 ? "" : "sidebar-filter-count",
    );

    this.clearBtn.disabled = !isRecent || this.state.recent.length === 0;
    this.undoBtn.disabled = !this.state.canUndo;
    this.summaryBtn.disabled =
      !isRecent ||
      this.state.recent.length === 0 ||
      this.state.summaryBusy ||
      !this.state.summary.ready;
    this.summaryBtn.title = this.summaryTitle();
    this.popoutBtn.disabled = this.state.inventory.length === 0;

    this.renderHint();
    this.renderBrowseEmpty(items);
    this.virtual.setItems(this.state.browseCollapsed ? [] : items);
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
