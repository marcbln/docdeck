/**
 * Thin DOM controller for the one-line status bar.
 *
 * The bar never takes focus, never overlays the document, and renders all text
 * with `textContent`. Clicking the main segment toggles the event log; the
 * warning chip opens it pre-filtered to warnings.
 */

import type { StatusBarView } from "./status-view";

export interface StatusBarOptions {
  /** Click on the bar outside the warning chip. */
  onToggleLog(): void;
  /** Click on the warning chip. */
  onShowWarnings(): void;
}

export class StatusBar {
  private readonly location: HTMLSpanElement;
  private readonly counts: HTMLSpanElement;
  private readonly chip: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: StatusBarOptions,
  ) {
    root.classList.add("status-bar");

    this.location = document.createElement("span");
    this.location.className = "status-bar-location";

    this.counts = document.createElement("span");
    this.counts.className = "status-bar-counts";
    this.counts.hidden = true;

    this.chip = document.createElement("button");
    this.chip.type = "button";
    this.chip.className = "status-bar-chip";
    this.chip.hidden = true;

    root.replaceChildren(this.location, this.counts, this.chip);

    this.chip.addEventListener("click", (event) => {
      event.stopPropagation();
      this.options.onShowWarnings();
    });
    root.addEventListener("click", () => this.options.onToggleLog());
  }

  public get element(): HTMLElement {
    return this.root;
  }

  public render(view: StatusBarView): void {
    this.root.dataset.severity = view.severity;

    if (view.phase === "scanning" && view.location !== null) {
      this.location.textContent = `Scanning ${view.location}`;
      const folders = `${view.directories} ${
        view.directories === 1 ? "folder" : "folders"
      }`;
      const files = `${view.files} ${view.files === 1 ? "file" : "files"}`;
      this.counts.textContent = `(${folders} · ${files})`;
      this.counts.hidden = false;
    } else {
      this.location.textContent = view.text;
      this.counts.textContent = "";
      this.counts.hidden = true;
    }

    const warnings = view.warningCount;
    this.chip.hidden = warnings === 0;
    this.chip.textContent =
      warnings === 1 ? "1 warning" : `${warnings} warnings`;
    this.chip.setAttribute(
      "aria-label",
      warnings === 1
        ? "Show 1 warning in the event log"
        : `Show ${warnings} warnings in the event log`,
    );
  }
}
