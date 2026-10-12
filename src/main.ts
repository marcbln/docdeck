import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import { FolderModal } from "./folder-modal";
import {
  applyMermaidTheme,
  isTailing,
  marked,
  renderMarkdown,
} from "./markdown";
import { MetadataView } from "./metadata-jump";
import {
  createPreferenceWriter,
  loadPreferences,
  type Preferences,
  type ThemeMode,
} from "./preferences";
import { createToggleButton } from "./toolbar";
import { extractHeadings } from "./toc";
import { TocPanel } from "./toc-panel";
import { ThemeController } from "./theme";

interface FilePayload {
  path: string;
  filename: string;
  content: string;
  modified_time: number;
}

/** A CLI argument the backend resolved: a document or a folder to watch. */
interface CliEntry {
  path: string;
  is_dir: boolean;
}

/** A settled filesystem change for one path. */
interface PathChange {
  path: string;
  exists: boolean;
}

/** A watched root and the Markdown documents found beneath it. */
interface FolderScan {
  root: string;
  files: string[];
}

interface Tab {
  path: string;
  filename: string;
  content: string;
  modifiedTime: number;
  hasUnreadUpdate: boolean;
  deletedOnDisk: boolean;
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

  private preferences: Preferences = loadPreferences();

  private readonly appRoot = must<HTMLDivElement>("app");
  private readonly tabsBar = must<HTMLElement>("tabs-bar");
  private readonly emptyState = must<HTMLElement>("empty-state");
  private readonly viewer = must<HTMLElement>("markdown-viewer");
  private readonly contentContainer = must<HTMLElement>("content-container");
  private readonly tocPanelEl = must<HTMLElement>("toc-panel");
  private readonly layoutBtn = must<HTMLButtonElement>("toggle-layout-btn");
  private readonly autosortBtn = must<HTMLButtonElement>("toggle-autosort-btn");

  private readonly writer = createPreferenceWriter();
  private readonly tocPanel: TocPanel;
  private readonly metadata: MetadataView;
  private readonly theme: ThemeController;

  /** Roots shown in the picker but not yet confirmed; reset on cancel/confirm. */
  private readonly pendingRoots = new Set<string>();
  private readonly folderModal: FolderModal;

  constructor() {
    this.metadata = new MetadataView(
      this.viewer,
      this.preferences.frontmatterVisible,
    );
    this.tocPanel = new TocPanel({
      container: this.tocPanelEl,
      scrollParent: this.contentContainer,
      onJumpToMetadata: () => this.metadata.reveal(),
    });
    this.theme = new ThemeController({
      onMermaidThemeChange: applyMermaidTheme,
      // Mermaid bakes colors into the SVG at render time, so a mode change has
      // to be followed by a re-render or diagrams keep the old palette.
      onModeApplied: () => void this.renderActiveContent(),
    });

    this.folderModal = new FolderModal({
      isOpen: (path) => this.tabs.has(path),
      onConfirm: (selected, known) => this.confirmFolders(selected, known),
      onCancel: () => this.pendingRoots.clear(),
    });

    this.applyPreferencesToUi();
    this.bindControls();
    this.theme.apply(this.preferences.themeMode);
    void this.start();
  }

  /** Applies the restored preferences before any control is clicked. */
  private applyPreferencesToUi(): void {
    this.tocPanelEl.hidden = !this.preferences.tocVisible;
  }

