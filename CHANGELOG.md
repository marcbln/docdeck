# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Mermaid diagrams can switch per diagram between the zoom panel and normal
  in-document flow (natural aspect, capped at the column width, page scrollbar)
  from a new toolbar button. The choice survives live reloads and remembers the
  zoom view to return to.
- Mermaid diagram pan/zoom: drag to pan, `Ctrl`/`Cmd` + wheel to zoom toward
  the pointer, double-click or the toolbar to fit, keyboard controls, a
  hover/focus toolbar with a percentage readout, and a fullscreen overlay.
  Zoom/pan survives live reloads and theme switches and resets when the diagram
  source changes.
- Tab context menu: right-click any tab (or press `Shift+F10` / the ContextMenu
  key) to copy the document's absolute path to the clipboard. Copying confirms
  with a transient toast, and hovering anywhere on a tab now shows its full path
  as a tooltip.
- In-document find: `Ctrl+F` (or `Cmd+F`) opens a floating find bar with
  Chrome-style yellow highlighting for every match and an orange active match,
  an `n/m` counter, case toggle, `Enter`/`Shift+Enter` navigation, and
  live-reload persistence.
- Release builds launched from a terminal now detach into their own session
  (`fork` + `setsid`, mirroring Zed's CLI), so closing the terminal or exiting
  the shell no longer sends `SIGHUP` and closes the window. `DOCDECK_FOREGROUND=1`
  keeps docdeck attached; debug builds (`tauri dev`) stay attached too.
- Config-driven watch registry: `~/.config/docdeck/config.toml` (XDG-aware,
  `$DOCDECK_CONFIG` overrides) with `watch` and `exclude` arrays. Selectors
  support `~`, `*` (one segment) and `**` (any depth); matched directories
  contribute recursive `*.md` trees and matched files are watched whatever
  their extension. Hidden entries, symlinks, `node_modules`, `target`, `dist`,
  `build`, `.venv` and `venv` are always skipped; expansion is capped at 256
  roots and 10,000 files with visible warnings.
- Thunderbird-style **Inbox** panel: collapsible left panel (header toggle,
  visible by default, persisted as `inboxVisible`) listing every matched file
  newest-first with a project chip for `_ai` paths, compacted parent path and
  relative time. Session-scoped unread: files changed since startup are bold
  with an amber dot until opened or activated; new files appear bold without
  opening a tab; deleted files keep a struck-through row until they reappear.
  Writes to the active document pulse the tab dot briefly without going bold.
- `load_watches` and `add_watch` commands; watcher events now carry
  `modifiedTime`, and the watcher applies exclude patterns to every event.
  CLI folder arguments add session watches that feed the inbox.
- `scripts/simulate_folder_watch.sh` end-to-end harness for config-driven
  watches, session folders and inbox transitions.
- Copy button on every code block: a hover-revealed button puts the snippet's
  plain source on the clipboard and confirms with a checkmark, falling back to
  `execCommand` on webviews without the async Clipboard API. Mermaid diagrams are
  skipped — their source was already replaced by the rendered SVG.
- Frontmatter metadata table: YAML headers render as a collapsible two-column
  table instead of raw markdown prose, with nested keys indented, lists
  stringified inline and malformed YAML degrading to a raw-text row rather than
  blanking the document.
- Table of contents sidebar listing `h1`–`h4`, with scroll-spy highlighting,
  click-to-jump, and a pinned "Document metadata" entry that expands the
  frontmatter table and scrolls to it.
- Light/dark theme toggle (Catppuccin Latte and Mocha) covering app chrome,
  GitHub markdown styles, syntax highlighting and Mermaid diagrams.
- Toolbar toggles for the outline and frontmatter table, all three new
  preferences persisted under `docdeck.preferences.v1`.

### Fixed
- Clicking a link in a rendered document no longer navigates docdeck's webview
  away from the app and forces a restart. Web links open in the system browser,
  local Markdown links open as tabs, other local files open in their default
  app, and unsafe schemes are blocked with a toast.
- Inbox rendering no longer rebuilds every row on tab activation or on each
  watcher event. The inbox now paints only the visible rows from a recycled
  pool, so switching tabs with thousands of watched documents stays
  interactive and the first inbox paint no longer blocks the UI.
- `**` expansion now walks breadth-first instead of depth-first, so one huge
  project can no longer consume the 100,000-entry budget before sibling
  directories are visited. Bounded selectors (`/shops/*/plugins/*/_ai`) now
  follow each pattern segment and skip unrelated siblings such as a shop's
  `vol/mariadb`, so deep plugin workspaces are found without walking database
  or source trees.
- Broad `**` selectors no longer walk content stores without bound: `vendor`,
  `cache`, `media`, `thumbnail`, `thumbnails`, `bundles`, `sitemap`, `uploads`,
  `storage`, `var`, `logs`, `__pycache__`, `htmlcov` and `*.egg-info` are now
  pruned like `node_modules`, and every selector/root walk stops at 100,000
  visited entries with a warning. Previously `/topdata/**/_ai` descended into a
  Shopware 6 media/thumbnail tree with millions of folders before finishing.
- Opening or switching to a document now starts at the top. Previously the
  renderer treated the empty (or previous) pane as "tailing" and scrolled the
  new document to its end; scroll preservation and tail-pinning now apply only
  to live reloads of the document already on screen.
- The window stays responsive while watched folders are scanned, and the inbox
  names the path currently being indexed with running folder/file counts.
  `load_watches` and `add_watch` now walk the filesystem on a blocking worker
  instead of the main thread, so a deep selector over a large tree (for example
  `/topdata/**/_ai`) no longer freezes the close button.
- `docdeck README.md` opens the document before the config scan starts; the tab
  no longer waits behind a minutes-long selector walk.
- `docdeck README.md` (a relative path) from a second shell now opens the file
  the caller meant: forwarded CLI arguments are resolved against the sending
  shell's working directory instead of the already-running app's, which
  silently dropped every relative path that did not exist under the app's own
  `cwd`.

### Changed
- CLI folder arguments no longer open a picker or auto-open tabs: a folder adds
  a session watch and its files appear in the inbox; a file argument opens a
  tab. New and modified files are never opened automatically.
- Watcher events are now batched and typed (`paths-changed` carrying
  `{path, exists, modifiedTime}`); the single-instance event is `open-path-cli`
  carrying `{path, is_dir}`.
- `npm test` now runs the Rust suite and the frontend vitest suite in sequence.
- Frontend logic is split into focused modules (`frontmatter`, `toc`,
  `preferences`, `theme`, `toc-panel`, `metadata-table`, `toolbar`, `copy-code`,
  `project`, `relative-time`, `inbox-model`, `inbox-panel`) with `main.ts`
  reduced to orchestration.

### Removed
- Folder picker modal and file tree (`folder-modal`, `file-tree`), the
  `scan_folder` and `watch_folders` commands, and their CSS.

## [0.1.0] - 2026-10-01

### Added
- Tauri v2 desktop application rendering through the native WebKitGTK engine.
- Single-instance CLI: `docdeck <file>` opens a tab in the already-running
  window instead of spawning a second process.
- Debounced `inotify` file watcher (300 ms) that repaints open documents when an
  agent writes to them.
- Tab management with an amber pulsing "unread update" dot on background tabs.
- Layout toggle between a horizontal top tab bar and a vertical left sidebar.
- Auto-sort toggle that bubbles the most recently modified documents to the top.
- GitHub-flavoured Markdown rendering: tables, task lists, syntax highlighting
  and Mermaid diagrams, with scroll position preserved across live reloads.
- `scripts/simulate_agent_writes.sh` end-to-end harness that simulates
  background agent writes.

### Fixed
- Startup documents are no longer lost: arguments are pulled through a
  `startup_paths` command once the webview is listening, replacing a fixed sleep
  that raced the webview's mount.
- Task lists no longer render a bullet alongside each `- [x]` checkbox.
- The toolbar stays flush at the top in sidebar layout.
- WebKitGTK's DMA-BUF renderer is disabled by default. Its GBM buffer modifier
  negotiation is incompatible with the NVIDIA proprietary driver and produced a
  blank white window; `--accelerated` (or `DOCDECK_ACCELERATED=1`) opts back in.

[Unreleased]: https://github.com/marc/docdeck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/marc/docdeck/releases/tag/v0.1.0