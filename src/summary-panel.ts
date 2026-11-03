/**
 * The change-summary modal.
 *
 * It reuses the inventory modal's shell so both pop-outs look and behave the
 * same: overlay click and Escape close, focus lands on the close control, and
 * long content scrolls inside the body.
 */

import {
  groupByProject,
  stateLabel,
  summaryFooter,
  summaryMeta,
  type SummaryDocument,
  type SummaryResult,
} from "./summary-model";

export interface SummaryPanelOptions {
  onOpen(path: string): void;
  onRetry(): void;
  onConfigure(): void;
  /** Called for every close, including Escape and overlay clicks. */
  onClose(): void;
}

export class SummaryPanel {
  private overlay: HTMLDivElement | null = null;
  private meta: HTMLSpanElement | null = null;
  private body: HTMLDivElement | null = null;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close();
  };

  constructor(private readonly options: SummaryPanelOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay !== null) return;
    this.mount();
    document.addEventListener("keydown", this.onKeyDown);
    document
      .querySelector<HTMLButtonElement>(".summary-overlay .inbox-modal-close")
      ?.focus();
  }

  setLoading(count: number): void {
    this.open();
    this.setMeta(count === 1 ? "Summarizing 1 document…" : `Summarizing ${count} documents…`);
    if (this.body === null) return;

    const loading = document.createElement("div");
    loading.className = "summary-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");

    const text = document.createElement("p");
    text.textContent =
      "Reading the changes and asking the agent for an overview. This can take a few seconds.";

    const skeleton = document.createElement("div");
    skeleton.className = "summary-skeleton";
    for (let index = 0; index < 4; index += 1) {
      const line = document.createElement("span");
      line.className = "summary-skeleton-line";
      line.style.width = `${92 - index * 11}%`;
      skeleton.append(line);
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "sidebar-inline-action";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());

    loading.append(text, skeleton, cancel);
    this.body.replaceChildren(loading);
  }

  setResult(result: SummaryResult): void {
    this.open();
    this.setMeta(summaryMeta(result));
    if (this.body === null) return;

    const fragment = document.createDocumentFragment();

    const overview = document.createElement("p");
    overview.className = "summary-overview";
    overview.textContent =
      result.overview.trim().length > 0
        ? result.overview
        : "The agent returned no overview.";
    fragment.append(overview);

    if (result.documents.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sidebar-inline-action summary-details-toggle";
      toggle.textContent = `Show details (${result.documents.length})`;

      const details = this.details(result.documents);
      details.hidden = true;

      toggle.addEventListener("click", () => {
        details.hidden = !details.hidden;
        toggle.textContent = details.hidden
          ? `Show details (${result.documents.length})`
          : "Hide details";
      });

      fragment.append(toggle, details);
    }

    if (result.skipped > 0) {
      const note = document.createElement("p");
      note.className = "summary-note";
      note.textContent = `${result.skipped} document${
        result.skipped === 1 ? "" : "s"
      } could not be included (limit, unreadable, or no model output).`;
      fragment.append(note);
    }

    const footer = document.createElement("p");
    footer.className = "summary-footer";
    footer.textContent = summaryFooter(result);
    fragment.append(footer);

    this.body.replaceChildren(fragment);
  }

  setError(message: string): void {
    this.open();
    this.setMeta("Summary failed");
    if (this.body === null) return;

    const error = document.createElement("div");
    error.className = "summary-error";
    error.setAttribute("role", "alert");

    const text = document.createElement("p");
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "summary-error-actions";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "sidebar-inline-action";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => this.options.onRetry());

    const configure = document.createElement("button");
    configure.type = "button";
    configure.className = "sidebar-inline-action";
    configure.textContent = "Open configuration";
    configure.addEventListener("click", () => this.options.onConfigure());

    actions.append(retry, configure);
    error.append(text, actions);
    this.body.replaceChildren(error);
  }

  close(): void {
    if (this.overlay === null) return;
    document.removeEventListener("keydown", this.onKeyDown);
    this.overlay.remove();
    this.overlay = null;
    this.meta = null;
    this.body = null;
    this.options.onClose();
  }

  private setMeta(text: string): void {
    if (this.meta !== null) this.meta.textContent = text;
  }

  private details(documents: readonly SummaryDocument[]): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "summary-details";

    const groups = groupByProject(documents);
    for (const group of groups) {
      if (groups.length > 1) {
        const label = document.createElement("p");
        label.className = "summary-group-label";
        label.textContent = group.project ?? "Other";
        container.append(label);
      }
      for (const document of group.documents) {
        container.append(this.document(document));
      }
    }

    return container;
  }

  private document(doc: SummaryDocument): HTMLDetailsElement {
    const element = document.createElement("details");
    element.className = "summary-doc";

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.className = "summary-doc-title";
    title.textContent = doc.filename;

    const state = document.createElement("span");
    state.className = "summary-doc-state";
    state.dataset.state = doc.state;
    state.textContent = stateLabel(doc.state);

    const project = document.createElement("span");
    project.className = "summary-doc-project";
    project.textContent = doc.project ?? "";

    summary.append(title, state, project);
    element.append(summary);

    if (doc.summary.trim().length > 0) {
      const line = document.createElement("p");
      line.className = "summary-doc-summary";
      line.textContent = doc.summary;
      element.append(line);
    }

    if (doc.bullets.length > 0) {
      const list = document.createElement("ul");
      list.className = "summary-bullets";
      for (const bullet of doc.bullets) {
        const entry = document.createElement("li");
        entry.textContent = bullet;
        list.append(entry);
      }
      element.append(list);
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "sidebar-inline-action summary-open";
    open.textContent = "Open";
    open.addEventListener("click", () => {
      this.close();
      this.options.onOpen(doc.path);
    });
    element.append(open);

    return element;
  }

  private mount(): void {
    const overlay = document.createElement("div");
    overlay.className = "inbox-overlay summary-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Changes summary");

    const modal = document.createElement("div");
    modal.className = "inbox-modal summary-modal";

    const header = document.createElement("div");
    header.className = "inbox-modal-header";
    const title = document.createElement("span");
    title.className = "inbox-modal-title";
    title.textContent = "Changes summary";
    this.meta = document.createElement("span");
    this.meta.className = "inbox-modal-count summary-meta";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "inbox-modal-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close changes summary");
    close.addEventListener("click", () => this.close());
    header.append(title, this.meta, close);

    this.body = document.createElement("div");
    this.body.className = "inbox-modal-body summary-body";

    modal.append(header, this.body);
    overlay.append(modal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });
    document.body.append(overlay);

    this.overlay = overlay;
  }
}
