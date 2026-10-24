import {
  findMatches,
  flattenSearchableText,
  matchToRange,
  type MatchInterval,
  type SearchableText,
} from "./find-text";

/** Highlight registry names, one per visual layer. */
const MATCH_HIGHLIGHT = "docdeck-find-match";
const CURRENT_HIGHLIGHT = "docdeck-find-current";

const EMPTY_SEARCHABLE: SearchableText = { text: "", segments: [] };

/** Paints and clears the two highlight layers. */
export interface HighlightSink {
  set(name: string, ranges: Range[]): void;
  clear(name: string): void;
}

/** Where the active match sat before a document repaint. */
export interface FindAnchor {
  offset: number;
  wasVisible: boolean;
}

export interface FindControllerOptions {
  /** The rendered document whose text is searched. */
  viewer: HTMLElement;
  /** The scrollable pane that contains the viewer. */
  scrollParent: HTMLElement;
  /** False while the empty state is showing. */
  hasDocument: () => boolean;
  /** Test seam; production uses CSS.highlights. `null` disables painting. */
  highlights?: HighlightSink | null;
}

/** Production adapter over the CSS Custom Highlight API. */
function cssHighlightSink(): HighlightSink | null {
  const registry = (
    globalThis as { CSS?: { highlights?: HighlightRegistry } }
  ).CSS?.highlights;

  if (!registry) return null;

  return {
    set(name, ranges) {
      registry.set(name, new Highlight(...ranges));
    },
    clear(name) {
      registry.delete(name);
    },
  };
}

type Selection =
  | { kind: "first" }
  | { kind: "keep" }
  | { kind: "nearest"; offset: number };

/** Last match starting at or before `offset`, or the first match. */
function nearestIndex(matches: MatchInterval[], offset: number): number {
  let index = 0;

  for (let current = 0; current < matches.length; current += 1) {
    if (matches[current].start > offset) break;
    index = current;
  }

  return index;
}

function makeButton(
  className: string,
  label: string,
  text: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = text;
  return button;
}

/** happy-dom does not implement Range geometry; real browsers do. */
function rangeRect(range: Range): DOMRect | null {
  if (typeof range.getBoundingClientRect !== "function") return null;
  return range.getBoundingClientRect();
}

/**
 * Owns the floating find bar and the highlight state for the active document.
 *
 * The controller never mutates the rendered document: matches are kept as
 * Ranges and painted through the CSS Custom Highlight API. A repaint replaces
 * every Range, so `captureAnchor()` must run before the viewer is cleared and
 * `refresh()` after the new content is mounted.
 */
export class FindController {
  private readonly layer: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLSpanElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly highlights: HighlightSink | null;
  private readonly onWindowKeyDown: (event: KeyboardEvent) => void;

  private query = "";
  private caseSensitive = false;
  private searched: SearchableText = EMPTY_SEARCHABLE;
  private matches: MatchInterval[] = [];
  private activeIndex = -1;
  private opened = false;

