import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Acknowledgements } from "./acknowledgements";
import { ClosedTabs, isReopenClosedTabShortcut } from "./closed-tabs";
import {
  type SaveOutcome,
  type SaveWatchConfigArgs,
  type WatchConfigView,
} from "./config-editor-model";
import { ConfigPanel } from "./config-panel";
import { copyText } from "./copy-code";
import { filterEntries } from "./filter-documents";
import { FindController } from "./find-bar";
import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import {
  InboxModel,
  type InboxSeed,
  type InboxStatus,
  type ReloadResult,
  type ReloadSummary,
  type ScanProgress,
} from "./inbox-model";
import { SidebarPanel } from "./sidebar-panel";
import { SummaryPanel } from "./summary-panel";
import type { SummaryResult, SummaryStatus } from "./summary-model";
import {
  buildOpenRows,
  selectRecent,
  snapshotRecent,
  type BrowseMode,
  type ClearSnapshot,
} from "./sidebar-model";
import { classifyLink, isMarkdownPath, type ResolvedLink } from "./links";
import {
  applyMermaidTheme,
  isTailing,
  marked,
  renderMarkdown,
} from "./markdown";
import { closeMermaidOverlay } from "./mermaid-zoom";
import { MetadataView } from "./metadata-jump";
import {
  createPreferenceWriter,
  loadPreferences,
  type Preferences,
  type ThemeMode,
} from "./preferences";
import { fileName, isUnderAny } from "./project";
import { scrollToAnchor } from "./scroll";
import { TabContextMenu } from "./tab-menu";
import { createToggleButton } from "./toolbar";
import { extractHeadings } from "./toc";
import { TocPanel } from "./toc-panel";
import { ThemeController } from "./theme";
import { ToastHost } from "./toast";

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

type PathChangeKind = "created" | "modified" | "deleted" | "renamed" | "movedOut";

/** A settled filesystem change for one path. */
interface PathChange {
  kind: PathChangeKind;
  path: string;
  fromPath?: string;
  exists: boolean;
  modifiedTime?: number;
}

/** One inbox row as returned by `load_watches` / `add_watch`. */
interface InboxEntryPayload {
  path: string;
  filename: string;
  modifiedTime: number;
  origin?: InboxSeed["origin"];
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
  revision: string;
  generation: number;
  at: number;
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
    origin: entry.origin,
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class AppState {
  private readonly tabs = new Map<string, Tab>();
  /** Recently closed tab paths, most recent last. */
  private readonly closedTabs = new ClosedTabs();
  private activePath: string | null = null;
  /** Path whose markup is painted; null while the empty state is showing. */
  private renderedPath: string | null = null;
  private autoSort = false;

  /**
   * Monotonic token per document. A reload only paints when it is still the
   * newest request for that path, so a slow read cannot overwrite a newer one.
   */
  private readonly reloadTokens = new Map<string, number>();

  private preferences: Preferences = loadPreferences();

  private readonly emptyState = must<HTMLElement>("empty-state");
  private readonly viewer = must<HTMLElement>("markdown-viewer");
  private readonly contentContainer = must<HTMLElement>("content-container");
  private readonly tocPanelEl = must<HTMLElement>("toc-panel");
  private readonly autosortBtn = must<HTMLButtonElement>("toggle-autosort-btn");

  private readonly writer = createPreferenceWriter();
  private readonly tocPanel: TocPanel;
  private readonly find: FindController;
  private readonly tabMenu: TabContextMenu;
  private readonly toast = new ToastHost();
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
    lastReload: null,
  };
  /** The tab currently playing the brief active-write pulse, if any. */
  private activeUpdatePath: string | null = null;
  private activeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Scans whose result has not arrived yet; stale progress events are dropped. */
  private scansInFlight = 0;
  /** Newest applied reload generation; older results are ignored. */
  private reloadGeneration = 0;
  /** Session-only browse filter; never persisted. */
  private filterTerm = "";
  /** Cross-session unread acknowledgements. */
  private readonly acks: Acknowledgements;
  /** Whether a baseline exists, so acknowledging is meaningful. */
  private acknowledgementsReady = false;
  private readonly configPanel: ConfigPanel;
  private readonly summaryPanel: SummaryPanel;
  private summaryStatus: SummaryStatus = {
    ready: false,
    provider: null,
    model: null,
    problem: "Checking summary configuration…",
    configPath: "",
  };
  private summaryBusy = false;
  /** Discards results whose modal was closed or superseded by a newer run. */
  private summaryRequest = 0;
  /** Observation floor for Recently Changed; 0 shows the whole session. */
  private clearedAt = 0;
  /** Snapshot for undoing the last clear. */
  private clearSnapshot: ClearSnapshot | null = null;
  private readonly sidebarEl = must<HTMLElement>("sidebar");
  private readonly sidebarPanel: SidebarPanel;

