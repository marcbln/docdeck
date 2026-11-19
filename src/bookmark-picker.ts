/**
 * Re-anchor picker: a modal list of the active document's current headings.
 *
 * Selecting a heading commits a fresh anchor in the controller. Escape, the
 * overlay and the close button cancel without changing anything, and every
 * path restores focus to the control that opened the picker.
 */

import type { Heading } from "./toc";

export interface BookmarkPickerOptions {
  path: string;
  /** Heading text stored on the bookmark, shown in the picker intro. */
  sectionText: string;
  headings: readonly Heading[];
  /** Currently resolved outline index, marked in the list when present. */
  currentIndex?: number | null;
  onSelect(index: number): void;
  /** Offered only when the outline is empty. */
  onRemove(): void;
  returnFocus?: HTMLElement | null;
  host?: HTMLElement;
}

function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export class BookmarkPicker {
  private overlay: HTMLDivElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private options: BookmarkPickerOptions | null = null;

  public get isOpen(): boolean {
    return this.overlay !== null;
  }

  public open(options: BookmarkPickerOptions): void {
    this.close(false);
    this.options = options;
    this.returnFocus = options.returnFocus ?? null;

    const overlay = document.createElement("div");
    overlay.className = "inbox-overlay bookmark-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Re-anchor bookmark");

    const modal = document.createElement("div");
    modal.className = "inbox-modal bookmark-picker";

    const header = document.createElement("div");
    header.className = "inbox-modal-header";
    const title = document.createElement("span");
    title.className = "inbox-modal-title";
    title.textContent = "Re-anchor bookmark";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "inbox-modal-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Cancel re-anchoring");
    close.addEventListener("click", () => this.close(true));
    header.append(title, close);

    const body = document.createElement("div");
    body.className = "inbox-modal-body bookmark-picker-body";

    const meta = document.createElement("p");
    meta.className = "bookmark-picker-meta";
    meta.textContent = `${fileName(options.path)} — “${options.sectionText}”`;
    body.append(meta);

    if (options.headings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "bookmark-picker-empty";
      empty.textContent = "This document has no headings to anchor to.";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bookmark-picker-remove sidebar-inline-action";
      remove.textContent = "Remove bookmark";
      remove.addEventListener("click", () => {
        const callback = this.options?.onRemove;
        this.close(true);
        callback?.();
      });

      body.append(empty, remove);
    } else {
      const list = document.createElement("ul");
      list.className = "bookmark-picker-list";
      list.setAttribute("role", "list");

      options.headings.forEach((heading, index) => {
        const item = document.createElement("li");
        item.className = "bookmark-picker-item-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = `bookmark-picker-item depth-${heading.depth}`;
        button.dataset.index = String(index);
        button.textContent = heading.text.length > 0 ? heading.text : "(untitled heading)";
        button.setAttribute(
          "aria-label",
          `Anchor to ${heading.text.length > 0 ? heading.text : "untitled heading"}`,
        );
        if (options.currentIndex === index) {
          button.classList.add("current");
          button.setAttribute("aria-current", "true");
        }
        button.addEventListener("click", () => {
          const callback = this.options?.onSelect;
          this.close(true);
          callback?.(index);
        });
        item.append(button);
        list.append(item);
      });
      body.append(list);
    }

    modal.append(header, body);
    overlay.append(modal);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close(true);
    });
    document.addEventListener("keydown", this.onKeyDown, true);

    (options.host ?? document.body).append(overlay);
    this.overlay = overlay;

    const focusTarget =
      overlay.querySelector<HTMLButtonElement>(".bookmark-picker-item") ??
      overlay.querySelector<HTMLButtonElement>(".bookmark-picker-remove") ??
      close;
    focusTarget.focus();
  }

  public close(restoreFocus = false): void {
    if (this.overlay === null) return;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.overlay.remove();
    this.overlay = null;
    this.options = null;

    const target = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  };
}
