---
filename: "_ai/backlog/active/261024_0701__IMPLEMENTATION_PLAN__in-document-find.md"
title: "In-document find with Chrome-style match highlighting"
createdAt: 2026-10-24 07:01
updatedAt: 2026-10-24 07:01
status: completed
completedAt: 2026-10-24 10:09
priority: medium
tags: [find, search, highlighting, ux, webview]
estimatedComplexity: moderate
documentRevision: 1
sourceSpec: ""
sourceHandoff: ""
sourceAdrs:
  - "_ai/technical_decisions/ADR__261024-1__css-custom-highlight-api-for-in-document-find.md"
  - "_ai/technical_decisions/ADR__261002-1__runtime-stylesheet-swapping-for-themes.md"
documentType: IMPLEMENTATION_PLAN
---

# In-document find with Chrome-style match highlighting

**Sources used:** the design discussion in this conversation and ADR
`261024-1` (CSS Custom Highlight API). No feature spec or design handoff file
exists for this work, so `sourceSpec` and `sourceHandoff` are empty.

## 1. Problem

docdeck renders long agent documents (plans, progress logs, status reports) into
a single live-updating pane. There is no way to locate a term inside the
document other than scrolling. A browser-style find — `Ctrl+F`, all matches
marked, a counter, and next/previous navigation — is missing.

The document is not plain text. It contains syntax-highlighted spans, tables,
task lists, a collapsible frontmatter table, copy buttons and Mermaid SVGs, and
the whole body is repainted whenever an agent writes to the file. A naive
highlight implementation that wraps matches in `<mark>` elements would fight
that pipeline. The search also has to survive a live reload without losing the
reader's place.

## 2. Executive summary

Add a floating find bar to the active document:

- `Ctrl+F` / `Cmd+F` opens it at the top-right of the document pane.
- Every match is painted yellow; the active match is orange, Chrome-style.
- A `n/m` counter, previous/next buttons, `Aa` case toggle and close button
  complete the bar.
- `Enter` / `Shift+Enter` step through matches with wraparound; `Esc` closes.
- Search is literal and case-insensitive by default; `Aa` makes it
  case-sensitive.
- A live reload keeps the query, rebuilds the ranges against the new DOM and
  selects the nearest match to the old active offset. The view follows that
  match only if the old one was visible.
- Switching tabs closes the bar; the search belongs to the active document.

The implementation uses the CSS Custom Highlight API over `Range`s built from a
flattened visible-text map. No rendered DOM is mutated, so Mermaid diagrams,
copy buttons, syntax highlighting and scroll preservation remain intact.

## 3. Design Decisions & Rejected Alternatives

| Decision | Rationale |
| --- | --- |
| Use the CSS Custom Highlight API with `Range`s (ADR `261024-1`) | No DOM mutation; matches across inline elements; cheap to rebuild after every repaint. |
| Flatten visible text with synthetic newlines at block boundaries | Prevents matches across paragraphs while allowing matches across inline markup. |
| Two highlight names, with the active range excluded from the "all" set | Guarantees the orange marker is not hidden by paint order; no reliance on `Highlight.priority`. |
| Search only the active document; close on tab switch | Matches the requested Ctrl-F scope and avoids a second cross-file search feature. |
| Literal matching plus an `Aa` toggle; no regex or whole-word mode | Keeps the UI small and the matching predictable; YAGNI. |
| Normalize source newlines/tabs to spaces outside `<pre>`; keep breaks inside `<pre>` | A phrase wrapped across Markdown source lines still matches like rendered text, while code lines stay separate. |
| Zero-height sticky layer inside the scroll pane | Overlays the document without reflowing it; no fixed-position math tied to the header. |
| Rebuild matches after every render, anchored by text offset | The viewer is replaced wholesale; stale ranges would silently stop painting. |
| Scroll only when the active match is not comfortably visible; reload follows only if it was visible | Avoids yanking a reader who deliberately scrolled away while keeping the place during agent writes. |
| Inject the highlight sink instead of calling `CSS.highlights` directly | happy-dom has no highlight registry; tests can assert painting without browser-only globals. |

Rejected alternatives:

- **`<mark>` wrapping.** Mutates the rendered DOM on every keystroke, needs
  unwrapping before each repaint, and risks breaking inline spans, copy buttons
  and Mermaid output.
- **`window.find()` / native webview find.** Non-standard, selects only one
  match, and offers no highlight-all or count.
