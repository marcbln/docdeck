/**
 * Windowed list geometry and a reusable DOM recycler.
 *
 * Only the visible rows plus a small overscan exist in the DOM, so an inventory
 * of thousands of documents does not make every watcher event an O(n) rebuild.
 */

/** Height of one list row in CSS pixels. */
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
 * `scrollOffset` is measured from the top of the list (not the scroll host), so
 * the caller subtracts any list offset before calling.
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

export interface VirtualListOptions<T> {
  /** Builds an unbound row; the recycler reuses it via `bindRow`. */
  createRow(): HTMLElement;
  /** Fills a row's content, dataset and state. */
  bindRow(row: HTMLElement, item: T, index: number): void;
  /** Called when a row is activated by click, Enter or Space. */
  onActivate?(item: T): void;
  rowHeight?: number;
  overscan?: number;
  /** Test seam; production measures the scroll host. */
  viewportHeight?: number;
}

/**
 * A virtualized list bound to one scroll host.
 *
 * Rows are absolutely positioned inside the list, whose height represents the
 * full item count. Scrolling swaps the window instead of growing the DOM.
 */
export class VirtualList<T> {
  private items: readonly T[] = [];
  private readonly rendered = new Map<number, HTMLElement>();
  private readonly freeRows: HTMLElement[] = [];
  private rafId: number | null = null;
  private readonly rowHeight: number;
  private readonly overscan: number;

  private readonly onScroll = (): void => this.schedule();

  constructor(
    private readonly list: HTMLUListElement,
    private readonly scrollHost: HTMLElement,
    private readonly options: VirtualListOptions<T>,
  ) {
    this.rowHeight = options.rowHeight ?? ROW_HEIGHT;
    this.overscan = options.overscan ?? OVERSCAN;
    this.scrollHost.addEventListener("scroll", this.onScroll, { passive: true });
    this.bindRowEvents();
  }

  /** Replaces the item set and repaints the visible window. */
  setItems(items: readonly T[]): void {
    this.items = items;
    this.list.style.height = `${items.length * this.rowHeight}px`;
    this.renderWindow(true);
  }

  /** Repaints the current window; call after the scroll host is resized. */
  refresh(): void {
    this.renderWindow(true);
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.scrollHost.removeEventListener("scroll", this.onScroll);
    this.recycleAll();
  }

  private bindRowEvents(): void {
    const activate = (event: Event): void => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row, .sidebar-row",
      );
      if (!row) return;
      const index = Number(row.dataset.index);
      if (!Number.isInteger(index)) return;
      const item = this.items[index];
      if (item === undefined) return;
      this.options.onActivate?.(item);
    };

    this.list.addEventListener("click", activate);
    this.list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".inbox-row, .sidebar-row",
      );
      if (!row || event.target !== row) return;
      event.preventDefault();
      activate(event);
    });
  }

  private schedule(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderWindow(false);
    });
  }

  /**
   * Puts exactly the visible range in the DOM.
   *
   * `rebind` is true after the items change: every rendered row is re-bound
   * because its index may now point at a different document. Scrolling passes
   * false so only entering rows are bound.
   */
  private renderWindow(rebind: boolean): void {
    const viewport = this.options.viewportHeight ?? this.scrollHost.clientHeight;
    if (viewport <= 0) {
      this.recycleAll();
      return;
    }

    const offset = Math.max(0, this.scrollHost.scrollTop - this.list.offsetTop);
    const { start, end } = visibleRange(
      offset,
      viewport,
      this.rowHeight,
      this.items.length,
      this.overscan,
    );

    for (const [index, row] of this.rendered) {
      if (index < start || index >= end) {
        this.rendered.delete(index);
        row.remove();
        this.freeRows.push(row);
      }
    }

    for (let index = end - 1; index >= start; index -= 1) {
      let row = this.rendered.get(index);
      const fresh = row === undefined;
      if (row === undefined) {
        row = this.freeRows.pop() ?? this.options.createRow();
        this.rendered.set(index, row);
        this.list.insertBefore(row, this.rendered.get(index + 1) ?? null);
      }
      row.dataset.index = String(index);
      row.style.top = `${index * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      row.setAttribute("aria-posinset", String(index + 1));
      row.setAttribute("aria-setsize", String(this.items.length));
      if (rebind || fresh) {
        this.options.bindRow(row, this.items[index], index);
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
