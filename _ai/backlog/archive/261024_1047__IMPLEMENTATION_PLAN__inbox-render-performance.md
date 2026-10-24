---
filename: "_ai/backlog/active/261024_1047__IMPLEMENTATION_PLAN__inbox-render-performance.md"
title: "Inbox render performance: windowed rows and O(1) tab activation"
createdAt: 2026-10-24 10:47
createdBy: opencode [deepseek-v4.1-flash-free]
updatedAt: 2026-10-24 10:47
updatedBy: opencode [deepseek-v4.1-flash-free]
status: completed
completedAt: 2026-10-24 11:40
priority: high
tags: [performance, inbox, virtual-list, webview, ui]
project: docdeck
estimatedComplexity: moderate
documentRevision: 1
sourceSpec: ""
sourceHandoff: ""
sourceAdrs: ["_ai/technical_decisions/ADR__261024-3__windowed-inbox-list.md"]
documentType: IMPLEMENTATION_PLAN
---

# Inbox render performance: windowed rows and O(1) tab activation

## 1. Problem

Switching tabs takes multiple seconds when the inbox contains thousands of
documents. The user's config (`~/devel/*/_ai`, `/topdata/**/_ai`, plus deep
plugin selectors) produced roughly 7,000 inbox rows across 195 `_ai` roots.

The watcher is not the cause. A recursive watch consumes one inotify watch per
**directory**, not per document: the running app had 1,379 directory watches,
far below the 1,048,576 `max_user_watches` limit. File-level watches exist only
for open tabs. The cost is entirely in the inbox DOM.

Every tab activation runs this chain synchronously inside the click handler:

1. `setActiveTab()` calls `renderInbox()` — `src/main.ts:475`
2. `renderInbox()` calls `inbox.entriesSorted()` — sorts ~7,000 entries
3. `InboxPanel.render()` calls `root.replaceChildren(fragment)` and creates a
   fresh row for every entry — `src/inbox-panel.ts:35-83`
4. each row allocates ~9 elements, 2 event listeners, an ISO timestamp and a
   `toLocaleString()` tooltip — `src/inbox-panel.ts:103-168`

Measured in the system WebKitGTK 2.52.6 (the engine Tauri uses), with the real
inbox CSS, a 280 px panel, a 1,280×900 window and 7,000 rows:

| Operation                                            | Time            |
| ---------------------------------------------------- | --------------- |
| Current full `render()` (create 7,000 rows + layout) | ~3,900–4,100 ms |
| Patch one row's `active` class                       | ~2.6–4.6 ms     |
| Keyed reconcile over 7,000 rows, no DOM changes      | 2–3 ms          |
| Keyed reconcile with one changed row                 | ~20 ms          |
| Reorder one row                                      | ~24 ms          |
| `content-visibility: auto` + full rebuild            | ~5,200 ms       |
| One `innerHTML` string + full rebuild                | ~3,600 ms       |
| Windowed render (~31 rows) + layout                  | ~16–47 ms       |
| `toLocaleString()` × 7,000                           | ~1,100 ms       |

The same full rebuild also runs once per changed path in a `paths-changed`
batch (`src/main.ts:329-331`, `410`) and up to every 150 ms while a scan is
running (`src/main.ts:334-338`, `src-tauri/src/commands.rs:16`). The first
paint of the inbox after startup is therefore also a multi-second freeze, even
when the user only wants to switch between two tabs.

The fix has two independent parts:

1. **Stop rebuilding the inbox for a tab switch.** Patch the affected rows and
   the header count instead.
2. **Stop keeping thousands of rows in the DOM.** Render only the visible
   window; the initial paint becomes tens of milliseconds and the DOM stays
   constant.

The second part is recorded in
[ADR 261024-3](../../technical_decisions/ADR__261024-3__windowed-inbox-list.md).

## 2. Executive Summary

Restructure `InboxPanel` into three stable regions: header, status host, and
list. Phase 1 adds a row registry and a `setActive()` fast path, batches the
Rust watcher events into one model update plus one render, and turns
`scan-progress` into a status-only update. Phase 2 replaces the full row list
with a fixed-height windowed list: only the visible rows plus overscan exist in
the DOM, rows are pooled and re-bound as the user scrolls, and row events are
delegated to the list.

No Rust changes, no new dependencies, no Tauri permissions. All behavior —
newest-first order, unread/active/open/deleted classes, click and keyboard
activation, header counts, warnings, progress, empty/error states, and scroll
position — stays the same.

Phase 1 is independently shippable: it fixes the reported tab-switch latency
without changing scroll behavior. Phase 2 then fixes the first paint and makes
live updates independent of inbox size.

## 3. Design Decisions & Rejected Alternatives

