import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
// The ~40 most common languages only. Importing "highlight.js" wholesale would
// add roughly a megabyte of grammar definitions for languages agent documents
// almost never use.
import hljs from "highlight.js/lib/common";
import mermaid from "mermaid";

import type { ThemeMode } from "./preferences";
import { LIGHT_MERMAID_VARIABLES } from "./theme";
import type { Heading } from "./toc";

/**
 * Mocha variables, unchanged from the previous hard-coded literal.
 *
 * "base" plus explicit variables: mermaid's stock "dark" theme fights the
 * Catppuccin surface and renders near-invisible diagram labels.
 */
const DARK_MERMAID_VARIABLES: Record<string, string> = {
  background: "#181825",
  primaryColor: "#313244",
  primaryTextColor: "#cdd6f4",
  primaryBorderColor: "#585b70",
  lineColor: "#6c7086",
  secondaryColor: "#45475a",
  tertiaryColor: "#181825",
  textColor: "#cdd6f4",
  mainBkg: "#313244",
  nodeBorder: "#585b70",
  clusterBkg: "#181825",
  clusterBorder: "#45475a",
  titleColor: "#cdd6f4",
  edgeLabelBackground: "#181825",
  fontSize: "14px",
};

/**
 * Re-initialises Mermaid for the active theme.
 *
 * Mermaid bakes its colors into the SVG at render time, so a mode change must
 * be followed by a re-render of the active document; already-drawn diagrams keep
 * the previous palette until then. This is the one place theme and content
 * state genuinely couple.
 */
export function applyMermaidTheme(mode: ThemeMode): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    themeVariables:
      mode === "dark" ? DARK_MERMAID_VARIABLES : LIGHT_MERMAID_VARIABLES,
  });
}

/** Exported so TOC extraction lexes with the exact same parser the renderer
 *  uses. Two instances could disagree on tokenization and produce slugs that do
 *  not match the rendered headings. */
export const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

/** Distance in pixels from the bottom within which the reader counts as "tailing". */
const TAIL_THRESHOLD_PX = 32;

/**
 * Whether a scroll pane is parked at (or within a hair of) its end.
 *
 * Exported so the caller can re-pin the pane after it grows the content
 * further — the metadata table is mounted *after* rendering, so its height is
 * not part of `renderMarkdown`'s own tail calculation.
 */
export function isTailing(scroller: HTMLElement): boolean {
  return (
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
    TAIL_THRESHOLD_PX
  );
}

/**
 * Writes the pre-computed slug onto each rendered heading.
 *
 * `marked` emits no `id` attributes, so the TOC's anchors have no target without
 * this. Headings are matched by document order, which is exactly how
 * `extractHeadings` produced the slug list.
 */
function stampHeadingIds(
  targetEl: HTMLElement,
  headings: Heading[],
): void {
  if (headings.length === 0) return;

  const elements = targetEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
  headings.forEach((heading, index) => {
    const element = elements[index];
    if (element) element.id = heading.slug;
  });
}

/**
 * Compiles markdown into `targetEl` and renders any mermaid diagrams.
 *
 * Scroll behaviour across a live reload: a reader who is tailing the document
 * stays pinned to the newest content, everyone else keeps their reading
 * position. Without this, an agent appending lines would yank a mid-document
 * reader downwards on every write.
 */
export async function renderMarkdown(
  content: string,
  targetEl: HTMLElement,
  headings: Heading[] = [],
): Promise<void> {
  const scrollParent = targetEl.parentElement;
  const previousScrollTop = scrollParent?.scrollTop ?? 0;
  const wasTailing = !!scrollParent && isTailing(scrollParent);

  // `marked.parse` is typed `string | Promise<string>`. It resolves
  // synchronously here because no async extension is registered, but the type
  // is the contract — keep the await rather than asserting the narrowing away.
  const html: string = await marked.parse(content);
  targetEl.innerHTML = html;

  stampHeadingIds(targetEl, headings);

  // marked emits a bare checkbox for `- [x]` items but no list-style hook, so
  // tag them ourselves — otherwise GitHub's CSS renders bullet *and* checkbox.
  for (const item of targetEl.querySelectorAll<HTMLLIElement>("li")) {
    const checkbox = item.querySelector<HTMLInputElement>(
      ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
    );
    if (checkbox) item.classList.add("task-list-item");
  }

  // highlight.js claims every fenced block, so mermaid sources arrive as
  // `pre > code.language-mermaid`. Promote them to mermaid containers.
  const mermaidBlocks =
    targetEl.querySelectorAll<HTMLElement>("pre code.language-mermaid");
  for (const block of mermaidBlocks) {
    const pre = block.parentElement;
    if (!pre) continue;
    const container = document.createElement("div");
    container.className = "mermaid";
    container.textContent = block.textContent ?? "";
    pre.replaceWith(container);
  }

  const diagrams = targetEl.querySelectorAll<HTMLElement>(".mermaid");
  if (diagrams.length > 0) {
    try {
      await mermaid.run({ nodes: diagrams });
    } catch (error) {
      console.error("Mermaid rendering failed", error);
    }
  }

  if (scrollParent) {
    scrollParent.scrollTop = wasTailing
      ? scrollParent.scrollHeight
      : previousScrollTop;
  }
}

applyMermaidTheme("dark");