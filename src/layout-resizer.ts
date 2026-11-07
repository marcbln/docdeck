/**
 * Reusable controller for one pane boundary.
 *
 * Pointer drags update only the pane size; the final value is persisted on
 * release. Keyboard, Home/End, Enter/Space and double-click follow the same
 * clamping path. When the pane is hidden or collapsed the handle is inert.
 *
 * It deliberately knows nothing about Markdown or the document renderer.
 */

export type ResizeOrientation = "vertical" | "horizontal";
export type ResizeAxis = "x" | "y";

export interface ResizeBounds {
  min: number;
  max: number;
}

export interface LayoutResizerOptions {
  handle: HTMLElement;
  /** ARIA orientation of the separator. */
  orientation: ResizeOrientation;
  /** Pointer axis that changes the size. */
  axis: ResizeAxis;
  /** True when moving up/left increases the size (event log). */
  invert?: boolean;
  getSize(): number;
  setSize(size: number): void;
  getBounds(): ResizeBounds;
  getDefault(): number;
  /** Keyboard step in size units. Defaults to 10. */
  step?: number;
  /** Pointer units per pixel; defaults to 1. */
  getScale?: () => number;
  /** Called with the final value on drag end, keyboard change, or reset. */
  onPersist?(size: number): void;
  label?: string;
}

export class LayoutResizer {
  private readonly options: LayoutResizerOptions;
  private enabled = true;
  private current: number;

  private drag: {
    pointerId: number | undefined;
    origin: number;
    startSize: number;
  } | null = null;

  constructor(options: LayoutResizerOptions) {
    this.options = options;
    this.current = options.getSize();

    const handle = options.handle;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", options.orientation);
    handle.tabIndex = 0;
    if (options.label) handle.setAttribute("aria-label", options.label);

    handle.addEventListener("pointerdown", this.onPointerDown);
    handle.addEventListener("dblclick", this.onDoubleClick);
    handle.addEventListener("keydown", this.onKeyDown);

    this.updateAria();
  }

  /** Re-reads the size from the owning pane (window resize). */
  public refresh(): void {
    this.current = this.options.getSize();
    this.updateAria();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const handle = this.options.handle;
    handle.hidden = !enabled;
    handle.tabIndex = enabled ? 0 : -1;
    if (enabled) {
      handle.removeAttribute("aria-disabled");
    } else {
      handle.setAttribute("aria-disabled", "true");
      this.stopDrag();
    }
    this.updateAria();
  }

  public destroy(): void {
    const handle = this.options.handle;
    handle.removeEventListener("pointerdown", this.onPointerDown);
    handle.removeEventListener("dblclick", this.onDoubleClick);
    handle.removeEventListener("keydown", this.onKeyDown);
    this.stopDrag();
  }

  private clamp(value: number): number {
    const bounds = this.options.getBounds();
    return Math.min(bounds.max, Math.max(bounds.min, value));
  }

  private apply(value: number): void {
    this.current = this.clamp(value);
    this.options.setSize(this.current);
    this.updateAria();
  }

  private updateAria(): void {
    const handle = this.options.handle;
    const bounds = this.options.getBounds();
    handle.setAttribute("aria-valuemin", String(bounds.min));
    handle.setAttribute("aria-valuemax", String(bounds.max));
    handle.setAttribute("aria-valuenow", String(this.current));
  }

  private persist(): void {
    this.options.onPersist?.(this.current);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.button !== 0 || event.isPrimary === false) return;

    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      origin: this.options.axis === "x" ? event.clientX : event.clientY,
      startSize: this.current,
    };

    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("blur", this.onWindowBlur);

    const handle = this.options.handle;
    if (typeof handle.setPointerCapture === "function") {
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Best effort: the window listeners still track the drag.
      }
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    event.preventDefault();
    const coordinate = this.options.axis === "x" ? event.clientX : event.clientY;
    const delta = coordinate - drag.origin;
    const scale = this.options.getScale?.() ?? 1;
    const direction = this.options.invert ? -1 : 1;

    this.apply(drag.startSize + delta * scale * direction);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.stopDrag();
    this.persist();
  };

  private onWindowBlur = (): void => {
    if (!this.drag) return;
    this.stopDrag();
    this.persist();
  };

  private stopDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;

    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("blur", this.onWindowBlur);

    const handle = this.options.handle;
    if (typeof handle.releasePointerCapture === "function") {
      try {
        handle.releasePointerCapture(drag.pointerId as number);
      } catch {
        // The pointer may already be released.
      }
    }
  }

  private onDoubleClick = (event: MouseEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.apply(this.options.getDefault());
    this.persist();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;

    const step = this.options.step ?? 10;
    const invert = this.options.invert ? -1 : 1;

    switch (event.key) {
      case "ArrowLeft":
        if (this.options.orientation !== "vertical") return;
        event.preventDefault();
        this.apply(this.current - step);
        break;
      case "ArrowRight":
        if (this.options.orientation !== "vertical") return;
        event.preventDefault();
        this.apply(this.current + step);
        break;
      case "ArrowUp":
        if (this.options.orientation !== "horizontal") return;
        event.preventDefault();
        this.apply(this.current - step * invert);
        break;
      case "ArrowDown":
        if (this.options.orientation !== "horizontal") return;
        event.preventDefault();
        this.apply(this.current + step * invert);
        break;
      case "Home":
        event.preventDefault();
        this.apply(this.options.getBounds().min);
        break;
      case "End":
        event.preventDefault();
        this.apply(this.options.getBounds().max);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        this.apply(this.options.getDefault());
        break;
      default:
        return;
    }

    this.persist();
  };
}

