import { afterEach, describe, expect, it } from "vitest";

import { ShortcutsModal } from "./shortcuts-modal";

function createModal(
  overrides: Partial<ConstructorParameters<typeof ShortcutsModal>[0]> = {},
): ShortcutsModal {
  return new ShortcutsModal({
    manualMarkdown: "# Manual\n\nThe manual body.",
    platform: "other",
    ...overrides,
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function tab(name: "shortcuts" | "manual"): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`#help-tab-${name}`)!;
}

function panel(name: "shortcuts" | "manual"): HTMLElement {
  return document.querySelector<HTMLElement>(`#help-panel-${name}`)!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shortcuts help dialog", () => {
  it("mounts one modal dialog with both tabs", async () => {
    const modal = createModal();
    await modal.open();

    expect(modal.isOpen).toBe(true);
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.getAttribute("aria-label")).toBe("Help");
    expect(tab("shortcuts").getAttribute("aria-selected")).toBe("true");
    expect(panel("manual").hidden).toBe(true);
    expect(panel("shortcuts").textContent).toContain("Close the active document");
    expect(panel("shortcuts").textContent).toContain("Ctrl+W");
  });

  it("does not stack overlays when opened twice", async () => {
    const modal = createModal();
    await modal.open();
    await modal.open();

    expect(document.querySelectorAll(".help-overlay").length).toBe(1);
  });

  it("switches tabs and keeps ARIA state in sync", async () => {
    const modal = createModal();
    await modal.open();

    tab("manual").click();

    expect(tab("manual").getAttribute("aria-selected")).toBe("true");
    expect(tab("shortcuts").getAttribute("aria-selected")).toBe("false");
    expect(panel("manual").hidden).toBe(false);
    expect(panel("shortcuts").hidden).toBe(true);
  });

  it("reopens on the Shortcuts tab after closing on Manual", async () => {
    const modal = createModal();
    await modal.open();
    tab("manual").click();
    modal.close();

    await modal.open();

    expect(tab("shortcuts").getAttribute("aria-selected")).toBe("true");
    expect(panel("shortcuts").hidden).toBe(false);
  });

  it("moves tabs with the arrow keys", async () => {
    const modal = createModal();
    await modal.open();
    tab("shortcuts").focus();

    tab("shortcuts").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(tab("manual").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("manual"));
  });

  it("closes on Escape and restores the previous focus", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const modal = createModal();
    await modal.open();
    expect(document.activeElement).not.toBe(trigger);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(modal.isOpen).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a backdrop click but not on a click inside", async () => {
    const modal = createModal();
    await modal.open();

    document.querySelector<HTMLElement>(".help-modal")!.click();
    expect(modal.isOpen).toBe(true);

    document.querySelector<HTMLElement>(".help-overlay")!.click();
    expect(modal.isOpen).toBe(false);
  });

  it("renders the injected manual through the Markdown renderer", async () => {
    const modal = createModal({
      renderManual: async (markdown) =>
        `<h2>Rendered</h2><p>${markdown.length} characters</p>`,
    });
    await modal.open();
    tab("manual").click();

    expect(panel("manual").querySelector("h2")?.textContent).toBe("Rendered");
    expect(panel("manual").textContent).toContain("characters");
  });

  it("shows a readable error when the manual cannot be rendered", async () => {
    const modal = createModal({
      renderManual: async () => {
        throw new Error("parser exploded");
      },
    });
    await modal.open();
    tab("manual").click();

    expect(panel("manual").textContent).toContain(
      "The manual could not be rendered.",
    );
  });

  it("caches the rendered manual across opens", async () => {
    let calls = 0;
    const modal = createModal({
      renderManual: async () => {
        calls += 1;
        return "<p>Manual</p>";
      },
    });

    await modal.open();
    modal.close();
    await modal.open();

    expect(calls).toBe(1);
    expect(panel("manual").textContent).toContain("Manual");
  });
});
