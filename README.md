# docdeck

A lightweight, tabbed Markdown viewer built for **watching AI agents write documents**.

Agents stream plans, progress logs and status reports straight to the local
filesystem while you work somewhere else. docdeck opens those files in tabs and
picks up their changes live — no reload, no polling, no second browser.

```
docdeck plans/refactor_plan.md reports/agent_status.md
```

## Features

- **Live file watch** — a debounced `inotify` watcher (300 ms) picks up external
  writes and repaints the open document.
- **Unread update indicator** — a tab touched by an agent while you are reading
  elsewhere gets an amber pulsing dot.
- **Top tabs or left sidebar** — toggle the tab bar between a horizontal strip and
  a vertical rail for deep directory trees.
- **Auto-sort by last update** — bump the documents an agent just touched to the top.
- **Single-instance CLI** — running `docdeck <file>` from any terminal opens a tab
  in the *running* window instead of starting a second process.
- **GitHub-flavoured Markdown** — tables, task lists (`- [x]`), syntax-highlighted
  code blocks and Mermaid diagrams, with scroll position preserved across reloads.
- **Copy code** — hover any code block for a button that puts its plain source on
  the clipboard and confirms with a checkmark. Diagrams are skipped.
- **Frontmatter as a table** — YAML headers render as a collapsible, two-column
  metadata table instead of raw text, with a TOC entry that jumps to it.
- **Table of contents** — an `h1`–`h4` outline in a collapsible sidebar that
  tracks the reading position as you scroll.
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
```

| Control | Action |
| --- | --- |
| `⇄ Layout` | Switch the tab bar between top and left sidebar |
| `⚡ Auto-Sort` | Order tabs by most recently modified |
| `☰ Outline` | Show or hide the table of contents sidebar |
| `⚙ Frontmatter` | Show or hide the metadata table above each document |
| `☀ Theme` | Switch between the dark and light palettes |
| `⧉` on a code block | Copy the snippet's source to the clipboard |
| Click a tab | Activate it and clear its unread dot |
| `×` on a tab | Close it and release its file watch |

### Preferences

Theme, outline visibility and frontmatter visibility are stored under the
`docdeck.preferences.v1` key in `localStorage`, so docdeck reopens the way you
left it. Clear that key to reset to defaults (dark theme, outline hidden,
frontmatter shown).

## Development

```bash
npm run tauri dev -- ./README.md   # run the app with a document loaded
npm run typecheck                  # tsc --noEmit
npm run test:web                   # vitest (frontend unit tests)
npm test                           # cargo test + vitest
npm run lint:rs                    # cargo clippy -D warnings
npm run simulate                   # end-to-end agent-write simulation
```

`npm run simulate` opens two throwaway documents, appends to one of them in
bursts like a running agent would, and prints a verification checklist. See
[`scripts/simulate_agent_writes.sh`](scripts/simulate_agent_writes.sh).

## Architecture

```
src/                  Frontend — tab state, layout, markdown rendering
  main.ts             AppState: tab registry, CLI events, watcher events, wiring
  markdown.ts         marked + highlight.js + mermaid pipeline, heading ids
  copy-code.ts        Clipboard write with fallback, per-block copy buttons
  frontmatter.ts      YAML header split + parse into table rows
  toc.ts              Heading extraction and GitHub-compatible slugs
  toc-panel.ts        Outline sidebar, scroll-spy, jump-to-heading
  theme.ts            Stylesheet swap, Catppuccin Latte, mermaid theming
  metadata-table.ts   Frontmatter <details> table view
  metadata-jump.ts    Metadata collapsed state and reveal
  toolbar.ts          Reusable toggle button
  preferences.ts      Versioned localStorage persistence
  style.css           Catppuccin Mocha + Latte, layouts, markdown overrides
src-tauri/src/
  lib.rs              Builder, single-instance IPC, plugin wiring
  commands.rs         load_file / close_file commands
  watcher.rs          Debounced inotify watcher and watch registry
  render.rs           WebKit renderer configuration
```

The Rust side is deliberately limited to OS concerns (process IPC, filesystem
watching, disk reads); the webview side owns all view orchestration. They meet
only at three `invoke` commands and two events (`open-file-cli`, `file-updated`).

## Known limitations

- **Linux only.** Relies on `inotify` and WebKitGTK.
- **Watches files, not directories.** An agent that replaces a document via
  write-to-temp-then-rename invalidates the inode-level watch; re-open the tab to
  re-attach. In-place writes and appends are unaffected.
- **Renders markdown only.** No editing.
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