| Decision                                                                           | Rationale                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windowed list (fixed row height, absolute rows, pooled elements)                   | Measured 4,000 ms → 16–47 ms for the first paint and constant DOM. See ADR 261024-3.                                                                                                     |
| Tab activation patches rows instead of calling `render()`                          | The old path rebuilt ~7,000 rows (~4 s) to move one `active` class (~2.6 ms). This is the user-visible bug.                                                                              |
| Keep `InboxPanel.render(entries, status, openPaths, activePath)` as the public API | All call sites stay the same; the panel decides between a full re-bind and a cheap patch.                                                                                                |
| Separate header, status host, and list                                             | `scan-progress` updates every 150 ms; it must never touch the list. Header counts change independently of rows.                                                                          |
| `ROW_HEIGHT = 48` and an inline row height                                         | WebKit measured the current two-line row at 47 px. 48 px gives one pixel of slack and removes the rounding risk. The JS constant owns the height; CSS `overflow: hidden` prevents spill. |
| `OVERSCAN = 6` rows on each side                                                   | About half a viewport of lead time during fast scrolling; adds only 12 rows.                                                                                                             |
| Delegate click/keydown to the list                                                 | One listener each instead of 2 × N. Required for pooled rows and removes ~14,000 listeners from the old full render.                                                                     |
| Recycle rows by index, not by path                                                 | The window is defined in index space (`start..end`); an index that stays in range keeps its row. A data change simply re-binds the same nodes.                                           |
| Apply a whole `paths-changed` batch before one render                              | An agent writing N files currently triggers N full rebuilds. The Rust side already batches per debounce window.                                                                          |
| Skip window rendering while the panel is hidden or has no height                   | The inbox can be toggled off. No rows need to be maintained while `clientHeight` is 0; `refresh()` handles the show.                                                                     |
| No `content-visibility`, no `innerHTML`, no full keyed reconcile                   | Measured 5.2 s, 3.6 s, and 4 s respectively; none fixes the first paint. See ADR 261024-3.                                                                                               |
| No `InboxModel` changes                                                            | `entriesSorted()`, unread, deleted, and merge semantics stay as they are. A 7,000-row sort is ~2 ms and now happens only on data changes.                                                |

Rejected:

- **Cap the inbox at N rows** — hides documents the config explicitly watches.
- **Project grouping / collapsible sections** — a separate UX feature; not
  needed to fix rendering.
- **Backend pagination** — the data is already in memory; the renderer is the
  bottleneck.
- **`content-visibility: auto`** — measured worse than the current rebuild in
  WebKitGTK.

## 4. Implementation Notes

### Relevant files

| File                                     | Role                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `src/inbox-panel.ts`                     | Inbox DOM renderer; currently a full rebuild on every `render()`  |
| `src/inbox-panel.test.ts`                | 11 happy-dom tests for rows, states, and interactions             |
| `src/main.ts`                            | `AppState`: tab activation, watcher event handling, scan progress |
| `src/style.css`                          | Inbox panel and row styles (section around line 780)              |
| `src/inbox-model.ts`                     | Pure unread/deleted model; unchanged                              |
| `src/project.ts`, `src/relative-time.ts` | Row text helpers; unchanged                                       |
| `src-tauri/src/*`                        | Unchanged; watcher and scan batching already exist                |

### Environment

- Tauri 2 + WebKitGTK 2.52.6 on Linux; webview tests run in happy-dom.
- `happy-dom` has no layout: `clientHeight`, `offsetTop`, and `scrollTop` are
  not useful by default. The panel takes an optional `viewportHeight` test
  seam; production reads `root.clientHeight`.
- The inbox panel is the scroll container (`#inbox-panel`), with the header and
  status above the list. Add `position: relative` to it so `list.offsetTop` is
  relative to the panel's scroll content.
- Commands:
  - `npm run typecheck`
  - `npm run test:web`
  - `npm test` (cargo test + vitest)
  - `npm run lint:rs`
  - `npm run build`
  - `npm run tauri dev -- ./README.md`

### Constraints

- Do not change the Rust side or the watcher contract.
- Do not change sort order, unread/deleted semantics, or what opens a document.
- Do not add dependencies.
- Keep the panel usable at 10,000 rows (`MAX_FILES`).

## 5. Phase 1 — O(1) tab activation, batched events, status-only progress

**Objective:** remove the full inbox rebuild from tab activation and watcher
bursts, and make progress updates touch only the status region.

**Deliverables:** stable panel shell, row registry + `setActive()` +
`setProgress()`, delegated row events, batched `paths-changed` handling, tests.

### 5.1 [MODIFY] `src/inbox-panel.ts` — stable shell and row registry

Build the header, status host, and list once in the constructor. `render()`
updates those regions instead of replacing the whole panel.