- **Re-rendering Markdown with match markers injected into the source.**
  Rebuilds Mermaid diagrams, scroll state and copy buttons on every query
  change.
- **A header-row search field.** Always visible and less browser-like; the
  floating bar keeps the document pane unobstructed when closed.
- **Search across tabs or the inbox.** Out of scope; this is Ctrl-F, not a
  project-wide search.

## 4. Project environment

```
Project:        docdeck (Tauri 2 desktop Markdown viewer)
Platform:       Linux; WebKitGTK 2.52.6 (CSS Custom Highlight API supported)
Frontend:       TypeScript 6, Vite 8, marked 18, highlight.js 11, mermaid 11
Tests:          Vitest 5 with happy-dom 20, colocated as src/*.test.ts
Backend:        Rust (unchanged by this plan)
Package scripts: npm run typecheck, npm run test:web, npm run test,
                 npm run lint:rs, npm run check, npm run tauri dev
Formatting:     follow existing TypeScript style (2 spaces, double quotes,
                 semicolons, small focused modules, doc comments on exports)
Git workflow:   no project AGENTS.md exists; implement in the current workspace
                 and do not create branches or pull requests
Dependencies:   none new
```

Implementation order matters: the pure matcher comes first, then the
controller, then the app wiring. Each phase must leave `npm run typecheck` and
`npm run test:web` green.

## 5. Implementation phases

### Phase 1 — Pure search core

**Goal:** flatten the visible text of a rendered document into a searchable
string with a map back to text nodes, and find literal matches without touching
the DOM.

**Files**

- `[NEW FILE]` `src/find-text.ts`
- `[NEW FILE]` `src/find-text.test.ts`

**`[NEW FILE]` `src/find-text.ts`**

```ts
/** One run of searchable characters and the text node that owns it. */
export interface TextSegment {
  /** First character index in the flattened string. */
  start: number;
  /** One past the last character index. */
  end: number;
  node: Text;
}

/** Flattened document text plus the map back to its DOM text nodes. */
export interface SearchableText {
  text: string;
  segments: TextSegment[];
}

/** Half-open character interval in a `SearchableText`. */
export interface MatchInterval {
  start: number;
  end: number;
}

export interface TextPosition {
  node: Text;
  offset: number;
}

/** Elements whose text is never part of the document body. */
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
]);

/**
 * Elements that begin and end a text run. `TEXT` covers Mermaid SVG labels;
 * `BR` makes a hard line break a match boundary.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TEXT",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** App chrome rendered inside the viewer but not part of the document. */
const SKIPPED_CLASSES = ["code-copy", "deleted-banner"];

interface FlattenState {
  chunks: string[];
  segments: TextSegment[];
  length: number;
  lastWasSeparator: boolean;
}

function appendSeparator(state: FlattenState): void {
  if (state.length === 0 || state.lastWasSeparator) return;
  state.chunks.push("\n");
  state.length += 1;
  state.lastWasSeparator = true;
}

function appendText(state: FlattenState, node: Text, value: string): void {
  if (value.length === 0) return;

  state.segments.push({
    start: state.length,
    end: state.length + value.length,
    node,
  });
  state.chunks.push(value);
  state.length += value.length;
  state.lastWasSeparator = false;
}

function directSummary(details: Element): Element | null {
  for (const child of details.children) {
    if (child.tagName.toUpperCase() === "SUMMARY") return child;
  }
  return null;
}

function isInsideSummary(element: Element, details: Element): boolean {
  const summary = directSummary(details);
  return summary !== null && summary.contains(element);
}

function isSearchableElement(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName.toUpperCase())) return false;
  if (SKIPPED_CLASSES.some((name) => element.classList.contains(name))) {
    return false;
  }
  if (element.hasAttribute("hidden")) return false;

  // A closed <details> hides everything except its own <summary>. The element
  // itself must still be walked so the summary remains searchable.
  const closedDetails = element.closest("details:not([open])");
  if (
    closedDetails !== null &&
    closedDetails !== element &&
    !isInsideSummary(element, closedDetails)
  ) {
    return false;
  }

  if (
    typeof element.checkVisibility === "function" &&
    !element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
  ) {
    return false;
  }

  return true;
}

function walk(node: Node, state: FlattenState, preserveBreaks: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? "";
    // A newline inside a Markdown paragraph is rendered as a space, so a
    // phrase wrapped across source lines must still match. Inside <pre> the
    // line break is meaningful and stays a boundary.
    const normalized = preserveBreaks
      ? value
      : value.replace(/[\t\n\r\f\v]/g, " ");
    appendText(state, node as Text, normalized);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  if (!isSearchableElement(element)) return;

  const tag = element.tagName.toUpperCase();
  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) appendSeparator(state);

  const keepBreaks = preserveBreaks || tag === "PRE";
  for (const child of element.childNodes) walk(child, state, keepBreaks);

  if (isBlock) appendSeparator(state);
}

/**
 * Flattens the visible text under `root`.
 *
 * Block elements contribute synthetic newlines, which are not mapped to a text
 * node. The returned `segments` cover only real text, so `locate()` returns
 * null for a synthetic boundary.
 */
export function flattenSearchableText(root: Node): SearchableText {
  const state: FlattenState = {
    chunks: [],
    segments: [],
    length: 0,
    lastWasSeparator: true,
  };

  walk(root, state, false);

  const joined = state.chunks.join("");
  const text =
    state.lastWasSeparator && joined.length > 0 ? joined.slice(0, -1) : joined;

  return { text, segments: state.segments };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds non-overlapping literal matches.
 *
 * A RegExp with `g`/`gi` is used instead of `indexOf` on lower-cased strings:
 * it preserves the original UTF-16 offsets, which is what the range mapping
 * needs.
 */
export function findMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): MatchInterval[] {
  if (query.length === 0) return [];

  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  const matches: MatchInterval[] = [];

  for (let result = pattern.exec(text); result !== null; result = pattern.exec(text)) {
    if (result[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push({ start: result.index, end: result.index + result[0].length });
  }

  return matches;
}

/** Maps a character index back to its text node, or null at a synthetic break. */
export function locate(
  searched: SearchableText,
  index: number,
): TextPosition | null {
  let low = 0;
  let high = searched.segments.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = searched.segments[middle];

    if (index < segment.start) {
      high = middle - 1;
    } else if (index >= segment.end) {
      low = middle + 1;
    } else {
      return { node: segment.node, offset: index - segment.start };
    }
  }

  return null;
}

/** Builds a DOM range for a match, or null when an endpoint is synthetic. */
export function matchToRange(
  searched: SearchableText,
  match: MatchInterval,
): Range | null {
  const start = locate(searched, match.start);
  const end = locate(searched, match.end - 1);
  if (!start || !end) return null;

  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}
```