  constructor() {
    this.acks = new Acknowledgements();
    this.configPanel = new ConfigPanel({
      readConfig: () => invoke<WatchConfigView>("read_watch_config"),
      saveConfig: (args: SaveWatchConfigArgs) =>
        invoke<SaveOutcome>("save_watch_config", {
          watch: args.watch,
          exclude: args.exclude,
          expectedRevision: args.expectedRevision,
          createFromExample: args.createFromExample,
        }),
      reloadConfig: () => invoke<ReloadResult>("reload_watch_config"),
      openFile: (path) => {
        void invoke("open_local_path", { path }).catch((error) => {
          this.toast.show(`Could not open config: ${describeError(error)}`, "error");
        });
      },
      onApplied: (reload) => this.applyReloadResult(reload),
      onClosed: () => undefined,
    });

    this.summaryPanel = new SummaryPanel({
      onOpen: (path) => {
        if (this.tabs.has(path)) void this.setActiveTab(path);
        else void this.openDocument(path);
      },
      onRetry: () => void this.summarizeRecent(),
      onConfigure: () => {
        this.summaryPanel.close();
        void this.openConfigPanel();
      },
      onClose: () => {
        this.summaryRequest += 1;
        this.summaryBusy = false;
        this.renderSidebar();
      },
    });

    this.metadata = new MetadataView(
      this.viewer,
      this.preferences.frontmatterVisible,
    );
    this.tocPanel = new TocPanel({
      container: this.tocPanelEl,
      scrollParent: this.contentContainer,
      onJumpToMetadata: () => this.metadata.reveal(),
    });

    this.find = new FindController({
      viewer: this.viewer,
      scrollParent: this.contentContainer,
      hasDocument: () => this.activePath !== null,
    });

    this.tabMenu = new TabContextMenu((path) => {
      void this.copyTabPath(path);
    });

    // Expanding or folding the metadata table changes which text is visible.
    // `toggle` does not bubble, so listen in the capture phase.
    this.viewer.addEventListener(
      "toggle",
      () => this.find.refresh(this.find.captureAnchor()),
      true,
    );

    this.theme = new ThemeController({
      onMermaidThemeChange: applyMermaidTheme,
      // Mermaid bakes colors into the SVG at render time, so a mode change has
      // to be followed by a re-render or diagrams keep the old palette.
      onModeApplied: () => void this.renderActiveContent(),
    });

    this.sidebarPanel = new SidebarPanel(this.sidebarEl, {
      onOpen: (path) => {
        if (this.tabs.has(path)) void this.setActiveTab(path);
        else void this.openDocument(path);
      },
      onClose: (path) => void this.closeTabPath(path),
      onCloseAll: () => void this.closeAllTabs(),
      onClear: () => this.clearRecent(),
      onUndo: () => this.undoClear(),
      onSummarize: () => void this.summarizeRecent(),
      onModeChange: (mode) => this.setBrowseMode(mode),
      onFilterChange: (term) => {
        this.filterTerm = term;
        this.renderSidebar();
      },
      onToggleSection: (section, collapsed) => {
        if (section === "open") {
          this.preferences.openSectionCollapsed = collapsed;
        } else {
          this.preferences.browseSectionCollapsed = collapsed;
        }
        this.persist();
        this.renderSidebar();
      },
      onContextMenu: (path, anchor, target) => {
        if (this.tabMenu.isOpen) return;
        this.tabMenu.open(path, anchor, target);
      },
    });

    this.applyPreferencesToUi();
    this.bindControls();
    this.bindConfigLifecycle();
    this.bindLinkHandling();
    this.bindShortcuts();
    this.theme.apply(this.preferences.themeMode);
    this.renderSidebar();
    void this.start();
  }

