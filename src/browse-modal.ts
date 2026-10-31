import type { InboxEntry } from "./inbox-model";
import { bindInboxRow, createInboxRow } from "./sidebar-rows";
import { OVERSCAN, ROW_HEIGHT, visibleRange } from "./virtual-list";

interface InboxBrowserOptions {
  onOpen(path: string): void;
  now?: () => number;
  viewportHeight?: number;
}

/**
 * The All-files modal.
 *
 * It is the full-height escape hatch for the inline browse list, so it keeps the
 * windowed renderer: only the visible rows exist in the DOM no matter how many
 * files the config matches.
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
    const activate = (event: Event): void => {
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