```ts
export interface InboxPanelOptions {
  onOpen(path: string): void;
  /** Injectable clock so relative times are deterministic in tests. */
  now?: () => number;
  /**
   * Test seam. Production measures the panel's own client height; happy-dom
   * has no layout.
   */
  viewportHeight?: number;
}

export class InboxPanel {
  private entries: InboxEntry[] = [];
  private status: InboxStatus;
  private openPaths: ReadonlySet<string> = new Set();
  private activePath: string | null = null;

  private readonly header: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly statusHost: HTMLDivElement;
  private readonly list: HTMLUListElement;

  /** Rendered rows by canonical path (phase 1). */
  private readonly rows = new Map<string, HTMLElement>();

  private total = 0;
  private unread = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: InboxPanelOptions,
  ) {
    this.status = {
      configPath: "",
      configFound: true,
      error: null,
      warnings: [],
      truncated: false,
      loading: true,
      progress: null,
    };

    this.header = document.createElement("div");
    this.header.className = "inbox-header";
    const title = document.createElement("span");
    title.className = "inbox-title";
    title.textContent = "Inbox";
    this.countEl = document.createElement("span");
    this.countEl.className = "inbox-count";
    this.header.append(title, this.countEl);

    this.statusHost = document.createElement("div");
    this.statusHost.className = "inbox-status";

    this.list = document.createElement("ul");
    this.list.className = "inbox-list";
    this.bindRowEvents();

    this.root.replaceChildren(this.header, this.statusHost, this.list);
  }
```

`bindRowEvents()` uses delegation (replaces the two listeners created in
`renderRow` today):

```ts
private bindRowEvents(): void {
  this.list.addEventListener("click", (event) => {
    const row = (event.target as Element | null)?.closest<HTMLElement>(".inbox-row");
    const path = row?.dataset.path;
    if (path) this.options.onOpen(path);
  });

  this.list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = (event.target as Element | null)?.closest<HTMLElement>(".inbox-row");
    const path = row?.dataset.path;
    if (!path) return;
    event.preventDefault();
    this.options.onOpen(path);
  });
}
```

`render()` stores the inputs, updates the three regions, and preserves the
scroll position:

```ts
public render(
  entries: InboxEntry[],
  status: InboxStatus,
  openPaths: ReadonlySet<string>,
  activePath: string | null,
): void {
  this.entries = entries;
  this.status = status;
  this.openPaths = openPaths;
  this.activePath = activePath;
  this.renderHeader();
  this.renderStatus();
  this.renderRows();
}

private renderHeader(): void {
  this.total = this.entries.length;
  this.unread = this.entries.filter((entry) => entry.unread).length;
  this.renderCount();
}

private renderCount(): void {
  const total = `${this.total} ${this.total === 1 ? "file" : "files"}`;
  this.countEl.textContent = this.unread > 0 ? `${total} · ${this.unread} new` : total;
}

private renderRows(): void {
  const scrollTop = this.root.scrollTop;
  const fragment = document.createDocumentFragment();
  this.rows.clear();
  for (const entry of this.entries) {
    const row = this.createRow(entry);
    this.rows.set(entry.path, row);
    fragment.append(row);
  }
  this.list.replaceChildren(fragment);
  this.root.scrollTop = scrollTop;
}
```

`renderStatus()` mirrors the current `render()` body from lines 45–79, except it
writes into `this.statusHost`:

```ts
private renderStatus(): void {
  const fragment = document.createDocumentFragment();

  if (this.status.loading) {
    fragment.append(this.scanMessage(this.status.progress));
  } else {
    if (this.status.progress) {
      fragment.append(this.scanMessage(this.status.progress));
    }
    if (this.status.error) {
      fragment.append(this.message(`Config error: ${this.status.error}`, "inbox-error"));
    } else if (!this.status.configFound) {
      fragment.append(this.setupHint(this.status.configPath));
    }
    if (this.status.warnings.length > 0) {
      fragment.append(this.warningList(this.status.warnings));
    }
    if (this.status.truncated) {
      fragment.append(
        this.message(
          "Some paths were skipped at the configured limits; see the warnings.",
          "inbox-truncated",
        ),
      );
    }
    if (this.entries.length === 0) {
      fragment.append(
        this.message("No documents match the configured watches.", "inbox-empty"),
      );
    }
  }

  this.statusHost.replaceChildren(fragment);
}
```

Add the two fast paths:

```ts
/**
 * Repaints the active/open/unread state of one row without touching the list.
 * Called on every tab activation.
 */
public setActive(
  previous: string | null,
  active: string | null,
  unread: number,
): void {
  this.activePath = active;
  if (previous && previous !== active) {
    this.rows.get(previous)?.classList.remove("active");
  }
  const row = active === null ? undefined : this.rows.get(active);
  if (row) {
    row.classList.add("active", "open");
    row.classList.remove("unread");
  }
  this.unread = unread;
  this.renderCount();
}

/** Updates only the scan status line; the row list is untouched. */
public setProgress(progress: ScanProgress | null): void {
  this.status = { ...this.status, progress };
  this.renderStatus();
}

/** Re-paints after the panel is shown or the window is resized. */
public refresh(): void {
  this.renderRows();
}
```

`refresh()` is a phase-1 stub that re-renders rows. Phase 2 replaces its body
with the window renderer.

`createRow(entry)` is the current `renderRow` minus the two per-row listeners
(the delegated listeners on the list handle them). Keep the markup and classes
identical.