**`[NEW FILE]` `src/find-text.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  findMatches,
  flattenSearchableText,
  locate,
  matchToRange,
} from "./find-text";

function mount(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe("flattenSearchableText", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps inline text contiguous", () => {
    const root = mount("<p>Hello <strong>world</strong></p>");
    const searched = flattenSearchableText(root);

    expect(searched.text).toBe("Hello world");
    expect(locate(searched, 6)).toMatchObject({ offset: 0 });
  });

  it("separates block elements so matches cannot cross them", () => {
    const root = mount("<p>foo</p><p>bar</p>");
    const searched = flattenSearchableText(root);

    expect(searched.text).toBe("foo\nbar");
    expect(findMatches(searched.text, "foo bar", false)).toEqual([]);
  });

  it("treats a source line break inside prose as a space", () => {
    const root = mount("<p>foo\nbar</p>");

    expect(findMatches(flattenSearchableText(root).text, "foo bar", false))
      .toHaveLength(1);
  });

  it("keeps line breaks inside pre so code lines stay separate", () => {
    const root = mount("<pre><code>const x\nconst y</code></pre>");

    expect(findMatches(flattenSearchableText(root).text, "x const", false))
      .toEqual([]);
  });

  it("skips app chrome, hidden content and scripts", () => {
    const root = mount(`
      <p>visible</p>
      <button class="code-copy">⧉</button>
      <p class="deleted-banner">This file was deleted on disk.</p>
      <p hidden>secret</p>
      <details><summary>Summary</summary><p>folded</p></details>
      <script>scripted</script>
    `);
    const text = flattenSearchableText(root).text;

    expect(text).toContain("visible");
    expect(text).toContain("Summary");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("folded");
    expect(text).not.toContain("scripted");
    expect(text).not.toContain("⧉");
  });

  it("searches the content of an open details element", () => {
    const root = mount(
      "<details open><summary>Summary</summary><p>shown</p></details>",
    );

    expect(flattenSearchableText(root).text).toContain("shown");
  });

  it("includes Mermaid SVG labels", () => {
    const root = mount(
      '<div class="mermaid"><svg><text>Flow</text></svg></div>',
    );

    expect(flattenSearchableText(root).text).toContain("Flow");
  });
});

describe("findMatches", () => {
  it("is case-insensitive by default and exact when asked", () => {
    expect(findMatches("Foo foo", "foo", false)).toHaveLength(2);
    expect(findMatches("Foo foo", "foo", true)).toHaveLength(1);
  });

  it("treats regex metacharacters literally", () => {
    expect(findMatches("a.b axb", "a.b", false)).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatches("anything", "", false)).toEqual([]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa", false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("matchToRange", () => {
  it("spans inline elements", () => {
    const root = mount("<p>foo <strong>bar</strong></p>");
    const searched = flattenSearchableText(root);
    const match = findMatches(searched.text, "foo bar", false)[0];
    const range = matchToRange(searched, match);

    expect(range?.toString()).toBe("foo bar");
  });

  it("returns null when an endpoint falls on a synthetic break", () => {
    const root = mount("<p>foo</p><p>bar</p>");
    const searched = flattenSearchableText(root);

    expect(matchToRange(searched, { start: 3, end: 6 })).toBeNull();
  });
});
```

