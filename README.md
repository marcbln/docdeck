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

- **Config-driven watch registry** — the watch configuration lists folders and
  files with wildcards (`~/devel/*/_ai`, `~/notes/**/*.md`). Matching folders
  become recursive Markdown watches; matching files are watched whatever their
  extension. Hidden entries, symlinks and build directories are skipped;
  `exclude` patterns refine the set.
- **Live configuration reload** — editing the configuration (by hand or from the
  in-app **Watches** surface) re-applies valid watches within a couple of
  seconds. An invalid save keeps the last working watches and shows an
  actionable error; open documents are never closed or reordered.
- **Cross-session unread** — review state is recorded per document, so documents
  changed while docdeck was closed are marked unread after a restart, while
  reviewed and unchanged documents stay read.
- **Browse filter** — a search field above the browse list narrows All documents
  or Recently changed by filename, folder or `_ai` project, case-insensitively,
  without changing order or any open/unread/deleted state.
- **Rename and move tracking** — a rename or move inside watched locations
  updates one row in place, keeping the document open, active and read. A move
  out of every watch leaves the list and marks an open tab unavailable; a move
  in appears as new unread work.
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
- **Recent-change summaries** — a ✨ button in the **Recently changed** toolbar
  asks a Rig agent for an overview of the current rows (filter included) plus
  optional per-document details. The agent reads numbered tables of contents
  and can call `get_toc`, `get_sections`, `search_sections` and `get_change`
  under a bounded tool-call budget. docdeck keeps the last two in-session
  versions of every document the watcher saw, so a later write yields a real
  unified diff; a document never opened or seen before falls back to current
  content. Summaries are session-only and closing the modal discards an
  in-flight result.
- **Unread indicator** — a document changed since you last reviewed it keeps
  its amber dot until activated, and the marker survives restarts; writing to
  the active document pulses the dot briefly and fades.
- **Panel tray icon** — a chat-style presence dot next to the window list:
  green while you are caught up, amber while detected changes are waiting to
  be seen. Left-click shows the window and clears the dot; the right-click
  menu offers Show, a notifications toggle and Quit. Optional desktop
  notifications announce settled changes and are configurable and throttled
  so a burst of agent writes cannot flood the desktop.
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

## Requirements

- Rust 1.80+ and Node.js 20+, plus the standard Tauri 2 toolchain for your
  platform.

**Linux**: `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`,
`libjavascriptcoregtk-4.1-dev`, `build-essential` and `pkg-config`. On Arch
these come from `webkit2gtk-4.1` and `base-devel`.

**macOS**: Xcode Command Line Tools (`xcode-select --install`) and Node.js.

**Windows**: the Microsoft C++ Build Tools (MSVC) and the WebView2 runtime
(preinstalled on current Windows releases).

The tray icon needs a StatusNotifierItem host in the panel (XFCE ≥ 4.18 and
KDE ship one) and loads `libappindicator3` at runtime (`libappindicator` /
`libayatana-appindicator` on Arch); without either, the app runs as a plain
window and prints why to stderr.

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

Or use the installer, which also registers docdeck as an "Open With" handler
for Markdown files (Linux):

```bash
npm run install:bin            # build and install to ~/.local/bin
./scripts/install.sh --default # additionally set it as the default .md handler
```

### Upgrading a running instance

`scripts/install.sh` detects a running installed instance only after the build
and install both succeed. On a terminal it asks
`Restart the running docdeck instance (pid N) now? [Y/n]`; accepting stops the
old process cleanly and starts the new build from the installed entry point with
the original arguments and working directory.

```bash
./scripts/install.sh --restart     # restart without prompting
./scripts/install.sh --no-restart  # never signal the running instance
./scripts/install.sh -n            # never prompt; print manual-restart guidance
```

`docdeck --quit` asks the running instance to exit without opening a window. It
is a lifecycle control flag, never a document or folder; with nothing running it
prints `docdeck is not running` and exits 0.

The installer relies on a per-user runtime record at
`$XDG_RUNTIME_DIR/docdeck/instance.json` (falling back to
`$HOME/.local/state/docdeck/instance.json`). It holds only the pid, executable,
launch arguments, working directory, and start time, with directory mode `0700`
and file mode `0600`; it is removed on a clean exit. It never contains document
content, preferences, or watch configuration. A stale record is validated and
cleared before anything is signalled.

If the detected process is a development build, the installer names both
executables and asks before replacing it. Declining leaves the old instance
untouched: open tabs are session-scoped, so quit and relaunch to use the new
build.

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

The configuration lives in the platform-standard user configuration directory
(`$DOCDECK_CONFIG` overrides the path on every platform):