### 5.2 [MODIFY] `src/main.ts` — tab activation

Capture the previous active path, clear unread in the model, and patch:

```ts
public setActiveTab(path: string): void {
  const previous = this.activePath;
  this.activePath = path;
  const tab = this.tabs.get(path);
  if (tab) tab.hasUnreadUpdate = false;

  if (this.activeUpdatePath !== null && this.activeUpdatePath !== path) {
    if (this.activeUpdateTimer !== null) clearTimeout(this.activeUpdateTimer);
    this.activeUpdateTimer = null;
    this.activeUpdatePath = null;
  }

  this.inbox.markRead(path);
  this.inboxPanel.setActive(previous, path, this.inbox.unreadCount());

  this.renderTabs();
  void this.renderActiveContent();
}
```

Remove the `this.renderInbox()` call on line 475. Do not remove `renderInbox()`
from the other call sites yet: loading the config/session folder and closing a
tab are structural changes and may still rebuild the list in phase 1. Phase 2
makes those cheap too.

When the inbox is shown again, it needs a fresh window/rows:

```ts
onChange: (next) => {
  this.preferences.inboxVisible = next;
  this.inboxPanelEl.hidden = !next;
  if (next) this.inboxPanel.refresh();
  this.persist();
},
```

### 5.3 [MODIFY] `src/main.ts` — batch watcher events

Replace the per-change listener with a batch pass:

```ts
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

  if (tabsChanged) this.renderTabs();
  if (inboxChanged) this.renderInbox();
  if (activeDeleted) void this.renderActiveContent();
  for (const path of reloads) void this.reloadDocument(path);
});
```

Make `applyPathChange` synchronous and return flags. Its rules stay identical:

```ts
private applyPathChange(change: PathChange): {
  inboxChanged: boolean;
  tabsChanged: boolean;
  activeDeleted: boolean;
  reload: boolean;
} {
  const tab = this.tabs.get(change.path);
  const isActive = this.activePath === change.path;
  const tracked =
    this.inbox.has(change.path) || isUnderAny(change.path, this.watchRoots);

  if (!change.exists) {
    const wasDeleted = tab?.deletedOnDisk ?? false;
    if (tab && !wasDeleted) tab.deletedOnDisk = true;
    return {
      inboxChanged: tracked && this.inbox.markDeleted(change.path),
      tabsChanged: tab !== undefined && !wasDeleted,
      activeDeleted: isActive && tab !== undefined && !wasDeleted,
      reload: false,
    };
  }

  if (tracked) {
    const seed: InboxSeed = {
      path: change.path,
      filename: fileName(change.path),
      modifiedTime: change.modifiedTime ?? Date.now(),
    };
    return {
      inboxChanged: this.inbox.upsert(seed, !isActive),
      tabsChanged: false,
      activeDeleted: false,
      reload: tab !== undefined,
    };
  }

  return { inboxChanged: false, tabsChanged: false, activeDeleted: false, reload: tab !== undefined };
}
```

`reloadDocument()` keeps its token guard and its own `renderTabs()` /
`renderActiveContent()` calls. Multiple reloads for multiple open tabs are still
allowed to repaint the document; only the inbox is guaranteed to render once per
batch.

### 5.4 [MODIFY] `src/main.ts` — progress-only updates

In `bindBackend()`:

```ts
await listen<ScanProgress>("scan-progress", (event) => {
  if (this.scansInFlight === 0) return;
  this.inboxStatus = { ...this.inboxStatus, progress: event.payload };
  this.inboxPanel.setProgress(event.payload);
});
```

The `renderInbox()` call on line 337 goes away. `loadWatchConfig` and
`addWatch` still set `inboxStatus` and call `renderInbox()` on completion, which
is correct.

### 5.5 [MODIFY] `src/inbox-panel.test.ts`

Keep all 11 existing tests; they exercise the same markup. Add:

- `setActive` moves the `active` class without replacing other rows:
  ```ts
  const before = root.querySelectorAll(".inbox-row");
  panel.setActive(null, secondPath, 1);
  const after = root.querySelectorAll(".inbox-row");
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[1].classList.contains("active")).toBe(true);
  ```
- `setActive` adds `open` to a newly activated row and removes `unread`.
- `setActive` updates the header to `2 files · 1 new` (or the expected count).
- `setProgress` replaces only the status host: capture a row node and the list
  node, call `setProgress`, assert both are still the same nodes and the
  loading text changed.
- Delegated click and Enter still open the right path (existing tests cover the
  behavior; keep them).

Use a helper that keeps the panel instance so the fast paths can be called:

```ts
function mount(entries: InboxEntry[] = [entry()]) {
  document.body.innerHTML = '<aside id="inbox-panel"></aside>';
  const root = document.getElementById("inbox-panel") as HTMLElement;
  const onOpen = vi.fn();
  const panel = new InboxPanel(root, { onOpen, now: () => NOW });
  panel.render(entries, status(), new Set(), null);
  return { root, panel, onOpen };
}
```

