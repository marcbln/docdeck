import {
  centerOnContentPoint,
  clampScale,
  clampTranslation,
  contentPointAtViewportCenter,
  fitWholeScale,
  fitWidthScale,
  fittedHeight,
  scaleLimits,
  wheelZoomFactor,
  zoomAtPoint,
  type Point,
  type Size,
  type ZoomTransform,
} from "./mermaid-zoom-math";

/** How the current view was produced; decides what a repaint restores. */
type ViewMode = "fit-width" | "fit-whole" | "custom" | "inline";

/** Modes that use the measured viewport and stage transform. */
type EnhancedMode = Exclude<ViewMode, "inline">;

interface SavedView extends ZoomTransform {
  mode: ViewMode;
  /** View to return to when leaving `inline`; set only for inline entries. */
  returnMode?: EnhancedMode;
}

/** Source-keyed views that survive wholesale viewer repaints. */
const viewRegistry = new Map<string, SavedView>();

/** Live controllers, used to dispose ones whose DOM has been replaced. */
const liveControllers = new Set<MermaidZoom>();

/** Closes the active fullscreen overlay, if any. */
let activeOverlayClose: (() => void) | null = null;

const ZOOM_STEP = 1.25;
const PAN_STEP = 40;
const FAST_PAN_STEP = 120;
const DRAG_THRESHOLD_PX = 4;
const MIN_VIEWPORT_HEIGHT = 120;

const FIT_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"/><path d="M6 10 2 14M10 6l4-4"/></svg>';

const FULLSCREEN_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';

const INLINE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.5 6h7M4.5 8.5h7M4.5 11h4"/></svg>';

/** Overridable in tests; the real webview supplies the layout box. */
export type MeasureViewport = (container: HTMLElement) => Size;

const defaultMeasure: MeasureViewport = (container) => ({
  width: container.clientWidth,
  height: container.clientHeight,
});

export interface MermaidZoomOptions {
  measure?: MeasureViewport;
}

/** Removes every remembered diagram view. Called when a document is switched. */
export function clearMermaidZoomState(): void {
  closeMermaidOverlay();
  viewRegistry.clear();
}

/** Closes the fullscreen diagram overlay, if one is open. */
export function closeMermaidOverlay(): void {
  activeOverlayClose?.();
}

function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, "\n").trim();
}

function sourceKey(source: string, occurrence: number): string {
  return `${source}\u0000${occurrence}`;
}

function readNaturalSize(svg: SVGSVGElement): Size | null {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      parts.every((part) => Number.isFinite(part)) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const widthAttr = svg.getAttribute("width") ?? "";
  const heightAttr = svg.getAttribute("height") ?? "";
  if (widthAttr.endsWith("%") || heightAttr.endsWith("%")) return null;

  const width = Number.parseFloat(widthAttr);
  const height = Number.parseFloat(heightAttr);
  if (
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return { width, height };
  }

  return null;
}

/**
 * Upgrades rendered Mermaid SVGs with pan/zoom.
 *
 * Containers are keyed by source text plus occurrence, pruned to the current
 * render, and skipped when Mermaid produced no SVG (for example after a syntax
 * error). Calling it again on the same container is a no-op.
 */
export function enhanceMermaidDiagrams(
  root: ParentNode,
  options: MermaidZoomOptions = {},
): void {
  const measure = options.measure ?? defaultMeasure;

  for (const controller of [...liveControllers]) {
    if (!controller.isConnected()) {
      controller.dispose();
      liveControllers.delete(controller);
    }
  }

  const containers = Array.from(
    root.querySelectorAll<HTMLElement>(".mermaid"),
  );
  const occurrences = new Map<string, number>();
  const keyed = containers.map((container) => {
    const source = normalizeSource(container.dataset.mermaidSource ?? "");
    const occurrence = occurrences.get(source) ?? 0;
    occurrences.set(source, occurrence + 1);
    return { container, key: sourceKey(source, occurrence) };
  });

  const liveKeys = new Set(keyed.map(({ key }) => key));
  for (const key of viewRegistry.keys()) {
    if (!liveKeys.has(key)) viewRegistry.delete(key);
  }

  for (const { container, key } of keyed) {
    if (container.dataset.zoomEnhanced === "true") continue;

    const svg = container.querySelector<SVGSVGElement>("svg");
    if (!svg) continue;

    const natural = readNaturalSize(svg);
    if (!natural) continue;

    const controller = new MermaidZoom(
      container,
      svg,
      natural,
      key,
      measure,
    );
    controller.mount();
    liveControllers.add(controller);
  }
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface OverlaySession {
  overlay: HTMLDivElement;
  placeholder: HTMLDivElement;
  savedMode: ViewMode;
  savedTransform: ZoomTransform;
  savedHeight: string;
  previousFocus: HTMLElement | null;
  onKeyDown: (event: KeyboardEvent) => void;
  onBackdrop: (event: Event) => void;
  inertTarget: HTMLElement | null;
}

function isToolbarTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(".mermaid-toolbar") !== null
  );
}

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * 400;
  return event.deltaY;
}