**Verification**

```bash
npm run typecheck
npx vitest run src/find-text.test.ts
```

If happy-dom's `Range.toString()` differs from a browser, assert the range's
`startContainer`/`startOffset`/`endContainer`/`endOffset` instead of the string.

---

### Phase 2 — Find controller and highlight painting

**Goal:** own the find bar DOM, keyboard interaction, match state and the CSS
Custom Highlight registry, with the browser API isolated behind an injectable
sink.

**Files**

- `[NEW FILE]` `src/find-bar.ts`
- `[NEW FILE]` `src/find-bar.test.ts`

**`[NEW FILE]` `src/find-bar.ts`**

```ts
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

    bar.append(
      this.input,
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
    this.count.classList.toggle("empty", total === 0);
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
```

**`[NEW FILE]` `src/find-bar.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { FindController, type HighlightSink } from "./find-bar";

class FakeHighlights implements HighlightSink {
  readonly entries = new Map<string, Range[]>();

  set(name: string, ranges: Range[]): void {
    this.entries.set(name, ranges);
  }

  clear(name: string): void {
    this.entries.delete(name);
  }
}

function mountDocument(html: string): {
  scrollParent: HTMLElement;
  viewer: HTMLElement;
} {
  document.body.replaceChildren();

  const scrollParent = document.createElement("main");
  const viewer = document.createElement("article");
  viewer.innerHTML = html;
  scrollParent.appendChild(viewer);
  document.body.appendChild(scrollParent);

  return { scrollParent, viewer };
}

function openFind(
  find: FindController,
  scrollParent: HTMLElement,
): HTMLInputElement {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
  );

  const input = scrollParent.querySelector<HTMLInputElement>(".find-bar-input");
  if (!input) throw new Error("find input was not mounted");
  return input;
}

function counter(scrollParent: HTMLElement): HTMLElement {
  const element = scrollParent.querySelector<HTMLElement>(".find-bar-count");
  if (!element) throw new Error("find counter was not mounted");
  return element;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

describe("FindController", () => {
  let highlights: FakeHighlights;

  beforeEach(() => {
    highlights = new FakeHighlights();
  });

  it("does not open without a document", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => false,
      highlights,
    });

    openFind(find, scrollParent);

    expect(find.isOpen()).toBe(false);
    find.destroy();
  });

  it("paints all matches and steps through them with wraparound", () => {
    const { scrollParent, viewer } = mountDocument(
      "<p>alpha beta alpha</p>",
    );
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(find, scrollParent);

    type(input, "alpha");

    expect(counter(scrollParent).textContent).toBe("1/2");
    expect(highlights.entries.get("docdeck-find-match")).toHaveLength(1);
    expect(highlights.entries.get("docdeck-find-current")).toHaveLength(1);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(counter(scrollParent).textContent).toBe("2/2");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
    );
    expect(counter(scrollParent).textContent).toBe("1/2");

    find.destroy();
  });

  it("re-runs the search when the case toggle changes", () => {
    const { scrollParent, viewer } = mountDocument("<p>Alpha alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(find, scrollParent);

    type(input, "alpha");
    expect(counter(scrollParent).textContent).toBe("1/2");

    const caseButton =
      scrollParent.querySelector<HTMLButtonElement>(".find-bar-case");
    if (!caseButton) throw new Error("case button was not mounted");
    caseButton.click();

    expect(caseButton.getAttribute("aria-pressed")).toBe("true");
    expect(counter(scrollParent).textContent).toBe("1/1");

    find.destroy();
  });

  it("closes on Escape, clears the query and removes highlights", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(find, scrollParent);

    type(input, "alpha");
    expect(highlights.entries.size).toBe(2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(find.isOpen()).toBe(false);
    expect(input.value).toBe("");
    expect(highlights.entries.size).toBe(0);
    expect(counter(scrollParent).textContent).toBe("0/0");

    find.destroy();
  });

  it("keeps the query and selects the nearest match after a repaint", () => {
    const { scrollParent, viewer } = mountDocument(
      "<p>alpha beta alpha</p>",
    );
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });
    const input = openFind(find, scrollParent);

    type(input, "alpha");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    const anchor = find.captureAnchor();
    viewer.innerHTML = "<p>new alpha</p><p>alpha</p>";
    find.refresh(anchor);

    expect(find.isOpen()).toBe(true);
    expect(counter(scrollParent).textContent).toBe("2/2");

    find.destroy();
  });

  it("scrolls a match into view when it is outside the viewport", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });

    const rangePrototype = Range.prototype as unknown as {
      getBoundingClientRect?: () => DOMRect;
    };
    const originalRangeRect = rangePrototype.getBoundingClientRect;
    const originalViewRect = scrollParent.getBoundingClientRect;

    rangePrototype.getBoundingClientRect = () =>
      ({
        top: 500,
        bottom: 520,
        height: 20,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 500,
        toJSON: () => ({}),
      }) as DOMRect;
    scrollParent.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 400,
        height: 400,
        left: 0,
        right: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const input = openFind(find, scrollParent);
    type(input, "alpha");

    expect(scrollParent.scrollTop).toBeGreaterThan(0);

    if (originalRangeRect) {
      rangePrototype.getBoundingClientRect = originalRangeRect;
    } else {
      delete rangePrototype.getBoundingClientRect;
    }
    scrollParent.getBoundingClientRect = originalViewRect;

    find.destroy();
  });

  it("removes the global listener on destroy", () => {
    const { scrollParent, viewer } = mountDocument("<p>alpha</p>");
    const find = new FindController({
      viewer,
      scrollParent,
      hasDocument: () => true,
      highlights,
    });

    find.destroy();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
    );

    expect(find.isOpen()).toBe(false);
  });
});
```

