import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
// The ~40 most common languages only. Importing "highlight.js" wholesale would
// add roughly a megabyte of grammar definitions for languages agent documents
// almost never use.
import hljs from "highlight.js/lib/common";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  // "base" plus explicit variables: mermaid's stock "dark" theme fights the
  // Catppuccin surface and renders near-invisible diagram labels.
  theme: "base",
  themeVariables: {
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
  },
});

const marked = new Marked(
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
): Promise<void> {
  const scrollParent = targetEl.parentElement;
  const previousScrollTop = scrollParent?.scrollTop ?? 0;
  const wasTailing =
    !!scrollParent &&
    scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight <=
      TAIL_THRESHOLD_PX;

  targetEl.innerHTML = await marked.parse(content);

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