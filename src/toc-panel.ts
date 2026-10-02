import type { Heading } from "./toc";

/** Id of the metadata table the pinned TOC entry jumps to. */
const METADATA_ANCHOR_ID = "doc-metadata";
const METADATA_LABEL = "Document metadata";

/** Offset in px used when jumping to a heading, clearing the sticky header. */
const SCROLL_OFFSET_PX = 12;

export interface TocPanelOptions {
  /** The <nav> that lists the outline. */
  container: HTMLElement;
  /** The scrollable pane the headings live in. */
  scrollParent: HTMLElement;
  /** Expands the metadata table before scrolling to it. */
  onJumpToMetadata?: () => void;
}

/**
 * Renders the outline and tracks the reading position.
 *
 * The observer is rebuilt on every render — the underlying heading elements are
 * replaced wholesale by each live reload, so stale observers would reference
 * detached nodes and silently stop tracking.
 */
export class TocPanel {
  private observer: IntersectionObserver | null = null;
  private readonly entryBySlug = new Map<string, HTMLLIElement>();
  private readonly headings: Heading[] = [];
  private readonly metadataEntry: HTMLLIElement;
  private readonly list: HTMLUListElement;
  private readonly options: TocPanelOptions;

  constructor(options: TocPanelOptions) {
    this.options = options;
    this.options.container.replaceChildren();

    this.list = document.createElement("ul");
    this.list.className = "toc-list";

    // The metadata entry is always present — an entry that vanished when the
    // reader needed it would be a trap.
    this.metadataEntry = document.createElement("li");
    this.metadataEntry.className = "toc-item toc-item-metadata";
    const metadataLink = document.createElement("a");
    metadataLink.className = "toc-link";
    metadataLink.href = `#${METADATA_ANCHOR_ID}`;
    metadataLink.textContent = METADATA_LABEL;
    metadataLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.options.onJumpToMetadata?.();
    });
    this.metadataEntry.appendChild(metadataLink);

    this.options.container.append(this.metadataEntry, this.list);
  }

  public rebuild(headings: Heading[]): void {
    this.headings.splice(0, this.headings.length, ...headings);
    this.list.replaceChildren();
    this.entryBySlug.clear();
    this.disconnect();

    if (headings.length === 0) {
      this.options.container.classList.add("toc-empty");
      return;
    }
    this.options.container.classList.remove("toc-empty");

    for (const heading of headings) {
      const item = document.createElement("li");
      item.className = `toc-item toc-depth-${heading.depth}`;

      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = `#${heading.slug}`;
      link.textContent = heading.text;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.scrollTo(heading.slug);
      });

      item.appendChild(link);
      this.list.appendChild(item);
      this.entryBySlug.set(heading.slug, item);
    }

    this.observe();
  }

  private scrollTo(slug: string): void {
    const target = document.getElementById(slug);
    if (!target) return;

    const top =
      target.getBoundingClientRect().top -
      this.options.scrollParent.getBoundingClientRect().top +
      this.options.scrollParent.scrollTop -
      SCROLL_OFFSET_PX;
    this.options.scrollParent.scrollTo({ top, behavior: "smooth" });
    this.setActive(slug);
  }

  private observe(): void {
    if (typeof IntersectionObserver === "undefined") return;

    this.observer = new IntersectionObserver(
      (entries) => {
        // The topmost intersecting heading is the one being read.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (!first) return;
        this.setActive(first.target.id);
      },
      {
        root: this.options.scrollParent,
        // A band near the top of the pane: a heading counts as "current" once it
        // reaches the top third rather than merely being on screen.
        rootMargin: `-${SCROLL_OFFSET_PX}px 0px -70% 0px`,
        threshold: 0,
      },
    );

    for (const heading of this.headings) {
      const element = document.getElementById(heading.slug);
      if (element) this.observer.observe(element);
    }
  }

  private setActive(slug: string): void {
    for (const [key, item] of this.entryBySlug) {
      item.classList.toggle("active", key === slug);
    }

    const active = this.entryBySlug.get(slug);
    if (active) {
      // Keep the active entry in view without scrolling the whole page.
      active.scrollIntoView({ block: "nearest" });
    }
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}