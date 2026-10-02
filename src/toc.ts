import type { Marked, Token } from "marked";

export interface Heading {
  depth: number;
  /** Plain text with all inline markdown removed. */
  text: string;
  slug: string;
}

/** Deepest heading level listed in the outline. Agent plans rarely nest past h4. */
export const MAX_TOC_DEPTH = 4;

/**
 * Concatenates the plain text of a heading's inline token tree.
 *
 * `heading.text` retains raw markdown — for `## **Bold** and \`code\`` it is
 * literally "**Bold** and \`code\`". Tokens also nest (`strong.tokens`,
 * `link.tokens`), so this recurses. HTML tokens are skipped so inline markup in
 * a heading never leaks into the slug.
 */
function collectText(tokens: Token[] | undefined, parts: string[]): void {
  if (!tokens) return;
  for (const token of tokens) {
    switch (token.type) {
      case "html":
        break;
      case "text":
      case "codespan":
      case "del":
      case "strong":
      case "em":
        parts.push(token.text);
        break;
      default:
        collectText("tokens" in token ? token.tokens : undefined, parts);
    }
  }
}

/**
 * GitHub-compatible slug.
 *
 * Accents are folded, non-letter/non-number runs collapse to a single dash and
 * edge dashes are trimmed. Keeping Unicode letters matters: an ASCII-only class
 * reduces "Ünïcödé" to an empty string.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  // A heading made only of punctuation ("## ---") has no slug of its own.
  return slug.length > 0 ? slug : "section";
}

/**
 * Extracts the outline from a markdown source.
 *
 * `marked` emits no `id` attributes on headings, so this is the single source
 * of both the DOM ids stamped during rendering and the TOC's anchors — they
 * cannot drift apart because they are computed once.
 */
export function extractHeadings(
  marked: Marked,
  markdown: string,
  maxDepth: number = MAX_TOC_DEPTH,
): Heading[] {
  const headings: Heading[] = [];
  const used = new Map<string, number>();

  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== "heading" || token.depth > maxDepth) return;

    const parts: string[] = [];
    collectText(token.tokens, parts);
    const text = parts.join("").trim();

    const base = slugify(text);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);

    // Two headings slugifying alike must get distinct DOM ids or the TOC's
    // second link scrolls to the first heading.
    const slug = seen === 0 ? base : `${base}-${seen}`;
    headings.push({ depth: token.depth, text, slug });
  });

  return headings;
}