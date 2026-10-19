import type { InboxEntry } from "./inbox-model";
import { compactPath, parentPath, projectName } from "./project";
import { formatExactTime, formatRelativeTime } from "./relative-time";

/** Everything the panel needs to explain the current watch state. */
export interface InboxStatus {
  configPath: string;
  configFound: boolean;
  error: string | null;
  warnings: string[];
  truncated: boolean;
  loading: boolean;
}

export interface InboxPanelOptions {
  onOpen(path: string): void;
  /** Injectable clock so relative times are deterministic in tests. */
  now?: () => number;
}

export class InboxPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly options: InboxPanelOptions,
  ) {}

  render(
    entries: InboxEntry[],
    status: InboxStatus,
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): void {
    const scrollTop = this.root.scrollTop;
    const fragment = document.createDocumentFragment();
    fragment.append(this.renderHeader(entries));

    if (status.loading) {
      fragment.append(this.message("Scanning watched paths…", "inbox-loading"));
    } else {
      if (status.error) {
        fragment.append(this.message(`Config error: ${status.error}`, "inbox-error"));
      } else if (!status.configFound) {
        fragment.append(this.setupHint(status.configPath));
      }

      if (status.warnings.length > 0) {
        fragment.append(this.warningList(status.warnings));
      }
      if (status.truncated) {
        fragment.append(
          this.message(
            "Some paths were skipped at the configured limits; see the warnings.",
            "inbox-truncated",
          ),
        );
      }

      if (entries.length === 0) {
        fragment.append(this.message("No documents match the configured watches.", "inbox-empty"));
      } else {
        const list = document.createElement("ul");
        list.className = "inbox-list";
        for (const entry of entries) {
          list.append(this.renderRow(entry, openPaths, activePath));
        }
        fragment.append(list);
      }
    }

    this.root.replaceChildren(fragment);
    this.root.scrollTop = scrollTop;
  }

  private renderHeader(entries: InboxEntry[]): HTMLElement {
    const header = document.createElement("div");
    header.className = "inbox-header";

    const title = document.createElement("span");
    title.className = "inbox-title";
    title.textContent = "Inbox";

    const total = `${entries.length} ${entries.length === 1 ? "file" : "files"}`;
    const unread = entries.filter((entry) => entry.unread).length;
    const count = document.createElement("span");
    count.className = "inbox-count";
    count.textContent = unread > 0 ? `${total} · ${unread} new` : total;

    header.append(title, count);
    return header;
  }

  private renderRow(
    entry: InboxEntry,
    openPaths: ReadonlySet<string>,
    activePath: string | null,
  ): HTMLElement {
    const item = document.createElement("li");
    item.className = "inbox-row";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.dataset.path = entry.path;
    if (entry.unread) item.classList.add("unread");
    if (entry.deleted) item.classList.add("deleted");
    if (openPaths.has(entry.path)) item.classList.add("open");
    if (entry.path === activePath) item.classList.add("active");

    const open = (): void => this.options.onOpen(entry.path);
    item.addEventListener("click", open);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    const top = document.createElement("div");
    top.className = "inbox-row-top";

    const project = projectName(entry.path);
    if (project !== null) {
      const chip = document.createElement("span");
      chip.className = "inbox-project";
      chip.textContent = project;
      top.append(chip);
    }

    const name = document.createElement("span");
    name.className = "inbox-filename";
    name.textContent = entry.filename;
    name.title = entry.deleted ? `${entry.path} (deleted on disk)` : entry.path;
    top.append(name);

    const dot = document.createElement("span");
    dot.className = "inbox-dot";
    top.append(dot);

    const bottom = document.createElement("div");
    bottom.className = "inbox-row-bottom";

    const fullParent = parentPath(entry.path);
    const parent = document.createElement("span");
    parent.className = "inbox-parent";
    parent.textContent = compactPath(fullParent);
    parent.title = fullParent;
    bottom.append(parent);

    const now = this.options.now?.() ?? Date.now();
    const time = document.createElement("time");
    time.className = "inbox-time";
    time.dateTime = new Date(entry.modifiedTime).toISOString();
    time.textContent = formatRelativeTime(entry.modifiedTime, now);
    time.title = formatExactTime(entry.modifiedTime);
    bottom.append(time);

    item.append(top, bottom);
    return item;
  }

  private setupHint(configPath: string): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "inbox-hint";

    const message = document.createElement("p");
    message.textContent = `No config found at ${configPath}. Create it to watch files on every launch:`;

    const example = document.createElement("code");
    example.textContent = 'watch = ["~/devel/*/_ai"]\nexclude = ["**/archive/**"]';

    hint.append(message, example);
    return hint;
  }

  private warningList(warnings: string[]): HTMLElement {
    const details = document.createElement("details");
    details.className = "inbox-warnings";

    const summary = document.createElement("summary");
    summary.textContent = `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;

    const list = document.createElement("ul");
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.append(item);
    }

    details.append(summary, list);
    return details;
  }

  private message(text: string, className: string): HTMLElement {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  }
}