**Verification**

```bash
npm run typecheck
npx vitest run src/find-bar.test.ts
```

`HighlightSink` is the only browser-specific seam. Production code must still
work when `cssHighlightSink()` returns null: counts and navigation continue,
only the paint is skipped.

---

### Phase 3 — App wiring and styles

**Goal:** mount the controller in `AppState`, preserve the query across live
reloads, close it on tab switches, and add the Chrome-style bar/highlight CSS.

**Files**

- `[MODIFY]` `src/main.ts`
- `[MODIFY]` `src/style.css`

**`[MODIFY]` `src/main.ts` — import**

```ts
import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
+import { FindController } from "./find-bar";
 import { InboxModel, type InboxSeed } from "./inbox-model";
```

**`[MODIFY]` `src/main.ts` — field and constructor**

```ts
  private readonly writer = createPreferenceWriter();
  private readonly tocPanel: TocPanel;
+ private readonly find: FindController;
```

```ts
    this.tocPanel = new TocPanel({
      container: this.tocPanelEl,
      scrollParent: this.contentContainer,
      onJumpToMetadata: () => this.metadata.reveal(),
    });

+   this.find = new FindController({
+     viewer: this.viewer,
+     scrollParent: this.contentContainer,
+     hasDocument: () => this.activePath !== null,
+   });
+
+   // Expanding or folding the metadata table changes which text is visible.
+   // `toggle` does not bubble, so listen in the capture phase.
+   this.viewer.addEventListener(
+     "toggle",
+     () => this.find.refresh(this.find.captureAnchor()),
+     true,
+   );
```

**`[MODIFY]` `src/main.ts` — `renderActiveContent()`**

