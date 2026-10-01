# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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