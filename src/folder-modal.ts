import { buildTree, type TreeNode } from "./file-tree";

export interface FolderModalCallbacks {
  /** Whether a path already has an open tab, so it starts checked. */
  isOpen(path: string): boolean;
  /**
   * Confirmed: `selected` is every checked path. `known` is every path the
   * picker displayed, so the caller can close tabs that were unchecked.
   */
  onConfirm(selected: string[], known: string[]): void | Promise<void>;
  /** Cancelled: nothing should change. */
  onCancel(): void;
}

/**
 * The folder picker: one collapsible checkbox tree per watched root, with
 * "watch + open" and "cancel" actions.
 *
 * A file's checkbox reflects whether it has an open tab. Checking it on confirm
 * opens it; unchecking closes it — the modal shows and edits one bit of truth
 * rather than inventing a second selection model.
 */
export class FolderModal {
  private readonly callbacks: FolderModalCallbacks;
  private readonly overlay: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly selection = new Map<string, boolean>();
  private readonly knownPaths = new Set<string>();

  constructor(callbacks: FolderModalCallbacks) {
    this.callbacks = callbacks;

    const overlay = document.createElement("div");
    overlay.className = "folder-modal-overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Choose documents to watch");

    const dialog = document.createElement("div");
    dialog.className = "folder-modal";

    const header = document.createElement("div");
    header.className = "folder-modal-header";
    const title = document.createElement("h2");
    title.textContent = "Watch folders";
    const hint = document.createElement("p");
    hint.textContent =
      "Select the documents to open. New and updated Markdown files will open in the background as agents write them.";
    header.append(title, hint);

    const body = document.createElement("div");
    body.className = "folder-modal-body";

    const footer = document.createElement("div");
    footer.className = "folder-modal-footer";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "folder-modal-cancel";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "folder-modal-confirm";
    confirm.textContent = "Watch folders + open selected files";
    footer.append(cancel, confirm);

    dialog.append(header, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    cancel.addEventListener("click", () => {
      this.hide();
      this.callbacks.onCancel();
    });
    confirm.addEventListener("click", () => {
      void this.confirm();
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.hide();
        this.callbacks.onCancel();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen) {
        this.hide();
        this.callbacks.onCancel();
      }
    });

    this.overlay = overlay;
    this.body = body;
  }

  public get isOpen(): boolean {
    return !this.overlay.classList.contains("hidden");
  }

  /** Opens the picker and resets its contents. */
  public show(): void {
    this.selection.clear();
    this.knownPaths.clear();
    this.body.replaceChildren();
    this.overlay.classList.remove("hidden");
  }

  public hide(): void {
    this.overlay.classList.add("hidden");
  }

  /** Appends a root's tree once its scan resolves. */
  public addRoot(root: string, files: string[]): void {
    for (const file of files) {
      this.knownPaths.add(file);
      if (!this.selection.has(file)) {
        this.selection.set(file, this.callbacks.isOpen(file));
      }
    }

    const section = document.createElement("section");
    section.className = "folder-root";

    const heading = document.createElement("div");
    heading.className = "folder-root-path";
    heading.textContent = root;

    section.append(heading, this.renderChildren(buildTree(root, files).children));
    this.body.append(section);
  }

  /** Reports a scan failure inline, without hiding the rest of the picker. */
  public setRootError(root: string, message: string): void {
    const error = document.createElement("p");
    error.className = "folder-error";
    error.textContent = `${root}: ${message}`;
    this.body.append(error);
  }

  private renderChildren(nodes: TreeNode[]): HTMLUListElement {
    const list = document.createElement("ul");
    list.className = "folder-tree";

    for (const node of nodes) {
      const item = document.createElement("li");

      if (node.kind === "directory") {
        item.className = "folder-dir";
        const details = document.createElement("details");
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = node.name;
        details.append(summary, this.renderChildren(node.children));
        item.append(details);
      } else {
        item.className = "folder-file";
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.selection.get(node.path) ?? false;
        checkbox.addEventListener("change", () => {
          this.selection.set(node.path, checkbox.checked);
        });
        const name = document.createElement("span");
        name.textContent = node.name;
        name.title = node.path;
        label.append(checkbox, name);
        item.append(label);
      }

      list.append(item);
    }

    return list;
  }

  private async confirm(): Promise<void> {
    const selected = [...this.selection.entries()]
      .filter(([, checked]) => checked)
      .map(([path]) => path);
    await this.callbacks.onConfirm(selected, [...this.knownPaths]);
  }
}