```ts
  private async renderActiveContent(): Promise<void> {
    const tab = this.activePath ? this.tabs.get(this.activePath) : undefined;

    if (!tab) {
+     this.find.close();
      this.renderedPath = null;
      this.emptyState.classList.remove("hidden");
      this.viewer.classList.add("hidden");
      this.viewer.replaceChildren();
      this.metadata.clear();
      this.tocPanel.rebuild([]);
      return;
    }

    this.emptyState.classList.add("hidden");
    this.viewer.classList.remove("hidden");

    // A different document starts at the top; only a re-render of the document
    // already on screen may inherit its scroll offset.
    const switching = this.activePath !== this.renderedPath;
+   if (switching) this.find.close();
+
+   // Capture before `replaceChildren()` detaches the ranges. A tab switch
+   // closes the bar above, so only a same-document repaint has an anchor.
+   const findAnchor = switching ? null : this.find.captureAnchor();
    this.renderedPath = this.activePath;

    const { raw, body } = splitFrontmatter(tab.content);
```

```ts
      this.tocPanel.rebuild(headings);
    } catch (error) {
      console.error("Failed to render markdown", error);
+     this.find.close();
      this.showMessage(`Could not render ${tab.filename}`);
    }

+   // Refresh after every render path. The metadata table is mounted before
+   // this point and the deletion banner may be prepended, so searching any
+   // earlier would miss nodes or compute against a body about to change.
+   this.find.refresh(findAnchor);
```

The refresh sits outside the `try` so a search bug can never be mistaken for a
render failure and blank the document. When the render failed, `find.close()`
already ran, so `refresh` is a no-op.

**`[MODIFY]` `src/style.css` — theme variables**

```css
 :root {
   --bg-primary: #1e1e2e;
   --bg-secondary: #181825;
   --bg-elevated: #313244;
   --border-color: #313244;
   --text-primary: #cdd6f4;
   --text-muted: #6c7086;
   --accent-color: #89b4fa;
   --dot-color: #fab387;
   --danger-color: #f38ba8;
+  --find-match-bg: #f9e2af;
+  --find-match-fg: #1e1e2e;
+  --find-current-bg: #fab387;
+  --find-current-fg: #1e1e2e;
   color-scheme: dark;
 }
```

```css
 [data-color-mode="light"] {
   --bg-primary: #eff1f5;
   --bg-secondary: #e6e9ef;
   --bg-elevated: #ccd0da;
   --border-color: #bcc0cc;
   --text-primary: #4c4f69;
   --text-muted: #6c6f85;
   --accent-color: #1e66f5;
   --dot-color: #fe640b;
   --danger-color: #d20f39;
+  --find-match-bg: #f9e2af;
+  --find-match-fg: #4c4f69;
+  --find-current-bg: #fe640b;
+  --find-current-fg: #eff1f5;
   color-scheme: light;
 }
```

**`[MODIFY]` `src/style.css` — find bar and highlight rules**

Add after the `#content-container` / document-pane block:

```css
/* --------------------------------------------------------------------------
   In-document find

   The layer is sticky inside the scroll pane and has zero height: the bar
   floats over the document without reflowing it. `pointer-events: none` lets
   clicks pass through the empty part of the layer.
   -------------------------------------------------------------------------- */

.find-bar-layer {
  position: sticky;
  top: 0;
  z-index: 6;
  height: 0;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.find-bar-layer[hidden] {
  display: none;
}

.find-bar {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 12px 16px 0 0;
  padding: 6px 8px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.find-bar-input {
  width: 200px;
  padding: 4px 6px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 12px;
}

.find-bar-input:focus {
  outline: 1px solid var(--accent-color);
  outline-offset: 0;
}

.find-bar-count {
  min-width: 44px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.find-bar-count.empty {
  color: var(--danger-color);
}

.find-bar button {
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.find-bar button:hover:not(:disabled) {
  background: var(--accent-color);
  color: var(--bg-primary);
}

.find-bar button:disabled {
  cursor: default;
  opacity: 0.4;
}

.find-bar button.active,
.find-bar button[aria-pressed="true"] {
  background: var(--accent-color);
  color: var(--bg-primary);
}

::highlight(docdeck-find-match) {
  background-color: var(--find-match-bg);
  color: var(--find-match-fg);
}

::highlight(docdeck-find-current) {
  background-color: var(--find-current-bg);
  color: var(--find-current-fg);
}
```

**Verification**

```bash
npm run typecheck
npm run test:web
```

Manual smoke test (Phase 4 covers the full checklist):

```bash
npm run tauri dev -- ./README.md
```

