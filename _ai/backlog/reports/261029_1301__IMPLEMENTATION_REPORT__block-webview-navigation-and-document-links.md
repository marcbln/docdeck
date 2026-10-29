---
filename: "_ai/backlog/reports/261029_1301__IMPLEMENTATION_REPORT__block-webview-navigation-and-document-links.md"
title: "Report: Block webview navigation and handle document links safely"
createdAt: 2026-10-29 13:01
updatedAt: 2026-10-29 13:35
planFile: "_ai/backlog/active/261029_1301__IMPLEMENTATION_PLAN__block-webview-navigation-and-document-links.md"
specFile: ""
project: "docdeck"
status: completed
filesCreated: 6
filesModified: 10
filesDeleted: 0
tags: [webview, navigation, links, security, tauri, bugfix]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Block webview navigation and handle document links safely

## 1. Summary

Rendered Markdown anchors used to be plain `<a href>` elements that the webview
followed directly, replacing docdeck's UI with a website or a failed load. Two
independent layers now prevent that:

1. A deny-by-default `on_navigation` guard (inline Tauri plugin) cancels every
   navigation that is not docdeck's own origin, so no anchor, script or future
   renderer can replace the app window.
2. One delegated `click`/`auxclick` listener classifies every document link and
   dispatches it explicitly: fragments scroll, `http(s)`/`mailto:` go to the OS
   handler, relative Markdown opens or focuses a tab (with fragment support),
   other local files open in their default application, and unsafe schemes are
   blocked with a toast.

Path resolution lives in Rust (platform-aware, canonicalized); classification
is a pure, unit-tested TypeScript module. OS dispatch uses narrow custom Tauri
commands around `tauri-plugin-opener` free functions, so the opener JS API and
its URL/path ACL scope are never exposed to the webview.

## 2. Files Changed

### Created

| File | Purpose |
| --- | --- |
| `src-tauri/src/navigation.rs` | Pure navigation allowlist (`allows_navigation`). |
| `src-tauri/src/navigation_test.rs` | Tests for app origins, dev server and hostile URLs. |
| `src/links.ts` | Pure href classifier and Markdown-path predicate. |
| `src/links.test.ts` | Classifier tests (external, fragment, mail, local, file URL, blocked). |
| `src/scroll.ts` | Shared `scrollToAnchor` + `SCROLL_OFFSET_PX`. |
| `src/scroll.test.ts` | Shared scroll helper tests. |

### Modified

| File | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Added `tauri-plugin-opener = "2"`. |
| `src-tauri/Cargo.lock` | Lockfile updated by cargo. |
| `src-tauri/src/commands.rs` | Opener import, `ResolvedLink`, three new commands. |
| `src-tauri/src/lib.rs` | Registers `navigation` module, guard plugin and new commands. |
| `src-tauri/src/paths.rs` | Added pure `resolve_link`. |
| `src-tauri/src/paths_test.rs` | Tests for relative/absolute resolution and rejection. |
| `src/main.ts` | Delegated link handling, fragment-aware `openDocument`, awaitable `setActiveTab`. |
| `src/toc-panel.ts` | Uses shared `scrollToAnchor`/`SCROLL_OFFSET_PX`. |
| `README.md` | "Safe links" feature bullet. |
| `CHANGELOG.md` | Fixed entry under `[Unreleased]`. |

### Deleted

None.

## 3. Key Changes

- **Navigation guard:** `navigation_guard()` is registered after the
  single-instance plugin. Production allows `tauri://localhost` and
  `http(s)://tauri.localhost`; development additionally allows
  `http://localhost:1420` / `127.0.0.1:1420`. Everything else is cancelled.
- **Classifier:** `classifyLink` handles empty/bare-hash, fragments,
  protocol-relative, `http(s)`, `mailto:`, `file:`, Windows drive paths and
  blocks unknown schemes. Percent-decoding falls back to raw text on malformed
  escapes.
- **IPC:** `open_external_url` re-validates the scheme in Rust,
  `open_local_path` canonicalizes before dispatch, and `resolve_document_link`
  resolves against the active document's directory.
- **Scroll sequencing:** `openDocument` captures the link's fragment, awaits
  `setActiveTab`, which now awaits `renderActiveContent`, then scrolls. The TOC
  and document links share one `scrollToAnchor` rule.
- **Delegate scope:** bound to `document.body` so Mermaid fullscreen-overlay
  anchors are covered too; controls that already call `preventDefault()` are
  skipped via the `defaultPrevented` check.

## 4. Deviations from Plan

None in behavior or API. Two mechanical notes:

- `src/toc-panel.ts` imports `SCROLL_OFFSET_PX` from `./scroll` because its
  `IntersectionObserver` `rootMargin` still needs the value; only the local
  declaration was removed, as the plan requires.
- The plan's `commands.rs` snippet was applied as an insertion; no naming or
  signature changed.

## 5. Technical Decisions

- `scrollToAnchor` remains synchronous and returns `false` when the heading is
  absent, so a fragment on a missing heading is a silent no-op rather than an
  error toast.
- The delegate captures `this.activePath` before awaiting
  `resolve_document_link`, so a tab switch mid-flight cannot redirect a relative
  link to the wrong base directory.

## 6. Testing Notes

Automated, all passing:

- `npm run typecheck`
- `npm run test:web` — 20 files, 188 tests
- `cd src-tauri && cargo test` — 65 tests (including 3 navigation and 2 link
  resolution tests)
- `npm run lint:rs` — clippy with `-D warnings`
- `npm run check` — typecheck, full test suite and production build without
  bundle

Manual matrix: **not executed interactively.** The plan's click-through matrix
requires a human at the desktop session; this run only smoke-tested startup.
The release binary (`DOCDECK_FOREGROUND=1 ./src-tauri/target/release/docdeck`)
stayed running for 8 seconds with no guard denial or startup error, which
confirms the production origin is allowed and the app shell loads. The
interactive rows (external, fragment, Markdown tab, asset, missing, unsafe,
`mailto:`, ctrl/middle-click, Mermaid anchor) remain to be verified by hand.

## 7. Usage Examples

- `[external](https://example.com)` → system browser; docdeck keeps its UI.
- `[fragment](#target-heading)` → scrolls in the current document.
- `[markdown](./other.md)` → opens or focuses a tab.
- `[markdown-fragment](./other.md#other-heading)` → opens/focuses and scrolls
  after render.
- `[image](./diagram.png)` → OS default application.
- `[missing](./does-not-exist.md)` → error toast.
- `[script](javascript:alert(1))` → blocked toast.
- `[mail](mailto:test@example.com)` → OS mail handler.
- `file://` URLs and absolute local paths follow the same local rules.

## 8. Documentation Updates

- `README.md`: added the "Safe links" feature bullet after "GitHub-flavoured
  Markdown".
- `CHANGELOG.md`: added the fix under `[Unreleased]` → `### Fixed`.
- `_ai/technical_decisions/README.md`: ADR `261029-1` row present.

## 9. Next Steps

- Run the manual click-through matrix from Phase 4 on a real desktop session and
  record any guard denial (a denial means a link source bypassed the delegate).
- Relative `<img src>` rendering is still unsolved and remains a separate
  problem; document links now resolve, but image sources are not rewritten.
- Consider an acceptance test around the delegated listener once the UI surface
  stabilises.
