/** Where a tab menu should open: pointer coordinates or a tab's rectangle. */
export type TabMenuAnchor = { x: number; y: number } | { rect: DOMRect };

/** Gap kept between the menu and the viewport edges, in CSS pixels. */
const VIEWPORT_MARGIN = 8;

/** Vertical offset used when the menu is anchored below a tab. */
const ANCHOR_GAP = 2;

export type CopyPathHandler = (path: string) => void;

/**
 * Singleton context menu for the tab bar.
 *
 * The menu exists only while open: opening builds the element and installs the
 * global dismissal listeners, closing removes both. The controller never
 * switches tabs; it only reports the path of the tab that was right-clicked.
 */
export class TabContextMenu {
  private menu: HTMLDivElement | null = null;
  private path: string | null = null;
  private returnFocus: HTMLElement | null = null;

  private readonly onPointerDown = (event: Event): void => {
    if (this.menu && !this.menu.contains(event.target as Node)) {
      this.close(false);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.close(true);
  };

  private readonly onViewportChange = (): void => {
    this.close(false);
  };

  constructor(
    private readonly onCopyPath: CopyPathHandler,
    private readonly host: HTMLElement = document.body,
  ) {}

  public get isOpen(): boolean {
    return this.menu !== null;
  }

  /**
   * Opens the menu for `path`. Re-opening while open replaces the previous
   * target, so right-clicking another tab never leaves two menus behind.
   */
  public open(
    path: string,
    anchor: TabMenuAnchor,
    returnFocus: HTMLElement | null = null,
  ): void {
    this.close(false);

    const menu = document.createElement("div");
    menu.className = "tab-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Tab actions");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Copy absolute path";
    item.addEventListener("click", () => {
      const target = this.path;
      this.close(true);
      if (target !== null) this.onCopyPath(target);
    });

    menu.appendChild(item);
    this.menu = menu;
    this.path = path;
    this.returnFocus = returnFocus;

    // Appended before measuring: an element outside the document has no box.
    this.host.appendChild(menu);
    this.position(menu, anchor);

    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("blur", this.onViewportChange);
    window.addEventListener("resize", this.onViewportChange);

    item.focus();
  }

  /** Removes the menu and every listener it installed. */
  public close(restoreFocus = false): void {
    const menu = this.menu;
    if (!menu) return;

    this.menu = null;
    this.path = null;

    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("blur", this.onViewportChange);
    window.removeEventListener("resize", this.onViewportChange);

    menu.remove();

    const target = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus && target?.isConnected) target.focus();
  }

  /** Places the menu at the pointer, or below the tab for keyboard opens. */
  private position(menu: HTMLDivElement, anchor: TabMenuAnchor): void {
    const rect = menu.getBoundingClientRect();
    const origin =
      "rect" in anchor
        ? { x: anchor.rect.left, y: anchor.rect.bottom + ANCHOR_GAP }
        : anchor;

    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;

    menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(origin.x, maxLeft))}px`;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(origin.y, maxTop))}px`;
  }
}
