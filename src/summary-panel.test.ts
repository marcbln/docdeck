import { afterEach, describe, expect, it, vi } from "vitest";

import { SummaryPanel } from "./summary-panel";
import type { SummaryResult } from "./summary-model";

function result(overrides: Partial<SummaryResult> = {}): SummaryResult {
  return {
    overview: "Two plans moved forward.",
    documents: [
      {
        path: "/p/_ai/a.md",
        filename: "a.md",
        project: "p",
        state: "updated",
        summary: "The plan now covers the install step.",
        bullets: ["Added a rollback section", "Fixed the link"],
      },
    ],
    provider: "openai",
    model: "gpt-test",
    generatedAt: 1,
    requested: 1,
    skipped: 0,
    toolCalls: 2,
    inputTokens: 100,
    outputTokens: 20,
    ...overrides,
  };
}

function panel(): {
  panel: SummaryPanel;
  onOpen: ReturnType<typeof vi.fn>;
  onRetry: ReturnType<typeof vi.fn>;
  onConfigure: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onOpen = vi.fn();
  const onRetry = vi.fn();
  const onConfigure = vi.fn();
  const onClose = vi.fn();
  const instance = new SummaryPanel({ onOpen, onRetry, onConfigure, onClose });
  return { panel: instance, onOpen, onRetry, onConfigure, onClose };
}

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".summary-overlay");
  if (!element) throw new Error("summary modal did not open");
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SummaryPanel", () => {
  it("shows a loading state with a cancel action", () => {
    const { panel: instance, onClose } = panel();
    instance.setLoading(3);

    const modal = overlay();
    expect(modal.querySelector(".summary-meta")?.textContent).toContain(
      "Summarizing 3 documents",
    );
    expect(modal.querySelector(".summary-skeleton")).not.toBeNull();

    (modal.querySelector(".summary-loading button") as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".summary-overlay")).toBeNull();
  });

  it("renders the overview and hides details until toggled", () => {
    const { panel: instance } = panel();
    instance.setResult(
      result({
        requested: 2,
        documents: [
          result().documents[0],
          {
            path: "/p/_ai/b.md",
            filename: "b.md",
            project: "p",
            state: "new",
            summary: "A new report.",
            bullets: [],
          },
        ],
      }),
    );

    const modal = overlay();
    expect(modal.querySelector(".summary-overview")?.textContent).toBe(
      "Two plans moved forward.",
    );
    expect(modal.querySelector(".summary-meta")?.textContent).toContain(
      "2 of 2 documents",
    );

    const details = modal.querySelector<HTMLElement>(".summary-details")!;
    expect(details.hidden).toBe(true);

    const toggle = modal.querySelector<HTMLButtonElement>(
      ".summary-details-toggle",
    )!;
    expect(toggle.textContent).toBe("Show details (2)");
    toggle.click();
    expect(details.hidden).toBe(false);
    expect(toggle.textContent).toBe("Hide details");
  });

  it("opens a document and closes before handing off", () => {
    const { panel: instance, onOpen, onClose } = panel();
    instance.setResult(result());

    (
      overlay().querySelector<HTMLButtonElement>(".summary-open") as HTMLButtonElement
    ).click();

    expect(onOpen).toHaveBeenCalledWith("/p/_ai/a.md");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers retry and configuration after an error", () => {
    const { panel: instance, onRetry, onConfigure } = panel();
    instance.setError("provider is not configured");

    const modal = overlay();
    expect(modal.querySelector("[role='alert']")?.textContent).toContain(
      "provider is not configured",
    );
    const buttons = [
      ...modal.querySelectorAll<HTMLButtonElement>(".summary-error-actions button"),
    ];
    buttons[0].click();
    buttons[1].click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and reports the closure", () => {
    const { panel: instance, onClose } = panel();
    instance.setResult(result());

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".summary-overlay")).toBeNull();
  });
});
