import { parse as parseYaml } from "yaml";

export interface FrontmatterSplit {
  /** The raw YAML text between the fences, or null when absent. */
  raw: string | null;
  /** The document with the frontmatter block removed. */
  body: string;
}

export type FrontmatterValueKind = "scalar" | "list" | "object" | "empty";

export interface FrontmatterRow {
  key: string;
  /** Already stringified for display; `null` only for `kind: "empty"`. */
  value: string | null;
  /** 0 for top-level keys, incremented per nesting level. */
  depth: number;
  kind: FrontmatterValueKind;
  /** Set when the block failed to parse and is shown verbatim. */
  malformed?: boolean;
}

/**
 * Matches a `---` fenced block anchored at the very start of the document.
 *
 * Anchoring at offset 0 is what distinguishes frontmatter from a thematic
 * break further down the document. The closing fence allows trailing
 * whitespace and tolerates CRLF line endings.
 */
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): FrontmatterSplit {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) return { raw: null, body: source };

  return { raw: match[1], body: source.slice(match[0].length) };
}

/** Renders any YAML value as a single display string. */
function formatValue(value: unknown): {
  text: string | null;
  kind: FrontmatterValueKind;
} {
  if (value === null || value === undefined) {
    return { text: null, kind: "empty" };
  }
  if (Array.isArray(value)) {
    // `[rust, tauri-v2]` reads better than Rust's multi-line array debug form.
    return { text: `[${value.map((item) => String(item)).join(", ")}]`, kind: "list" };
  }
  if (typeof value === "object") {
    return { text: "{…}", kind: "object" };
  }
  return { text: String(value), kind: "scalar" };
}

function flatten(
  entries: [string, unknown][],
  depth: number,
  rows: FrontmatterRow[],
): void {
  for (const [key, value] of entries) {
    const { text, kind } = formatValue(value);
    rows.push({ key, value: text, depth, kind });

    // Nested maps become indented sub-rows; arrays stay on one line.
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const nested = Object.entries(value as Record<string, unknown>);
      if (nested.length > 0) flatten(nested, depth + 1, rows);
    }
  }
}

/**
 * Parses raw YAML into display rows.
 *
 * `yaml.parse` throws on malformed input, so a broken header degrades to a
 * single verbatim row. A document with an unparseable header must still render
 * its body — losing the whole document to a typo in its metadata is the worst
 * possible failure mode here.
 */
export function parseFrontmatterRows(raw: string): FrontmatterRow[] {
  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch {
    return [
      { key: "frontmatter", value: raw, depth: 0, kind: "scalar", malformed: true },
    ];
  }

  // A frontmatter block that parses to a scalar or nothing (`---\n---\n`)
  // is not a key/value table.
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return [
      { key: "frontmatter", value: raw, depth: 0, kind: "scalar", malformed: true },
    ];
  }

  const rows: FrontmatterRow[] = [];
  flatten(Object.entries(document as Record<string, unknown>), 0, rows);
  return rows;
}