Press `Ctrl+F`, type `markdown`, confirm yellow matches and an orange active
match, press `Enter` and `Shift+Enter`, toggle `Aa`, press `Esc`.

---

### Phase 4 — Webview verification and hardening

**Goal:** verify behavior in the real WebKitGTK webview, where happy-dom cannot
model layout, painting or Mermaid, and fix anything the unit tests could not
catch.

**Files:** none planned up front; fix files from earlier phases only if a real
webview check fails.

**Manual checklist**

1. `npm run tauri dev -- ./README.md`.
2. `Ctrl+F` opens the bar at the top-right; focus is in the input.
3. Type a term with many hits: every match is yellow, the active one orange,
   and the counter matches the number of visible marks.
4. `Enter` / `Shift+Enter` move the active mark and wrap at the ends.
5. The active match is scrolled into view; matches already comfortably visible
   do not move the page when typed.
6. `Aa` changes the match count for a mixed-case term.
7. `Esc` closes the bar, clears the marks and leaves the scroll position.
8. Switch tabs: the bar closes and no marks remain.
9. Reopen the same document and search again; the bar is empty on reopen.
10. Live reload: search a term, scroll to a match, run
    `./scripts/simulate_agent_writes.sh` (or append to the file manually) and
    confirm the query and highlights survive, the nearest match stays active,
    and the view follows only when the old match was visible.
11. Fold the frontmatter table: matches inside the folded values disappear from
    the count; unfold and they return.
12. Search a Mermaid label. Confirm the label is painted. If WebKitGTK cannot
    paint `::highlight()` on SVG text, add `"SVG"` to `SKIPPED_TAGS` (or skip
    SVG text nodes specifically), update the Mermaid test to assert exclusion,
    and record the deviation in the implementation report so the counter never
    includes an invisible match.
13. Toggle light/dark mode: both marker colors keep readable contrast.
14. Hover a code block and confirm the copy button still works and is not
    searchable.
15. Open a very large document (for example a generated 10,000-line file) and
    type a short query. If input lags perceptibly, throttle recomputation with
    `requestAnimationFrame` or a ~50 ms debounce, but do not change the
    matching semantics.
16. Confirm the bar does not shift the document layout and remains visible
    while scrolling.

**Verification**

```bash
npm run typecheck
npm run test:web
```

Add a regression test for any bug found in this phase before fixing it when the
bug is expressible in happy-dom.

---

### Phase 5 — Documentation, changelog and implementation report

**Goal:** document the feature and record what was built.

**Files**

- `[MODIFY]` `README.md`
- `[MODIFY]` `CHANGELOG.md`
- `[NEW FILE]` `_ai/backlog/reports/261024_0701__IMPLEMENTATION_REPORT__in-document-find.md`

**`[MODIFY]` `README.md` — feature bullet**

Add after the table-of-contents bullet:

```markdown
- **In-document find** — `Ctrl+F` (or `Cmd+F`) opens a floating find bar with
  Chrome-style highlighting: every match is yellow, the active match is orange,
  and a `n/m` counter tracks your position. `Enter`/`Shift+Enter` step through
  matches, `Aa` toggles case sensitivity, and the search survives live reloads
  without losing your place.
```

**`[MODIFY]` `README.md` — controls table**

Add these rows after the theme row:

```markdown
| `Ctrl+F` / `Cmd+F` | Find in the active document |
| `Enter` / `Shift+Enter` | Next / previous match (wraps around) |
| `Aa` | Toggle case-sensitive matching |
| `Esc` | Close the find bar and clear highlights |
```

**`[MODIFY]` `README.md` — architecture list**

Add next to the other frontend modules:

```text
  find-text.ts        Visible-text flattening, literal matching, DOM ranges
  find-bar.ts         Floating find bar, match state, CSS highlight painting
```

**`[MODIFY]` `CHANGELOG.md`**

Add under `## [Unreleased]` → `### Added`:

```markdown
- In-document find: `Ctrl+F` (or `Cmd+F`) opens a floating find bar with
  Chrome-style yellow highlighting for every match and an orange active match,
  an `n/m` counter, case toggle, `Enter`/`Shift+Enter` navigation, and
  live-reload persistence.
```

**`[NEW FILE]` `_ai/backlog/reports/261024_0701__IMPLEMENTATION_REPORT__in-document-find.md`**

Use this frontmatter (fill counts and status from the actual implementation):

