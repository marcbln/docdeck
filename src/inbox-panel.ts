import { sectionInbox, type InboxEntry } from "./inbox-model";
import { compactPath, parentPath, projectName } from "./project";
import { formatExactTime, formatRelativeTime } from "./relative-time";

/** Height of one inbox row in CSS pixels for the virtualized All-files list. */
export const ROW_HEIGHT = 48;

/** Extra rows rendered above and below the viewport during fast scrolling. */
export const OVERSCAN = 6;

export interface RowRange {
  start: number;
  end: number;
}

/**
 * The half-open index range that must exist in the DOM for a viewport.
 *
 * `scrollOffset` is measured from the top of the list (not the panel), so the
 * header and status height are the caller's responsibility.
 */
export function visibleRange(
  scrollOffset: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): RowRange {
  if (total <= 0 || viewportHeight <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }

  const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const size = visible + overscan * 2;
  const maxStart = Math.max(0, total - size);
  const start = Math.min(
    Math.max(0, Math.floor(scrollOffset / rowHeight) - overscan),
    maxStart,
  );

  return { start, end: Math.min(total, start + size) };
}

/** Where a running scan currently is, as streamed by the backend. */
export interface ScanProgress {
  path: string;
  directories: number;
  files: number;
}

/** Everything the panel needs to explain the current watch state. */
export interface InboxStatus {
  configPath: string;
  configFound: boolean;
  error: string | null;
  warnings: string[];
  truncated: boolean;
  loading: boolean;
  progress: ScanProgress | null;
}

export interface InboxPanelOptions {
  onOpen(path: string): void;
  /** Injectable clock so relative times are deterministic in tests. */
  now?: () => number;
  /**
   * Test seam for the All-files modal. Production measures the modal body;
   * happy-dom has no layout.
   */
  modalViewportHeight?: number;
}

/** Builds one row with the anatomy both the panel and the modal share. */
function createInboxRow(): HTMLElement {
  const row = document.createElement("li");
  row.className = "inbox-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const top = document.createElement("div");
  top.className = "inbox-row-top";
  const chip = document.createElement("span");
  chip.className = "inbox-project";
  const name = document.createElement("span");
  name.className = "inbox-filename";
  const dot = document.createElement("span");
  dot.className = "inbox-dot";
  top.append(chip, name, dot);

  const bottom = document.createElement("div");
  bottom.className = "inbox-row-bottom";
  const parent = document.createElement("span");
  parent.className = "inbox-parent";
  const time = document.createElement("time");
  time.className = "inbox-time";
  bottom.append(parent, time);

  row.append(top, bottom);
  return row;
}

/** Fills a row's content and state; positioning belongs to the list owner. */
function bindInboxRow(
  row: HTMLElement,
  entry: InboxEntry,
  openPaths: ReadonlySet<string>,
  activePath: string | null,
  now: number,
): void {
  row.dataset.path = entry.path;
  row.className = "inbox-row";
  if (entry.unread) row.classList.add("unread");
  if (entry.deleted) row.classList.add("deleted");
  if (openPaths.has(entry.path)) row.classList.add("open");
  if (entry.path === activePath) row.classList.add("active");

  const project = projectName(entry.path);
  const chip = row.querySelector<HTMLElement>(".inbox-project")!;
  chip.hidden = project === null;
  chip.textContent = project ?? "";

  const name = row.querySelector<HTMLElement>(".inbox-filename")!;
  name.textContent = entry.filename;
  name.title = entry.deleted ? `${entry.path} (deleted on disk)` : entry.path;

  const parentPathText = parentPath(entry.path);
  const parent = row.querySelector<HTMLElement>(".inbox-parent")!;
  parent.textContent = compactPath(parentPathText);
  parent.title = parentPathText;

  const time = row.querySelector<HTMLTimeElement>(".inbox-time")!;
  time.dateTime = new Date(entry.modifiedTime).toISOString();
  time.textContent = formatRelativeTime(entry.modifiedTime, now);
  time.title = formatExactTime(entry.modifiedTime);
}

interface InboxBrowserOptions {
  onOpen(path: string): void;
  now?: () => number;
  viewportHeight?: number;
}

/**
 * The All-files modal.
 *
 * It is the one surface that still shows the complete inventory, so it keeps
 * the windowed renderer: only the visible rows exist in the DOM no matter how
 * many files the config matches.
 */
