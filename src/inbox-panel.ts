import type { InboxEntry } from "./inbox-model";
import { compactPath, parentPath, projectName } from "./project";
import { formatExactTime, formatRelativeTime } from "./relative-time";

/** Height of one inbox row in CSS pixels. Owned by JS; see `bindRow()`. */
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
   * Test seam. Production measures the panel's own client height; happy-dom
   * has no layout.
   */
  viewportHeight?: number;
}

export class InboxPanel {
  private entries: InboxEntry[] = [];
  private status: InboxStatus;
  private openPaths: ReadonlySet<string> = new Set();
  private activePath: string | null = null;

  private readonly header: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly statusHost: HTMLDivElement;
  private readonly list: HTMLUListElement;

  /** Rendered rows by index in the current window. */
  private readonly rendered = new Map<number, HTMLElement>();
  private readonly freeRows: HTMLElement[] = [];
  private rafId: number | null = null;

  private total = 0;
  private unread = 0;

  private readonly onScroll = (): void => this.scheduleWindow();
  private readonly onResize = (): void => this.scheduleWindow();

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

    this.header = document.createElement("div");
    this.header.className = "inbox-header";
    const title = document.createElement("span");
    title.className = "inbox-title";
    title.textContent = "Inbox";
    this.countEl = document.createElement("span");
    this.countEl.className = "inbox-count";
    this.header.append(title, this.countEl);

    this.statusHost = document.createElement("div");
    this.statusHost.className = "inbox-status";

    this.list = document.createElement("ul");
    this.list.className = "inbox-list";
    this.bindRowEvents();

    this.root.replaceChildren(this.header, this.statusHost, this.list);
    this.root.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
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
    this.list.style.height = `${entries.length * ROW_HEIGHT}px`;
    this.renderWindow(true);
  }

  /**
   * Repaints the active/open/unread state of one row without touching the list.
   * Called on every tab activation.
   */
  public setActive(
    previous: string | null,
    active: string | null,
    unread: number,
  ): void {
    this.activePath = active;
    if (previous && previous !== active) {
      this.rowFor(previous)?.classList.remove("active");
    }
    const row = active === null ? undefined : this.rowFor(active);
    if (row) {
      row.classList.add("active", "open");
      row.classList.remove("unread");
    }
    this.unread = unread;
    this.renderCount();
  }

  /** Updates only the scan status line; the row list is untouched. */
  public setProgress(progress: ScanProgress | null): void {
    this.status = { ...this.status, progress };
    this.renderStatus();
    this.scheduleWindow();
  }

  /** Re-paints after the panel is shown or the window is resized. */
  public refresh(): void {
    this.renderWindow(true);
  }

  /** Releases the scroll and resize listeners. */
  public destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.root.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
  }

  private renderHeader(): void {
    this.total = this.entries.length;
    this.unread = this.entries.filter((entry) => entry.unread).length;
    this.renderCount();
  }

  private renderCount(): void {
    const total = `${this.total} ${this.total === 1 ? "file" : "files"}`;
    this.countEl.textContent =
      this.unread > 0 ? `${total} · ${this.unread} new` : total;
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
        fragment.append(this.message(`Config error: ${this.status.error}`, "inbox-error"));
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
        fragment.append(this.message("No documents match the configured watches.", "inbox-empty"));
      }
    }

    this.statusHost.replaceChildren(fragment);
  }

  private bindRowEvents(): void {
    this.list.addEventListener("click", (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(".inbox-row");
      const path = row?.dataset.path;
      if (path) this.options.onOpen(path);
    });

    this.list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = (event.target as Element | null)?.closest<HTMLElement>(".inbox-row");
      const path = row?.dataset.path;
      if (!path) return;
      event.preventDefault();
      this.options.onOpen(path);
    });
  }

  private createRow(): HTMLElement {
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

  private bindRow(row: HTMLElement, index: number): void {
    const entry = this.entries[index];
    row.dataset.path = entry.path;
    row.style.top = `${index * ROW_HEIGHT}px`;
    row.style.height = `${ROW_HEIGHT}px`;
    row.className = "inbox-row";
    if (entry.unread) row.classList.add("unread");
    if (entry.deleted) row.classList.add("deleted");
    if (this.openPaths.has(entry.path)) row.classList.add("open");
    if (entry.path === this.activePath) row.classList.add("active");
    row.setAttribute("aria-posinset", String(index + 1));
    row.setAttribute("aria-setsize", String(this.entries.length));

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

    const now = this.options.now?.() ?? Date.now();
    const time = row.querySelector<HTMLTimeElement>(".inbox-time")!;
    time.dateTime = new Date(entry.modifiedTime).toISOString();
    time.textContent = formatRelativeTime(entry.modifiedTime, now);
    time.title = formatExactTime(entry.modifiedTime);
  }

  private rowFor(path: string): HTMLElement | undefined {
    for (const row of this.rendered.values()) {
      if (row.dataset.path === path) return row;
    }
    return undefined;
  }

  private measureViewport(): number {
    return this.options.viewportHeight ?? this.root.clientHeight;
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
    const viewport = this.measureViewport();
    if (viewport <= 0) {
      this.recycleAll();
      return;
    }

    const offset = Math.max(0, this.root.scrollTop - this.list.offsetTop);
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
      if (row === undefined) {
        row = this.freeRows.pop() ?? this.createRow();
        this.rendered.set(index, row);
        this.bindRow(row, index);
        this.list.insertBefore(row, this.rendered.get(index + 1) ?? null);
      } else if (rebind) {
        this.bindRow(row, index);
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

  private scanMessage(progress: ScanProgress | null): HTMLElement {
    if (!progress) return this.message("Scanning watched paths…", "inbox-loading");

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
    // Expanding or collapsing the warnings moves the list; re-window once the
    // new status height is known.
    details.addEventListener("toggle", () => this.scheduleWindow());

    const summary = document.createElement("summary");
    summary.textContent = `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;

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