function toolbarButton(
  doc: Document,
  action: string,
  label: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "mermaid-toolbar__button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function textButton(
  doc: Document,
  action: string,
  label: string,
  glyph: string,
): HTMLButtonElement {
  const button = toolbarButton(doc, action, label);
  button.textContent = glyph;
  return button;
}

function iconButton(
  doc: Document,
  action: string,
  label: string,
  icon: string,
): HTMLButtonElement {
  const button = toolbarButton(doc, action, label);
  button.innerHTML = icon;
  return button;
}

/**
 * Owns one enhanced diagram: viewport DOM, transform, input and overlay.
 *
 * The controller is deliberately independent of `renderMarkdown`: it is
 * constructed with the SVG and a key, and the registry is the only shared
 * state. Disposal is driven by the enhancer when a repaint detaches the DOM.
 */
class MermaidZoom {
  private readonly viewport: HTMLElement;
  private readonly natural: Size;
  private readonly key: string;
  private readonly measure: MeasureViewport;
  private readonly stage: HTMLDivElement;
  private readonly percentLabel: HTMLSpanElement;
  private readonly inlineButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;

  private transform: ZoomTransform = { scale: 1, x: 0, y: 0 };
  private mode: ViewMode = "fit-width";
  private inlineReturn: {
    mode: EnhancedMode;
    transform: ZoomTransform;
  } | null = null;
  private size: Size = { width: 0, height: 0 };
  private drag: DragState | null = null;
  private suppressClick = false;
  private resizeObserver: ResizeObserver | null = null;
  private overlay: OverlaySession | null = null;

  constructor(
    viewport: HTMLElement,
    private readonly svg: SVGSVGElement,
    natural: Size,
    key: string,
    measure: MeasureViewport,
  ) {
    this.viewport = viewport;
    this.natural = natural;
    this.key = key;
    this.measure = measure;

    const doc = viewport.ownerDocument;
    this.stage = doc.createElement("div");
    this.stage.className = "mermaid-stage";

    this.percentLabel = doc.createElement("span");
    this.percentLabel.className = "mermaid-toolbar__zoom";
    this.percentLabel.setAttribute("aria-live", "polite");
    this.percentLabel.textContent = "100%";

    this.inlineButton = iconButton(
      doc,
      "inline",
      "Show diagram inline",
      INLINE_ICON,
    );

    this.fullscreenButton = iconButton(
      doc,
      "fullscreen",
      "Open diagram fullscreen",
      FULLSCREEN_ICON,
    );
  }

  isConnected(): boolean {
    return this.viewport.isConnected;
  }

  mount(): void {
    const doc = this.viewport.ownerDocument;

    this.svg.setAttribute("width", String(this.natural.width));
    this.svg.setAttribute("height", String(this.natural.height));
    this.svg.style.width = `${this.natural.width}px`;
    this.svg.style.height = `${this.natural.height}px`;
    this.svg.style.maxWidth = "none";
    this.stage.appendChild(this.svg);

    const toolbar = doc.createElement("div");
    toolbar.className = "mermaid-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Diagram controls");

    const zoomOut = textButton(doc, "zoom-out", "Zoom out", "−");
    const zoomIn = textButton(doc, "zoom-in", "Zoom in", "+");
    const fit = iconButton(doc, "fit", "Fit diagram", FIT_ICON);

    toolbar.append(
      zoomOut,
      this.percentLabel,
      zoomIn,
      fit,
      this.inlineButton,
      this.fullscreenButton,
    );

    this.viewport.classList.add("mermaid--enhanced");
    this.updateViewportA11y();
    this.viewport.replaceChildren(this.stage, toolbar);
    this.viewport.dataset.zoomEnhanced = "true";
    this.updateInlineButton();

