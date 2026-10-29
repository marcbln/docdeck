---
title: Block webview navigation and dispatch document links explicitly
status: Accepted
date: 2026-10-29
deciders: docdeck maintainer
tags: [webview, navigation, links, security, tauri]
adrId: 261029-1
---

# Block webview navigation and dispatch document links explicitly

## Context

Rendered Markdown anchors are plain `<a href>` elements produced by `marked` and
written with `innerHTML`; nothing intercepts their clicks. Tauri's webview
therefore follows the href and replaces docdeck's `index.html` with the target
page — for external URLs, a website with no way back; for relative files, a
failed load. The app shell, tabs, watchers and scroll state are gone, and the
only recovery is restarting docdeck.

Links arrive in several shapes: `http(s)` URLs, `mailto:`, same-document
`#fragments`, relative Markdown files, relative assets (PDF, images), absolute
local paths and hostile schemes such as `javascript:`. Rendered content can also
come from Mermaid SVGs, and future renderers will add more anchor sources, so a
per-element fix would keep regressing.

## Decision

The docdeck webview never navigates. A `TauriPlugin::on_navigation` guard
installed at startup allows only the application's own origin (the production
`tauri://localhost`/platform equivalent and the Vite dev origin) and cancels
every other navigation, regardless of what triggered it.

Link clicks are dispatched explicitly by one delegated `click` listener on the
Markdown viewer. It always calls `preventDefault()` and classifies the href:

- Same-document `#fragment` scrolls within the current document.
- `http(s)` and `mailto:` are opened by the OS default handler.
- Relative and absolute local targets are resolved against the active
  document's directory (percent-decoded, canonicalized) by a Rust command.
  `.md`/`.markdown` opens or focuses a docdeck tab, then scrolls to any fragment;
  other existing files open with the OS default application; missing targets
  show a toast.
- `javascript:`, `data:`, `blob:`, `vbscript:` and unknown schemes are blocked
  with a toast.

OS dispatch goes through narrow custom Tauri commands (`open_url`,
`open_path`) that call `tauri-plugin-opener`'s Rust free functions. The opener
JS API is not exposed to the webview, so the Tauri ACL remains `core:default`
instead of granting a URL/path scope to page JavaScript. Ctrl-click and
middle-click follow the same rules; they never navigate.

## Consequences

Positive:
- The unrecoverable blank/foreign webview state becomes impossible, including
  for anchors the editor code does not know about.
- Link classification is pure TypeScript testable in vitest; path resolution and
  the navigation guard are testable in Rust.
- Relative Markdown links become first-class navigation inside docdeck.
- No new frontend permissions or broad opener scope.

Negative:
- docdeck owns link classification and path resolution that a browser would
  otherwise provide; new link kinds require explicit support.
- `target="_blank"` / new-window semantics are intentionally not supported;
  everything is either system-handled or in-app.
- OS handler failures (no default browser, missing association) must be surfaced
  by docdeck.
- Relative `<img src>` rendering remains a separate, unsolved problem.

## Alternatives Considered

- **`target="_blank"` plus the opener JS plugin on rendered anchors.** Rejected:
  it does not solve relative `.md` tabs or fragment scrolling, leaves untagged
  anchors and scripts free to navigate, and grants the webview a broad
  URL/path ACL scope.
- **Rust-only `on_navigation` interception.** Rejected: it cannot open relative
  Markdown as a tab or preserve in-document fragment scrolling; classification
  would still have to happen in the frontend.
- **Let the webview navigate and add back/reload controls.** Rejected: destroys
  SPA state, watchers and scroll position, and treats arbitrary websites as part
  of the app.
- **A custom asset protocol or `<base>` tag for relative files.** Rejected:
  larger attack surface, and it addresses only relative assets, not external
  links, hostile schemes or tab navigation.

## Related Decisions

- [261024-2](ADR__261024-2__custom-html-context-menu.md) — same preference for
  frontend-owned, testable in-app behavior over native/webview defaults.
