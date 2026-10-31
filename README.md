# docdeck

A lightweight Markdown viewer with a document sidebar, built for **watching AI agents write documents**.

Agents stream plans, progress logs and status reports straight to the local
filesystem while you work somewhere else. docdeck lists those files in a
sidebar and picks up their changes live — no reload, no polling, no second
browser.

```
docdeck plans/refactor_plan.md reports/agent_status.md
```

## Features

- **Config-driven watch registry** — `~/.config/docdeck/config.toml` lists
  folders and files with wildcards (`~/devel/*/_ai`, `~/notes/**/*.md`).
  Matching folders become recursive Markdown watches; matching files are watched
  whatever their extension. Hidden entries, symlinks and build directories are
  skipped; `exclude` patterns refine the set.
- **Single left sidebar** — **Open documents** sits above a browsable document
  list. Open rows replace the old tab strip: activate one to switch documents,
  close it with `×`, or copy its path from the context menu. The sidebar is
  always present, so document switching can never disappear.
- **Browse all or recently changed** — the lower list switches between the
  complete watched inventory and **Recently changed**, a session-scoped,
  de-duplicated activity list ordered by the moment docdeck observed each write.
  **Clear** empties the activity list and acknowledges its unread markers;
  **Undo** restores both. A document may appear in Open documents and Recently
  changed at the same time, because the lists answer different questions.
- **Unread indicator** — a background document touched by an agent keeps its
  amber pulsing dot until activated; writing to the active document pulses the
  dot briefly and fades.
- **Auto-sort by last update** — bump the documents an agent just touched to the
  top of Open documents.
- **Copy a document's path** — right-click any row (or press `Shift+F10` / the
  ContextMenu key) to copy the document's absolute path. Hovering a row shows
  the same path as a tooltip, and a short toast confirms the copy.
- **Reopen closed documents** — `Ctrl+Shift+T` (`Cmd+Shift+T` on macOS) reopens
  the most recently closed document, browser-style. Repeated presses walk back
  through the session's closed documents; documents deleted in the meantime are
  skipped after reporting the read error.
- **Single-instance CLI** — running `docdeck <file>` or `docdeck <folder>` from any
  terminal reaches the *running* window instead of starting a second process.