export class InboxBrowser {
  private overlay: HTMLDivElement | null = null;
  private scrollHost: HTMLDivElement | null = null;
  private list: HTMLUListElement | null = null;
  private countEl: HTMLSpanElement | null = null;
  private emptyEl: HTMLParagraphElement | null = null;

  private entries: InboxEntry[] = [];
  private openPaths: ReadonlySet<string> = new Set();
  private activePath: string | null = null;

  private readonly rendered = new Map<number, HTMLElement>();
  private readonly freeRows: HTMLElement[] = [];
  private rafId: number | null = null;

  private readonly onScroll = (): void => this.scheduleWindow();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close();
  };

  constructor(private readonly options: InboxBrowserOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(
    entries: InboxEntry[],
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): void {
    if (this.overlay === null) this.mount();
    this.update(entries, openPaths, activePath);
    document.addEventListener("keydown", this.onKeyDown);
    this.overlay?.querySelector<HTMLButtonElement>(".inbox-modal-close")?.focus();
  }

  update(
    entries: InboxEntry[],
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): void {
    this.entries = entries;
    this.openPaths = openPaths;
    this.activePath = activePath;

    if (this.list === null || this.countEl === null || this.emptyEl === null) {
      return;
    }

    this.countEl.textContent = `${entries.length} ${
      entries.length === 1 ? "file" : "files"
    }`;
    this.emptyEl.hidden = entries.length > 0;
    this.list.style.height = `${entries.length * ROW_HEIGHT}px`;
    this.renderWindow(true);
  }

  refresh(): void {
    this.renderWindow(true);
  }

  close(): void {
    if (this.overlay === null) return;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener("keydown", this.onKeyDown);
    this.scrollHost?.removeEventListener("scroll", this.onScroll);
    this.list?.replaceChildren();
    this.overlay.remove();

    this.overlay = null;
    this.scrollHost = null;
    this.list = null;
    this.countEl = null;
    this.emptyEl = null;
    this.rendered.clear();
    this.freeRows.length = 0;
  }

  destroy(): void {
    this.close();
  }

  private mount(): void {
    const overlay = document.createElement("div");
    overlay.className = "inbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "All watched files");

    const modal = document.createElement("div");
    modal.className = "inbox-modal";

    const header = document.createElement("div");
    header.className = "inbox-modal-header";
    const title = document.createElement("span");
    title.className = "inbox-modal-title";
    title.textContent = "All files";
    this.countEl = document.createElement("span");
    this.countEl.className = "inbox-modal-count";

    const close = document.createElement("button");
    close.className = "inbox-modal-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close all files");
    close.addEventListener("click", () => this.close());
    header.append(title, this.countEl, close);

    const scrollHost = document.createElement("div");
    scrollHost.className = "inbox-modal-body";

    const list = document.createElement("ul");
    list.className = "inbox-list inbox-list--virtual";

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "inbox-empty";
    this.emptyEl.textContent = "No documents match the configured watches.";

    scrollHost.append(list, this.emptyEl);
    modal.append(header, scrollHost);
    overlay.append(modal);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });
    scrollHost.addEventListener("scroll", this.onScroll, { passive: true });
    this.bindRowEvents(list);

    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.scrollHost = scrollHost;
    this.list = list;
  }

  private bindRowEvents(list: HTMLUListElement): void {
    const activate = (event: MouseEvent): void => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const path = row?.dataset.path;
      if (!path) return;
      this.close();
      this.options.onOpen(path);
    };

    list.addEventListener("click", activate);
    list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row",
      );
      const path = row?.dataset.path;
      if (!path) return;
      event.preventDefault();
      this.close();
      this.options.onOpen(path);
    });
  }

  private scheduleWindow(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderWindow(false);
    });
  }

  /**
   * Puts exactly the visible range in the DOM.
   *
   * `rebind` is true after the entries change: every rendered row is re-bound
   * because its index may now point at a different document. Scrolling passes
   * false so only entering rows are bound.
   */
  private renderWindow(rebind: boolean): void {
    const list = this.list;
    const scrollHost = this.scrollHost;
    if (list === null || scrollHost === null) return;

    const viewport = this.options.viewportHeight ?? scrollHost.clientHeight;
    if (viewport <= 0) {
      this.recycleAll();
      return;
    }

    const offset = Math.max(0, scrollHost.scrollTop - list.offsetTop);
    const { start, end } = visibleRange(
      offset,
      viewport,
      ROW_HEIGHT,
      this.entries.length,
      OVERSCAN,
    );

    for (const [index, row] of this.rendered) {
      if (index < start || index >= end) {
        this.rendered.delete(index);
        row.remove();
        this.freeRows.push(row);
      }
    }

    // Descending insertion keeps DOM order equal to index order without moving
    // rows that stay in the window.
    for (let index = end - 1; index >= start; index -= 1) {
      let row = this.rendered.get(index);
      const fresh = row === undefined;
      if (row === undefined) {
        row = this.freeRows.pop() ?? createInboxRow();
        this.rendered.set(index, row);
        list.insertBefore(row, this.rendered.get(index + 1) ?? null);
      }
      row.style.top = `${index * ROW_HEIGHT}px`;
      row.style.height = `${ROW_HEIGHT}px`;
      row.setAttribute("aria-posinset", String(index + 1));
      row.setAttribute("aria-setsize", String(this.entries.length));
      if (rebind || fresh) {
        bindInboxRow(
          row,
          this.entries[index],
          this.openPaths,
          this.activePath,
          this.options.now?.() ?? Date.now(),
        );
      }
    }
  }

  private recycleAll(): void {
    for (const row of this.rendered.values()) {
      row.remove();
      this.freeRows.push(row);
    }
    this.rendered.clear();
  }
}

