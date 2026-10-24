export type ToastTone = "info" | "error";

/** How long a toast stays visible before it starts fading out, in ms. */
const TOAST_DURATION_MS = 2000;

/**
 * A single transient notification anchored to the bottom-right corner.
 *
 * One host owns at most one toast node: a new message reuses it, restarts the
 * countdown, and cannot stack duplicates. The node stays in the DOM after it
 * fades so successive messages do not re-create it.
 */
export class ToastHost {
  private el: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement = document.body,
    private readonly durationMs: number = TOAST_DURATION_MS,
  ) {}

  public show(message: string, tone: ToastTone = "info"): void {
    const el = this.ensureElement();
    el.textContent = message;
    el.classList.toggle("toast-error", tone === "error");

    // Remove and re-add in the same frame so a replacement message replays the
    // entrance transition instead of appearing at full opacity instantly.
    el.classList.remove("toast-visible");
    void el.offsetWidth;
    el.classList.add("toast-visible");

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      el.classList.remove("toast-visible");
    }, this.durationMs);
  }

  /** Hides the toast immediately; the next `show` reuses the same node. */
  public dismiss(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.el?.classList.remove("toast-visible");
  }

  private ensureElement(): HTMLDivElement {
    if (this.el !== null && this.el.isConnected) return this.el;

    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    this.host.appendChild(el);
    this.el = el;
    return el;
  }
}