- **Survives the terminal** — release builds launched from a shell detach into
  their own session (`fork` + `setsid`, like Zed's CLI), so closing that terminal
  or exiting the shell leaves the window open. `DOCDECK_FOREGROUND=1` keeps
  docdeck attached for debugging; debug builds never detach.
- **GitHub-flavoured Markdown** — tables, task lists (`- [x]`), syntax-highlighted
  code blocks and Mermaid diagrams, with scroll position preserved across reloads.
- **Safe links** — clicking a link never replaces the app window. Web links and
  `mailto:` open in the OS default handler, local Markdown links open or focus a
  tab (scrolling to any `#fragment`), other local files open in their default
  application, and `javascript:`/`data:`/unknown schemes are blocked with a toast.
- **Copy code** — hover any code block for a button that puts its plain source on
  the clipboard and confirms with a checkmark. Diagrams are skipped.
- **Diagram zoom & pan** — large Mermaid graphs open at fit-width and can be
  dragged, zoomed with `Ctrl`/`Cmd` + wheel toward the pointer, or fitted with a
  hover toolbar. The toolbar also opens a diagram fullscreen and can switch it
  back to a normal in-document view capped at the column width. Zoom and pan
  survive live reloads and theme switches; editing a diagram resets its view.
- **Frontmatter as a table** — YAML headers render as a collapsible, two-column
  metadata table instead of raw text, with a TOC entry that jumps to it.
- **Table of contents** — an `h1`–`h4` outline in a collapsible sidebar that
  tracks the reading position as you scroll.
- **In-document find** — `Ctrl+F` (or `Cmd+F`) opens a floating find bar with
  Chrome-style highlighting: every match is yellow, the active match is orange,
  and a `n/m` counter tracks your position. `Enter`/`Shift+Enter` step through
  matches, `Aa` toggles case sensitivity, and the search survives live reloads
  without losing your place.
- **Light and dark themes** — Catppuccin Mocha and Latte, covering the app
  chrome, GitHub markdown styles, syntax highlighting and Mermaid diagrams.

## Requirements (Linux)

- Rust 1.80+ and Node.js 20+
- `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`
- `build-essential` and `pkg-config`

On Arch these come from `webkit2gtk-4.1`, `base-devel`.

## Build

```bash
npm install
npm run tauri build
```

Do not install a binary produced by a plain `cargo build --release`: without
Tauri's `custom-protocol` feature it loads `http://localhost:1420` instead of the
embedded frontend and shows "Could not connect to localhost" when no Vite dev
server is running. `npm run tauri build` (and `scripts/install.sh`) enables that
feature for you.

The binary lands at `src-tauri/target/release/docdeck`. Put it on your `PATH`:

```bash
sudo install -m 755 src-tauri/target/release/docdeck /usr/local/bin/docdeck
```

### Install as a system package

```bash
npm run tauri build -- --bundles deb   # or: rpm, appimage
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
```

## Usage

```bash
# Open a single document
docdeck report.md

# Open several agent plans at once
docdeck plan_a.md plan_b.md /tmp/agent_output.md

# Add a document to the window that is already running
docdeck ./reports/agent_status.md

# Add a folder to this session's watches
docdeck ./_ai
```

## Watching folders on every launch

Create `~/.config/docdeck/config.toml` (`$DOCDECK_CONFIG` overrides the path):

```toml
watch = [
  "~/devel/*/_ai",        # every project's agent workspace
  "~/notes/**/*.md",      # every Markdown file under notes
  "~/journal/today.txt",  # an explicit file, any extension
]
exclude = [
  "**/archive/**",
  "**/templates/**",
]
```

- `~` expands to your home directory; `*` matches one path segment; `**`
  matches any depth. Relative paths resolve against your home directory.
- A matched directory contributes its recursive `*.md` tree; a matched file is
  watched explicitly.
- Hidden entries (including `.git`), symlinks and `node_modules`, `target`,
  `dist`, `build`, `.venv`, `venv`, `vendor`, `cache`, `media`, `thumbnail`,
  `thumbnails`, `bundles`, `sitemap`, `uploads`, `storage`, `var`, `logs`,
  `__pycache__`, `htmlcov` and `*.egg-info` are always skipped. `exclude`
  globs apply on top.
- The config is read once at startup; restart docdeck after editing it.
- Expansion is capped at 256 watched roots, 10,000 files and 100,000 visited
  entries per walk; the sidebar names any selector that was truncated. `**`
  walks are breadth-first, so shallow matches are found even when the entry cap
  is hit. Bounded selectors walk depth-first but follow each pattern segment,
  skipping unrelated siblings (a shop's `vol/mariadb`, for example); use one to
  guarantee a deeply nested root. A broad `**` selector over a content store (a
  CMS media tree, for example) stops at the entry cap instead of spending
  minutes walking directories that cannot contain documents.
- Scanning runs in the background so the window stays responsive. While a
  selector is being expanded or a root is being read, the sidebar shows the path
  currently being scanned with running folder and file counts. Explicit
  `docdeck <file>` arguments open before the config scan starts.

The sidebar has two stacked sections. **Open documents** is the tab registry
rendered as rows: one row per open document, with an active highlight, an
unread dot, a deleted marker and a close control. Its order is the order the
documents were opened unless **Auto-sort** is on, which orders by most recent
write. **Open documents** is always visible; the `✉ Browse` toggle only hides
the lower section.

The lower section switches between two modes. **All documents** lists every
watched path once, with a project chip, compacted parent path, relative
modification time, and open/unread/deleted state. **Recently changed** lists
distinct documents whose change docdeck observed since launch, newest first, and
stays empty until an agent writes. A write updates one row rather than appending
a new one. Documents can appear in both Open documents and Recently changed.

**Clear** empties Recently changed and acknowledges the unread markers for the
changes it covered; **Undo** restores the previous list and unread state.
Clearing is session-scoped like unread: a restart starts with no recent
activity. The `⤢` button opens the same inventory in a full-height modal. Both
the inline list and the modal keep only the visible rows in the DOM (plus a
small overscan), so thousands of matched documents do not affect document
switching or the first paint.

Running `docdeck <folder>` adds that folder as a **session watch** alongside
the config and lists its files in the sidebar; `docdeck <file>` opens a
document. Nothing is opened automatically when a file changes — the browse list
is the triage surface.

| Control | Action |
| --- | --- |
| `⚡ Auto-Sort` | Order Open documents by most recently modified |
| `✉ Browse` | Show or hide the lower browse section |
| `All` / `Recently changed` | Switch the browse list's mode |
| `Clear` / `Undo` | Clear recent activity and acknowledge it / restore it |
| `⤢` | Browse the complete matched inventory in a full-height modal |
| `☰ Outline` | Show or hide the table of contents sidebar |
| `⚙ Frontmatter` | Show or hide the metadata table above each document |
| `☀ Theme` | Switch between the dark and light palettes |
| `Ctrl+F` / `Cmd+F` | Find in the active document |
| `Enter` / `Shift+Enter` | Next / previous match (wraps around) |
| `Aa` | Toggle case-sensitive matching |
| `Esc` | Close the find bar and clear highlights |
| `⧉` on a code block | Copy the snippet's source to the clipboard |
| Drag a diagram | Pan the diagram |
| `Ctrl` / `Cmd` + wheel over a diagram | Zoom toward the pointer |
| Double-click a diagram / `fit` | Fit the whole diagram |
| `+` / `-` / `0` on a focused diagram | Zoom in / out / fit |
| Arrow keys on a focused diagram | Pan (hold `Shift` for larger steps) |
| `⛶` on a diagram | Open it in the fullscreen overlay |
| The inline button on a diagram | Switch between the zoom panel and normal document flow |
| `Esc` in fullscreen | Close the overlay |
| Click a browse row | Open the document, or activate it if already open |
| Click an open row | Activate it and clear its unread dot |
| `×` on an open row | Close it and release its file watch (watched folders stay live) |
| `Ctrl+Shift+T` / `Cmd+Shift+T` | Reopen the most recently closed document |

### Preferences

Theme, outline, frontmatter, browse visibility, browse mode and the collapsed
state of each sidebar section are stored under the `docdeck.preferences.v1` key
in `localStorage`, so docdeck reopens the way you left it. Recently changed
activity is session-scoped and is not persisted. Clear that key to reset to
defaults (dark theme, outline hidden, frontmatter shown, browse shown in
Recently changed mode, both sections expanded).

## Development

```bash
npm run tauri dev -- ./README.md   # run the app with a document loaded
npm run typecheck                  # tsc --noEmit
npm run test:web                   # vitest (frontend unit tests)
npm test                           # cargo test + vitest
npm run lint:rs                    # cargo clippy -D warnings
npm run simulate                   # end-to-end agent-write simulation
npm run simulate:folder            # end-to-end folder-watch simulation
```

`npm run simulate` opens two throwaway documents, appends to one of them in
bursts like a running agent would, and prints a verification checklist. See
[`scripts/simulate_agent_writes.sh`](scripts/simulate_agent_writes.sh).

`npm run simulate:folder` builds a throwaway `_ai`-style workspace and config,
launches docdeck with `DOCDECK_CONFIG` pointing at it, then has a simulated
agent create, edit, delete and recreate documents inside it. See
[`scripts/simulate_folder_watch.sh`](scripts/simulate_folder_watch.sh).

## Architecture

```
src/                  Frontend — document state, sidebar, markdown rendering
  main.ts             AppState: tab registry, CLI events, watcher events, wiring
  markdown.ts         marked + highlight.js + mermaid pipeline, heading ids
  mermaid-zoom-math.ts Pure fit/zoom/pan geometry for diagram viewports
  mermaid-zoom.ts     Mermaid viewport controller, source-keyed state, fullscreen
  copy-code.ts        Clipboard write with fallback, per-block copy buttons
  find-text.ts        Visible-text flattening, literal matching, DOM ranges
  find-bar.ts         Floating find bar, match state, CSS highlight painting
  frontmatter.ts      YAML header split + parse into table rows
  toc.ts              Heading extraction and GitHub-compatible slugs
  toc-panel.ts        Outline sidebar, scroll-spy, jump-to-heading
  tab-menu.ts         Right-click menu for document rows: positioning, dismissal, focus
  closed-tabs.ts      Session stack of closed paths and the reopen shortcut
  theme.ts            Stylesheet swap, Catppuccin Latte, mermaid theming
  toast.ts            Transient themed status messages
  metadata-table.ts   Frontmatter <details> table view
  metadata-jump.ts    Metadata collapsed state and reveal
  toolbar.ts          Reusable toggle button
  preferences.ts      Versioned localStorage persistence
  project.ts          Path/components helpers: parent, project chip, compaction
  relative-time.ts    Deterministic short relative timestamps
  inbox-model.ts      Session unread/deleted/observation state and sorted rows
  sidebar-model.ts    Pure Open/Recent projections, clear snapshot helpers
  sidebar-panel.ts    Two-section sidebar: Open documents and the browse list
  sidebar-rows.ts     Shared two-line row anatomy for browse surfaces
  virtual-list.ts     Windowed list geometry and DOM row recycler
  browse-modal.ts     Full-height windowed inventory pop-out
  style.css           Catppuccin Mocha + Latte, sidebar, markdown overrides
src-tauri/src/
  lib.rs              Builder, single-instance IPC, plugin wiring
  commands.rs         load_file / close_file / load_watches / add_watch
  config.rs           TOML parsing, selector expansion, caps and warnings
  paths.rs            Path predicates, exclusion set, CLI classification
  folder.rs           Recursive Markdown discovery below a root
  watcher.rs          Debounced inotify watcher, file and root registries
  render.rs           WebKit renderer configuration
```

The Rust side is deliberately limited to OS concerns (process IPC, filesystem
watching, disk reads); the webview side owns all view orchestration. They meet
only at five `invoke` commands and two events:

| Direction | Name | Payload |
| --- | --- | --- |
| → webview | `open-path-cli` | `{ path, is_dir }` — a forwarded CLI argument |
| → webview | `paths-changed` | `[{ path, exists, modifiedTime }]` — a batch of settled watcher events |

`exists` is sampled after the debounce window closed, which is all the
classification the UI needs: reload the document, or mark its row as deleted.
`modifiedTime` updates sidebar ordering and relative times without re-reading
the document.

## Known limitations

- **Linux only.** Relies on `inotify` and WebKitGTK.
- **Renders markdown only.** No editing.
- **No rename tracking.** A rename surfaces as a remove plus a create: the open
  row keeps its content with the "deleted on disk" marker while the new path
  appears as a bold row (no document opens automatically). (Watched *folders*
  do survive write-to-temp-then-rename saves, which a purely per-file watch
  could not follow.)
- **Native find sees only the rendered browse window.** The inline browse list
  and the pop-out inventory keep just the visible rows in the DOM, so the
  browser's find bar cannot match rows scrolled out of view. docdeck has no
  in-app browse search.
- **Config is read once.** Editing `config.toml` requires a restart; there is no
  live reload or in-app editor. CLI folders are session-only — put them in the
  config to restore them on the next launch.
- **Very new directories can need one more write.** A file written into a
  directory created within the same `inotify` burst may be missed until its next
  write.
- **DMA-BUF rendering is off by default.** WebKitGTK negotiates GBM buffer
  modifiers through Mesa, which the NVIDIA proprietary driver does not accept —
  that combination paints a blank white window and logs
  `Failed to create GBM buffer ...: Invalid argument`. docdeck disables the
  DMA-BUF renderer at startup, since a markdown viewer does not need it. To opt
  back in on hardware where it works:

  ```bash
  docdeck --accelerated report.md     # or: DOCDECK_ACCELERATED=1 docdeck report.md
  ```

  Exporting `WEBKIT_DISABLE_DMABUF_RENDERER` yourself always takes precedence.