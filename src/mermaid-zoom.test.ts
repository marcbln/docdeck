import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMermaidZoomState,
  closeMermaidOverlay,
  enhanceMermaidDiagrams,
} from "./mermaid-zoom";

const VIEWPORT = { width: 800, height: 400 };

function mountDiagram(
  source: string,
  naturalWidth = 1600,
  naturalHeight = 800,
): HTMLElement {
  document.body.innerHTML = `
    <div id="app">
      <article class="markdown-body">
        <div class="mermaid" data-mermaid-source="${source}">
          <svg viewBox="0 0 ${naturalWidth} ${naturalHeight}" width="100%"></svg>
        </div>
      </article>
    </div>
  `;

  const root = document.querySelector<HTMLElement>(".markdown-body");
  if (!root) throw new Error("markdown root missing");

  enhanceMermaidDiagrams(root, { measure: () => VIEWPORT });
  return root;
}

function percentage(root: ParentNode): string {
  return root.querySelector(".mermaid-toolbar__zoom")?.textContent ?? "";
}

function stageTransform(root: ParentNode): string {
  return root.querySelector<HTMLElement>(".mermaid-stage")?.style.transform ?? "";
}

/**
 * happy-dom's WheelEvent ignores the MouseEvent fields in its init dict, so
 * apply the ones this controller reads (Ctrl/Cmd and the pointer position)
 * explicitly.
 */
function wheelEvent(init: {
  deltaY: number;
  ctrlKey?: boolean;
  clientX?: number;
  clientY?: number;
}): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY: init.deltaY,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "clientY", { value: init.clientY ?? 0 });
  return event;
}

function dispatchKey(
  target: EventTarget,
  key: string,
  shiftKey = false,
): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

beforeEach(() => {
  clearMermaidZoomState();
  document.body.replaceChildren();
});

afterEach(() => {
  closeMermaidOverlay();
  clearMermaidZoomState();
  vi.restoreAllMocks();
});

describe("enhanceMermaidDiagrams", () => {
  it("wraps the SVG in a viewport and stage at fit-width", () => {
    const root = mountDiagram("graph TD; A-->B;");

    const diagram = root.querySelector(".mermaid");
    const stage = root.querySelector(".mermaid-stage");

    expect(diagram?.classList.contains("mermaid--enhanced")).toBe(true);
    expect(stage?.parentElement).toBe(diagram);
    expect(root.querySelector(".mermaid-stage > svg")).not.toBeNull();
    expect(percentage(root)).toBe("50%");
  });

  it("never upscales a small diagram", () => {
    const root = mountDiagram("small", 400, 200);

    expect(percentage(root)).toBe("100%");
    expect(stageTransform(root)).toContain("translate(200px, 100px)");
    expect(stageTransform(root)).toContain("scale(1)");
  });

  it("leaves a container without an SVG alone", () => {
    document.body.innerHTML = `
      <div id="app">
        <article class="markdown-body">
          <div class="mermaid" data-mermaid-source="broken">broken</div>
        </article>
      </div>
    `;
    const root = document.querySelector<HTMLElement>(".markdown-body");
    if (!root) throw new Error("markdown root missing");

    enhanceMermaidDiagrams(root, { measure: () => VIEWPORT });

    expect(
      root.querySelector(".mermaid")?.classList.contains("mermaid--enhanced"),
    ).toBe(false);
    expect(root.querySelector(".mermaid-toolbar")).toBeNull();
  });
});

describe("toolbar and keyboard", () => {
  it("zooms with the toolbar and returns to fit", () => {
    const root = mountDiagram("graph TD; A-->B;");

    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();
    expect(percentage(root)).toBe("63%");
    expect(
      root.querySelector(".mermaid")?.classList.contains("mermaid--active"),
    ).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-action="fit"]')?.click();
    expect(percentage(root)).toBe("50%");
    expect(
      root.querySelector(".mermaid")?.classList.contains("mermaid--active"),
    ).toBe(false);
  });

  it("fits the whole tall diagram rather than only its width", () => {
    const root = mountDiagram("tall", 400, 2000);
    expect(percentage(root)).toBe("100%");

    root.querySelector<HTMLButtonElement>('[data-action="fit"]')?.click();
    expect(percentage(root)).toBe("20%");
  });

  it("zooms and pans from the keyboard", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    if (!diagram) throw new Error("diagram missing");

    diagram.focus();
    dispatchKey(diagram, "+");
    expect(percentage(root)).toBe("63%");

    dispatchKey(diagram, "ArrowDown");
    expect(stageTransform(root)).toContain("translate(-100px, -90px)");

    dispatchKey(diagram, "ArrowLeft");
    expect(stageTransform(root)).toContain("translate(-60px, -90px)");

    dispatchKey(diagram, "0");
    expect(percentage(root)).toBe("50%");
  });
});

describe("pointer input", () => {
  it("zooms toward the pointer only with Ctrl/Cmd held", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    if (!diagram) throw new Error("diagram missing");

    vi.spyOn(diagram, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: VIEWPORT.width,
      bottom: VIEWPORT.height,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    diagram.dispatchEvent(wheelEvent({ deltaY: -100 }));
    expect(percentage(root)).toBe("50%");

    diagram.dispatchEvent(
      wheelEvent({
        deltaY: -100,
        ctrlKey: true,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(Number.parseInt(percentage(root), 10)).toBeGreaterThan(50);
  });

  it("pans after the drag threshold is crossed", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    if (!diagram) throw new Error("diagram missing");

    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();
    const beforeDrag = stageTransform(root);

    diagram.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      }) as PointerEvent,
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 60,
        clientY: 60,
      }) as PointerEvent,
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        clientX: 60,
        clientY: 60,
      }) as PointerEvent,
    );

    expect(stageTransform(root)).not.toBe(beforeDrag);
  });
});