export class InboxPanel {
  private entries: InboxEntry[] = [];
  private status: InboxStatus;
  private openPaths: ReadonlySet<string> = new Set();
  private activePath: string | null = null;

  private readonly countEl: HTMLSpanElement;
  private readonly browseBtn: HTMLButtonElement;
  private readonly statusHost: HTMLDivElement;
  private readonly sectionsHost: HTMLDivElement;

  private browser: InboxBrowser | null = null;

  private readonly onClick = (event: MouseEvent): void => {
    const row = (event.target as Element | null)?.closest<HTMLElement>(
      ".inbox-row",
    );
    const path = row?.dataset.path;
    if (path) this.options.onOpen(path);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = (event.target as Element | null)?.closest<HTMLElement>(
      ".inbox-row",
    );
    const path = row?.dataset.path;
    if (!path) return;
    event.preventDefault();
    this.options.onOpen(path);
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly options: InboxPanelOptions,
  ) {
    this.status = {
      configPath: "",
      configFound: true,
      error: null,
      warnings: [],
      truncated: false,
      loading: true,
      progress: null,
    };

    const header = document.createElement("div");
    header.className = "inbox-header";
    const title = document.createElement("span");
    title.className = "inbox-title";
    title.textContent = "Inbox";
    this.countEl = document.createElement("span");
    this.countEl.className = "inbox-count";
    this.browseBtn = document.createElement("button");
    this.browseBtn.className = "inbox-browse";
    this.browseBtn.type = "button";
    this.browseBtn.addEventListener("click", () => this.openBrowser());
    header.append(title, this.countEl, this.browseBtn);

    this.statusHost = document.createElement("div");
    this.statusHost.className = "inbox-status";

    this.sectionsHost = document.createElement("div");
    this.sectionsHost.className = "inbox-sections";
    this.sectionsHost.addEventListener("click", this.onClick);
    this.sectionsHost.addEventListener("keydown", this.onKeyDown);

    this.root.replaceChildren(header, this.statusHost, this.sectionsHost);
  }

  render(
    entries: InboxEntry[],
    status: InboxStatus,
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): void {
    this.entries = entries;
    this.status = status;
    this.openPaths = openPaths;
    this.activePath = activePath;
    this.renderHeader();
    this.renderStatus();
    this.renderSections();
    this.browser?.update(entries, openPaths, activePath);
  }

  /**
   * Repaints the active/open state of one row without rebuilding the sections.
   * Called on tab activation when no section membership changed; `main.ts`
   * re-renders instead when an unread row moves to "Manually opened".
   */
  public setActive(previous: string | null, active: string | null): void {
    this.activePath = active;
    if (previous && previous !== active) {
      this.rowFor(previous)?.classList.remove("active");
    }
    const row = active === null ? undefined : this.rowFor(active);
    if (row) {
      row.classList.add("active", "open");
      row.classList.remove("unread");
    }
  }