| Platform | Default path |
| --- | --- |
| Linux / other Unix | `$XDG_CONFIG_HOME/docdeck/config.toml`, else `~/.config/docdeck/config.toml` |
| macOS | `~/Library/Application Support/docdeck/config.toml` |
| Windows | `%APPDATA%\docdeck\config.toml`, else `%USERPROFILE%\AppData\Roaming\docdeck\config.toml` |

Create it with:

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

# [tray]                        # panel tray icon (all keys optional)
# enabled = true                # set false to hide the tray entirely
# notify = "unfocused"          # "off" | "unfocused" | "always"
# throttle_secs = 10            # minimum gap between notifications

# [summary]                     # optional AI summaries (Recently changed ✨)
# provider = "openai"           # openai | anthropic | ollama | openrouter |
#                               # deepseek | groq | mistral | xai | gemini |
#                               # opencode | zai
# model = "gpt-4o-mini"
# # api_key_env = "OPENAI_API_KEY"  # defaults to the provider's standard key
# # base_url = "https://..."        # openai/anthropic/ollama only
# max_tool_calls = 8            # per-run retrieval budget
# max_documents = 20            # per-summary document cap
```

`[summary]` is opt-in: without it the ✨ button stays disabled and its tooltip
explains how to add it. API keys are never stored in the config file; the
standard environment variables are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`,
`XAI_API_KEY`, `GEMINI_API_KEY`, `OPENCODE_API_KEY` and `ZAI_API_KEY`. Ollama
is keyless by default and reads `OLLAMA_API_BASE_URL`.

- `~` expands to your home directory; `*` matches one path segment; `**`
  matches any depth. Relative paths resolve against your home directory.
- A matched directory contributes its recursive `*.md` tree; a matched file is
  watched explicitly.
- Hidden entries (including `.git`), symlinks and `node_modules`, `target`,
  `dist`, `build`, `.venv`, `venv`, `vendor`, `cache`, `media`, `thumbnail`,
  `thumbnails`, `bundles`, `sitemap`, `uploads`, `storage`, `var`, `logs`,
  `__pycache__`, `htmlcov` and `*.egg-info` are always skipped. `exclude`
  globs apply on top.
- The config is live: a valid save (in-app or in your editor) is applied within
  about two seconds, without restarting. Invalid files keep the last working
  watches and show an error. The `Watches` header control opens an in-app editor
  that preserves comments, formatting, `[tray]` and unknown keys.