describe("persistent view state", () => {
  it("restores a custom view after a repaint with the same source", () => {
    const root = mountDiagram("graph TD; A-->B;");
    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();

    const percentAfterZoom = percentage(root);
    const transformAfterZoom = stageTransform(root);

    const repainted = mountDiagram("graph TD; A-->B;");

    expect(percentage(repainted)).toBe(percentAfterZoom);
    expect(stageTransform(repainted)).toBe(transformAfterZoom);
  });

  it("starts fresh when the diagram source changed", () => {
    const root = mountDiagram("graph A");
    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();

    const repainted = mountDiagram("graph B");
    expect(percentage(repainted)).toBe("50%");
  });

  it("starts fresh after an explicit clear", () => {
    const root = mountDiagram("graph A");
    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();

    clearMermaidZoomState();

    const repainted = mountDiagram("graph A");
    expect(percentage(repainted)).toBe("50%");
  });

  it("keeps identical diagrams independent by occurrence", () => {
    document.body.innerHTML = `
      <div id="app">
        <article class="markdown-body">
          <div class="mermaid" data-mermaid-source="same">
            <svg viewBox="0 0 1600 800"></svg>
          </div>
          <div class="mermaid" data-mermaid-source="same">
            <svg viewBox="0 0 1600 800"></svg>
          </div>
        </article>
      </div>
    `;
    const root = document.querySelector<HTMLElement>(".markdown-body");
    if (!root) throw new Error("markdown root missing");
    enhanceMermaidDiagrams(root, { measure: () => VIEWPORT });

    const diagrams = root.querySelectorAll<HTMLElement>(".mermaid");
    diagrams[0]?.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();

    expect(
      diagrams[0]?.querySelector(".mermaid-toolbar__zoom")?.textContent,
    ).toBe("63%");
    expect(
      diagrams[1]?.querySelector(".mermaid-toolbar__zoom")?.textContent,
    ).toBe("50%");
  });
});

describe("inline mode", () => {
  it("returns the diagram to document flow and restores the zoomed view", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    const inline = root.querySelector<HTMLButtonElement>(
      '[data-action="inline"]',
    );
    if (!diagram || !inline) throw new Error("diagram or inline button missing");

    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();
    const transform = stageTransform(root);
    expect(percentage(root)).toBe("63%");

    inline.click();
    expect(diagram.classList.contains("mermaid--inline")).toBe(true);
    expect(diagram.style.height).toBe("");
    expect(diagram.getAttribute("tabindex")).toBeNull();
    expect(inline.getAttribute("aria-pressed")).toBe("true");
    expect(inline.getAttribute("aria-label")).toBe("Show zoom controls");

    inline.click();
    expect(diagram.classList.contains("mermaid--inline")).toBe(false);
    expect(diagram.getAttribute("tabindex")).toBe("0");
    expect(percentage(root)).toBe("63%");
    expect(stageTransform(root)).toBe(transform);
    expect(inline.getAttribute("aria-pressed")).toBe("false");
    expect(inline.getAttribute("aria-label")).toBe("Show diagram inline");
  });

  it("stays inline after a repaint and remembers the previous zoom", () => {
    const root = mountDiagram("graph TD; A-->B;");
    root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();

    const zoomedPercentage = percentage(root);
    const zoomedTransform = stageTransform(root);
    root.querySelector<HTMLButtonElement>('[data-action="inline"]')?.click();

    const repainted = mountDiagram("graph TD; A-->B;");
    const diagram = repainted.querySelector(".mermaid");
    expect(diagram?.classList.contains("mermaid--inline")).toBe(true);

    repainted
      .querySelector<HTMLButtonElement>('[data-action="inline"]')
      ?.click();
    expect(percentage(repainted)).toBe(zoomedPercentage);
    expect(stageTransform(repainted)).toBe(zoomedTransform);
  });

  it("ignores wheel zoom, keyboard, drag and double-click while inline", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    if (!diagram) throw new Error("diagram missing");
    root.querySelector<HTMLButtonElement>('[data-action="inline"]')?.click();

    const transform = stageTransform(root);
    const percent = percentage(root);

    diagram.dispatchEvent(
      wheelEvent({
        deltaY: -100,
        ctrlKey: true,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(percentage(root)).toBe(percent);

    dispatchKey(diagram, "+");
    expect(percentage(root)).toBe(percent);

    diagram.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      }) as PointerEvent,
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }) as PointerEvent,
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }) as PointerEvent,
    );
    expect(stageTransform(root)).toBe(transform);

    diagram.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    expect(percentage(root)).toBe(percent);
  });
});

describe("fullscreen overlay", () => {
  it("moves the viewport into an overlay and restores it on Escape", () => {
    const root = mountDiagram("graph TD; A-->B;");
    const diagram = root.querySelector<HTMLElement>(".mermaid");
    if (!diagram) throw new Error("diagram missing");

    root
      .querySelector<HTMLButtonElement>('[data-action="fullscreen"]')
      ?.click();

    expect(document.querySelector(".mermaid-overlay")).not.toBeNull();
    expect(document.querySelector(".mermaid-placeholder")).not.toBeNull();
    expect(document.getElementById("app")?.inert).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.querySelector(".mermaid-overlay")).toBeNull();
    expect(document.querySelector(".mermaid-placeholder")).toBeNull();
    expect(document.querySelector(".mermaid")).toBe(diagram);
    expect(document.getElementById("app")?.inert).toBe(false);
  });
});