```yaml
---
filename: "_ai/backlog/reports/261024_0701__IMPLEMENTATION_REPORT__in-document-find.md"
title: "Report: In-document find with Chrome-style match highlighting"
createdAt: 2026-10-24 07:01
updatedAt: 2026-10-24 07:01
planFile: "_ai/backlog/active/261024_0701__IMPLEMENTATION_PLAN__in-document-find.md"
specFile: ""
project: "docdeck"
status: completed
completedAt: 2026-10-24 10:09
filesCreated: 5
filesModified: 4
filesDeleted: 0
tags: [find, search, highlighting, ux, webview]
documentType: IMPLEMENTATION_REPORT
---
```

Body sections, in order:

1. **Summary** — what was built in 2–3 sentences.
2. **Files Changed** — new files (`find-text.ts`, `find-text.test.ts`,
   `find-bar.ts`, `find-bar.test.ts`), modified files (`main.ts`, `style.css`,
   `README.md`, `CHANGELOG.md`), deleted files (none).
3. **Key Changes** — text flattening/range mapping, highlight sink, keyboard
   flow, reload anchor, CSS.
4. **Deviations from Plan** — including any SVG/Mermaid or throttling decision
   from Phase 4.
5. **Technical Decisions** — why the Custom Highlight API, why the active range
   is excluded from the all set, why the bar is a zero-height sticky layer.
6. **Testing Notes** — unit tests plus the manual checklist, with the exact
   commands used.
7. **Usage Examples** — `Ctrl+F`, `Enter`, `Shift+Enter`, `Aa`, `Esc`.
8. **Documentation Updates** — README features/controls/architecture and
   CHANGELOG.
9. **Next Steps** — only genuine follow-ups; do not invent scope.

No `.gitignore` change is needed: the plan adds only TypeScript source and
test files, with no new build artifacts or generated directories.

**Final verification**

```bash
npm run check
```

`npm run check` runs the TypeScript check, the Rust tests, the Vitest suite and
a no-bundle Tauri build. Also run the Phase 4 manual checklist once more after
the final changes.

## 6. Design coverage

| Design behavior | Implemented by |
| --- | --- |
| `Ctrl+F` / `Cmd+F` opens a floating bar | Phase 2 (`FindController`), Phase 3 (wiring/CSS) |
| All matches yellow, active match orange | Phase 2 (`paintHighlights`), Phase 3 (`::highlight` rules) |
| `n/m` counter, prev/next, wraparound | Phase 2 |
| Literal matching + `Aa` case toggle | Phase 1 (`findMatches`), Phase 2 (button) |
| Visible document text only, including code/tables/Mermaid | Phase 1 |
| Skip hidden/collapsed content and app chrome | Phase 1 |
| Live reload keeps query and nearest match | Phase 2 (`captureAnchor`/`refresh`), Phase 3 (`renderActiveContent`) |
| Scroll only when the match is not comfortably visible | Phase 2 (`scrollToActive`) |
| Tab switch / no document closes search | Phase 3 |
| Metadata fold/unfold re-runs search | Phase 3 (`toggle` listener) |
| Light/dark marker contrast | Phase 3 (theme variables) |
| No DOM mutation / Mermaid and copy buttons intact | Phase 1–3 (CSS Custom Highlight API) |

## 7. Risks and open questions

- **Mermaid SVG painting.** The ADR requires verifying that `::highlight()`
  paints text inside SVG in WebKitGTK. Phase 4 includes the check and the
  exclusion fallback. This is the only behavior that may differ from the design
  after implementation.
- **Highlight CSS variables in pseudo-elements.** `::highlight()` inherits
  custom properties from its originating element in modern engines. If WebKitGTK
  fails to resolve them, replace the variable references with literal colors and
  add light-theme overrides. Verify in Phase 4.
- **Large-document input latency.** Matching is synchronous on every input
  event. The design accepts this for typical agent documents; Phase 4 measures a
  10,000-line file and adds a small throttle only if needed.
- **Whitespace normalization is intentionally shallow.** Newlines/tabs outside
  `<pre>` become single spaces, but runs of spaces are not collapsed. A phrase
  spanning two rendered spaces may not match. This matches the approved design's
  scope and can be revisited if it becomes annoying.
- **Reload anchoring is an offset heuristic.** If an agent inserts a large block
  above the active match, the nearest-match rule keeps the reader in the same
  region rather than preserving an exact DOM anchor. This is deliberate: exact
  anchors do not survive wholesale repaints.