- Windows accepts both `/` and `\` in selectors and excludes; they are
  normalized to one internal form. On Linux and macOS a backslash remains a
  literal filename character.
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
Recently changed is session-scoped: a restart starts with no recent activity,
while unread markers derived from your review history persist. A filter field
above the list narrows either mode by filename, folder or project and is
cleared with its `×` control or `Escape`. The `⤢` button opens the same inventory in a full-height modal. Both
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
| `👁 Watches` | Open the in-app watch configuration surface |
| `✉ Browse` | Show or hide the lower browse section |
| `All` / `Recently changed` | Switch the browse list's mode |
| Filter field | Narrow the selected list; `Esc` or `×` clears it |
| `Clear` / `Undo` | Clear recent activity and acknowledge it / restore it |
| `✨` | Summarize the current Recently changed rows with the configured agent |
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

### Tray icon and notifications

docdeck lives in the panel tray (XFCE's System Tray plugin, KDE, or any other
StatusNotifierItem host) with a chat-style presence dot:

| Dot | Meaning |
| --- | --- |
| 🟢 green | Watching; nothing waiting for you |
| 🟠 amber | Changes settled while the window was not focused |

The amber dot clears as soon as the window regains focus (or when you click
the tray icon). Left-click shows and focuses the window; right-click opens a
menu with **Show docdeck**, **Notify on changes** (toggles notifications for
this session, starting from the configured mode) and **Quit docdeck**.

Notifications fire when a debounced batch of changes settles, with the names
of up to three files plus a `+N more` summary. Files under an `_ai` workspace
carry their project chip (`skillman: plan.md`), matching the inbox rows. What
counts as "fire" is the `[tray]` section in `~/.config/docdeck/config.toml` —
read once at startup
like the rest of the config:

- `notify = "off"` — dot only, never a popup.
- `notify = "unfocused"` (default) — popups only while the window is not
  focused, so watching a document live never interrupts you.
- `notify = "always"` — every batch notifies.
- `throttle_secs` — minimum seconds between two popups regardless of mode
  (default 10); bursts of agent writes raise one notification, not twenty.
- `enabled = false` — no tray icon at all.

On XFCE the dot shows in the standard System Tray plugin (4.18+ supports
StatusNotifierItem natively). If no tray host is reachable, docdeck logs the
reason to stderr and runs as a plain window — the tray is never fatal.

### Preferences

Theme, outline, frontmatter, browse visibility, browse mode and the collapsed
state of each sidebar section are stored under the `docdeck.preferences.v1` key
in `localStorage`, so docdeck reopens the way you left it. Per-document review
acknowledgements use `docdeck.acknowledgements.v1` (`{ version: 1, entries: {
"<path>": { mtime, at } } }`); corrupt or wrong-version history is treated as a
first launch and one bad entry never discards the rest. The browse filter,
Recently changed activity and all session state are not persisted. Clear the
preferences key to reset the appearance defaults (dark theme, outline hidden,
frontmatter shown, browse shown in Recently changed mode, both sections
expanded).

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
  inbox-model.ts      Inventory, origin-aware reconcile, unread/deleted state
  acknowledgements.ts Versioned cross-session review history + unread rule
  filter-documents.ts Pure case-insensitive name/path/project filter
  config-editor-model.ts Pure draft, validation and conflict state
  config-panel.ts     In-app watch configuration modal
  sidebar-model.ts    Pure Open/Recent projections, clear snapshot helpers
  sidebar-panel.ts    Two-section sidebar: Open documents and the browse list
  sidebar-rows.ts     Shared two-line row anatomy for browse surfaces
  virtual-list.ts     Windowed list geometry and DOM row recycler
  browse-modal.ts     Full-height windowed inventory pop-out
  summary-model.ts    Summary result types, grouping and labels
  summary-panel.ts    Change-summary modal: loading, overview, details, errors
  style.css           Catppuccin Mocha + Latte, sidebar, markdown overrides
src-tauri/src/
  lib.rs              Builder, single-instance IPC, plugin wiring
  commands.rs         File/watch commands plus config read/save/reload
  config.rs           TOML parsing, platform paths, revisions, expansion, caps
  config_edit.rs      Comment-preserving TOML edits and atomic writes
  config_watch.rs     Live config reload and shared reconciliation
  paths.rs            Path predicates, identity, exclusion set, CLI classification
  folder.rs           Recursive Markdown discovery below a root
  rename.rs           Pure file-identity rename pairing and move-out detection
  watcher.rs          Debounced watcher, ownership sets, event kinds, identities
  tray.rs             Panel tray icon, presence dot compositing, notifications
  render.rs           WebKit renderer configuration
  summary/mod.rs      Summary status and command entry points
  summary/agent.rs    Rig agent, prompt, model providers and retrieval tools
  summary/store.rs    Bounded last-two-versions snapshots and unified diffs
  summary/toc.rs      Heading extraction and section selection expressions
```

The Rust side is deliberately limited to OS concerns (process IPC, filesystem
watching, disk reads) plus the optional summary agent; the webview side owns all
view orchestration. They meet only at a small set of typed `invoke` commands and
events:

| Direction | Name | Payload |
| --- | --- | --- |
| → webview | `open-path-cli` | `{ path, is_dir }` — a forwarded CLI argument |
| → webview | `paths-changed` | `[{ kind, path, fromPath?, exists, modifiedTime? }]` |
| → webview | `config-reloaded` | A generation-tagged reload result |
| → webview | `scan-progress` | Live scan path, folder and file counts |
| → Rust | `summary_status` | Whether `[summary]` is ready, and why not |
| → Rust | `summarize_changes` | `{ paths }` → overview and per-document details |

`kind` is `created`, `modified`, `deleted`, `renamed` or `movedOut`. `exists`
and `modifiedTime` are sampled after the debounce window closed, so the UI can
reload a document or mark its row deleted without re-reading contents. The
reload result is ordered by a monotonic generation; older results are ignored.

## Known limitations

- **Renders markdown only.** No editing.
- **Summaries are session-scoped.** Only rows in **Recently changed** can be
  summarized. A document that changes for the first time after launch has no
  earlier snapshot, so its first summary describes current content instead of
  a diff; documents opened or changed again get real diffs.
- **A summary is not persisted.** Closing the modal abandons an in-flight run
  (the provider request itself cannot be cancelled) and the next summary starts
  from scratch. Nothing is written to disk and unread markers are unchanged.
- **Native find sees only the rendered browse window.** The inline browse list
  and the pop-out inventory keep just the visible rows in the DOM, so the
  browser's find bar cannot match rows scrolled out of view. Use the browse
  filter (name, folder or project) instead.
- **CLI folders are session-only.** They survive live reloads, but put them in
  the config to restore them on the next launch.
- **Upgrade restart is shell-installer only.** Packaged bundles and in-app
  updates are out of scope. A restart reopens the original launch targets, but
  tabs opened from inside the app are session-scoped and close with the old
  instance.
- **Rename pairing depends on file identity.** Where the platform cannot report
  a stable file identity, a rename falls back to a delete plus a create.
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