### 5.6 Phase 1 verification

- `npm run typecheck`
- `npm run test:web` — all existing and new tests pass
- Manual: `npm run tauri dev -- ./README.md`; click through 20 tabs. The
  WebKitWebProcess CPU should not spike; switching should be immediate.
- Manual: `npm run simulate`; watch the inbox during a burst. The list may still
  rebuild once per settled batch in phase 1, but no longer once per file.
- Confirm the header unread count clears when a tab is activated.

## 6. Phase 2 — Windowed inbox list

**Objective:** keep only the visible rows plus overscan in the DOM, so the first
inbox paint no longer blocks the UI and row count no longer affects render cost.

**Deliverables:** exported `visibleRange()` math, pooled window renderer,
scroll/resize handling, inline row geometry, updated tests, CSS.

### 6.1 [MODIFY] `src/inbox-panel.ts` — constants and pure range math

```ts
/** Height of one inbox row in CSS pixels. Owned by JS; see `bindRow()`. */
export const ROW_HEIGHT = 48;

/** Extra rows rendered above and below the viewport during fast scrolling. */
export const OVERSCAN = 6;

export interface RowRange {
  start: number;
  end: number;
}

/**
 * The half-open index range that must exist in the DOM for a viewport.
 *
 * `scrollOffset` is measured from the top of the list (not the panel), so the
 * header and status height are the caller's responsibility.
 */
export function visibleRange(
  scrollOffset: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): RowRange {
  if (total <= 0 || viewportHeight <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }

  const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const size = visible + overscan * 2;
  const maxStart = Math.max(0, total - size);
  const start = Math.min(
    Math.max(0, Math.floor(scrollOffset / rowHeight) - overscan),
    maxStart,
  );

  return { start, end: Math.min(total, start + size) };
}
```

Unit tests cover: `total = 0`; `viewportHeight = 0`; fewer entries than the
window; `scrollOffset` at 0; `scrollOffset` past the end; overscan at the top
and bottom; single-row and fractional offsets.

### 6.2 [MODIFY] `src/inbox-panel.ts` — window state

Replace the phase-1 `rows: Map<string, HTMLElement>` with index-keyed state:

```ts
private readonly rendered = new Map<number, HTMLElement>();
private readonly freeRows: HTMLElement[] = [];
private rafId: number | null = null;

private readonly onResize = (): void => this.scheduleWindow();
```

Constructor additions (after building the list):

```ts
this.root.addEventListener("scroll", this.onScroll, { passive: true });
window.addEventListener("resize", this.onResize);
```

with:

```ts
private readonly onScroll = (): void => this.scheduleWindow();
private readonly onResize = (): void => this.scheduleWindow();
```

`destroy()` is for tests and completeness:

```ts
public destroy(): void {
  if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  this.root.removeEventListener("scroll", this.onScroll);
  window.removeEventListener("resize", this.onResize);
}
```

`render()` now sets the rail height and calls the window renderer with a
rebind:

```ts
public render(entries, status, openPaths, activePath): void {
  this.entries = entries;
  this.status = status;
  this.openPaths = openPaths;
  this.activePath = activePath;
  this.renderHeader();
  this.renderStatus();
  this.list.style.height = `${entries.length * ROW_HEIGHT}px`;
  this.renderWindow(true);
}
```

`refresh()` becomes:

```ts
public refresh(): void {
  this.renderWindow(true);
}
```

