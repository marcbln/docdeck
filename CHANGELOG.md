# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

### Changed
- `npm test` now runs the Rust suite and the frontend vitest suite in sequence.
- Frontend logic is split into focused modules (`frontmatter`, `toc`,
  `preferences`, `theme`, `toc-panel`, `metadata-table`, `toolbar`) with
  `main.ts` reduced to orchestration.

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