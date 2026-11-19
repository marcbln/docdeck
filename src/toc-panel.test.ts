import { afterEach, describe, expect, it, vi } from "vitest";

import { TocPanel } from "./toc-panel";
import type { Heading } from "./toc";

const HEADINGS: Heading[] = [
  { depth: 1, text: "Scope", slug: "scope" },
  { depth: 2, text: "Risks", slug: "risks" },
];

function mount(onToggleBookmark = vi.fn()): {
  nav: HTMLElement;
  panel: TocPanel;
} {
  document.body.innerHTML = '<nav id="toc"></nav><main id="content"></main>';
  const nav = document.getElementById("toc") as HTMLElement;
  const content = document.getElementById("content") as HTMLElement;
  const panel = new TocPanel({
    container: nav,
    scrollParent: content,
    onToggleBookmark,
  });
  return { nav, panel };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TocPanel bookmark controls", () => {
  it("adds one bookmark control per heading", () => {
    const { nav, panel } = mount();
    panel.rebuild(HEADINGS);

    const stars = [...nav.querySelectorAll<HTMLButtonElement>(".toc-bookmark")];
    expect(stars).toHaveLength(2);
    expect(stars.every((star) => star.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
    expect(stars[0].getAttribute("aria-label")).toBe("Bookmark Scope");
    expect(stars[0].textContent).toBe("☆");
  });

  it("refreshes pressed state from bookmarked slugs", () => {
    const { nav, panel } = mount();
    panel.rebuild(HEADINGS);

    panel.setBookmarkedSlugs(new Set(["risks"]));

    const stars = [...nav.querySelectorAll<HTMLButtonElement>(".toc-bookmark")];
    expect(stars[0].getAttribute("aria-pressed")).toBe("false");
    expect(stars[1].getAttribute("aria-pressed")).toBe("true");
    expect(stars[1].getAttribute("aria-label")).toBe(
      "Remove bookmark for Risks",
    );
    expect(stars[1].textContent).toBe("★");
  });

  it("marks a shared target as mixed", () => {
    const { nav, panel } = mount();
    panel.rebuild(HEADINGS);

    panel.setBookmarkedSlugs(new Set(["risks"]), new Map([["risks", 2]]));

    const star = nav.querySelectorAll<HTMLButtonElement>(".toc-bookmark")[1];
    expect(star.getAttribute("aria-pressed")).toBe("mixed");
    expect(star.classList.contains("mixed")).toBe(true);
    expect(star.getAttribute("aria-label")).toContain("2 bookmarks");
  });

  it("toggles the bookmark without scrolling", () => {
    const onToggle = vi.fn();
    const { nav, panel } = mount(onToggle);
    panel.rebuild(HEADINGS);
    const content = document.getElementById("content") as HTMLElement;
    content.scrollTop = 120;

    nav.querySelectorAll<HTMLButtonElement>(".toc-bookmark")[1].click();

    expect(onToggle).toHaveBeenCalledWith(HEADINGS[1]);
    expect(content.scrollTop).toBe(120);
  });

  it("re-applies state after a rebuild", () => {
    const { nav, panel } = mount();
    panel.rebuild(HEADINGS);
    panel.setBookmarkedSlugs(new Set(["scope"]));
    panel.rebuild(HEADINGS);

    expect(
      nav.querySelectorAll<HTMLButtonElement>(".toc-bookmark")[0].getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });
});
