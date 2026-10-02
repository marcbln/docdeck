import { describe, expect, it } from "vitest";

import { parseFrontmatterRows } from "./frontmatter";
import { createMetadataTable } from "./metadata-table";

describe("createMetadataTable", () => {
  it("renders one row per frontmatter field", () => {
    const table = createMetadataTable(
      parseFrontmatterRows("title: A Plan\nstatus: draft"),
    );
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]?.textContent).toContain("title");
    expect(bodyRows[0]?.textContent).toContain("A Plan");
  });

  it("uses a summary as the disclosure label", () => {
    const table = createMetadataTable([]);
    const summary = table.querySelector("summary");
    expect(summary?.textContent).toBe("Document metadata");
  });

  it("honours the requested expanded state", () => {
    expect(createMetadataTable([], { expanded: true }).open).toBe(true);
    expect(createMetadataTable([], { expanded: false }).open).toBe(false);
  });

  it("marks nested keys and indents them", () => {
    const table = createMetadataTable(parseFrontmatterRows("meta:\n  nested: true\n"));
    const rows = table.querySelectorAll("tbody tr");
    expect(rows[0]?.classList.contains("metadata-row-nested")).toBe(false);
    expect(rows[1]?.classList.contains("metadata-row-nested")).toBe(true);
    expect(rows[1]?.textContent).toContain("↳ nested");
  });

  it("shows a placeholder for a valueless key", () => {
    const table = createMetadataTable(parseFrontmatterRows("emptyValue:\n"));
    const cell = table.querySelector(".metadata-empty");
    expect(cell?.textContent).toBe("—");
  });

  it("flags malformed frontmatter for styling", () => {
    const table = createMetadataTable(parseFrontmatterRows("a: [unclosed"));
    expect(
      table.querySelector("tbody tr")?.classList.contains("metadata-malformed"),
    ).toBe(true);
  });
});