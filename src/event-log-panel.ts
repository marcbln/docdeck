/**
 * Docked, session-only event log.
 *
 * Reads the `EventLog` store and owns only transient UI state: visibility,
 * filter, follow/pause, and the new-event counter. Appending one entry never
 * re-renders the list, so a paused scroll position is preserved.
 */

import type { EventLog, StatusEvent } from "./event-log";

export type LogFilter = "all" | "warnings";

export interface EventLogPanelOptions {
  log: EventLog;
  /** Timestamp formatter; injectable for deterministic tests. */
  formatTime?: (at: number) => string;
  onClear?(): void;
  onVisibilityChange?(open: boolean): void;
}

/** "Near the bottom" per the contract. */
const FOLLOW_THRESHOLD_PX = 24;

function defaultFormatTime(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

export class EventLogPanel {
  private readonly options: EventLogPanelOptions;
  private readonly scroll: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLParagraphElement;
  private readonly pill: HTMLButtonElement;
  private readonly filterButtons: Record<LogFilter, HTMLButtonElement>;

  private openState = false;
  private filter: LogFilter = "all";
  private followingState = true;
  private lastId = 0;
  private pendingCount = 0;
  private opener: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    options: EventLogPanelOptions,
  ) {
    this.options = options;
    root.classList.add("event-log");
    root.hidden = true;

    const header = document.createElement("header");
    header.className = "event-log-header";

    const title = document.createElement("span");
    title.className = "event-log-title";
    title.textContent = "Event log";

    const filters = document.createElement("div");
    filters.className = "event-log-filters";
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Event log filter");
    this.filterButtons = {
      all: this.filterButton("all", "All"),
      warnings: this.filterButton("warnings", "Warnings"),
    };
    filters.append(this.filterButtons.all, this.filterButtons.warnings);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "event-log-clear";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => this.clear());

    const close = document.createElement("button");
    close.type = "button";
    close.className = "event-log-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close the event log");
    close.addEventListener("click", () => this.close());

    header.append(title, filters, clear, close);

    this.scroll = document.createElement("div");
    this.scroll.className = "event-log-scroll";
    this.list = document.createElement("ol");
    this.list.className = "event-log-list";
    this.empty = document.createElement("p");
    this.empty.className = "event-log-empty";
    this.empty.hidden = true;
    this.scroll.append(this.list, this.empty);

    this.pill = document.createElement("button");
    this.pill.type = "button";
    this.pill.className = "event-log-new";
    this.pill.hidden = true;
    this.pill.addEventListener("click", () => this.followBottom());

    root.replaceChildren(header, this.scroll, this.pill);

    this.scroll.addEventListener("scroll", this.onScroll);
    root.addEventListener("keydown", this.onKeyDown);
    this.setFilter("all");
  }

  public get isOpen(): boolean {
    return this.openState;
  }

  public get filterMode(): LogFilter {
    return this.filter;
  }

  public get following(): boolean {
    return this.followingState;
  }

  public get newEventCount(): number {
    return this.pendingCount;
  }

  public open(opener: HTMLElement | null = null, filter?: LogFilter): void {
    this.opener = opener;
    this.openState = true;
    this.root.hidden = false;
    this.setFilter(filter ?? this.filter);
    this.followingState = true;
    this.pendingCount = 0;
    this.pill.hidden = true;
    this.renderAll();
    this.followBottom();
    this.options.onVisibilityChange?.(true);
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.hidden = true;
    const opener = this.opener;
    this.opener = null;
    this.options.onVisibilityChange?.(false);
    if (opener?.isConnected) opener.focus();
  }

  public toggle(opener: HTMLElement | null = null): void {
    if (this.openState) this.close();
    else this.open(opener, this.filter);
  }

  public setFilter(filter: LogFilter): void {
    this.filter = filter;
    for (const [mode, button] of Object.entries(this.filterButtons)) {
      const active = mode === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  /** Appends entries recorded since the last call, without a full re-render. */
  public sync(): void {
    const entries = this.options.log.entries();
    if (entries.length === 0) return;

    if (!this.openState) {
      this.lastId = entries[entries.length - 1].id;
      return;
    }

    let added = 0;
    for (const entry of entries) {
      if (entry.id <= this.lastId) continue;
      this.lastId = entry.id;
      if (!this.matches(entry)) continue;
      this.list.append(this.row(entry));
      added += 1;
    }

    if (added === 0) return;
    this.empty.hidden = true;

    if (this.followingState) {
      this.followBottom();
    } else {
      this.pendingCount += added;
      this.showPill();
    }
  }

  public clear(): void {
    this.options.log.clear();
    this.list.replaceChildren();
    this.lastId = 0;
    this.pendingCount = 0;
    this.pill.hidden = true;
    this.updateEmptyState();
    this.options.onClear?.();
  }

  private filterButton(filter: LogFilter, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-log-filter";
    button.dataset.filter = filter;
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      this.setFilter(filter);
      this.renderAll();
      this.onScroll();
    });
    return button;
  }

  private matches(entry: StatusEvent): boolean {
    return this.filter === "all" || entry.severity === "warning";
  }

  private renderAll(): void {
    this.list.replaceChildren();
    for (const entry of this.options.log.entries()) {
      this.lastId = entry.id;
      if (this.matches(entry)) this.list.append(this.row(entry));
    }
    this.updateEmptyState();
  }

  private updateEmptyState(): void {
    if (this.list.childElementCount > 0) {
      this.empty.hidden = true;
      return;
    }
    this.empty.hidden = false;
    this.empty.textContent =
      this.filter === "warnings"
        ? "No warnings in this session"
        : "No events in this session";
  }

  private row(entry: StatusEvent): HTMLLIElement {
    const item = document.createElement("li");
    item.className = `event-log-row event-log-row--${entry.severity}`;
    item.dataset.severity = entry.severity;
    item.dataset.kind = entry.kind;

    const time = document.createElement("span");
    time.className = "event-log-time";
    const formatter = this.options.formatTime ?? defaultFormatTime;
    time.textContent = formatter(entry.at);

    const severity = document.createElement("span");
    severity.className = "event-log-severity";
    severity.textContent = entry.severity;

    const message = document.createElement("span");
    message.className = "event-log-message";
    message.textContent = entry.message;

    item.append(time, severity, message);

    if (entry.detail) {
      const detail = document.createElement("span");
      detail.className = "event-log-detail";
      detail.textContent = entry.detail;
      item.append(detail);
    }

    return item;
  }

  private distanceFromBottom(): number {
    const max = this.scroll.scrollHeight - this.scroll.clientHeight;
    return Math.max(0, max - this.scroll.scrollTop);
  }

  private onScroll = (): void => {
    const nearBottom = this.distanceFromBottom() <= FOLLOW_THRESHOLD_PX;
    this.followingState = nearBottom;
    if (nearBottom) {
      this.pendingCount = 0;
      this.pill.hidden = true;
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.openState || event.key !== "Escape") return;
    event.preventDefault();
    this.close();
  };

  private followBottom(): void {
    this.scroll.scrollTop = this.scroll.scrollHeight;
    this.followingState = true;
    this.pendingCount = 0;
    this.pill.hidden = true;
  }

  private showPill(): void {
    this.pill.textContent = `${this.pendingCount} new event${
      this.pendingCount === 1 ? "" : "s"
    }`;
    this.pill.hidden = false;
  }
}