    zoomOut.addEventListener("click", () => {
      if (this.mode !== "inline") this.zoomAroundCenter(1 / ZOOM_STEP);
    });
    zoomIn.addEventListener("click", () => {
      if (this.mode !== "inline") this.zoomAroundCenter(ZOOM_STEP);
    });
    fit.addEventListener("click", () => {
      if (this.mode !== "inline") this.fitWhole();
    });
    this.inlineButton.addEventListener("click", () => this.toggleInline());
    this.fullscreenButton.addEventListener("click", () =>
      this.toggleFullscreen(),
    );

    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    this.viewport.addEventListener("click", this.onClickCapture, true);
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    this.viewport.addEventListener("dblclick", this.onDoubleClick);
    this.viewport.addEventListener("keydown", this.onKeyDown);

    this.size = this.measure(this.viewport);
    const saved = viewRegistry.get(this.key);
    if (saved?.mode === "inline") {
      this.restore(saved);
    } else if (this.size.width > 0) {
      this.applyFittedHeight(this.size.width);
      this.size = this.measure(this.viewport);
      if (saved) this.restore(saved);
      else this.fitWidth();
    } else {
      this.paintTransform();
      this.save();
    }

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.viewport);
    }
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopDragging();
    if (this.overlay) this.closeFullscreen();

    this.viewport.removeEventListener("pointerdown", this.onPointerDown);
    this.viewport.removeEventListener("click", this.onClickCapture, true);
    this.viewport.removeEventListener("wheel", this.onWheel);
    this.viewport.removeEventListener("dblclick", this.onDoubleClick);
    this.viewport.removeEventListener("keydown", this.onKeyDown);
  }

  private limits(): { min: number; max: number } {
    return scaleLimits(fitWholeScale(this.natural, this.size));
  }

  private applyFittedHeight(width: number): void {
    if (width <= 0) return;
    const height = Math.max(
      MIN_VIEWPORT_HEIGHT,
      fittedHeight(this.natural, { width, height: this.size.height }),
    );
    this.viewport.style.height = `${Math.round(height)}px`;
  }

  private paintTransform(): void {
    if (this.mode !== "inline") {
      this.stage.style.transform = `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.scale})`;
      this.percentLabel.textContent = `${Math.round(this.transform.scale * 100)}%`;
    }
    this.viewport.classList.toggle(
      "mermaid--active",
      this.mode === "custom",
    );
  }

  private save(): void {
    viewRegistry.set(this.key, {
      ...this.transform,
      mode: this.mode,
      ...(this.mode === "inline" && this.inlineReturn
        ? { returnMode: this.inlineReturn.mode }
        : {}),
    });
  }

  private applyTransform(next: ZoomTransform, mode: EnhancedMode): void {
    this.transform = clampTranslation(next, this.natural, this.size);
    this.mode = mode;
    this.paintTransform();
    this.save();
  }

  private restore(saved: SavedView): void {
    if (saved.mode === "inline") {
      this.enterInline({
        mode: saved.returnMode ?? "fit-width",
        transform: { scale: saved.scale, x: saved.x, y: saved.y },
      });
      return;
    }

    if (saved.mode === "fit-width") {
      this.fitWidth();
    } else if (saved.mode === "fit-whole") {
      this.fitWhole();
    } else {
      this.applyTransform(
        { scale: saved.scale, x: saved.x, y: saved.y },
        "custom",
      );
    }
  }

  private updateViewportA11y(): void {
    this.viewport.setAttribute("role", "group");
    if (this.mode === "inline") {
      this.viewport.removeAttribute("tabindex");
      this.viewport.setAttribute(
        "aria-label",
        "Mermaid diagram shown inline. Use the toolbar to show zoom controls.",
      );
    } else {
      this.viewport.tabIndex = 0;
      this.viewport.setAttribute(
        "aria-label",
        "Mermaid diagram. Use plus and minus to zoom and arrow keys to pan.",
      );
    }
  }

  private updateInlineButton(): void {
    const inline = this.mode === "inline";
    const label = inline ? "Show zoom controls" : "Show diagram inline";
    this.inlineButton.setAttribute("aria-pressed", String(inline));
    this.inlineButton.setAttribute("aria-label", label);
    this.inlineButton.title = label;
  }

  private toggleInline(): void {
    if (this.overlay) return;
    if (this.mode === "inline") this.exitInline();
    else this.enterInline();
  }

  private enterInline(
    returnView?: { mode: EnhancedMode; transform: ZoomTransform },
  ): void {
    if (this.mode === "inline") return;

    const previous = returnView ?? {
      mode: this.mode,
      transform: { ...this.transform },
    };
    this.inlineReturn = {
      mode: previous.mode,
      transform: { ...previous.transform },
    };
    this.transform = { ...previous.transform };
    this.mode = "inline";

    this.viewport.classList.add("mermaid--inline");
    this.viewport.classList.remove("mermaid--active");
    this.viewport.style.height = "";
    this.updateInlineButton();
    this.updateViewportA11y();
    this.save();
  }

  private exitInline(): void {
    if (this.mode !== "inline") return;

    const target = this.inlineReturn ?? {
      mode: "fit-width" as const,
      transform: { scale: 1, x: 0, y: 0 },
    };
    this.inlineReturn = null;
    this.viewport.classList.remove("mermaid--inline");

    this.size = this.measure(this.viewport);
    if (this.size.width > 0) {
      this.applyFittedHeight(this.size.width);
      this.size = this.measure(this.viewport);
    }
    this.restore({ ...target.transform, mode: target.mode });
    this.updateInlineButton();
    this.updateViewportA11y();
  }

  private fitWidth(): void {
    if (this.size.width <= 0) {
      this.mode = "fit-width";
      this.paintTransform();
      this.save();
      return;
    }

    const scale = fitWidthScale(this.natural, this.size);
    this.applyTransform({ scale, x: 0, y: 0 }, "fit-width");
  }

  private fitWhole(): void {
    if (this.size.width <= 0 || this.size.height <= 0) return;
    const scale = clampScale(
      fitWholeScale(this.natural, this.size),
      this.limits(),
    );
    this.applyTransform({ scale, x: 0, y: 0 }, "fit-whole");
  }

  private zoomAroundCenter(factor: number): void {
    this.zoomAt({ x: this.size.width / 2, y: this.size.height / 2 }, factor);
  }

  private zoomAt(point: Point, factor: number): void {
    if (this.size.width <= 0 || this.size.height <= 0) return;
    const next = zoomAtPoint(this.transform, point, factor, this.limits());
    if (next === this.transform) return;
    this.applyTransform(next, "custom");
  }

  private panBy(dx: number, dy: number): void {
    this.panTo(this.transform.x + dx, this.transform.y + dy);
  }

  private panTo(x: number, y: number): void {
    const next = clampTranslation(
      { scale: this.transform.scale, x, y },
      this.natural,
      this.size,
    );
    if (next.x === this.transform.x && next.y === this.transform.y) return;
    this.applyTransform(next, "custom");
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.mode === "inline") return;
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();

    const bounds = this.viewport.getBoundingClientRect();
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    this.zoomAt(point, wheelZoomFactor(normalizeWheelDelta(event)));
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.mode === "inline") return;
    if (event.button !== 0 || event.isPrimary === false) return;
    if (isToolbarTarget(event.target)) return;

    this.viewport.focus({ preventScroll: true });
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.transform.x,
      originY: this.transform.y,
      moved: false,
    };

    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      this.viewport.classList.add("mermaid--dragging");
      if (typeof this.viewport.setPointerCapture === "function") {
        try {
          this.viewport.setPointerCapture(event.pointerId);
        } catch {
          // Best-effort: the window listeners still track the drag.
        }
      }
    }

    event.preventDefault();
    this.panTo(drag.originX + dx, drag.originY + dy);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    this.stopDragging();
    if (drag.moved) {
      this.suppressClick = true;
      window.setTimeout(() => {
        this.suppressClick = false;
      }, 0);
    }
  };

  private stopDragging(): void {
    const drag = this.drag;
    if (!drag) return;

    this.drag = null;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.viewport.classList.remove("mermaid--dragging");

    if (typeof this.viewport.releasePointerCapture === "function") {
      try {
        this.viewport.releasePointerCapture(drag.pointerId);
      } catch {
        // The pointer may already have been released.
      }
    }
  }

  private onClickCapture = (event: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.mode === "inline") return;
    if (isToolbarTarget(event.target)) return;
    event.preventDefault();
    this.fitWhole();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode === "inline" || isToolbarTarget(event.target)) return;
    const step = event.shiftKey ? FAST_PAN_STEP : PAN_STEP;

    switch (event.key) {
      case "+":
      case "=":
        this.zoomAroundCenter(ZOOM_STEP);
        break;
      case "-":
      case "_":
        this.zoomAroundCenter(1 / ZOOM_STEP);
        break;
      case "0":
        this.fitWhole();
        break;
      case "ArrowLeft":
        this.panBy(step, 0);
        break;
      case "ArrowRight":
        this.panBy(-step, 0);
        break;
      case "ArrowUp":
        this.panBy(0, step);
        break;
      case "ArrowDown":
        this.panBy(0, -step);
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  private onResize(): void {
    if (this.mode === "inline") return;

    const size = this.measure(this.viewport);
    if (size.width === this.size.width && size.height === this.size.height) {
      return;
    }

    this.size = size;
    if (size.width <= 0) return;

    if (this.mode === "fit-width") {
      this.applyFittedHeight(size.width);
      this.size = this.measure(this.viewport);
      this.fitWidth();
    } else if (this.mode === "fit-whole") {
      this.fitWhole();
    } else {
      this.applyTransform(this.transform, "custom");
    }
  }

  private toggleFullscreen(): void {
    if (this.mode === "inline") return;
    if (this.overlay) this.closeFullscreen();
    else this.openFullscreen();
  }

  private updateFullscreenButton(): void {
    const label = this.overlay
      ? "Exit fullscreen"
      : "Open diagram fullscreen";
    this.fullscreenButton.setAttribute("aria-label", label);
    this.fullscreenButton.title = label;
  }

  private openFullscreen(): void {
    if (this.overlay) return;
    closeMermaidOverlay();

    const doc = this.viewport.ownerDocument;
    const oldSize = this.size;
    const savedMode = this.mode;
    const savedTransform = { ...this.transform };
    const savedHeight = this.viewport.style.height;
    const previousFocus =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

    const placeholder = doc.createElement("div");
    placeholder.className = "mermaid-placeholder";
    const boxHeight = this.viewport.offsetHeight || oldSize.height;
    placeholder.style.height = `${Math.max(1, boxHeight)}px`;
    this.viewport.parentElement?.insertBefore(placeholder, this.viewport);

    const overlay = doc.createElement("div");
    overlay.className = "mermaid-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Diagram fullscreen");

    const closeButton = doc.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mermaid-overlay__close";
    closeButton.setAttribute("aria-label", "Close fullscreen diagram");
    closeButton.title = "Close fullscreen diagram";
    closeButton.textContent = "×";

    overlay.append(this.viewport, closeButton);
    doc.body.appendChild(overlay);

    const inertTarget = doc.getElementById("app");
    if (inertTarget) inertTarget.inert = true;

    this.viewport.classList.add("mermaid--fullscreen");
    this.viewport.style.height = "100%";

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeFullscreen();
    };
    doc.addEventListener("keydown", onKeyDown, true);

    const onBackdrop = (event: Event): void => {
      if (event.target === overlay) this.closeFullscreen();
    };
    overlay.addEventListener("pointerdown", onBackdrop);
    closeButton.addEventListener("click", () => this.closeFullscreen());

    this.overlay = {
      overlay,
      placeholder,
      savedMode,
      savedTransform,
      savedHeight,
      previousFocus,
      onKeyDown,
      onBackdrop,
      inertTarget,
    };
    activeOverlayClose = () => this.closeFullscreen();
    this.updateFullscreenButton();

    this.size = this.measure(this.viewport);
    if (savedMode === "custom" && oldSize.width > 0 && this.size.width > 0) {
      const center = contentPointAtViewportCenter(
        savedTransform,
        oldSize,
      );
      const scale = clampScale(savedTransform.scale, this.limits());
      this.applyTransform(
        centerOnContentPoint(center, scale, this.size, this.natural),
        "custom",
      );
    } else {
      this.fitWhole();
    }

    this.viewport.focus({ preventScroll: true });
  }

  private closeFullscreen(): void {
    const session = this.overlay;
    if (!session) return;

    this.overlay = null;
    activeOverlayClose = null;

    session.overlay.ownerDocument.removeEventListener(
      "keydown",
      session.onKeyDown,
      true,
    );
    session.overlay.removeEventListener("pointerdown", session.onBackdrop);
    if (session.inertTarget) session.inertTarget.inert = false;

    this.viewport.classList.remove("mermaid--fullscreen");
    this.viewport.style.height = session.savedHeight;

    if (session.placeholder.isConnected) {
      session.placeholder.replaceWith(this.viewport);
    } else {
      this.viewport.remove();
    }
    session.overlay.remove();

    this.updateFullscreenButton();
    this.size = this.measure(this.viewport);
    this.restore({
      ...session.savedTransform,
      mode: session.savedMode,
    });

    if (session.previousFocus?.isConnected) {
      session.previousFocus.focus({ preventScroll: true });
    } else if (this.viewport.isConnected) {
      this.viewport.focus({ preventScroll: true });
    }
  }
}
