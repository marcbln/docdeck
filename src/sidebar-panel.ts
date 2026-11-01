import { InboxBrowser } from "./browse-modal";
import type { InboxEntry, InboxStatus, ScanProgress } from "./inbox-model";
import { compactPath } from "./project";
import { formatRelativeTime } from "./relative-time";
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
  status: InboxStatus;
  openCollapsed: boolean;
  browseCollapsed: boolean;
  canUndo: boolean;
  /** Session-only filter term; empty means the full list. */
  filterTerm: string;
  now: number;
}

export interface SidebarPanelOptions {
  onOpen(path: string): void;
  onClose(path: string): void;
  /** Closes every document in the Open Documents pane. */
  onCloseAll(): void;
  onClear(): void;
  onUndo(): void;
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
  private readonly popoutBtn: HTMLButtonElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterClear: HTMLButtonElement;
  private readonly statusHost: HTMLDivElement;
  private readonly browseScroll: HTMLDivElement;
  private readonly browseList: HTMLUListElement;
  private readonly browseEmpty: HTMLParagraphElement;

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
      status: {
        configPath: "",
        configFound: true,
        error: null,
        warnings: [],
        truncated: false,
        loading: true,
        progress: null,
        lastReload: null,
      },
      openCollapsed: false,
      browseCollapsed: false,
      canUndo: false,
      filterTerm: "",
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
    this.popoutBtn = this.actionButton(
      "⤢",
      "Open the full-height inventory",
      "popout",
    );
    this.popoutBtn.setAttribute("aria-label", "Open the full-height inventory");
    actions.append(this.clearBtn, this.undoBtn, this.popoutBtn);
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

    this.statusHost = document.createElement("div");
    this.statusHost.className = "inbox-status";

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
      this.statusHost,
      this.browseScroll,
      this.browseEmpty,
    );

    this.browseSection.append(this.browseHeader, this.browseBody);

    this.root.replaceChildren(this.openSection, this.browseSection);

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
  }

  /** Updates only the scan status line; the row lists are untouched. */
  setProgress(progress: ScanProgress | null): void {
    this.state = { ...this.state, status: { ...this.state.status, progress } };
    this.renderStatus();
  }

  /** Repaints after being shown or after a window resize. */
  refresh(): void {
    this.virtual.refresh();
    this.browser?.refresh();
  }

  /** Shows or hides the browse section; Open Documents is never hidden. */
  setBrowseVisible(visible: boolean): void {
    this.browseSection.hidden = !visible;
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
    this.popoutBtn.disabled = this.state.inventory.length === 0;

    this.renderStatus();
    this.renderBrowseEmpty(items);
    this.virtual.setItems(this.state.browseCollapsed ? [] : items);
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

  private renderStatus(): void {
    const fragment = document.createDocumentFragment();
    const status = this.state.status;

    if (status.loading) {
      fragment.append(this.scanMessage(status.progress));
    } else {
      if (status.progress) {
        fragment.append(this.scanMessage(status.progress));
      }
      if (status.error) {
        fragment.append(
          this.message(`Config error: ${status.error}`, "inbox-error"),
        );
      } else if (!status.configFound) {
        fragment.append(this.setupHint(status.configPath));
      }

      if (status.lastReload) {
        fragment.append(this.reloadMessage(status.lastReload));
      }

      if (status.warnings.length > 0) {
        fragment.append(this.warningList(status.warnings));
      }
      if (status.truncated) {
        fragment.append(
          this.message(
            "Some paths were skipped at the configured limits; see the warnings.",
            "inbox-truncated",
          ),
        );
      }
    }

    this.statusHost.replaceChildren(fragment);
  }

  private scanMessage(progress: ScanProgress | null): HTMLElement {
    if (!progress) {
      return this.message("Scanning watched paths…", "inbox-loading");
    }

    const shown = compactPath(progress.path);
    const folders = `${progress.directories} ${
      progress.directories === 1 ? "folder" : "folders"
    }`;
    const files = `${progress.files} ${progress.files === 1 ? "file" : "files"}`;
    const line = this.message(
      `Scanning ${shown} (${folders} · ${files})`,
      "inbox-loading",
    );
    line.title = progress.path;
    return line;
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

  private reloadMessage(reload: NonNullable<InboxStatus["lastReload"]>): HTMLElement {
    if (!reload.ok) {
      const line = this.message(
        `Last reload failed: ${reload.error ?? "unknown error"}`,
        "inbox-error inbox-reload",
      );
      return line;
    }
    const when = formatRelativeTime(reload.at, this.state.now);
    const parts = [`Configuration reloaded ${when}.`];
    if (reload.warnings.length > 0) {
      parts.push(
        `${reload.warnings.length} warning${reload.warnings.length === 1 ? "" : "s"}.`,
      );
    }
    if (reload.truncated) parts.push("Results were truncated.");
    return this.message(parts.join(" "), "inbox-loading inbox-reload");
  }

  private warningList(warnings: string[]): HTMLElement {
    const details = document.createElement("details");
    details.className = "inbox-warnings";

    const summary = document.createElement("summary");
    summary.textContent = `${warnings.length} warning${
      warnings.length === 1 ? "" : "s"
    }`;

    const list = document.createElement("ul");
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.append(item);
    }

    details.append(summary, list);
    return details;
  }

  private message(text: string, className: string): HTMLElement {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  }
}
