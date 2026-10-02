import type { FrontmatterRow } from "./frontmatter";

/** Placeholder for a key declared without a value. */
const EMPTY_PLACEHOLDER = "—";

export interface MetadataTableOptions {
  /** Rendered as the summary row; also the TOC's metadata anchor. */
  title?: string;
  /** Defaults to true. Optional so callers can pass `{}`. */
  expanded?: boolean;
}

/**
 * Renders frontmatter as a two-column table inside a `<details>`.
 *
 * The native element supplies the disclosure semantics, keyboard handling and
 * open/closed state, so no custom ARIA wiring is needed. Expanded state is
 * owned by the caller because it must survive the live reloads that rebuild
 * this element from scratch.
 */
export function createMetadataTable(
  rows: FrontmatterRow[],
  options: MetadataTableOptions = {},
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "metadata-table";
  details.id = "doc-metadata";
  details.open = options.expanded ?? true;

  const summary = document.createElement("summary");
  summary.className = "metadata-summary";
  summary.textContent = options.title ?? "Document metadata";
  details.appendChild(summary);

  const table = document.createElement("table");
  table.className = "metadata-grid";

  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Field", "Value"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.appendChild(cell);
  }
  header.appendChild(headerRow);
  table.appendChild(header);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.depth > 0) tr.className = "metadata-row-nested";

    const key = document.createElement("th");
    key.scope = "row";
    // Nested keys indent rather than repeat the parent path, so a wide value
    // column stays readable.
    key.textContent = row.depth > 0 ? `↳ ${row.key}` : row.key;
    key.classList.add("metadata-key");

    const value = document.createElement("td");
    value.classList.add("metadata-value");
    if (row.kind === "empty") {
      value.textContent = EMPTY_PLACEHOLDER;
      value.classList.add("metadata-empty");
    } else {
      value.textContent = row.value ?? EMPTY_PLACEHOLDER;
    }
    if (row.malformed) tr.classList.add("metadata-malformed");

    tr.append(key, value);
    body.appendChild(tr);
  }

  table.appendChild(body);
  details.appendChild(table);
  return details;
}