  /** Applies the restored preferences before any control is clicked. */
  private applyPreferencesToUi(): void {
    this.tocPanelEl.hidden = !this.preferences.tocVisible;
    this.sidebarPanel.setBrowseVisible(this.preferences.inboxVisible);
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
    const watchesBtn = document.getElementById("toggle-watches-btn");
    watchesBtn?.addEventListener("click", () => void this.openConfigPanel());

    this.autosortBtn.addEventListener("click", () => {
      this.autoSort = !this.autoSort;
      this.autosortBtn.classList.toggle("active", this.autoSort);
      this.autosortBtn.textContent = `⚡ Auto-Sort: ${
        this.autoSort ? "ON" : "OFF"
      }`;
      this.renderSidebar();
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-inbox-btn"),
      icon: "✉",
      label: "Browse",
      tooltip: "Toggle the browse list",
      initialState: this.preferences.inboxVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.inboxVisible = next;
        this.sidebarPanel.setBrowseVisible(next);
        if (next) this.sidebarPanel.refresh();
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
        else this.find.refresh(this.find.captureAnchor());
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

  /**
   * Flushes persisted acknowledgements when the window goes away, so a review
   * made in the last debounce window survives the restart.
   */
  private bindConfigLifecycle(): void {
    const flush = (): void => this.acks.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
  }

  private async openConfigPanel(): Promise<void> {
    try {
      const view = await invoke<WatchConfigView>("read_watch_config");
      this.configPanel.open(view, this.inboxStatus.lastReload);
    } catch (error) {
      this.toast.show(
        `Could not read the watch configuration: ${describeError(error)}`,
        "error",
      );
    }
  }

  /** Re-reads whether the summary agent is configured and usable. */
  private async refreshSummaryStatus(): Promise<void> {
    try {
      this.summaryStatus = await invoke<SummaryStatus>("summary_status");
    } catch (error) {
      this.summaryStatus = {
        ready: false,
        provider: null,
        model: null,
        problem: describeError(error),
        configPath: "",
      };
    }
    this.renderSidebar();
  }

  private static reloadSummary(result: ReloadResult): ReloadSummary {
    return {
      at: result.at,
      ok: result.error === null,
      error: result.error,
      warnings: [...result.warnings],
      truncated: result.truncated,
    };
  }

  /**
   * Applies one backend reload, ignoring any result older than the newest one
   * already applied.
   */
  private applyReloadResult(result: ReloadResult): void {
    if (result.generation < this.reloadGeneration) return;
    this.reloadGeneration = result.generation;

    this.watchRoots.clear();
    for (const root of result.roots) this.watchRoots.add(root);

    this.inboxStatus = {
      ...this.inboxStatus,
      configPath: result.path,
      configFound: result.found,
      error: result.error,
      warnings: result.warnings,
      truncated: result.truncated,
      loading: false,
      progress: null,
      lastReload: AppState.reloadSummary(result),
    };

    if (result.error === null && result.found) {
      this.inbox.reconcile(result.entries.map(toSeed));
      this.afterSuccessfulInventory(false);
    }

    this.renderSidebar();
    void this.refreshSummaryStatus();
  }

  /**
   * Establishes the acknowledgement baseline on the first successful inventory
   * and prunes history for documents that left the watch set.
   */
  private afterSuccessfulInventory(startup: boolean): void {
    const entries = this.inbox.entriesSorted().map(toSeed);
    if (!this.acks.hasStore) {
      this.acks.seedBaseline(entries);
    }
    this.acknowledgementsReady = true;
    if (startup) this.applyAcknowledgementFlags();
    this.acks.prune(entries.map((entry) => entry.path));
    this.acks.flush();
  }

  private applyAcknowledgementFlags(): void {
    const flags = this.acks.unreadFlags(this.inbox.entriesSorted());
    this.inbox.applyUnread(flags);
  }

  /** Records the active document as reviewed at its current mtime. */
  private acknowledgeActive(path: string, modifiedTime: number): void {
    if (!this.acknowledgementsReady) return;
    this.acks.acknowledge(path, modifiedTime);
  }

  /** Reopens the most recently closed tab, like a browser's Ctrl+Shift+T. */
  private bindShortcuts(): void {
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (!isReopenClosedTabShortcut(event)) return;
      event.preventDefault();
      void this.reopenClosedTab();
    });
  }

  /**
   * Dispatches every document link instead of letting the webview navigate.
   *
   * Bound to `body` so it also covers anchors in the Mermaid fullscreen
   * overlay, which is moved outside the viewer. Controls that already handle
   * their own clicks (for example TOC links) call `preventDefault()` first and
   * are skipped by the `defaultPrevented` check.
   */
  private bindLinkHandling(): void {
    const activate = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button === 2) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      event.preventDefault();
      void this.handleLink(anchor.getAttribute("href") ?? "");
    };

