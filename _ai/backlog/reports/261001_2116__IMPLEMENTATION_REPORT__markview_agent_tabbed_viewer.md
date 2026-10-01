---
filename: "_ai/backlog/reports/261001_2116__IMPLEMENTATION_REPORT__markview_agent_tabbed_viewer.md"
title: "Report: docdeck — Tabbed Agent Document Monitor"
createdAt: 2026-10-01 21:16
updatedAt: 2026-10-01 22:40
planFile: "_ai/backlog/active/261001_2116__IMPLEMENTATION_PLAN__markview_agent_tabbed_viewer.md"
project: "docdeck"
status: completed
filesCreated: 11
filesModified: 3
filesDeleted: 2
tags: [rust, tauri-v2, webkitgtk, markdown, inotify, cli, tabs]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: docdeck

## 1. Summary

Built **docdeck**, a lightweight Linux Markdown viewer for monitoring AI agent
document output. Tauri v2 + Rust backend with WebKitGTK, debounced `inotify`
watching, single-instance CLI, tab state machine with unread indicators, and
toggleable top/sidebar layouts.

Every feature in the plan was implemented and then **verified by launching the
release binary and driving the real GUI**. That surfaced three defects that
static checks could not have caught (see §5).

> **Naming:** the plan called the product *MarkView*. Per the repository owner
> the project is **docdeck**, so the product name, binary, package, Cargo crate,
> Tauri identifier and titles were all changed to `docdeck` and the app was
> created at the repository root rather than in a `markview/` subdirectory.
> Functional scope is unchanged.

## 2. Files Changed

### New files (11)

| File | Purpose |
| --- | --- |
| `index.html` | App shell: toolbar, tab bar, document pane, empty state |
| `src/main.ts` | `AppState` — tab registry, CLI/watcher event handling, rendering |
| `src/markdown.ts` | marked + highlight.js + mermaid pipeline, scroll preservation |
| `src/style.css` | Catppuccin dark theme, both layouts, unread-dot animation |
| `src-tauri/src/watcher.rs` | Debounced watcher + watch registry (`WatcherState`) |
| `src-tauri/src/commands.rs` | `load_file` / `close_file` commands, `FilePayload` |
| `src-tauri/src/lib.rs` | Builder, single-instance IPC, `startup_paths` command |
| `src-tauri/src/watcher_test.rs` | 4 unit tests for watch registry lifecycle |
| `scripts/simulate_agent_writes.sh` | End-to-end agent-write simulation harness |
| `package.json` | npm manifest + `typecheck`/`test`/`lint:rs`/`simulate` scripts |
| `vite.config.ts`, `tsconfig.json`, `package-lock.json`, `.vscode/` | Scaffold/tooling |

### Modified files (3)

- **`src-tauri/Cargo.toml`** — crate renamed to `docdeck`; added
  `tauri-plugin-single-instance`, `notify`, `notify-debouncer-mini`, `tokio`;
  `tempfile` dev-dependency for tests.
- **`src-tauri/tauri.conf.json`** — product name/identifier/window title →
  `docdeck`; window sized 1100×800 with sensible minimums.
- **`.gitignore`** — merged Rust/Cargo (`/src-tauri/target/`), Tauri schema and
  Vite entries into the repo's existing Python/IDE/OS rules.
- **`README.md` / `CHANGELOG.md`** — rewritten for docdeck.

### Deleted (2)

- `src/styles.css`, `src/assets/` — Tauri template boilerplate.
- `@tauri-apps/plugin-opener` — unused; removing it also removed the
  `opener:default` permission from `src-tauri/capabilities/default.json`.

## 3. Key Changes

- **Single-instance CLI.** `tauri-plugin-single-instance` is registered first so
  the IPC socket exists before anything else. A second `docdeck <file>` emits
  `open-file-cli` into the running window and focuses it.
- **Debounced watching.** `notify-debouncer-mini` with a 300 ms window; the
  watcher registry is deduplicated and refcounted by canonical path so re-opening
  a tab never double-watches.
- **Deterministic startup handshake.** The frontend registers listeners, then
  pulls launch arguments via a `startup_paths` command.
- **Tab state machine.** Tabs keyed by canonical path; `hasUnreadUpdate` is set
  only for background tabs and cleared on activation.
- **Reload ordering guard.** A monotonic token per document discards superseded
  reads so a slow read cannot overwrite a newer one.

## 4. Deviations from the Plan

