import type { FrontmatterRow } from "./frontmatter";
import {
  createMetadataTable,
  type MetadataTableOptions,
} from "./metadata-table";

const METADATA_ANCHOR_ID = "doc-metadata";

/**
 * Owns the frontmatter table's collapsed state.
 *
 * Collapsed state lives here rather than on the element because every live
 * reload rebuilds the `<details>` from scratch — without a durable record, an
 * agent appending to a document would silently re-expand the table the reader
 * had just folded away.
 */
export class MetadataView {
  private expanded: boolean;
  private current: HTMLDetailsElement | null = null;
  private readonly viewer: HTMLElement;

  constructor(viewer: HTMLElement, expanded: boolean) {
    this.viewer = viewer;
    this.expanded = expanded;
  }

  public isExpanded(): boolean {
    return this.expanded;
  }

  /** Mounts (or updates) the table at the top of the viewer. */
  public mount(rows: FrontmatterRow[], options: MetadataTableOptions = {}): void {
    const table = createMetadataTable(rows, {
      ...options,
      expanded: this.expanded,
    });
    this.current = table;

    // Re-read the element's own state: the reader may have folded the table
    // without going through any of our own controls.
    table.addEventListener("toggle", () => {
      this.expanded = table.open;
    });

    // Placed before the existing body content so the header reads as a header.
    this.viewer.prepend(table);
  }

  /** Expands the table and scrolls it into view. Used by the TOC entry. */
  public reveal(): void {
    if (!this.current) return;
    this.current.open = true;
    this.expanded = true;
    this.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  public clear(): void {
    this.current = null;
  }
}

export { METADATA_ANCHOR_ID };