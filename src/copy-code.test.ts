import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyText, mountCopyButtons } from "./copy-code";

/** Replaces `navigator.clipboard` with a spy and returns it. */
function stubClipboard(result: "ok" | "reject" | "absent"): {
  writeText: ReturnType<typeof vi.fn>;
} {
  const writeText = vi.fn(() =>
    result === "reject"
      ? Promise.reject(new Error("denied"))
      : Promise.resolve(undefined),
  );

  if (result === "absent") {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  } else {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }
  return { writeText };
}

/** happy-dom implements no `execCommand`, so the legacy path needs installing. */
function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
  });
  return execCommand;
}

describe("copyText", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("writes through the async clipboard API", async () => {
    const { writeText } = stubClipboard("ok");
    await expect(copyText("const a = 1;")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
  });

  it("falls back when the clipboard API rejects", async () => {
    stubClipboard("reject");
    const execCommand = stubExecCommand(true);
    await expect(copyText("hello")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when neither path works", async () => {
    stubClipboard("absent");
    stubExecCommand(false);
    await expect(copyText("hello")).resolves.toBe(false);
  });

  it("survives a webview with neither API", async () => {
    stubClipboard("absent");
    // Left undefined: `document.execCommand("copy")` throws rather than
    // returning false, which is what WebKitGTK does without the API.
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
    });
    await expect(copyText("hello")).resolves.toBe(false);
  });
});

describe("mountCopyButtons", () => {
  let target: HTMLElement;
  let written: string[];

  beforeEach(() => {
    document.body.replaceChildren();
    target = document.createElement("article");
    document.body.appendChild(target);
    written = [];
    stubClipboard("ok").writeText.mockImplementation((text: string) => {
      written.push(text);
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("wraps each code block and mounts one button per block", () => {
    target.innerHTML = "<pre><code>one</code></pre><p>x</p><pre><code>two</code></pre>";
    const buttons = mountCopyButtons(target);

    expect(buttons).toHaveLength(2);
    expect(target.querySelectorAll(".code-block")).toHaveLength(2);
    expect(target.querySelectorAll("pre > code")).toHaveLength(2);
  });

  it("positions the button inside the block, after the code", () => {
    target.innerHTML = "<pre><code>one</code></pre>";
    const [button] = mountCopyButtons(target);

    const block = target.querySelector(".code-block");
    expect(button?.parentElement).toBe(block);
    expect(block?.lastElementChild).toBe(button);
  });

  it("leaves inline code and mermaid containers alone", () => {
    target.innerHTML =
      "<p><code>inline</code></p><div class=\"mermaid\"><svg /></div>";
    expect(mountCopyButtons(target)).toHaveLength(0);
    expect(target.querySelectorAll("button")).toHaveLength(0);
  });

  it("does not double-wrap when mounted twice", () => {
    target.innerHTML = "<pre><code>one</code></pre>";
    mountCopyButtons(target);
    const second = mountCopyButtons(target);

    expect(second).toHaveLength(0);
    expect(target.querySelectorAll(".code-block")).toHaveLength(1);
    expect(target.querySelectorAll("button")).toHaveLength(1);
  });

  it("copies the source verbatim, not the highlight markup", async () => {
    // highlight.js wraps tokens in spans and escapes entities; the clipboard
    // must still receive the characters the author wrote.
    target.innerHTML =
      '<pre><code class="hljs language-js">' +
      '<span class="hljs-string">"a &amp; b"</span> + c &lt; d\n' +
      "  indented\n" +
      "</code></pre>";

    const [button] = mountCopyButtons(target);
    button?.click();

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe('"a & b" + c < d\n  indented\n');
  });

  it("confirms on the button, then returns to idle", async () => {
    vi.useFakeTimers();
    target.innerHTML = "<pre><code>one</code></pre>";
    const [button] = mountCopyButtons(target);

    button?.click();
    await vi.waitFor(() => expect(button?.className).toContain("copied"));
    expect(button?.textContent).toBe("✓");
    expect(button?.title).toBe("Copied");

    vi.runAllTimers();
    expect(button?.className).not.toContain("copied");
    expect(button?.textContent).toBe("⧉");
    expect(button?.title).toBe("Copy code");
  });

  it("marks a failed copy instead of claiming success", async () => {
    stubClipboard("absent");
    stubExecCommand(false);
    target.innerHTML = "<pre><code>one</code></pre>";
    const [button] = mountCopyButtons(target);

    button?.click();
    await vi.waitFor(() => expect(button?.className).toContain("failed"));
    expect(button?.textContent).toBe("✗");
  });

  it("carries an accessible label for screen readers and tooltips", () => {
    target.innerHTML = "<pre><code>one</code></pre>";
    const [button] = mountCopyButtons(target);

    expect(button?.getAttribute("aria-label")).toBe("Copy code");
    expect(button?.type).toBe("button");
  });

  it("copies per block, so two snippets never collide", async () => {
    target.innerHTML = "<pre><code>first</code></pre><pre><code>second</code></pre>";
    const [first, second] = mountCopyButtons(target);

    first?.click();
    second?.click();

    await vi.waitFor(() => expect(written).toHaveLength(2));
    expect(written).toEqual(["first", "second"]);
  });
});