    // `click` covers the primary button; `auxclick` covers middle-click in
    // WebKitGTK. Both follow the same rules: never navigate.
    document.body.addEventListener("click", activate);
    document.body.addEventListener("auxclick", activate);
  }

  private async handleLink(rawHref: string): Promise<void> {
    const target = classifyLink(rawHref);

    switch (target.kind) {
      case "empty":
        return;
      case "fragment":
        scrollToAnchor(this.contentContainer, target.fragment);
        return;
      case "blocked":
        this.toast.show(`Blocked link: ${target.reason}`, "error");
        return;
      case "external":
      case "mailto":
        try {
          await invoke("open_external_url", { url: target.url });
        } catch (error) {
          this.toast.show(
            `Could not open link: ${describeError(error)}`,
            "error",
          );
        }
        return;
      case "local": {
        // Capture the document the link was authored in: the resolver must
        // use its directory even if the active tab changes mid-flight.
        const baseFile = this.activePath;
        if (baseFile === null) return;

        try {
          const resolved = await invoke<ResolvedLink>("resolve_document_link", {
            baseFile,
            href: target.path,
          });

          if (!resolved.isDir && isMarkdownPath(resolved.path)) {
            await this.openDocument(resolved.path, target.fragment);
          } else {
            await invoke("open_local_path", { path: resolved.path });
          }
        } catch (error) {
          this.toast.show(describeError(error), "error");
        }
        return;
      }
    }
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
        let inboxChanged = false;
        let tabsChanged = false;
        let activeDeleted = false;
        const reloads: string[] = [];

        for (const change of event.payload) {
          const result = this.applyPathChange(change);
          inboxChanged ||= result.inboxChanged;
          tabsChanged ||= result.tabsChanged;
          activeDeleted ||= result.activeDeleted;
          if (result.reload) reloads.push(change.path);
        }

        if (tabsChanged || inboxChanged) this.renderSidebar();
        if (activeDeleted) void this.renderActiveContent();
        for (const path of reloads) void this.reloadDocument(path);
      });

      // A settled configuration reload (external edit, save or recovery).
      await listen<ReloadResult>("config-reloaded", (event) => {
        this.applyReloadResult(event.payload);
      });

      // Live position of the (possibly minutes-long) config or folder scan.
      await listen<ScanProgress>("scan-progress", (event) => {
        if (this.scansInFlight === 0) return;
        this.inboxStatus = { ...this.inboxStatus, progress: event.payload };
        this.sidebarPanel.setProgress(event.payload);
      });
    } catch (error) {
      console.error("Failed to attach backend listeners", error);
      this.showMessage("Could not connect to the docdeck backend.");
    }
  }

  // -- document lifecycle ---------------------------------------------------

  public async openDocument(
    rawPath: string,
    fragment: string | null = null,
  ): Promise<boolean> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      // Opening a closed path manually makes its history entry stale.
      this.closedTabs.forget(data.path);

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

      // A manually opened document joins the session inventory even when it is
      // outside every watch root, so it can appear in All Documents. It is never
      // marked unread and never counted as recent activity: the reader is
      // opening it right now.
      this.inbox.upsert(
        {
          path: data.path,
          filename: data.filename,
          modifiedTime: data.modified_time,
        },
        false,
        false,
      );
      this.renderSidebar();

      await this.setActiveTab(data.path);
      if (fragment !== null) scrollToAnchor(this.contentContainer, fragment);
      return true;
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      // Surface the backend reason: a watcher-limit or permission failure is
      // otherwise indistinguishable from a file that no longer exists.
      const reason = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open ${rawPath}: ${reason}`);
      return false;
    }
  }

  /**
   * Pops the closed-tab stack and opens that document again. The history entry
   * is consumed even when the file can no longer be read, so the next press
   * moves to the document before it instead of retrying the same failure.
   */
  private async reopenClosedTab(): Promise<void> {
    const path = this.closedTabs.take();
    if (path === undefined) return;

    if (this.tabs.has(path)) {
      await this.setActiveTab(path);
      return;
    }

    await this.openDocument(path);
  }

  /**
   * Handles one settled watcher event.
   *
   * Deleted files keep their tab (content included) and get a marker; their
   * inbox row is struck through until the file reappears. A moved-out file
   * leaves the browse list and keeps its tab with the unavailable banner. A
   * rename re-keys the tab and the inbox row instead of creating a second one.
   * Nothing is ever opened automatically: the inbox is the triage surface.
   */
  private applyPathChange(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    switch (change.kind) {
      case "renamed":
        return this.applyRename(change);
      case "movedOut":
        return this.applyMoveOut(change);
      case "created":
        return this.applyCreated(change);
      case "deleted":
        return this.applyDeleted(change);
      case "modified":
      default:
        return this.applyModified(change);
    }
  }

  private applyRename(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    const from = change.fromPath;
    if (!from || from === change.path) return this.applyModified(change);

    const tab = this.tabs.get(from);
    let tabsChanged = false;
    if (tab) {
      this.tabs.delete(from);
      tab.path = change.path;
      tab.filename = fileName(change.path);
      tab.deletedOnDisk = false;
      if (change.modifiedTime !== undefined) tab.modifiedTime = change.modifiedTime;
      this.tabs.set(change.path, tab);

      const token = this.reloadTokens.get(from);
      if (token !== undefined) {
        this.reloadTokens.delete(from);
        this.reloadTokens.set(change.path, token);
      }
      this.closedTabs.forget(from);
      if (this.activePath === from) this.activePath = change.path;
      tabsChanged = true;
    }

    const moved = this.inbox.rename(from, change.path);
    this.acks.move(from, change.path);

    let inboxChanged = moved;
    if (!moved && this.isTracked(change.path)) {
      inboxChanged =
        this.inbox.addCreated({
          path: change.path,
          filename: fileName(change.path),
          modifiedTime: change.modifiedTime ?? Date.now(),
          origin: "config",
        }) || inboxChanged;
    }

    return {
      inboxChanged,
      tabsChanged,
      activeDeleted: false,
      reload: false,
    };
  }

  private applyMoveOut(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    const tab = this.tabs.get(change.path);
    const isActive = this.activePath === change.path;
    const wasDeleted = tab?.deletedOnDisk ?? false;
    if (tab && !wasDeleted) tab.deletedOnDisk = true;

    const removed = this.inbox.removeForMoveOut(change.path);
    if (this.acknowledgementsReady) {
      this.acks.prune(this.inbox.entriesSorted().map((entry) => entry.path));
    }

    return {
      inboxChanged: removed,
      tabsChanged: tab !== undefined && !wasDeleted,
      activeDeleted: isActive && tab !== undefined && !wasDeleted,
      reload: false,
    };
  }

  private applyCreated(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    if (!this.isTracked(change.path)) {
      return { inboxChanged: false, tabsChanged: false, activeDeleted: false, reload: false };
    }
    return {
      inboxChanged: this.inbox.addCreated({
        path: change.path,
        filename: fileName(change.path),
        modifiedTime: change.modifiedTime ?? Date.now(),
        origin: "config",
      }),
      tabsChanged: false,
      activeDeleted: false,
      reload: false,
    };
  }

  private applyDeleted(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    const tab = this.tabs.get(change.path);
    const isActive = this.activePath === change.path;
    const wasDeleted = tab?.deletedOnDisk ?? false;
    if (tab && !wasDeleted) tab.deletedOnDisk = true;

    return {
      inboxChanged:
        this.inbox.has(change.path) && this.inbox.markDeleted(change.path),
      tabsChanged: tab !== undefined && !wasDeleted,
      activeDeleted: isActive && tab !== undefined && !wasDeleted,
      reload: false,
    };
  }

  private applyModified(change: PathChange): {
    inboxChanged: boolean;
    tabsChanged: boolean;
    activeDeleted: boolean;
    reload: boolean;
  } {
    const tab = this.tabs.get(change.path);
    const isActive = this.activePath === change.path;
    const tracked = this.isTracked(change.path);

    if (!tracked) {
      return {
        inboxChanged: false,
        tabsChanged: false,
        activeDeleted: false,
        reload: tab !== undefined,
      };
    }

    const seed: InboxSeed = {
      path: change.path,
      filename: fileName(change.path),
      modifiedTime: change.modifiedTime ?? Date.now(),
    };

    // A path discovered by the watcher is new work; an existing row keeps its
    // provenance and its review state.
    if (!this.inbox.has(change.path)) {
      return {
        inboxChanged: this.inbox.addCreated({ ...seed, origin: "config" }),
        tabsChanged: false,
        activeDeleted: false,
        reload: tab !== undefined && !isActive,
      };
    }

    return {
      // The active document is on screen already: update its mtime and order
      // without pretending the reader missed something.
      inboxChanged: this.inbox.upsert(seed, !isActive),
      tabsChanged: false,
      activeDeleted: false,
      reload: tab !== undefined,
    };
  }

  private isTracked(path: string): boolean {
    return this.inbox.has(path) || isUnderAny(path, this.watchRoots);
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
        this.inbox.setUnread(path, false);
        this.acknowledgeActive(path, tab.modifiedTime);
        this.flashActiveTab(path);
      } else {
        tab.hasUnreadUpdate = true;
      }

      this.renderSidebar();
      if (this.activePath === path) {
        await this.renderActiveContent();
      }
    } catch (error) {
      console.error(`Failed to reload modified file: ${path}`, error);
    }
  }

  /** Pulses a row's dot once for an active-document write, then clears it. */
  private flashActiveTab(path: string): void {
    if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
    this.activeUpdatePath = path;
    this.renderSidebar();
    this.activeUpdateTimer = setTimeout(() => {
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
      this.renderSidebar();
    }, 2500);
  }

  public async setActiveTab(path: string): Promise<void> {
    this.activePath = path;
    const tab = this.tabs.get(path);
    if (tab) tab.hasUnreadUpdate = false;

    if (this.activeUpdatePath !== null && this.activeUpdatePath !== path) {
      if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
      this.activeUpdatePath = null;
    }

    // Reading a document acknowledges its change, which removes it from
    // Recently Changed's unread state and keeps it read after a restart.
    this.inbox.markRead(path);
    if (tab) this.acknowledgeActive(path, tab.modifiedTime);
    this.renderSidebar();
    await this.renderActiveContent();
  }

  private async closeTabPath(path: string): Promise<void> {
    try {
      await invoke("close_file", { pathStr: path });
    } catch (error) {
      console.error(`Failed to release watch for ${path}`, error);
    }

    if (this.tabs.has(path)) this.closedTabs.record(path);
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

    this.renderSidebar();
    await this.renderActiveContent();
  }

  /** Closes every open document in one pass, avoiding a repaint per tab. */
  private async closeAllTabs(): Promise<void> {
    const paths = [...this.tabs.keys()];
    if (paths.length === 0) return;

    await Promise.all(
      paths.map((path) =>
        invoke("close_file", { pathStr: path }).catch((error) => {
          console.error(`Failed to release watch for ${path}`, error);
        }),
      ),
    );

    for (const path of paths) {
      if (this.tabs.has(path)) this.closedTabs.record(path);
      this.tabs.delete(path);
      this.reloadTokens.delete(path);
    }

    if (this.activeUpdateTimer !== null) {
      clearTimeout(this.activeUpdateTimer);
      this.activeUpdateTimer = null;
    }
    this.activeUpdatePath = null;
    this.activePath = null;

    this.renderSidebar();
    await this.renderActiveContent();
  }

  /** Copies a document's absolute path and reports the outcome with a toast. */
  private async copyTabPath(path: string): Promise<void> {
    const copied = await copyText(path);
    this.toast.show(
      copied ? "Path copied" : "Copy failed",
      copied ? "info" : "error",
    );
  }

  // -- watch registry and inbox ---------------------------------------------

  /** Loads the global config and turns it into watches plus inbox rows. */
  private async loadWatchConfig(): Promise<void> {
    this.scansInFlight += 1;
    this.inboxStatus = { ...this.inboxStatus, loading: true, progress: null };
    this.renderSidebar();
    try {
      const result = await invoke<WatchLoad>("load_watches");
      for (const root of result.roots) this.watchRoots.add(root);
      this.reloadGeneration = result.generation;
      this.inbox.replace(result.entries.map(toSeed));
      // Explicit CLI documents are opened before the config scan. `replace`
      // clears the inventory, so put those session rows back afterwards.
      for (const tab of this.tabs.values()) {
        this.inbox.upsert(
          {
            path: tab.path,
            filename: tab.filename,
            modifiedTime: tab.modifiedTime,
          },
          false,
          false,
        );
      }
      this.inboxStatus = {
        configPath: result.configPath,
        configFound: result.configFound,
        error: result.error,
        warnings: result.warnings,
        truncated: result.truncated,
        loading: false,
        progress: null,
        lastReload: {
          at: result.at,
          ok: result.error === null,
          error: result.error,
          warnings: [...result.warnings],
          truncated: result.truncated,
        },
      };

      if (result.error === null) {
        this.afterSuccessfulInventory(true);
        // The active tab is on screen: never present it as missed work.
        const active = this.activePath ? this.tabs.get(this.activePath) : undefined;
        if (active) {
          this.inbox.setUnread(active.path, false);
          this.acknowledgeActive(active.path, active.modifiedTime);
        }
      }
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
        lastReload: null,
      };
    } finally {
      this.scansInFlight -= 1;
    }
    this.renderSidebar();
    void this.refreshSummaryStatus();
  }

  /** Registers session watches for CLI folder arguments. */
  private async addWatch(paths: string[]): Promise<void> {
    this.scansInFlight += 1;
    try {
      const result = await invoke<WatchAdded>("add_watch", { paths });
      for (const root of result.roots) this.watchRoots.add(root);
      this.inbox.merge(result.entries.map(toSeed));
      if (this.inboxStatus.error === null) this.afterSuccessfulInventory(false);
      this.applyAcknowledgementFlags();
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
    this.renderSidebar();
  }

  private renderSidebar(): void {
    const entries = this.inbox.entriesSorted();
    this.sidebarPanel.render({
      openRows: buildOpenRows(
        this.tabs.values(),
        this.activePath,
        this.autoSort,
      ),
      browseMode: this.preferences.browseMode,
      inventory: filterEntries(entries, this.filterTerm),
      recent: filterEntries(selectRecent(entries, this.clearedAt), this.filterTerm),
      openPaths: new Set(this.tabs.keys()),
      activePath: this.activePath,
      activeUpdatePath: this.activeUpdatePath,
      status: this.inboxStatus,
      openCollapsed: this.preferences.openSectionCollapsed,
      browseCollapsed: this.preferences.browseSectionCollapsed,
      canUndo: this.clearSnapshot !== null,
      filterTerm: this.filterTerm,
      summary: this.summaryStatus,
      summaryBusy: this.summaryBusy,
      now: Date.now(),
    });
  }

  private setBrowseMode(mode: BrowseMode): void {
    if (this.preferences.browseMode === mode) return;
    this.preferences.browseMode = mode;
    this.persist();
    this.renderSidebar();
  }

  /**
   * Clears the recent activity list and acknowledges the unread markers for the
   * changes it covered. The snapshot makes the action undoable.
   */
  private clearRecent(): void {
    if (this.stateRecentCount() === 0) return;

    this.clearSnapshot = snapshotRecent(
      this.inbox.entriesSorted(),
      this.clearedAt,
    );
    const cutoff = Date.now();
    this.inbox.acknowledgeThrough(cutoff);
    this.clearedAt = cutoff;
    this.renderSidebar();
    this.toast.show(
      "Recent changes cleared. Use Undo in the sidebar to restore them.",
      "info",
    );
  }

  private undoClear(): void {
    if (this.clearSnapshot === null) return;
    const snapshot = this.clearSnapshot;
    this.clearSnapshot = null;
    this.clearedAt = snapshot.clearedAt;
    this.inbox.restoreUnread(snapshot.unread);
    this.renderSidebar();
    this.toast.show("Clear undone", "info");
  }

  private stateRecentCount(): number {
    return selectRecent(this.inbox.entriesSorted(), this.clearedAt).length;
  }

  /**
   * Asks the configured Rig agent for an overview of the rows currently shown
   * in Recently changed. Closing the modal abandons the result.
   */
  private async summarizeRecent(): Promise<void> {
    if (this.summaryBusy) return;

    const entries = filterEntries(
      selectRecent(this.inbox.entriesSorted(), this.clearedAt),
      this.filterTerm,
    );
    if (entries.length === 0) {
      this.toast.show("No recent changes to summarize.", "info");
      return;
    }
    if (!this.summaryStatus.ready) {
      this.toast.show(
        this.summaryStatus.problem ?? "The summary agent is not configured.",
        "error",
      );
      return;
    }

    const request = ++this.summaryRequest;
    this.summaryBusy = true;
    this.renderSidebar();
    this.summaryPanel.setLoading(entries.length);

    try {
      const result = await invoke<SummaryResult>("summarize_changes", {
        paths: entries.map((entry) => entry.path),
      });
      if (request !== this.summaryRequest) return;
      this.summaryPanel.setResult(result);
    } catch (error) {
      if (request !== this.summaryRequest) return;
      this.summaryPanel.setError(describeError(error));
    } finally {
      if (request === this.summaryRequest) {
        this.summaryBusy = false;
        this.renderSidebar();
      }
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
    // A fullscreen diagram lives outside the viewer (moved into a fixed
    // overlay). Close it before the viewer is detached so the placeholder is
    // restored and `#app` is no longer inert.
    closeMermaidOverlay();

    const tab = this.activePath ? this.tabs.get(this.activePath) : undefined;

    if (!tab) {
      this.find.close();
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
    if (switching) this.find.close();

    // Capture before `replaceChildren()` detaches the ranges. A tab switch
    // closes the bar above, so only a same-document repaint has an anchor.
    const findAnchor = switching ? null : this.find.captureAnchor();
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
      this.find.close();
      this.showMessage(`Could not render ${tab.filename}`);
    }

    // Refresh after every render path. The metadata table is mounted before
    // this point and the deletion banner may be prepended, so searching any
    // earlier would miss nodes or compute against a body about to change.
    this.find.refresh(findAnchor);
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