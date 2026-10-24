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

/**
 * Elements whose text is never part of the document body.
 *
 * `SVG` is skipped because WebKitGTK does not paint `::highlight()` ranges on
 * SVG text. Counting Mermaid labels would produce matches that stay invisible.
 */
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "TEMPLATE",
  "TEXTAREA",
]);

/**
 * Elements that begin and end a text run. `BR` makes a hard line break a match
 * boundary.
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

    // Markdown renderers put indentation and newline-only text nodes between
    // block elements. HTML collapses those, so they must not become searchable
    // matches (typing a space would otherwise count every block boundary).
    if (!preserveBreaks && state.lastWasSeparator && normalized.trim() === "") {
      return;
    }

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

  for (
    let result = pattern.exec(text);
    result !== null;
    result = pattern.exec(text)
  ) {
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