Also extend the phase-1 `setProgress()` so a status line that grows or shrinks
re-windows the list (the list's `offsetTop` moved):

```ts
public setProgress(progress: ScanProgress | null): void {
  this.status = { ...this.status, progress };
  this.renderStatus();
  this.scheduleWindow();
}
```

### 6.3 [MODIFY] `src/inbox-panel.ts` — create, bind, recycle

Split the old `renderRow` into a factory and a binder:

```ts
private createRow(): HTMLElement {
  const row = document.createElement("li");
  row.className = "inbox-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const top = document.createElement("div");
  top.className = "inbox-row-top";
  const chip = document.createElement("span");
  chip.className = "inbox-project";
  const name = document.createElement("span");
  name.className = "inbox-filename";
  const dot = document.createElement("span");
  dot.className = "inbox-dot";
  top.append(chip, name, dot);

  const bottom = document.createElement("div");
  bottom.className = "inbox-row-bottom";
  const parent = document.createElement("span");
  parent.className = "inbox-parent";
  const time = document.createElement("time");
  time.className = "inbox-time";
  bottom.append(parent, time);

  row.append(top, bottom);
  return row;
}

private bindRow(row: HTMLElement, index: number): void {
  const entry = this.entries[index];
  row.dataset.path = entry.path;
  row.style.top = `${index * ROW_HEIGHT}px`;
  row.style.height = `${ROW_HEIGHT}px`;
  row.className = "inbox-row";
  if (entry.unread) row.classList.add("unread");
  if (entry.deleted) row.classList.add("deleted");
  if (this.openPaths.has(entry.path)) row.classList.add("open");
  if (entry.path === this.activePath) row.classList.add("active");
  row.setAttribute("aria-posinset", String(index + 1));
  row.setAttribute("aria-setsize", String(this.entries.length));

  const project = projectName(entry.path);
  const chip = row.querySelector<HTMLElement>(".inbox-project")!;
  chip.hidden = project === null;
  chip.textContent = project ?? "";

  const name = row.querySelector<HTMLElement>(".inbox-filename")!;
  name.textContent = entry.filename;
  name.title = entry.deleted ? `${entry.path} (deleted on disk)` : entry.path;

  const parentPathText = parentPath(entry.path);
  const parent = row.querySelector<HTMLElement>(".inbox-parent")!;
  parent.textContent = compactPath(parentPathText);
  parent.title = parentPathText;

  const now = this.options.now?.() ?? Date.now();
  const time = row.querySelector<HTMLTimeElement>(".inbox-time")!;
  time.dateTime = new Date(entry.modifiedTime).toISOString();
  time.textContent = formatRelativeTime(entry.modifiedTime, now);
  time.title = formatExactTime(entry.modifiedTime);
}
```

`rowFor(path)` scans the rendered window (at most ~31 nodes):

```ts
private rowFor(path: string): HTMLElement | undefined {
  for (const row of this.rendered.values()) {
    if (row.dataset.path === path) return row;
  }
  return undefined;
}
```

Update `setActive` to use `rowFor()`:

```ts
public setActive(previous: string | null, active: string | null, unread: number): void {
  this.activePath = active;
  if (previous && previous !== active) {
    this.rowFor(previous)?.classList.remove("active");
  }
  const row = active === null ? undefined : this.rowFor(active);
  if (row) {
    row.classList.add("active", "open");
    row.classList.remove("unread");
  }
  this.unread = unread;
  this.renderCount();
}
```

### 6.4 [MODIFY] `src/inbox-panel.ts` — the window renderer

```ts
private measureViewport(): number {
  return this.options.viewportHeight ?? this.root.clientHeight;
}

private scheduleWindow(): void {
  if (this.rafId !== null) return;
  this.rafId = requestAnimationFrame(() => {
    this.rafId = null;
    this.renderWindow(false);
  });
}

/**
 * Puts exactly the visible range in the DOM.
 *
 * `rebind` is true after the entries change: every rendered row is re-bound
 * because its index may now point at a different document. Scrolling passes
 * false so only entering rows are bound.
 */
private renderWindow(rebind: boolean): void {
  const viewport = this.measureViewport();
  if (viewport <= 0) {
    this.recycleAll();
    return;
  }

  const offset = Math.max(0, this.root.scrollTop - this.list.offsetTop);
  const { start, end } = visibleRange(
    offset,
    viewport,
    ROW_HEIGHT,
    this.entries.length,
    OVERSCAN,
  );

  for (const [index, row] of this.rendered) {
    if (index < start || index >= end) {
      this.rendered.delete(index);
      row.remove();
      this.freeRows.push(row);
    }
  }

  // Descending insertion keeps DOM order equal to index order without moving
  // rows that stay in the window.
  for (let index = end - 1; index >= start; index -= 1) {
    let row = this.rendered.get(index);
    if (row === undefined) {
      row = this.freeRows.pop() ?? this.createRow();
      this.rendered.set(index, row);
      this.bindRow(row, index);
      this.list.insertBefore(row, this.rendered.get(index + 1) ?? null);
    } else if (rebind) {
      this.bindRow(row, index);
    }
  }
}

private recycleAll(): void {
  for (const row of this.rendered.values()) {
    row.remove();
    this.freeRows.push(row);
  }
  this.rendered.clear();
}
```

Why descending: `this.rendered.get(index + 1)` is already placed when the loop
reaches `index`, so `insertBefore` positions every new row correctly. Rows that
stay keep their existing DOM position; no element is moved on a one-row scroll.

The `freeRows` pool grows to the window size and never shrinks; at ~31 rows
that is negligible.

### 6.5 [MODIFY] `src/style.css` — geometry

```css
#inbox-panel {
  position: relative;
}

.inbox-list {
  position: relative;
}

.inbox-row {
  overflow: hidden;
}
```

`#inbox-panel` must be `position: relative` so `list.offsetTop` is measured
inside the panel's scroll content. The list is `position: relative` so absolutely
positioned rows are contained. Do not add a CSS height to `.inbox-row`: `bindRow`
writes `height: 48px` inline from `ROW_HEIGHT`, keeping the JS range math and the
DOM in sync.

The global `* { box-sizing: border-box }` (`src/style.css:60`) makes the inline
`height` the border-box height. The measured natural row is 47 px including its
12 px vertical padding, so 48 px never clips; `.inbox-row { overflow: hidden }`
is the guard. `padding: 6px 12px` and `border-left: 3px` stay as they are.

### 6.6 [MODIFY] `src/inbox-panel.test.ts` — window tests

Pass a viewport seam everywhere:

```ts
const panel = new InboxPanel(root, {
  onOpen,
  now: () => NOW,
  viewportHeight: 480,
});
```

Update **both** existing helpers (`mount()` and `render()`) to pass
`viewportHeight: 480`. Without a seam, `root.clientHeight` is 0 in happy-dom and
every row is recycled, which would make all row assertions fail.

Add tests:

- 1,000 entries, viewport 480, row 48, overscan 6 → 22 rows in the DOM and
  `list.style.height === "48000px"`.
- Scrolling: set `root.scrollTop = 400 * 48`, dispatch `scroll`, await a
  requestAnimationFrame, then assert the first row's `data-path` is entry 394
  and the last is entry 415.
- `setActive` on an offscreen path does not create a row; scrolling to it later
  binds it with `active` already set.
- A data render does not replace row DOM nodes: capture a row for index 0,
  `render()` again with one changed entry, assert the same node is reused and
  its `.inbox-time` text changed.
- 0 entries → no `.inbox-row`, the empty message is shown, and
  `list.style.height === "0px"`.
- `destroy()` removes the resize listener (no assertion needed beyond not
  throwing).

happy-dom lacks layout; `root.scrollTop` is a plain property and `list.offsetTop`
is 0, which is exactly the coordinate system the range math expects. If a
happy-dom version does not implement `scrollTop`, define it in the test with
`Object.defineProperty(root, "scrollTop", { value: 0, writable: true })`.

### 6.7 Phase 2 verification

- `npm run typecheck`
- `npm run test:web`
- Manual, with the real config (~7,000 rows):
  - Launch `npm run tauri dev -- ./README.md`. After the scan completes, the
    inbox paints without a multi-second freeze.
  - Scroll from top to bottom and back; row content, chip, parent path,
    relative time, and tooltips stay correct.
  - Click rows, use Enter and Space; the right document opens.
  - Activate tabs from the tab bar and from the inbox; active/open/unread
    states are correct, including rows scrolled out of view and back.
  - Toggle the inbox off and on; resize the window; switch top/side layout.
  - `npm run simulate` while scrolling; new writes update the visible row and
    do not reset the scroll position.
- Memory: the WebKitWebProcess DOM node count should be roughly constant while
  scrolling, not proportional to 7,000.

## 7. Phase 3 — Documentation, ADR, changelog, validation, report

### 7.1 [NEW] ADR

Already written:
`_ai/technical_decisions/ADR__261024-3__windowed-inbox-list.md`, and indexed in
`_ai/technical_decisions/README.md`.

### 7.2 [MODIFY] `README.md`

- Architecture table: change the `src/inbox-panel.ts` description to
  "Windowed inbox renderer: fixed-height row pool, visible-range painting".
- In the config/watcher section, add one sentence: the inbox renders only the
  visible rows, so thousands of matched documents do not affect tab switching.
- Known limitations: add that browser-native find only sees the rendered inbox
  window (docdeck has no in-app inbox find).

### 7.3 [MODIFY] `CHANGELOG.md`

Under `## [Unreleased]` → `### Fixed` (or `### Changed`), add:

```md
- Inbox rendering no longer rebuilds every row on tab activation or on each
  watcher event. The inbox now paints only the visible rows from a recycled
  pool, so switching tabs with thousands of watched documents stays
  interactive and the first inbox paint no longer blocks the UI.
```

### 7.4 Full validation

```bash
npm run typecheck
npm run test:web
npm test
npm run lint:rs
npm run build
```

All must pass. No Rust files change; `npm test` still runs `cargo test` and
`vitest`. `npm run lint:rs` guards against accidental Rust edits.

### 7.5 Measurement

Re-run the throwaway WebKitGTK harness used during analysis (same 7,000 rows,
280 px panel, 1,280×900 window) or measure the real app:

- Time the first inbox paint after `load_watches` resolves. Target: < 250 ms in
  the real app, tens of milliseconds in the harness.
- Time 20 tab switches. Target: no perceptible delay; the panel work per switch
  should be a few milliseconds.
- Scroll the list for 10 seconds and confirm the WebKitWebProcess CPU stays
  low and rows remain correct.

Record before/after numbers in the report.

### 7.6 [NEW] Implementation report

Write `_ai/backlog/reports/261024_1047__IMPLEMENTATION_REPORT__inbox-render-performance.md`
with the frontmatter required by the plan workflow:

```yaml
---
filename: "_ai/backlog/reports/261024_1047__IMPLEMENTATION_REPORT__inbox-render-performance.md"
title: "Report: Inbox render performance"
createdAt: 2026-10-24 10:47
createdBy: opencode [deepseek-v4.1-flash-free]
updatedAt: 2026-10-24 10:47
updatedBy: opencode [deepseek-v4.1-flash-free]
planFile: "_ai/backlog/active/261024_1047__IMPLEMENTATION_PLAN__inbox-render-performance.md"
project: "docdeck"
status: completed
completedAt: 2026-10-24 11:40
filesCreated: 1
filesModified: 4
filesDeleted: 0
tags: [performance, inbox, virtual-list]
documentType: IMPLEMENTATION_REPORT
---
```

Include: summary, files changed, key changes, technical decisions, testing
notes, the before/after measurements, and any deviations (for example, if
`ROW_HEIGHT` had to change from 48).

## 8. Requirement Coverage

| Requirement                                     | Where                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Tab switch does not rebuild the inbox           | Phase 1: `setActive()`; `main.ts` removes `renderInbox()` from `setActiveTab` |
| Header unread count stays correct on activation | Phase 1: `setActive(..., unread)` → `renderCount()`                           |
| Watcher batch causes one inbox render           | Phase 1: batch loop + flags in `paths-changed`                                |
| Scan progress does not touch rows               | Phase 1: `setProgress()` → status host only                                   |
| Initial inbox paint does not block for seconds  | Phase 2: windowed list, ~31 rows                                              |
| DOM stays constant while scrolling              | Phase 2: pool + `rendered` map                                                |
| Click/keyboard still open documents             | Delegated listeners; existing tests                                           |
| Active/open/unread/deleted semantics unchanged  | `bindRow()` applies the same classes; `InboxModel` untouched                  |
| Scroll position preserved across renders        | Phase 1 `scrollTop` restore; Phase 2 list is not replaced                     |
| Panel hidden/reshown works                      | `refresh()` on the inbox toggle and on resize                                 |
| 10,000-file cap remains safe                    | Windowed render is O(visible), not O(total)                                   |
| No Rust changes                                 | All work in `src/`                                                            |

## 9. Risks and Mitigations

| Risk                                                   | Mitigation                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Row height drifts from `ROW_HEIGHT` after a CSS change | `bindRow()` writes the height inline from the constant; `.inbox-row { overflow: hidden }`; the ADR records the invariant.                    |
| happy-dom has no layout                                | `viewportHeight` test seam; `visibleRange()` is a pure exported function tested directly.                                                    |
| Off-by-one in the window range                         | Table-driven tests for top, middle, bottom, empty and undersized lists.                                                                      |
| Scroll jank from rebinding too many rows               | Only entering rows are bound on scroll; `rebind` is reserved for data changes; `requestAnimationFrame` throttles scroll events.              |
| Focus is lost when a focused row is recycled           | Rows are recycled only when out of view; document the behavior. Do not move focus to a different document.                                   |
| Header/status height changes shift the list offset     | `renderWindow()` reads `list.offsetTop` after the status update; no cached offset.                                                           |
| Hidden panel measures 0 height                         | `renderWindow()` recycles rows and returns; `refresh()` on show and resize.                                                                  |
| A data change while scrolled reorders rows             | Indices are rebound in place; the scroll pixel offset is preserved, matching today's behavior.                                               |
| `toLocaleString()` cost                                | Only entering rows call it (~1–2 per scroll tick, ~31 per data render), not 7,000.                                                           |
| Native find cannot see offscreen inventory             | The inbox has no in-app find; documented as a limitation.                                                                                    |
| Tests rely on DOM order                                | Window rows are inserted in index order (descending insert loop); tests assert `data-path` rather than fragile child indexes where possible. |

## 10. Appendix — Benchmark method

The analysis used a throwaway harness (not committed) that:

1. Generates 7,000 inbox entries with realistic `_ai` paths and the same row
   markup as `InboxPanel.renderRow()`.
2. Loads the real inbox CSS in a `WebKit2.WebView` (PyGObject, WebKitGTK 2.52.6,
   1,280×900 window, 280 px panel).
3. Measures `performance.now()` around each scenario and forces layout with
   `scrollHeight` / `getBoundingClientRect()`.

Scenarios and medians:

| Scenario                                                   | Median     |
| ---------------------------------------------------------- | ---------- |
| `createElement` + listeners + `toLocaleString`, 7,000 rows | 3,970 ms   |
| same without listeners/Intl (isolating DOM cost)           | 3,838 ms   |
| one `innerHTML` string, 7,000 rows                         | 3,606 ms   |
| keyed reconcile, no changes                                | 2 ms       |
| keyed reconcile, one changed row                           | 20 ms      |
| reorder one row                                            | 24 ms      |
| patch one `active` class                                   | 2.6–4.6 ms |
| windowed render, 31 rows                                   | 16–47 ms   |
| windowed pooled scroll tick                                | ~16 ms     |
| `content-visibility: auto` + full rebuild                  | 5,255 ms   |
| `toLocaleString()` × 7,000                                 | 1,037 ms   |

The measurement is reproducible with the same markup; it is recorded here to
justify the windowed design and to give the implementation a target. The harness
is intentionally not committed: it requires PyGObject and a display server and
is not part of the product's test suite.
