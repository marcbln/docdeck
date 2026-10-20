import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import { InboxModel, type InboxSeed } from "./inbox-model";
import { InboxPanel, type InboxStatus, type ScanProgress } from "./inbox-panel";
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
import { fileName, isUnderAny } from "./project";
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
  modifiedTime?: number;
}

/** One inbox row as returned by `load_watches` / `add_watch`. */
interface InboxEntryPayload {
  path: string;
  filename: string;
  modifiedTime: number;
}

/** The startup config result. `error` means no watches were registered. */
interface WatchLoad {
  configPath: string;
  configFound: boolean;
  roots: string[];
  entries: InboxEntryPayload[];
  warnings: string[];
  error: string | null;
  truncated: boolean;
}

/** The result of adding session watches for CLI folders. */
interface WatchAdded {
  roots: string[];
  entries: InboxEntryPayload[];
  warnings: string[];
}

function toSeed(entry: InboxEntryPayload): InboxSeed {
  return {
    path: entry.path,
    filename: entry.filename,
    modifiedTime: entry.modifiedTime,
  };
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
  /** Path whose markup is painted; null while the empty state is showing. */
  private renderedPath: string | null = null;
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

  /** Roots registered from the config or a CLI folder for this session. */
  private readonly watchRoots = new Set<string>();
  private readonly inbox = new InboxModel();
  private inboxStatus: InboxStatus = {
    configPath: "",
    configFound: true,
    error: null,
    warnings: [],
    truncated: false,
    loading: true,
    progress: null,
  };
  /** The tab currently playing the brief active-write pulse, if any. */
  private activeUpdatePath: string | null = null;
  private activeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Scans whose result has not arrived yet; stale progress events are dropped. */
  private scansInFlight = 0;
  private readonly inboxPanelEl = must<HTMLElement>("inbox-panel");
  private readonly inboxPanel: InboxPanel;

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

    this.inboxPanel = new InboxPanel(this.inboxPanelEl, {
      onOpen: (path) => {
        if (this.tabs.has(path)) this.setActiveTab(path);
        else void this.openDocument(path);
      },
    });

    this.applyPreferencesToUi();
    this.bindControls();
    this.theme.apply(this.preferences.themeMode);
    this.renderInbox();
    void this.start();
  }

  /** Applies the restored preferences before any control is clicked. */
  private applyPreferencesToUi(): void {
    this.tocPanelEl.hidden = !this.preferences.tocVisible;
    this.inboxPanelEl.hidden = !this.preferences.inboxVisible;
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
      const folders = entries.filter((entry) => entry.is_dir).map((entry) => entry.path);

      // Explicit documents first: a config scan over a deep glob can take
      // minutes, and `docdeck README.md` must not wait behind it.
      for (const entry of entries) {
        if (!entry.is_dir) await this.openDocument(entry.path);
      }

      // Config next: its excludes must be installed before a session folder
      // is scanned, or the two sources would disagree about what is noise.
      await this.loadWatchConfig();
      if (folders.length > 0) await this.addWatch(folders);
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
      element: must<HTMLButtonElement>("toggle-inbox-btn"),
      icon: "✉",
      label: "Inbox",
      tooltip: "Toggle File Inbox",
      initialState: this.preferences.inboxVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.inboxVisible = next;
        this.inboxPanelEl.hidden = !next;
        this.persist();
      },
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
      // A second `docdeck <path>` in another shell. Folders join the session
      // watch registry; files open a tab.
      await listen<CliEntry>("open-path-cli", (event) => {
        if (event.payload.is_dir) void this.addWatch([event.payload.path]);
        else void this.openDocument(event.payload.path);
      });

      // A batch of settled writes from the debounced inotify watcher.
      await listen<PathChange[]>("paths-changed", (event) => {
        for (const change of event.payload) void this.applyPathChange(change);
      });

      // Live position of the (possibly minutes-long) config or folder scan.
      await listen<ScanProgress>("scan-progress", (event) => {
        if (this.scansInFlight === 0) return;
        this.inboxStatus = { ...this.inboxStatus, progress: event.payload };
        this.renderInbox();
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
        existing.deletedOnDisk = false;
      } else {
        this.tabs.set(data.path, {
          path: data.path,
          filename: data.filename,
          content: data.content,
          modifiedTime: data.modified_time,
          hasUnreadUpdate: false,
          deletedOnDisk: false,
        });
      }

      this.setActiveTab(data.path);
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      // A row can lose the race against a delete; that is routine, not an
      // error worth interrupting the reader for.
      this.showMessage(`Could not open ${rawPath}`);
    }
  }

  /**
   * Handles one settled watcher event.
   *
   * Deleted files keep their tab (content included) and get a marker; their
   * inbox row is struck through until the file reappears. Existing files
   * reload their tab when one is open and update the inbox row. Nothing is
   * ever opened automatically: the inbox is the triage surface.
   */
  private async applyPathChange(change: PathChange): Promise<void> {
    const tab = this.tabs.get(change.path);
    const isActive = this.activePath === change.path;
    const tracked =
      this.inbox.has(change.path) || isUnderAny(change.path, this.watchRoots);

    if (!change.exists) {
      if (tab && !tab.deletedOnDisk) {
        tab.deletedOnDisk = true;
        this.renderTabs();
        if (isActive) await this.renderActiveContent();
      }
      if (tracked && this.inbox.markDeleted(change.path)) this.renderInbox();
      return;
    }

    if (tracked) {
      const seed: InboxSeed = {
        path: change.path,
        filename: fileName(change.path),
        modifiedTime: change.modifiedTime ?? Date.now(),
      };
      // The active document is on screen already: update its mtime and order
      // without pretending the reader missed something.
      this.inbox.upsert(seed, !isActive);
      this.renderInbox();
    }

    if (tab) await this.reloadDocument(change.path);
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
        // Reading this tab: paint it straight away and acknowledge with the
        // brief pulse instead of the unread dot.
        tab.hasUnreadUpdate = false;
        this.flashActiveTab(path);
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

  /** Pulses a tab's dot once for an active-document write, then clears it. */
  private flashActiveTab(path: string): void {
    if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
    this.activeUpdatePath = path;
    this.renderTabs();
    this.activeUpdateTimer = setTimeout(() => {
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
      this.renderTabs();
    }, 2500);
  }

  public setActiveTab(path: string): void {
    this.activePath = path;
    const tab = this.tabs.get(path);
    if (tab) tab.hasUnreadUpdate = false;

    if (this.activeUpdatePath !== null && this.activeUpdatePath !== path) {
      if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
    }

    this.inbox.markRead(path);

    this.renderTabs();
    this.renderInbox();
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

    if (this.activeUpdatePath === path && this.activeUpdateTimer !== null) {
      clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
    }

    if (this.activePath === path) {
      const remaining = [...this.tabs.keys()];
      this.activePath = remaining[remaining.length - 1] ?? null;
    }

    this.renderTabs();
    this.renderInbox();
    await this.renderActiveContent();
  }

  private async closeTab(path: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.closeTabPath(path);
  }

  // -- watch registry and inbox ---------------------------------------------

  /** Loads the global config and turns it into watches plus inbox rows. */
  private async loadWatchConfig(): Promise<void> {
    this.scansInFlight += 1;
    this.inboxStatus = { ...this.inboxStatus, loading: true, progress: null };
    this.renderInbox();
    try {
      const result = await invoke<WatchLoad>("load_watches");
      for (const root of result.roots) this.watchRoots.add(root);
      this.inbox.replace(result.entries.map(toSeed));
      this.inboxStatus = {
        configPath: result.configPath,
        configFound: result.configFound,
        error: result.error,
        warnings: result.warnings,
        truncated: result.truncated,
        loading: false,
        progress: null,
      };
    } catch (error) {
      console.error("Failed to load watch config", error);
      this.inboxStatus = {
        configPath: "",
        configFound: false,
        error: String(error),
        warnings: [],
        truncated: false,
        loading: false,
        progress: null,
      };
    } finally {
      this.scansInFlight -= 1;
    }
    this.renderInbox();
  }

  /** Registers session watches for CLI folder arguments. */
  private async addWatch(paths: string[]): Promise<void> {
    this.scansInFlight += 1;
    try {
      const result = await invoke<WatchAdded>("add_watch", { paths });
      for (const root of result.roots) this.watchRoots.add(root);
      this.inbox.merge(result.entries.map(toSeed));
      this.inboxStatus.warnings = [...this.inboxStatus.warnings, ...result.warnings];
    } catch (error) {
      console.error("Failed to add watch", error);
      this.inboxStatus.warnings = [
        ...this.inboxStatus.warnings,
        `Could not watch folder: ${String(error)}`,
      ];
    } finally {
      this.scansInFlight -= 1;
      if (this.scansInFlight === 0) this.inboxStatus.progress = null;
    }
    this.renderInbox();
  }

  private renderInbox(): void {
    this.inboxPanel.render(
      this.inbox.entriesSorted(),
      this.inboxStatus,
      new Set(this.tabs.keys()),
      this.activePath,
    );
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
      if (tab.path === this.activeUpdatePath) item.classList.add("active-update");
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
      this.renderedPath = null;
      this.emptyState.classList.remove("hidden");
      this.viewer.classList.add("hidden");
      this.viewer.replaceChildren();
      this.metadata.clear();
      this.tocPanel.rebuild([]);
      return;
    }

    this.emptyState.classList.add("hidden");
    this.viewer.classList.remove("hidden");

    // A different document starts at the top; only a re-render of the document
    // already on screen may inherit its scroll offset.
    const switching = this.activePath !== this.renderedPath;
    this.renderedPath = this.activePath;

    const { raw, body } = splitFrontmatter(tab.content);

    // Captured before the paint so the table's height — added after the
    // renderer has already restored the scroll position — is accounted for.
    const wasTailing = !switching && isTailing(this.contentContainer);

    try {
      this.metadata.clear();
      this.viewer.replaceChildren();

      const headings = extractHeadings(marked, body);
      await renderMarkdown(body, this.viewer, headings, switching ? "top" : "preserve");

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