  private persist(): void {
    this.writer.schedule(this.preferences);
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
      const entries = await invoke<CliEntry[]>("startup_paths");
      const folders = entries
        .filter((entry) => entry.is_dir)
        .map((entry) => entry.path);

      for (const entry of entries) {
        if (!entry.is_dir) await this.openDocument(entry.path);
      }

      if (folders.length > 0) void this.showFolderModal(folders);
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

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-toc-btn"),
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle Table of Contents",
      initialState: this.preferences.tocVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.tocVisible = next;
        this.tocPanelEl.hidden = !next;
        this.persist();
      },
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-frontmatter-btn"),
      icon: "⚙",
      label: "Frontmatter",
      tooltip: "Toggle Document Metadata",
      initialState: this.preferences.frontmatterVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.frontmatterVisible = next;
        const table = this.viewer.querySelector("details.metadata-table");
        if (table) table.remove();
        if (next) void this.renderActiveContent();
        this.persist();
      },
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-theme-btn"),
      icon: "☀",
      label: "Theme",
      tooltip: "Toggle Light/Dark Theme",
      initialState: this.preferences.themeMode === "light",
      formatLabel: (state) => (state ? "Light" : "Dark"),
      onChange: (next) => {
        const mode: ThemeMode = next ? "light" : "dark";
        this.preferences.themeMode = mode;
        this.theme.apply(mode);
        this.persist();
      },
    });
  }

  private async bindBackend(): Promise<void> {
    try {
      // A second `docdeck <path>` in another shell. Folders reopen the picker.
      await listen<CliEntry>("open-path-cli", (event) => {
        if (event.payload.is_dir) void this.showFolderModal([event.payload.path]);
        else void this.openDocument(event.payload.path);
      });

      // A batch of settled writes from the debounced inotify watcher.
      await listen<PathChange[]>("paths-changed", (event) => {
        for (const change of event.payload) void this.applyPathChange(change);
      });
    } catch (error) {
      console.error("Failed to attach backend listeners", error);
      this.showMessage("Could not connect to the docdeck backend.");
    }
  }

  // -- document lifecycle ---------------------------------------------------

  public async openDocument(
    rawPath: string,
    options: { background?: boolean } = {},
  ): Promise<void> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      const existing = this.tabs.get(data.path);
      if (existing) {
        existing.filename = data.filename;
        existing.content = data.content;
        existing.modifiedTime = data.modified_time;
        existing.deletedOnDisk = false;
      } else {
        this.tabs.set(data.path, {
          path: data.path,
          filename: data.filename,
          content: data.content,
          modifiedTime: data.modified_time,
          hasUnreadUpdate: options.background === true,
          deletedOnDisk: false,
        });
      }

      if (options.background && this.activePath !== null) {
        // Never steal focus from the document being read.
        this.renderTabs();
        if (this.activePath === data.path) await this.renderActiveContent();
      } else {
        this.setActiveTab(data.path);
      }
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      // A background auto-open can lose the race against a delete; that is
      // routine, not an error worth interrupting the reader for.
      if (!options.background) this.showMessage(`Could not open ${rawPath}`);
    }
  }

  /**
   * Handles one settled watcher event.
   *
   * Deleted files keep their tab (content included) and get a marker, so a
   * document replaced mid-read does not silently vanish. Everything that
   * exists is either reloaded or opened in the background — focus is never
   * taken.
   */
  private async applyPathChange(change: PathChange): Promise<void> {
    const tab = this.tabs.get(change.path);

    if (!change.exists) {
      if (!tab || tab.deletedOnDisk) return;
      tab.deletedOnDisk = true;
      this.renderTabs();
      if (this.activePath === change.path) await this.renderActiveContent();
      return;
    }

    if (tab) {
      await this.reloadDocument(change.path);
    } else {
      await this.openDocument(change.path, { background: true });
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
      tab.deletedOnDisk = false;

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

  private async closeTabPath(path: string): Promise<void> {
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

  private async closeTab(path: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.closeTabPath(path);
  }

  // -- folder watching -------------------------------------------------------

  /** Scans each root and opens the picker; safe to call repeatedly. */
  private async showFolderModal(roots: string[]): Promise<void> {
    for (const root of roots) this.pendingRoots.add(root);
    this.folderModal.show();

    for (const root of roots) {
      try {
        const scan = await invoke<FolderScan>("scan_folder", { pathStr: root });
        this.folderModal.addRoot(scan.root, scan.files);
      } catch (error) {
        console.error(`Failed to scan folder ${root}`, error);
        this.folderModal.setRootError(root, "Could not scan this folder.");
      }
    }
  }

  private async confirmFolders(selected: string[], known: string[]): Promise<void> {
    const roots = [...this.pendingRoots];

    try {
      await invoke("watch_folders", { paths: roots });
    } catch (error) {
      console.error("Failed to start folder watch", error);
      return; // Keep the modal open so the user can retry or cancel.
    }

    this.pendingRoots.clear();

    // Unchecking closes; checking opens. Tabs outside the picker are untouched
    // because `known` only ever contains files the modal displayed.
    const selectedSet = new Set(selected);
    for (const path of known) {
      if (!selectedSet.has(path) && this.tabs.has(path)) {
        await this.closeTabPath(path);
      }
    }

    let first = true;
    for (const path of selected) {
      if (!this.tabs.has(path)) {
        await this.openDocument(path, { background: !first });
        first = false;
      }
    }

    this.folderModal.hide();
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
      if (tab.deletedOnDisk) item.classList.add("deleted");
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
      title.title = tab.deletedOnDisk
        ? `${tab.path} (deleted on disk)`
        : tab.path;

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

  /**
   * Paints the active document.
   *
   * Order matters: the body is compiled with heading slugs stamped onto its
   * h1-h4 elements, the frontmatter table is then prepended above that markup
   * (the compiler owns `innerHTML`, so anything mounted first would be wiped),
   * and only then is the TOC rebuilt — it resolves anchors by id against the
   * elements the previous steps wrote.
   */
  private async renderActiveContent(): Promise<void> {
    const tab = this.activePath ? this.tabs.get(this.activePath) : undefined;

    if (!tab) {
      this.emptyState.classList.remove("hidden");
      this.viewer.classList.add("hidden");
      this.viewer.replaceChildren();
      this.metadata.clear();
      this.tocPanel.rebuild([]);
      return;
    }

    this.emptyState.classList.add("hidden");
    this.viewer.classList.remove("hidden");

    const { raw, body } = splitFrontmatter(tab.content);

    // Captured before the paint so the table's height — added after the
    // renderer has already restored the scroll position — is accounted for.
    const wasTailing = isTailing(this.contentContainer);

    try {
      this.metadata.clear();
      this.viewer.replaceChildren();

      const headings = extractHeadings(marked, body);
      await renderMarkdown(body, this.viewer, headings);

      if (raw !== null && this.preferences.frontmatterVisible) {
        this.metadata.mount(parseFrontmatterRows(raw));
        if (wasTailing) {
          this.contentContainer.scrollTop = this.contentContainer.scrollHeight;
        }
      }

      if (tab.deletedOnDisk) {
        const banner = document.createElement("p");
        banner.className = "deleted-banner";
        banner.textContent = "This file was deleted on disk.";
        this.viewer.prepend(banner);
        if (wasTailing) {
          this.contentContainer.scrollTop = this.contentContainer.scrollHeight;
        }
      }

      this.tocPanel.rebuild(headings);
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