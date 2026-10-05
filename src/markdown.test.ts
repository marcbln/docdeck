import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractHeadings } from "./toc";
import { marked, renderMarkdown } from "./markdown";

/** Installs a clipboard spy and returns the array it writes into. */
function stubClipboard(): string[] {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve(undefined);
      },
    },
    configurable: true,
  });
  return written;
}

/**
 * The renderer owns the order of its post-processing passes, and the copy
 * button depends on it: mermaid promotion replaces `pre > code.language-mermaid`
 * with a diagram container, so mounting buttons any earlier would leave one
 * offering to copy source that no longer exists on the page.
 */
describe("renderMarkdown", () => {
  let target: HTMLElement;
  let written: string[];

  const render = (body: string): Promise<void> =>
    renderMarkdown(body, target, extractHeadings(marked, body));

  beforeEach(() => {
    document.body.replaceChildren();
    target = document.createElement("article");
    document.body.appendChild(target);
    written = stubClipboard();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    vi.useRealTimers();
  });

  it("mounts a copy button per fenced block and none for a diagram", async () => {
    await render(
      [
        "```js",
        "const a = 1;",
        "```",
        "```mermaid",
        "graph TD; A-->B;",
        "```",
      ].join("\n"),
    );

    expect(target.querySelectorAll(".code-block")).toHaveLength(1);
    expect(target.querySelectorAll("button.code-copy")).toHaveLength(1);
    // The diagram replaced its source; nothing is left for a button to copy.
    expect(target.querySelectorAll(".code-block .mermaid")).toHaveLength(0);
    expect(target.querySelector(".mermaid")).not.toBeNull();
  });

  it("copies a highlighted block as plain source", async () => {
    await render(['```js', 'const a = "x & y";', "```"].join("\n"));

    const button = target.querySelector<HTMLButtonElement>("button.code-copy");
    button?.click();

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe('const a = "x & y";\n');
  });

  it("copies the source of a block with no language", async () => {
    await render(["```", "plain text", "```"].join("\n"));

    target.querySelector<HTMLButtonElement>("button.code-copy")?.click();

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe("plain text\n");
  });

  it("mounts buttons for indented code blocks too", async () => {
    await render("    indented code");
    expect(target.querySelectorAll("button.code-copy")).toHaveLength(1);
  });

  it("leaves a document without code untouched", async () => {
    await render("# Heading\n\nJust prose and `inline code`.\n");
    expect(target.querySelectorAll("button")).toHaveLength(0);
  });

  it("rebuilds one button per block on a live reload", async () => {
    const body = ["```sh", "ls -la", "```"].join("\n");
    await render(body);
    await render(body);

    expect(target.querySelectorAll(".code-block")).toHaveLength(1);
    expect(target.querySelectorAll("button.code-copy")).toHaveLength(1);
  });
});