| # | Plan said | Implemented | Why |
| --- | --- | --- | --- |
| 1 | Product named *MarkView* in a `markview/` subfolder | *docdeck* at repo root | Repository owner's instruction |
| 2 | First-launch args emitted after a 500 ms sleep | `startup_paths` command the frontend calls after registering listeners | The sleep **silently dropped the arguments** — see §5.1 |
| 3 | Flexbox shell with `flex-wrap` | CSS Grid with named areas | The flex layout **pushed the toolbar 170 px down the window** in sidebar mode — see §5.3 |
| 4 | `mermaid` theme `"dark"` | `theme: "base"` + explicit Catppuccin `themeVariables` | Mermaid's stock dark theme was being ignored, producing low-contrast nodes |
| 5 | `import hljs from "highlight.js"` | `highlight.js/lib/common` | Cut the main bundle from 1137 kB to 371 kB |
| 6 | `marked` output used directly | Post-parse pass adds `task-list-item` | marked v18 emits no list-style hook, so tasks rendered bullet **and** checkbox — see §5.2 |
| 7 | Scroll position preserved by pixel offset | Tail-sticky: a reader at the bottom stays pinned, others keep position | Preserving raw pixels yanks a mid-document reader down on every agent append |
| 8 | `close_file` used the raw path | Canonicalizes before unwatching | `watch_file` registers canonical paths; a mismatch leaks the watch |
| 9 | 1 unit test | 4 unit tests | Covers idempotent watch, untracked unwatch, multi-document isolation |
| 10 | `/tmp/agent_*.md` in `.gitignore` | Dropped | A leading `/` anchors to the repo root; the pattern can never match |

## 5. Defects Found by Runtime Testing

Static checks (`cargo clippy -D warnings`, `cargo fmt --check`, `tsc --noEmit`,
`cargo test`) were all green before the app was ever launched. Launching the
release binary and screenshotting the real window found three real bugs.

### 5.1 Launch arguments were silently dropped

The plan emitted `open-file-cli` after a fixed 500 ms sleep. The webview took
longer than that to mount, so **no tabs opened at all** — `docdeck a.md b.md`
showed the empty state. A screenshot made this obvious immediately.

Replaced with a `startup_paths` command the frontend invokes *after* its
listeners are attached, which removes the race entirely.

### 5.2 Task lists rendered bullet and checkbox

marked v18 emits `<li><p><input type="checkbox">…</p></li>` with no
`task-list-item` class, which GitHub's CSS relies on. Result: every `- [x]` item
showed a bullet *and* a checkbox. Fixed by tagging those `<li>` elements after
parse, and collapsing the loose-list `<p>`.

### 5.3 Sidebar layout displaced the toolbar

`flex-wrap` splits the shell into two flex *lines*. With free space on the cross
axis, the default `align-content: stretch` inflated the header's line, pushing
the toolbar ~170 px down and leaving a dead band at the top. Replaced with CSS
Grid and named areas, which have no free space to redistribute.

## 6. Technical Decisions

- **WebKitGTK via Tauri, not Electron** — keeps the process well under the plan's
  memory ceiling; the release binary is **6.7 MB**.
- **Vanilla TypeScript, no framework** — tab state is a few hundred lines; a
  framework would add hydration cost for no benefit.
- **Listeners before startup fetch** — the whole class of "event fired too
  early" bugs disappears when the consumer asks for state instead of being told.
- **Grid over flex for the shell** — two stable shapes (row/column) with a
  full-width toolbar; grid areas express this directly and cannot be stretched
  out of alignment by free space.
- **Mermaid pinned to `^11`** — v12 pulls a `chevrotain` → `lodash-es` chain with
  two high-severity advisories. `npm audit` reports **0 vulnerabilities**.
- **Grammars limited to `highlight.js/lib/common`** — ~40 languages covers agent
  documents; the full bundle is ~1 MB of rarely-used grammars.

## 7. Testing Notes

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | 4 passed, 0 failed |
| Rust formatting | `cargo fmt --check` | clean |
| Rust lints | `npm run lint:rs` | clean with `-D warnings` |
| TypeScript | `npm run typecheck` | clean |
| Dependency audit | `npm audit` | 0 vulnerabilities |
| Release build | `npm run tauri build -- --no-bundle` | binary at `src-tauri/target/release/docdeck` |

**Manual GUI verification** (release binary, real X display, `import`
screenshots): launch with two files → both tabs open; background appends to the
inactive tab → amber dot appears; activating the tab → dot clears and new lines
render; Auto-Sort → tabs reorder by mtime; Layout toggle → sidebar renders with
the toolbar flush at top; second `docdeck` invocation → opens a third tab in the
**same** window, process count stays at 1; task lists, syntax highlighting and
Mermaid all render correctly.

> On this VM's software renderer WebKitGTK logs `Failed to create GBM buffer`
> and paints a blank window. Reproducing with
> `WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1` works. This
> is a display-stack limitation, not an application defect — documented in the
> README.

## 8. Documentation Updates

- `README.md` — features, build/install, CLI usage, architecture, and known
  limitations (including the software-rendering workaround).
- `CHANGELOG.md` — `0.1.0` entry describing all added capabilities.
- `.gitignore` — Rust/Tauri/Vite entries merged into the existing rules.

## 9. Known Limitations

- **Linux only** — depends on `inotify` and WebKitGTK.
- **Inode-level watches** — an agent that replaces a file via
  write-temp-then-rename invalidates the watch; the tab must be reopened. In-place
  writes and appends are unaffected.
- **Read-only** — renders markdown, never writes to it.
- **No frontend test suite** — the tab state machine is plain TypeScript and would
  benefit from unit tests once it grows.

## 10. Next Steps

1. Watch directories instead of individual files so atomic renames survive.
2. Add keyboard shortcuts (`Ctrl+W` close tab, `Ctrl+T` next tab).
3. Search across open tabs (`Ctrl+Shift+F`).
4. Inline diffing of changed blocks between reloads.