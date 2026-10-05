/** Glyphs the button cycles through: idle, copied, failed. */
const IDLE_GLYPH = "⧉";
const COPIED_GLYPH = "✓";
const FAILED_GLYPH = "✗";

const BUTTON_TITLE = "Copy code";
const COPIED_TITLE = "Copied";
const FAILED_TITLE = "Copy failed";

/** How long the confirmation glyph stays before the button returns to idle. */
const RESET_DELAY_MS = 1600;

/**
 * Legacy copy path for webviews without the async Clipboard API.
 *
 * `navigator.clipboard` needs a secure context and, on WebKitGTK, a
 * permission the app does not have to ask for — when it is missing, a staged
 * textarea plus `execCommand` is the only thing that still works.
 */
function copyViaTextarea(text: string): boolean {
  const staging = document.createElement("textarea");
  staging.value = text;
  staging.setAttribute("readonly", "");
  // Off-screen rather than `display: none`: a hidden element cannot be
  // selected, and an empty selection copies nothing.
  staging.style.position = "fixed";
  staging.style.top = "-1000px";
  staging.style.opacity = "0";
  document.body.appendChild(staging);
  staging.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  staging.remove();
  return copied;
}

/** Puts `text` on the system clipboard, reporting whether it made it. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or not focused — fall through to the legacy path.
    }
  }
  return copyViaTextarea(text);
}

/**
 * Puts a copy button on every fenced code block inside `targetEl`.
 *
 * Each `<pre>` is wrapped in a `.code-block` positioning context so the button
 * stays put while a long line scrolls horizontally underneath it — an absolutely
 * positioned child of the scroll container itself would travel with the text.
 *
 * The source is read from the highlighted element's `textContent`, which is the
 * pre-highlighting text: highlight.js only ever escapes and wraps it in spans,
 * never drops or reorders characters. Returns the buttons in document order.
 */
export function mountCopyButtons(targetEl: HTMLElement): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];

  for (const code of targetEl.querySelectorAll<HTMLElement>("pre > code")) {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains("code-block")) continue;

    const source = code.textContent ?? "";

    const block = document.createElement("div");
    block.className = "code-block";
    pre.replaceWith(block);
    block.appendChild(pre);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = IDLE_GLYPH;
    button.title = BUTTON_TITLE;
    button.setAttribute("aria-label", BUTTON_TITLE);

    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const paint = (state: "idle" | "copied" | "failed"): void => {
      button.classList.toggle("copied", state === "copied");
      button.classList.toggle("failed", state === "failed");
      button.textContent =
        state === "copied"
          ? COPIED_GLYPH
          : state === "failed"
            ? FAILED_GLYPH
            : IDLE_GLYPH;
      button.title =
        state === "copied"
          ? COPIED_TITLE
          : state === "failed"
            ? FAILED_TITLE
            : BUTTON_TITLE;
      button.setAttribute("aria-label", button.title);
    };

    button.addEventListener("click", () => {
      void copyText(source).then((copied) => {
        paint(copied ? "copied" : "failed");
        // Re-clicking restarts the countdown instead of stacking timers that
        // would reset the button mid-confirmation.
        if (resetTimer !== undefined) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => paint("idle"), RESET_DELAY_MS);
      });
    });

    block.appendChild(button);
    buttons.push(button);
  }

  return buttons;
}