  constructor(private readonly options: FindControllerOptions) {
    this.highlights =
      options.highlights === undefined ? cssHighlightSink() : options.highlights;

    this.layer = document.createElement("div");
    this.layer.className = "find-bar-layer";
    this.layer.hidden = true;

    const bar = document.createElement("div");
    bar.className = "find-bar";
    bar.setAttribute("role", "search");

    const field = document.createElement("div");
    field.className = "find-bar-field";

    const icon = document.createElement("span");
    icon.className = "find-bar-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"></circle><path d="m10.4 10.4 3.1 3.1"></path></svg>';

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = "find-bar-input";
    this.input.placeholder = "Find";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Find in document");

    this.count = document.createElement("span");
    this.count.className = "find-bar-count";
    this.count.setAttribute("role", "status");
    this.count.setAttribute("aria-live", "polite");
    this.count.textContent = "0/0";

    this.prevButton = makeButton(
      "find-bar-prev",
      "Previous match (Shift+Enter)",
      "↑",
    );
    this.nextButton = makeButton("find-bar-next", "Next match (Enter)", "↓");
    this.caseButton = makeButton("find-bar-case", "Match case", "Aa");
    this.caseButton.setAttribute("aria-pressed", "false");
    this.closeButton = makeButton("find-bar-close", "Close find", "×");

    field.append(icon, this.input);

    bar.append(
      field,
      this.count,
      this.prevButton,
      this.nextButton,
      this.caseButton,
      this.closeButton,
    );
    this.layer.append(bar);
    this.options.scrollParent.prepend(this.layer);

    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.recompute({ kind: "first" });
      this.scrollToActive();
    });

    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });

    this.prevButton.addEventListener("click", () => this.step(-1));
    this.nextButton.addEventListener("click", () => this.step(1));
    this.closeButton.addEventListener("click", () => this.close());

    this.caseButton.addEventListener("click", () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
      this.caseButton.classList.toggle("active", this.caseSensitive);

      if (this.query.length > 0) {
        this.recompute({ kind: "first" });
        this.scrollToActive();
      }
    });

    this.onWindowKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        this.open();
        return;
      }

      if (event.key === "Escape" && this.opened) {
        event.preventDefault();
        this.close();
      }
    };
    window.addEventListener("keydown", this.onWindowKeyDown);
    this.paintCount();
  }

  public isOpen(): boolean {
    return this.opened;
  }

  /** Opens the bar and focuses the query field. */
  public open(): void {
    if (!this.options.hasDocument()) return;

    if (!this.opened) {
      this.opened = true;
      this.layer.hidden = false;
    }

    this.input.focus();
    this.input.select();
  }

  /** Closes the bar and drops the query and all highlights. */
  public close(): void {
    if (!this.opened) return;

    this.opened = false;
    this.layer.hidden = true;
    this.input.value = "";
    this.input.blur();
    this.query = "";
    this.searched = EMPTY_SEARCHABLE;
    this.matches = [];
    this.activeIndex = -1;
    this.clearHighlights();
    this.paintCount();
  }

  /**
   * Records where the active match is before the viewer is repainted.
   * Returns null when the bar is closed or nothing is active.
   */
  public captureAnchor(): FindAnchor | null {
    if (!this.opened || this.activeIndex < 0) return null;

    const range = this.activeRange();
    const rect = range ? rangeRect(range) : null;
    const offset = this.matches[this.activeIndex].start;

    if (!rect) return { offset, wasVisible: false };

    const view = this.options.scrollParent.getBoundingClientRect();
    return {
      offset,
      wasVisible: rect.bottom >= view.top && rect.top <= view.bottom,
    };
  }

  /**
   * Rebuilds ranges against the current DOM after a render or a metadata
   * fold. Only scrolls when the active match was visible before.
   */
  public refresh(anchor: FindAnchor | null): void {
    if (!this.opened) return;

    if (this.query.length === 0) {
      this.searched = EMPTY_SEARCHABLE;
      this.matches = [];
      this.activeIndex = -1;
      this.clearHighlights();
      this.paintCount();
      return;
    }

    this.recompute(
      anchor ? { kind: "nearest", offset: anchor.offset } : { kind: "keep" },
    );

    if (anchor?.wasVisible) this.scrollToActive();
  }

  /** Removes the window listener and the bar. Used by tests and teardown. */
  public destroy(): void {
    window.removeEventListener("keydown", this.onWindowKeyDown);
    this.layer.remove();
  }

  private recompute(selection: Selection): void {
    this.searched = flattenSearchableText(this.options.viewer);
    this.matches = findMatches(
      this.searched.text,
      this.query,
      this.caseSensitive,
    );

    if (this.matches.length === 0) {
      this.activeIndex = -1;
    } else if (selection.kind === "first") {
      this.activeIndex = 0;
    } else if (selection.kind === "nearest") {
      this.activeIndex = nearestIndex(this.matches, selection.offset);
    } else {
      this.activeIndex =
        this.activeIndex < 0
          ? 0
          : Math.min(this.activeIndex, this.matches.length - 1);
    }

    this.paintHighlights();
    this.paintCount();
  }

  private step(delta: number): void {
    if (this.matches.length === 0) return;

    this.activeIndex =
      (this.activeIndex + delta + this.matches.length) % this.matches.length;
    this.paintHighlights();
    this.paintCount();
    this.scrollToActive();
  }

  private activeRange(): Range | null {
    if (this.activeIndex < 0) return null;
    return matchToRange(this.searched, this.matches[this.activeIndex]);
  }

  private paintHighlights(): void {
    if (!this.highlights) return;

    const ranges: Range[] = [];
    this.matches.forEach((match, index) => {
      if (index === this.activeIndex) return;

      const range = matchToRange(this.searched, match);
      if (range) ranges.push(range);
    });

    this.highlights.clear(MATCH_HIGHLIGHT);
    this.highlights.clear(CURRENT_HIGHLIGHT);

    if (ranges.length > 0) this.highlights.set(MATCH_HIGHLIGHT, ranges);

    const current = this.activeRange();
    if (current) this.highlights.set(CURRENT_HIGHLIGHT, [current]);
  }

  private clearHighlights(): void {
    this.highlights?.clear(MATCH_HIGHLIGHT);
    this.highlights?.clear(CURRENT_HIGHLIGHT);
  }

  private paintCount(): void {
    const total = this.matches.length;

    this.count.textContent =
      total === 0 ? "0/0" : `${this.activeIndex + 1}/${total}`;
    this.count.classList.toggle("empty", total === 0 && this.query.length > 0);
    this.prevButton.disabled = total === 0;
    this.nextButton.disabled = total === 0;
  }

  private scrollToActive(): void {
    const range = this.activeRange();
    const rect = range ? rangeRect(range) : null;
    if (!rect) return;

    const view = this.options.scrollParent.getBoundingClientRect();
    const margin = 24;
    const comfortablyVisible =
      rect.top >= view.top + margin && rect.bottom <= view.bottom - margin;

    if (comfortablyVisible) return;

    const target = view.top + Math.max(margin, (view.height - rect.height) / 2);
    this.options.scrollParent.scrollTop += rect.top - target;
  }
}