  /** Updates only the scan status line; the row list is untouched. */
  public setProgress(progress: ScanProgress | null): void {
    this.status = { ...this.status, progress };
    this.renderStatus();
  }

  /** Re-paints after the panel is shown or the window is resized. */
  public refresh(): void {
    this.browser?.refresh();
  }

  /** Releases listeners and removes any open All-files modal. */
  public destroy(): void {
    this.sectionsHost.removeEventListener("click", this.onClick);
    this.sectionsHost.removeEventListener("keydown", this.onKeyDown);
    this.browser?.destroy();
  }

  private openBrowser(): void {
    this.browser ??= new InboxBrowser({
      onOpen: (path) => this.options.onOpen(path),
      now: this.options.now,
      viewportHeight: this.options.modalViewportHeight,
    });
    this.browser.open(this.entries, this.openPaths, this.activePath);
  }

  private renderHeader(): void {
    const { changed, opened } = sectionInbox(this.entries, this.openPaths);
    this.countEl.textContent = `${changed.length} changed · ${opened.length} open`;

    const total = this.entries.length;
    this.browseBtn.textContent = `All files (${total})`;
    this.browseBtn.title = `Browse all ${total} ${
      total === 1 ? "file" : "files"
    }`;
    this.browseBtn.disabled = total === 0;
  }

  private renderStatus(): void {
    const fragment = document.createDocumentFragment();

    if (this.status.loading) {
      fragment.append(this.scanMessage(this.status.progress));
    } else {
      if (this.status.progress) {
        fragment.append(this.scanMessage(this.status.progress));
      }
      if (this.status.error) {
        fragment.append(
          this.message(`Config error: ${this.status.error}`, "inbox-error"),
        );
      } else if (!this.status.configFound) {
        fragment.append(this.setupHint(this.status.configPath));
      }

      if (this.status.warnings.length > 0) {
        fragment.append(this.warningList(this.status.warnings));
      }
      if (this.status.truncated) {
        fragment.append(
          this.message(
            "Some paths were skipped at the configured limits; see the warnings.",
            "inbox-truncated",
          ),
        );
      }

      if (this.entries.length === 0) {
        fragment.append(
          this.message(
            "No documents match the configured watches.",
            "inbox-empty",
          ),
        );
      }
    }

    this.statusHost.replaceChildren(fragment);
  }

  private renderSections(): void {
    const { changed, opened } = sectionInbox(this.entries, this.openPaths);
    const fragment = document.createDocumentFragment();

    if (changed.length > 0) {
      fragment.append(this.section("change-detected", "Change detected", changed));
    }
    if (opened.length > 0) {
      fragment.append(this.section("opened", "Manually opened", opened));
    }
    if (
      changed.length === 0 &&
      opened.length === 0 &&
      this.entries.length > 0
    ) {
      fragment.append(
        this.message(
          "No changes or open documents. Use All files to browse the watched set.",
          "inbox-empty",
        ),
      );
    }

    this.sectionsHost.replaceChildren(fragment);
  }

  private section(
    name: string,
    title: string,
    entries: InboxEntry[],
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "inbox-section";
    section.dataset.section = name;

    const heading = document.createElement("h3");
    heading.className = "inbox-section-title";
    const label = document.createElement("span");
    label.textContent = title;
    const count = document.createElement("span");
    count.className = "inbox-section-count";
    count.textContent = String(entries.length);
    heading.append(label, count);

    const list = document.createElement("ul");
    list.className = "inbox-list";

    const now = this.options.now?.() ?? Date.now();
    for (const entry of entries) {
      const row = createInboxRow();
      bindInboxRow(row, entry, this.openPaths, this.activePath, now);
      row.setAttribute("aria-posinset", String(list.childElementCount + 1));
      row.setAttribute("aria-setsize", String(entries.length));
      list.append(row);
    }

    section.append(heading, list);
    return section;
  }

  private rowFor(path: string): HTMLElement | undefined {
    for (const row of this.sectionsHost.querySelectorAll<HTMLElement>(
      ".inbox-row",
    )) {
      if (row.dataset.path === path) return row;
    }
    return undefined;
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
