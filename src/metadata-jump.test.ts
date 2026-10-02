import { beforeEach, describe, expect, it } from "vitest";

import { parseFrontmatterRows } from "./frontmatter";
import { MetadataView } from "./metadata-jump";

const ROWS = parseFrontmatterRows("title: A Plan\nstatus: draft");

describe("MetadataView", () => {
  let viewer: HTMLElement;
  let view: MetadataView;

  beforeEach(() => {
    document.body.replaceChildren();
    viewer = document.createElement("article");
    document.body.appendChild(viewer);
    view = new MetadataView(viewer, true);
  });

  it("mounts the table as the viewer's first child", () => {
    viewer.appendChild(document.createElement("h1"));
    view.mount(ROWS);
    expect(viewer.firstElementChild?.tagName).toBe("DETAILS");
  });

  it("records a fold made directly on the element", () => {
    view.mount(ROWS);
    const table = viewer.querySelector("details");
    expect(table).not.toBeNull();
    if (!table) return;

    table.open = false;
    table.dispatchEvent(new Event("toggle"));
    expect(view.isExpanded()).toBe(false);
  });

  it("keeps a folded table folded across the remount a reload causes", () => {
    view.mount(ROWS);
    const first = viewer.querySelector("details");
    if (!first) throw new Error("metadata table was not mounted");
    first.open = false;
    first.dispatchEvent(new Event("toggle"));

    // The reload path clears and re-mounts; an agent appending to the document
    // must not silently re-expand what the reader folded away.
    view.clear();
    view.mount(ROWS);
    expect(viewer.querySelector("details")?.open).toBe(false);
  });

  it("reveal expands the table", () => {
    view.mount(ROWS);
    const table = viewer.querySelector("details");
    if (!table) throw new Error("metadata table was not mounted");
    table.open = false;

    view.reveal();
    expect(view.isExpanded()).toBe(true);
    expect(viewer.querySelector("details")?.open).toBe(true);
  });

  it("reveal is a no-op when no table is mounted", () => {
    expect(() => view.reveal()).not.toThrow();
  });
});