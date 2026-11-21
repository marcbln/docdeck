/**
 * The `?` help dialog: a shortcut reference and a bundled manual.
 *
 * The dialog is mounted on demand and removed on close, matching the other
 * docdeck modals. It owns no persistence: help always reopens on the
 * Shortcuts tab, and the manual is rendered from an injected Markdown source.
 */

import { marked } from "./markdown";
import {
  buildShortcutReference,
  type ShortcutReferenceGroup,
} from "./shortcut-reference";
import { shortcutPlatform, type ShortcutPlatform } from "./shortcuts";

export type HelpTab = "shortcuts" | "manual";

export interface ShortcutsModalOptions {
  /** Bundled manual source. Trusted content; rendered as Markdown. */
  manualMarkdown: string;
  /** Platform used to label modifier chords; injected for tests. */
  platform?: ShortcutPlatform;
  /** Host for the overlay; defaults to `document.body`. */
  host?: HTMLElement;
  /** Markdown renderer override; defaults to the configured app parser. */
  renderManual?: (markdown: string) => Promise<string>;
}

const defaultRenderManual = async (markdown: string): Promise<string> =>
  await marked.parse(markdown);

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ShortcutsModal {
  private overlay: HTMLDivElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private panels: Record<HelpTab, HTMLElement> | null = null;
  private manualBody: HTMLElement | null = null;
  private manualHtml: string | null = null;
  private activeTab: HelpTab = "shortcuts";
  private previousFocus: HTMLElement | null = null;

  private readonly platform: ShortcutPlatform;
  private readonly host: HTMLElement;
  private readonly renderManual: (markdown: string) => Promise<string>;

  public constructor(private readonly options: ShortcutsModalOptions) {
    this.platform = options.platform ?? shortcutPlatform();
    this.host = options.host ?? document.body;
    this.renderManual = options.renderManual ?? defaultRenderManual;
  }

  public get isOpen(): boolean {
    return this.overlay !== null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.overlay === null) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === "Tab") {
      this.trapFocus(event);
    }
  };

  /**
   * Opens the dialog and renders the manual.
   *
   * Rendering is awaited so tests and callers can rely on the Manual tab being
   * complete when the promise settles. Calling `open()` while it is already
   * open never mounts a second overlay.
   */
  public async open(): Promise<void> {
    if (this.overlay !== null) {
      this.tabs.find((tab) => tab.dataset.tab === this.activeTab)?.focus();
      return;
    }

    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    this.mount();
    document.addEventListener("keydown", this.onKeyDown);
    this.selectTab("shortcuts");
    this.tabs[0]?.focus();
    await this.paintManual();
  }

  public close(): void {
    if (this.overlay === null) return;

    document.removeEventListener("keydown", this.onKeyDown);
    this.overlay.remove();
    this.overlay = null;
    this.tabs = [];
    this.panels = null;
    this.manualBody = null;

    const previous = this.previousFocus;
    this.previousFocus = null;
    if (previous !== null && previous.isConnected) previous.focus();
  }

  public destroy(): void {
    this.close();
  }

  private mount(): void {
    const overlay = element("div", "help-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Help");

    const modal = element("div", "help-modal");

    const header = element("div", "help-header");
    const title = element("span", "help-title", "Help");
    const close = element("button", "help-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close help");
    close.addEventListener("click", () => this.close());
    header.append(title, close);

    const tablist = element("div", "help-tabs");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Help sections");

    const shortcutsPanel = element("section", "help-panel");
    shortcutsPanel.id = "help-panel-shortcuts";
    shortcutsPanel.setAttribute("role", "tabpanel");
    shortcutsPanel.setAttribute("aria-labelledby", "help-tab-shortcuts");
    this.renderShortcuts(shortcutsPanel);

    const manualPanel = element("section", "help-panel");
    manualPanel.id = "help-panel-manual";
    manualPanel.setAttribute("role", "tabpanel");
    manualPanel.setAttribute("aria-labelledby", "help-tab-manual");
    manualPanel.hidden = true;

    const manualBody = element("div", "help-manual markdown-body");
    manualPanel.append(manualBody);

    this.tabs = [
      this.createTab(tablist, "shortcuts", "Shortcuts", shortcutsPanel),
      this.createTab(tablist, "manual", "Manual", manualPanel),
    ];
    tablist.addEventListener("keydown", (event) => this.onTabKeyDown(event));

    const body = element("div", "help-body");
    body.append(shortcutsPanel, manualPanel);

    modal.append(header, tablist, body);
    overlay.append(modal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });

    this.overlay = overlay;
    this.panels = { shortcuts: shortcutsPanel, manual: manualPanel };
    this.manualBody = manualBody;

    this.host.appendChild(overlay);
  }

  private createTab(
    tablist: HTMLElement,
    tab: HelpTab,
    label: string,
    panel: HTMLElement,
  ): HTMLButtonElement {
    const button = element("button", "help-tab", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.id = `help-tab-${tab}`;
    button.setAttribute("aria-controls", panel.id);
    button.dataset.tab = tab;
    button.addEventListener("click", () => this.selectTab(tab, true));
    tablist.append(button);
    return button;
  }

  private renderShortcuts(container: HTMLElement): void {
    const intro = element(
      "p",
      "help-intro",
      "Press ? to reopen this list. Esc closes it.",
    );

    let groups: ShortcutReferenceGroup[];
    try {
      groups = buildShortcutReference(this.platform);
    } catch (error) {
      console.error("Failed to build the shortcut reference", error);
      container.append(
        intro,
        element("p", "help-error", "The shortcut list could not be built."),
      );
      return;
    }

    container.append(intro);
    for (const group of groups) {
      const section = element("section", "help-group");
      section.append(element("h3", "help-group-title", group.title));

      const list = element("ul", "help-shortcuts");
      for (const entry of group.entries) {
        const row = element("li", "help-shortcut");
        const keys = element("span", "help-keys");
        entry.keys.forEach((key, index) => {
          if (index > 0) keys.append(element("span", "help-key-separator", "/"));
          keys.append(element("kbd", "", key));
        });
        row.append(keys, element("span", "help-description", entry.description));
        list.append(row);
      }
      section.append(list);
      container.append(section);
    }
  }

  private async paintManual(): Promise<void> {
    const body = this.manualBody;
    if (body === null) return;

    if (this.manualHtml !== null) {
      body.innerHTML = this.manualHtml;
      return;
    }

    try {
      const html = await this.renderManual(this.options.manualMarkdown);
      // The dialog may have been closed while the parser was running.
      if (this.manualBody !== body) return;
      this.manualHtml = html;
      body.innerHTML = html;
    } catch (error) {
      console.error("Failed to render the manual", error);
      if (this.manualBody !== body) return;
      body.replaceChildren(
        element("p", "help-error", "The manual could not be rendered."),
      );
    }
  }

  private selectTab(tab: HelpTab, focus = false): void {
    this.activeTab = tab;

    for (const button of this.tabs) {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("active", selected);
      if (selected && focus) button.focus();
    }

    if (this.panels !== null) {
      this.panels.shortcuts.hidden = tab !== "shortcuts";
      this.panels.manual.hidden = tab !== "manual";
    }
  }

  /** Arrow/Home/End move between tabs, per the ARIA tabs pattern. */
  private onTabKeyDown(event: KeyboardEvent): void {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    const current = this.tabs.findIndex(
      (button) => button.dataset.tab === this.activeTab,
    );
    if (current < 0) return;

    let next = current;
    if (event.key === "ArrowLeft") {
      next = (current - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === "ArrowRight") {
      next = (current + 1) % this.tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else {
      next = this.tabs.length - 1;
    }

    event.preventDefault();
    const tab = this.tabs[next];
    if (tab?.dataset.tab === "manual" || tab?.dataset.tab === "shortcuts") {
      this.selectTab(tab.dataset.tab as HelpTab, true);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    if (this.overlay === null) return;

    const focusable = [
      ...this.overlay.querySelectorAll<HTMLElement>(
        "button, a[href], [tabindex]",
      ),
    ].filter(
      (node) =>
        node.tabIndex >= 0 &&
        !node.hasAttribute("disabled") &&
        node.closest("[hidden]") === null,
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!this.overlay.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
