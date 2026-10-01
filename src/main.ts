import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { renderMarkdown } from "./markdown";

interface FilePayload {
  path: string;
  filename: string;
  content: string;
  modified_time: number;
}

interface Tab {
  path: string;
  filename: string;
  content: string;
  modifiedTime: number;
  hasUnreadUpdate: boolean;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: #${id}`);
  return el as T;
}

class AppState {
  private readonly tabs = new Map<string, Tab>();
  private activePath: string | null = null;
  private autoSort = false;
  private sidebarLayout = false;

  /**
   * Monotonic token per document. A reload only paints when it is still the
   * newest request for that path, so a slow read cannot overwrite a newer one.
   */
  private readonly reloadTokens = new Map<string, number>();

  private readonly appRoot = must<HTMLDivElement>("app");
  private readonly tabsBar = must<HTMLElement>("tabs-bar");
  private readonly emptyState = must<HTMLElement>("empty-state");
  private readonly viewer = must<HTMLElement>("markdown-viewer");
  private readonly layoutBtn = must<HTMLButtonElement>("toggle-layout-btn");
  private readonly autosortBtn = must<HTMLButtonElement>("toggle-autosort-btn");

  constructor() {
    this.bindControls();
    void this.start();
  }

  private async start(): Promise<void> {
    // Listeners first, so no CLI or watcher event can arrive unhandled.
    await this.bindBackend();
    await this.loadStartupPaths();
  }

  /// Pulls the documents this process was launched with. `startup_paths` is a
  /// command rather than an event precisely because the webview may not have
  /// mounted yet when the app finishes setting itself up.
  private async loadStartupPaths(): Promise<void> {
    try {
      const paths = await invoke<string[]>("startup_paths");
      for (const path of paths) {
        await this.openDocument(path);
      }
    } catch (error) {
      console.error("Failed to read startup paths", error);
    }
  }

  // -- wiring ---------------------------------------------------------------

  private bindControls(): void {
    this.layoutBtn.addEventListener("click", () => {
      this.sidebarLayout = !this.sidebarLayout;
      this.appRoot.classList.toggle("layout-top", !this.sidebarLayout);
      this.appRoot.classList.toggle("layout-side", this.sidebarLayout);
    });

    this.autosortBtn.addEventListener("click", () => {
      this.autoSort = !this.autoSort;
      this.autosortBtn.classList.toggle("active", this.autoSort);
      this.autosortBtn.textContent = `⚡ Auto-Sort: ${
        this.autoSort ? "ON" : "OFF"
      }`;
      this.renderTabs();
    });
  }

  private async bindBackend(): Promise<void> {
    try {
      // A second `docdeck <file>` in another shell, or args from the first launch.
      await listen<string>("open-file-cli", (event) => {
        void this.openDocument(event.payload);
      });

      // A background write settled by the debounced inotify watcher.
      await listen<string>("file-updated", (event) => {
        void this.reloadDocument(event.payload);
      });
    } catch (error) {
      console.error("Failed to attach backend listeners", error);
      this.showMessage("Could not connect to the docdeck backend.");
    }
  }

  // -- document lifecycle ---------------------------------------------------

  public async openDocument(rawPath: string): Promise<void> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      const existing = this.tabs.get(data.path);
      if (existing) {
        existing.filename = data.filename;
        existing.content = data.content;
        existing.modifiedTime = data.modified_time;
      } else {
        this.tabs.set(data.path, {
          path: data.path,
          filename: data.filename,
          content: data.content,
          modifiedTime: data.modified_time,
          hasUnreadUpdate: false,
        });
      }

      this.setActiveTab(data.path);
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      this.showMessage(`Could not open ${rawPath}`);
    }
  }

  private async reloadDocument(path: string): Promise<void> {
    const tab = this.tabs.get(path);
    if (!tab) return;

    const token = (this.reloadTokens.get(path) ?? 0) + 1;
    this.reloadTokens.set(path, token);

    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: path });
      if (this.reloadTokens.get(path) !== token) return; // superseded

      tab.content = data.content;
      tab.modifiedTime = data.modified_time;

      if (this.activePath === path) {
        // Reading this tab, so the change is not "unread" — paint it straight away.
        tab.hasUnreadUpdate = false;
      } else {
        tab.hasUnreadUpdate = true;
      }

      this.renderTabs();
      if (this.activePath === path) {
        await this.renderActiveContent();
      }
    } catch (error) {
      console.error(`Failed to reload modified file: ${path}`, error);
    }
  }

  public setActiveTab(path: string): void {
    this.activePath = path;
    const tab = this.tabs.get(path);
    if (tab) tab.hasUnreadUpdate = false;

    this.renderTabs();
    void this.renderActiveContent();
  }

  private async closeTab(path: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      await invoke("close_file", { pathStr: path });
    } catch (error) {
      console.error(`Failed to release watch for ${path}`, error);
    }

    this.tabs.delete(path);
    this.reloadTokens.delete(path);

    if (this.activePath === path) {
      const remaining = [...this.tabs.keys()];
      this.activePath = remaining[remaining.length - 1] ?? null;
    }

    this.renderTabs();
    await this.renderActiveContent();
  }

  // -- rendering ------------------------------------------------------------

  private renderTabs(): void {
    this.tabsBar.replaceChildren();

    const ordered = [...this.tabs.values()];
    if (this.autoSort) {
      ordered.sort((a, b) => b.modifiedTime - a.modifiedTime);
    }

    for (const tab of ordered) {
      const item = document.createElement("div");
      item.className = "tab-item";
      item.setAttribute("role", "tab");
      item.setAttribute("tabindex", "0");
      if (tab.path === this.activePath) item.classList.add("active");
      if (tab.hasUnreadUpdate) item.classList.add("has-update");
      item.addEventListener("click", () => this.setActiveTab(tab.path));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.setActiveTab(tab.path);
        }
      });

      const dot = document.createElement("span");
      dot.className = "tab-dot";

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.filename;
      title.title = tab.path;

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("role", "button");
      close.setAttribute("aria-label", `Close ${tab.filename}`);
      close.addEventListener("click", (event) => {
        void this.closeTab(tab.path, event);
      });

      item.append(dot, title, close);
      this.tabsBar.appendChild(item);
    }
  }

  private async renderActiveContent(): Promise<void> {
    const tab = this.activePath ? this.tabs.get(this.activePath) : undefined;

    if (!tab) {
      this.emptyState.classList.remove("hidden");
      this.viewer.classList.add("hidden");
      this.viewer.replaceChildren();
      return;
    }

    this.emptyState.classList.add("hidden");
    this.viewer.classList.remove("hidden");

    try {
      await renderMarkdown(tab.content, this.viewer);
    } catch (error) {
      console.error("Failed to render markdown", error);
      this.showMessage(`Could not render ${tab.filename}`);
    }
  }

  private showMessage(message: string): void {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    this.emptyState.replaceChildren(paragraph);
    this.emptyState.classList.remove("hidden");
    this.viewer.classList.add("hidden");
  }
}

function bootstrap(): void {
  try {
    new AppState();
  } catch (error) {
    console.error("docdeck failed to start", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}