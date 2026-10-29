---
filename: "_ai/backlog/active/261029_1301__IMPLEMENTATION_PLAN__block-webview-navigation-and-document-links.md"
title: "Block webview navigation and handle document links safely"
createdAt: 2026-10-29 13:01
updatedAt: 2026-10-29 13:01
status: completed
completedAt: 2026-10-29 13:38
priority: high
tags: [webview, navigation, links, security, tauri, bugfix]
estimatedComplexity: moderate
documentRevision: 1
sourceSpec: ""
sourceHandoff: ""
sourceAdrs: ["_ai/technical_decisions/ADR__261029-1__block-webview-navigation-and-dispatch-links-explicitly.md"]
documentType: IMPLEMENTATION_PLAN
---

# Implementation Plan: Block webview navigation and handle document links safely

**Sources:** design discussion in the current conversation plus ADR
`261029-1`; no feature spec or design handoff exists for this work.

## 1. Problem

Rendered Markdown anchors are plain `<a href>` elements produced by `marked`
and written into `#markdown-viewer` with `innerHTML`. Nothing intercepts their
clicks and the Tauri window has no `on_navigation` guard, so the webview follows
the href. An external link replaces docdeck's UI with a website; a relative link
attempts a failed load. Tabs, watchers, scroll position and the app shell are
lost, and the only recovery is restarting docdeck.

This plan implements the accepted decision in
`ADR__261029-1__block-webview-navigation-and-dispatch-links-explicitly.md`:
docdeck never navigates its webview, and every document link is classified and
dispatched explicitly.

## 2. Executive Summary

Add a two-layer defence:

1. A frontend delegate classifies every anchor click before the browser acts.
   Fragments scroll in place, external URLs and `mailto:` go to the OS handler,
   relative Markdown links open or focus a docdeck tab (with fragment support),
   other local files open in the OS default application, and unsafe schemes are
   blocked with a toast.
2. A Rust navigation guard cancels every webview navigation whose URL is not
   docdeck's own origin, so even an anchor or script that bypasses the frontend
   cannot replace the app window.

Path resolution is done in Rust (platform-aware, canonicalized) while link
classification stays a pure, unit-tested TypeScript module. OS dispatch uses
narrow custom Tauri commands around `tauri-plugin-opener` free functions; the
opener JS API and its URL/path ACL scope are never exposed to the webview.

## 3. Design Decisions & Rejected Alternatives

| Decision | Rationale | Source |
| --- | --- | --- |
| Deny-by-default `on_navigation` guard registered as an inline Tauri plugin | Guarantees no click, script or future renderer can replace the app shell | [ADR 261029-1](../../technical_decisions/ADR__261029-1__block-webview-navigation-and-dispatch-links-explicitly.md) |
| One delegated click/auxclick listener; always `preventDefault()` | Survives live reloads, Mermaid SVGs and future anchor sources without rebinding | ADR 261029-1 |
| Bind the delegate to `document.body` rather than only the viewer | The fullscreen Mermaid overlay is moved outside the viewer; the ADR's single-delegate invariant still holds and the extra coverage closes that gap | Conversation |
| Classify links in pure `src/links.ts`; resolve paths in Rust | Classification is cheap and vitest-testable; path handling needs platform rules and canonicalization | ADR 261029-1 |
| OS dispatch through custom `open_external_url` / `open_local_path` commands wrapping opener free functions | Keeps Tauri ACL at `core:default`; no broad URL/path scope handed to page JavaScript | ADR 261029-1 |
| Relative `.md` / `.markdown` links open a tab; other local files use the OS default app | Matches how docdeck treats documents versus assets | Conversation |
| Missing targets and unsafe schemes produce an error toast | Silent failure makes a broken link look like a dead app | Conversation |
| Extract `scrollToAnchor` so the TOC and document links share one scroll rule | Prevents the sticky-header offset from drifting between two copies | Conversation |
| Make `setActiveTab` await its render so a fragment scroll happens after paint | Fragment jumps otherwise target not-yet-rendered elements | Conversation |

Rejected alternatives:

- **`target="_blank"` plus the opener JS plugin.** Dropped: it does not handle
  relative `.md` tabs or fragments, leaves untagged anchors free to navigate,
  and grants a broad ACL scope.
- **Rust-only `on_navigation` interception.** Dropped: it cannot open relative
  Markdown as tabs or dispatch link types; classification is still needed.
- **Let the webview navigate and add back/reload controls.** Dropped: destroys
  SPA state, watchers and scroll, and treats arbitrary websites as app content.
- **A custom asset protocol or `<base>` tag.** Dropped: larger attack surface
  and does not cover external links, hostile schemes or tab navigation.
- **Opening every local target with the OS handler.** Dropped: Markdown files
  belong in docdeck tabs; handing them to a browser or editor would be a
  regression.

## 4. Project Environment

- **Frontend:** TypeScript (strict, ES2020, no unused locals/parameters), Vite,
  Vitest with happy-dom.
- **Backend:** Rust (edition 2021), Tauri 2, `tauri-plugin-opener` 2.
- **Package manager:** npm with the committed `package-lock.json`.
- **Repository conventions:** `_ai/conventions.md` (generated by `ruleman`),
  `AGENTS.md`. There are no branch or PR steps in this plan; follow the
  repository's git conventions and do not create topic branches or pull
  requests unless explicitly asked later.
- **Verification commands:**
  - `npm run typecheck`
  - `npm run test:web`
  - `cd src-tauri && cargo test`
  - `npm run lint:rs`
  - `npm run check` (full typecheck, tests and production build without bundle)
- **Platform note:** Automated tests cover URL/path rules on every platform.
  Manual click-through verification happens on Linux/WebKitGTK; Windows and
  macOS behavior is covered by the opener crate and the navigation tests.
- **Executor:** an AI coding agent. The code blocks are prescriptive; each
  phase must leave the repository green before the next phase starts.

## 5. Implementation Phases

### Phase 1 — Backend: navigation guard, opener commands, link resolution

**Goal:** make webview navigation impossible and expose narrow IPC for OS
dispatch and path resolution.

#### [MODIFY] `src-tauri/Cargo.toml`

Add the opener dependency next to the other Tauri plugins:

```toml
tauri = { version = "2", features = [] }
tauri-plugin-single-instance = "2"
tauri-plugin-opener = "2"
```

`Cargo.lock` will be updated by the first `cargo` command and must be included
with the change. Do not commit unless the user explicitly asks.

#### [NEW FILE] `src-tauri/src/navigation.rs`

```rust
//! Navigation policy for the docdeck webview.
//!
//! Rendered documents may contain links that no frontend handler sees (Mermaid
//! SVGs, future renderers, injected content). The webview must therefore never
//! be allowed to leave the application origin.

/// Whether the webview may navigate to `url`.
///
/// Production uses the Tauri protocol on Linux/macOS and
/// `http(s)://tauri.localhost` on Windows. Development additionally allows the
/// fixed Vite server. Everything else is denied.
pub fn allows_navigation(url: &tauri::Url, dev: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost" | "127.0.0.1")) if dev => url.port() == Some(1420),
        _ => false,
    }
}
```

#### [NEW FILE] `src-tauri/src/navigation_test.rs`

```rust
use crate::navigation::allows_navigation;
use tauri::Url;

fn parsed(raw: &str) -> Url {
    Url::parse(raw).unwrap()
}

#[test]
fn app_origins_are_allowed_in_production() {
    assert!(allows_navigation(
        &parsed("tauri://localhost/index.html"),
        false
    ));
    assert!(allows_navigation(
        &parsed("http://tauri.localhost/index.html"),
        false
    ));
}

#[test]
fn dev_server_is_allowed_only_in_dev() {
    assert!(allows_navigation(&parsed("http://localhost:1420/"), true));
    assert!(allows_navigation(&parsed("http://127.0.0.1:1420/"), true));
    assert!(!allows_navigation(&parsed("http://localhost:1420/"), false));
    assert!(!allows_navigation(&parsed("http://localhost:5173/"), true));
}

#[test]
fn external_and_hostile_urls_are_blocked() {
    for raw in [
        "https://example.com/",
        "http://localhost:8080/",
        "mailto:a@example.com",
        "javascript:alert(1)",
        "data:text/html,x",
    ] {
        assert!(!allows_navigation(&parsed(raw), false), "{raw}");
    }
}
```

#### [MODIFY] `src-tauri/src/paths.rs`

Add a pure resolver next to `is_markdown`. It must stay free of Tauri and
watcher types so it can be unit tested:

```rust
/// Resolves a document-relative link against the directory of `base_file`.
///
/// The caller supplies an already percent-decoded target. Canonicalization
/// normalizes `..` segments and proves the target exists.
pub fn resolve_link(base_file: &Path, raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("empty link target".to_string());
    }

    let candidate = Path::new(raw);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        let parent = base_file
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", base_file.display()))?;
        parent.join(candidate)
    };

    joined
        .canonicalize()
        .map_err(|error| format!("cannot resolve {}: {error}", joined.display()))
}
```

#### [MODIFY] `src-tauri/src/paths_test.rs`

Extend the import list and add two tests:

```rust
use crate::paths::{
    classify_args, expand_tilde, has_ignored_component_below, is_ignored_name, is_markdown,
    is_noise_name, is_relevant, is_under, modified_millis, resolve_link, ExcludeSet,
};
```

```rust
#[test]
fn links_resolve_against_the_document_directory() {
    let dir = tempdir().unwrap();
    let docs = dir.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    let base = docs.join("plan.md");
    fs::write(&base, "# plan").unwrap();
    let sibling = docs.join("notes.md");
    fs::write(&sibling, "# notes").unwrap();
    let assets = dir.path().join("assets");
    fs::create_dir_all(&assets).unwrap();
    let asset = assets.join("diagram.png");
    fs::write(&asset, "png").unwrap();

    assert_eq!(
        resolve_link(&base, "notes.md").unwrap(),
        sibling.canonicalize().unwrap()
    );
    assert_eq!(
        resolve_link(&base, "../assets/diagram.png").unwrap(),
        asset.canonicalize().unwrap()
    );
    assert_eq!(
        resolve_link(&base, &asset.to_string_lossy()).unwrap(),
        asset.canonicalize().unwrap()
    );
}

#[test]
fn missing_and_empty_link_targets_are_rejected() {
    let dir = tempdir().unwrap();
    let base = dir.path().join("plan.md");
    fs::write(&base, "# plan").unwrap();

    assert!(resolve_link(&base, "missing.md").is_err());
    assert!(resolve_link(&base, "").is_err());
}
```

#### [MODIFY] `src-tauri/src/commands.rs`

Add the opener import at the top:

```rust
use tauri_plugin_opener::{open_path, open_url};
```

Add the result type and commands near `load_file`:

```rust
/// Result of resolving a relative link against the active document.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLink {
    pub path: String,
    pub is_dir: bool,
}

/// Opens an external URL with the OS default handler.
///
/// The frontend has already classified the link; re-checking the scheme here
/// keeps this command from becoming a general-purpose opener if the webview is
/// ever compromised.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|error| format!("invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => {}
        scheme => return Err(format!("blocked URL scheme: {scheme}")),
    }

    open_url(url, None::<&str>).map_err(|error| format!("cannot open URL: {error}"))
}

/// Opens an existing local file or directory with its default application.
#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("cannot resolve path: {error}"))?;

    open_path(canonical, None::<&str>).map_err(|error| format!("cannot open path: {error}"))
}

/// Resolves a document-relative link to a canonical absolute path.
#[tauri::command]
pub fn resolve_document_link(base_file: String, href: String) -> Result<ResolvedLink, String> {
    let resolved = crate::paths::resolve_link(Path::new(&base_file), &href)?;

    Ok(ResolvedLink {
        is_dir: resolved.is_dir(),
        path: resolved.to_string_lossy().into_owned(),
    })
}
```

#### [MODIFY] `src-tauri/src/lib.rs`

Register the new module and its test module:

```rust
mod commands;
mod config;
mod detach;
mod folder;
mod navigation;
mod paths;
mod render;
mod watcher;

#[cfg(test)]
mod config_test;
#[cfg(test)]
mod folder_test;
#[cfg(test)]
mod navigation_test;
#[cfg(test)]
mod paths_test;
#[cfg(test)]
mod render_test;
#[cfg(test)]
mod watcher_test;
```

Add the guard factory and register it after the single-instance plugin (which
must remain first), plus the new commands:

```rust
/// Cancels every webview navigation that leaves docdeck's own origin.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let dev = tauri::is_dev();
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(move |_webview, url| navigation::allows_navigation(url, dev))
        .build()
}
```

```rust
    builder = builder.plugin(navigation_guard());

    builder
        .manage(watcher_state)
        .setup(|app| {
            app.state::<WatcherState>()
                .init(app.handle().clone())
                .map_err(io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file,
            commands::close_file,
            commands::load_watches,
            commands::add_watch,
            commands::open_external_url,
            commands::open_local_path,
            commands::resolve_document_link,
            startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running docdeck application");
```

**Phase 1 verification:** `cd src-tauri && cargo test` and `npm run lint:rs`.
Both must pass before touching the frontend.

### Phase 2 — Frontend: link classifier and shared scroll helper

**Goal:** classify hrefs without touching the DOM or the filesystem, and give
the TOC and link dispatch one scroll implementation.

#### [NEW FILE] `src/links.ts`

```ts
/**
 * Classification of one href found in rendered Markdown.
 *
 * Filesystem resolution is deliberately not done here: it needs platform-aware
 * path handling and is owned by the Rust `resolve_document_link` command.
 */
export type LinkTarget =
  | { kind: "empty" }
  | { kind: "fragment"; fragment: string }
  | { kind: "external"; url: string }
  | { kind: "mailto"; url: string }
  | { kind: "local"; path: string; fragment: string | null }
  | { kind: "blocked"; reason: string };

/** A local target after the Rust resolver has canonicalized it. */
export interface ResolvedLink {
  path: string;
  isDir: boolean;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

/** Decodes an href component, falling back to the raw text on malformed input. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits a raw relative href into a decoded path and fragment. */
function classifyLocalPath(raw: string): LinkTarget {
  const hashIndex = raw.indexOf("#");
  const fragment =
    hashIndex >= 0 ? decode(raw.slice(hashIndex + 1)) || null : null;
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;

  const queryIndex = withoutFragment.indexOf("?");
  const rawPath =
    queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const path = decode(rawPath);

  return path === ""
    ? { kind: "blocked", reason: "empty path" }
    : { kind: "local", path, fragment };
}

/** Converts a `file:` URL into the local path the resolver expects. */
function classifyFileUrl(raw: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "blocked", reason: "malformed file URL" };
  }

  let path = decode(url.pathname);
  // URL pathnames serialize Windows drives as `/C:/...`.
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
  // Preserve UNC hosts for the OS handler.
  if (url.hostname !== "" && url.hostname !== "localhost") {
    path = `//${url.hostname}${path}`;
  }

  const fragment = url.hash === "" ? null : decode(url.hash.slice(1)) || null;
  return { kind: "local", path, fragment };
}

/**
 * Classifies one rendered href.
 *
 * Same-document fragments scroll, http(s)/mailto go to the OS handler, local
 * paths are resolved later against the active document, and everything else is
 * blocked with a reason suitable for a toast.
 */
export function classifyLink(rawHref: string): LinkTarget {
  const href = rawHref.trim();
  if (href === "" || href === "#") return { kind: "empty" };

  if (href.startsWith("#")) {
    return { kind: "fragment", fragment: decode(href.slice(1)) };
  }

  // Protocol-relative links inherit the page scheme in a browser; docdeck
  // always chooses https for a desktop viewer.
  if (href.startsWith("//")) {
    return { kind: "external", url: `https:${href}` };
  }

  const match = SCHEME.exec(href);
  if (match !== null && !WINDOWS_DRIVE.test(href)) {
    const scheme = match[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      return { kind: "external", url: href };
    }
    if (scheme === "mailto") return { kind: "mailto", url: href };
    if (scheme === "file") return classifyFileUrl(href);
    return { kind: "blocked", reason: `unsupported scheme "${scheme}:"` };
  }

  return classifyLocalPath(href);
}

/** Whether a resolved path should open as a docdeck document tab. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
```

#### [NEW FILE] `src/links.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { classifyLink, isMarkdownPath } from "./links";

describe("classifyLink", () => {
  it("keeps external URLs untouched", () => {
    expect(classifyLink("https://example.com/a?b=1#c")).toEqual({
      kind: "external",
      url: "https://example.com/a?b=1#c",
    });
    expect(classifyLink("//example.com/x")).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
  });

  it("separates fragments, mail and local paths", () => {
    expect(classifyLink("#intro")).toEqual({
      kind: "fragment",
      fragment: "intro",
    });
    expect(classifyLink("#sec%20tion")).toEqual({
      kind: "fragment",
      fragment: "sec tion",
    });
    expect(classifyLink("mailto:a@example.com")).toEqual({
      kind: "mailto",
      url: "mailto:a@example.com",
    });
    expect(classifyLink("./other.md#part")).toEqual({
      kind: "local",
      path: "./other.md",
      fragment: "part",
    });
    expect(classifyLink("../assets/diagram.png?raw=1")).toEqual({
      kind: "local",
      path: "../assets/diagram.png",
      fragment: null,
    });
  });

  it("treats absolute and Windows paths as local", () => {
    expect(classifyLink("/home/marc/doc.md")).toEqual({
      kind: "local",
      path: "/home/marc/doc.md",
      fragment: null,
    });
    expect(classifyLink("C:\\docs\\plan.md")).toEqual({
      kind: "local",
      path: "C:\\docs\\plan.md",
      fragment: null,
    });
  });

  it("converts file URLs to local paths", () => {
    expect(classifyLink("file:///home/marc/a%20b/doc.md#top")).toEqual({
      kind: "local",
      path: "/home/marc/a b/doc.md",
      fragment: "top",
    });
    expect(classifyLink("file:///C:/Users/marc/doc.md")).toEqual({
      kind: "local",
      path: "C:/Users/marc/doc.md",
      fragment: null,
    });
  });

  it("blocks unsafe and unknown schemes", () => {
    expect(classifyLink("javascript:alert(1)").kind).toBe("blocked");
    expect(classifyLink("data:text/html,x").kind).toBe("blocked");
    expect(classifyLink("ftp://example.com/x").kind).toBe("blocked");
  });

  it("treats empty, bare-hash and malformed-escape links predictably", () => {
    expect(classifyLink("")).toEqual({ kind: "empty" });
    expect(classifyLink("  #  ")).toEqual({ kind: "empty" });
    expect(classifyLink("./100%.md")).toEqual({
      kind: "local",
      path: "./100%.md",
      fragment: null,
    });
  });
});

describe("isMarkdownPath", () => {
  it("accepts md and markdown case-insensitively", () => {
    expect(isMarkdownPath("/a/plan.md")).toBe(true);
    expect(isMarkdownPath("/a/PLAN.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("/a/plan.txt")).toBe(false);
  });
});
```

#### [NEW FILE] `src/scroll.ts`

```ts
/** Offset in px used when jumping to a heading, clearing the sticky header. */
export const SCROLL_OFFSET_PX = 12;

/**
 * Scrolls `scrollParent` so the element with `id` sits below the sticky header.
 * Returns false when the target is not in the document.
 */
export function scrollToAnchor(scrollParent: HTMLElement, id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;

  const top =
    target.getBoundingClientRect().top -
    scrollParent.getBoundingClientRect().top +
    scrollParent.scrollTop -
    SCROLL_OFFSET_PX;

  scrollParent.scrollTo({ top, behavior: "smooth" });
  return true;
}
```

#### [NEW FILE] `src/scroll.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollToAnchor, SCROLL_OFFSET_PX } from "./scroll";

describe("scrollToAnchor", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("returns false when the target does not exist", () => {
    const pane = document.createElement("div");
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo;

    expect(scrollToAnchor(pane, "missing")).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls the pane with the sticky-header offset", () => {
    document.body.innerHTML = '<h2 id="target">Target</h2>';
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const target = document.getElementById("target");
    if (!target) throw new Error("test fixture missing");

    target.getBoundingClientRect = () => ({ top: 120 } as DOMRect);
    pane.getBoundingClientRect = () => ({ top: 20 } as DOMRect);
    Object.defineProperty(pane, "scrollTop", { value: 7, writable: true });
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo;

    expect(scrollToAnchor(pane, "target")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 120 - 20 + 7 - SCROLL_OFFSET_PX,
      behavior: "smooth",
    });
  });
});
```

#### [MODIFY] `src/toc-panel.ts`

Replace the local offset constant and private scroll math with the shared
helper. Keep the scroll-spy update that follows a successful jump:

```ts
import type { Heading } from "./toc";
import { scrollToAnchor } from "./scroll";

// ... existing METADATA_ANCHOR_ID and METADATA_LABEL constants ...
```

```ts
  private scrollTo(slug: string): void {
    if (scrollToAnchor(this.options.scrollParent, slug)) this.setActive(slug);
  }
```

Delete `SCROLL_OFFSET_PX` from `src/toc-panel.ts`; it now lives in
`src/scroll.ts`.

**Phase 2 verification:** `npm run typecheck` and `npm run test:web`.

### Phase 3 — Wire link dispatch into the app

**Goal:** connect classification to IPC, tabs and toast feedback, and make
fragment scrolling deterministic after a tab render.

#### [MODIFY] `src/main.ts`

Add imports:

```ts
import { classifyLink, isMarkdownPath, type ResolvedLink } from "./links";
import { scrollToAnchor } from "./scroll";
```

Add a small error formatter near `must` so IPC rejections and real errors read
the same way:

```ts
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

Call the new binding from the constructor after `this.bindControls()`:

```ts
    this.applyPreferencesToUi();
    this.bindControls();
    this.bindLinkHandling();
```

Add the delegated handler and dispatcher:

```ts
  /**
   * Dispatches every document link instead of letting the webview navigate.
   *
   * Bound to `body` so it also covers anchors in the Mermaid fullscreen
   * overlay, which is moved outside the viewer. Controls that already handle
   * their own clicks (for example TOC links) call `preventDefault()` first and
   * are skipped by the `defaultPrevented` check.
   */
  private bindLinkHandling(): void {
    const activate = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button === 2) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      event.preventDefault();
      void this.handleLink(anchor.getAttribute("href") ?? "");
    };

    // `click` covers the primary button; `auxclick` covers middle-click in
    // WebKitGTK. Both follow the same rules: never navigate.
    document.body.addEventListener("click", activate);
    document.body.addEventListener("auxclick", activate);
  }

  private async handleLink(rawHref: string): Promise<void> {
    const target = classifyLink(rawHref);

    switch (target.kind) {
      case "empty":
        return;
      case "fragment":
        scrollToAnchor(this.contentContainer, target.fragment);
        return;
      case "blocked":
        this.toast.show(`Blocked link: ${target.reason}`, "error");
        return;
      case "external":
      case "mailto":
        try {
          await invoke("open_external_url", { url: target.url });
        } catch (error) {
          this.toast.show(
            `Could not open link: ${describeError(error)}`,
            "error",
          );
        }
        return;
      case "local": {
        // Capture the document the link was authored in: the resolver must
        // use its directory even if the active tab changes mid-flight.
        const baseFile = this.activePath;
        if (baseFile === null) return;

        try {
          const resolved = await invoke<ResolvedLink>("resolve_document_link", {
            baseFile,
            href: target.path,
          });

          if (!resolved.isDir && isMarkdownPath(resolved.path)) {
            await this.openDocument(resolved.path, target.fragment);
          } else {
            await invoke("open_local_path", { path: resolved.path });
          }
        } catch (error) {
          this.toast.show(describeError(error), "error");
        }
        return;
      }
    }
  }
```

Change `openDocument` to accept an optional fragment and await its render:

```ts
  public async openDocument(
    rawPath: string,
    fragment: string | null = null,
  ): Promise<void> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      // ... existing tab upsert stays unchanged ...

      await this.setActiveTab(data.path);
      if (fragment !== null) scrollToAnchor(this.contentContainer, fragment);
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      const reason = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open ${rawPath}: ${reason}`);
    }
  }
```

Change `setActiveTab` from fire-and-forget to an awaitable render:

```ts
  public async setActiveTab(path: string): Promise<void> {
    // ... existing body up to renderTabs() stays unchanged ...

    this.renderTabs();
    await this.renderActiveContent();
  }
```

Update every existing call site to make the ignored promise explicit:

```ts
        if (this.tabs.has(path)) void this.setActiveTab(path);
```

```ts
      item.addEventListener("click", () => void this.setActiveTab(tab.path));
```

```ts
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.setActiveTab(tab.path);
          return;
        }
```

In `openDocument`, the call becomes `await this.setActiveTab(data.path);` as
shown above. No other production call sites exist.

**Phase 3 verification:** `npm run typecheck` and `npm run test:web` must pass.
Then start `npm run tauri dev` and run the manual matrix in Phase 4.

### Phase 4 — Validation

#### Automated

Run, in order:

1. `npm run typecheck`
2. `npm run test:web`
3. `cd src-tauri && cargo test`
4. `npm run lint:rs`
5. `npm run check` (full production build without bundle)

All must pass with no warnings from clippy.

#### Manual matrix (`npm run tauri dev`)

Use a scratch document containing these links:

```markdown
[external](https://example.com)
[fragment](#target-heading)
[markdown](./other.md)
[markdown-fragment](./other.md#other-heading)
[image](./diagram.png)
[missing](./does-not-exist.md)
[script](javascript:alert(1))
[mail](mailto:test@example.com)
[windows](C:\temp\plan.md)
[file-url](file:///tmp/plan.md)
```

Verify each row:

| Click | Expected |
| --- | --- |
| External https | System browser opens; docdeck keeps its UI, tabs and scroll |
| Fragment | Scrolls within the current document, no reload |
| Markdown | Opens a tab, or focuses the existing tab |
| Markdown + fragment | Opens/focuses the tab and scrolls to that heading after render |
| Image/PDF | OS default application opens the file |
| Missing file | Error toast; current document stays visible |
| `javascript:` | Blocked toast; no console navigation error |
| `mailto:` | OS mail handler opens |
| Ctrl-click / middle-click | Same rules; docdeck never navigates |
| Link inside a Mermaid diagram | External links open in the browser; no navigation |

Also confirm in the webview devtools console that no `navigation` or
`on_navigation` denial appears during normal use. A denial appearing means the
frontend missed a link source and should be recorded in the implementation
report.

### Phase 5 — Documentation and housekeeping

#### [MODIFY] `README.md`

Add a feature bullet after the "GitHub-flavoured Markdown" entry:

```markdown
- **Safe links** — clicking a link never replaces the app window. Web links and
  `mailto:` open in the OS default handler, local Markdown links open or focus a
  tab (scrolling to any `#fragment`), other local files open in their default
  application, and `javascript:`/`data:`/unknown schemes are blocked with a toast.
```

#### [MODIFY] `CHANGELOG.md`

Add under `## [Unreleased]` → `### Fixed`, before the existing fixed entries:

```markdown
- Clicking a link in a rendered document no longer navigates docdeck's webview
  away from the app and forces a restart. Web links open in the system browser,
  local Markdown links open as tabs, other local files open in their default
  app, and unsafe schemes are blocked with a toast.
```

#### Documentation record check

- Confirm the ADR index row for `261029-1` exists in
  `_ai/technical_decisions/README.md` (added with the decision).
- `.gitignore`: no new build artifacts, caches or generated files are
  introduced. `src-tauri/target/` and `node_modules/` are already ignored.
  `Cargo.lock` must remain tracked and updated.
- Run `git status` and confirm only intended source, test, lockfile and
  documentation changes are present. Do not commit unless explicitly asked.

### Phase 6 — Implementation report

Write
`_ai/backlog/reports/261029_1301__IMPLEMENTATION_REPORT__block-webview-navigation-and-document-links.md`
with the actual results:

```yaml
---
filename: "_ai/backlog/reports/261029_1301__IMPLEMENTATION_REPORT__block-webview-navigation-and-document-links.md"
title: "Report: Block webview navigation and handle document links safely"
createdAt: 2026-10-29 13:01
updatedAt: 2026-10-29 13:01
planFile: "_ai/backlog/active/261029_1301__IMPLEMENTATION_PLAN__block-webview-navigation-and-document-links.md"
specFile: ""
project: "docdeck"
status: completed
completedAt: 2026-10-29 13:38
filesCreated: 0
filesModified: 0
filesDeleted: 0
tags: [webview, navigation, links, security, tauri, bugfix]
documentType: IMPLEMENTATION_REPORT
---
```

The report body must contain:

1. **Summary** — what changed and why the crash is now impossible.
2. **Files Changed** — created/modified/deleted tables with one-line purposes.
3. **Key Changes** — navigation guard, classifier, IPC, scroll sequencing,
   tests.
4. **Deviations from Plan** — any API, naming or behavior difference, with the
   reason; state "none" only if genuinely none.
5. **Technical Decisions** — anything decided during implementation that was
   not in the plan.
6. **Testing Notes** — automated commands and the manual matrix results.
7. **Usage Examples** — the link kinds users can rely on.
8. **Documentation Updates** — README, CHANGELOG, ADR index.
9. **Next Steps** — carried-over items such as relative image rendering and
   any missed link source found during manual testing.

Update the frontmatter counts (`filesCreated`, `filesModified`,
`filesDeleted`), `updatedAt`, and `status` (`completed`, `partial` or `blocked`)
from the real outcome. Do not claim a passing validation that was not run.

## 6. Traceability

| Phase | Satisfies |
| --- | --- |
| 1 | ADR 261029-1 navigation invariant; OS dispatch IPC; path resolution tests |
| 2 | ADR 261029-1 pure classification; shared fragment scroll rule |
| 3 | Behavior contract: external, fragment, relative Markdown, local files, blocked schemes, never navigate |
| 4 | Verifies every behavior contract row, including ctrl/middle click and Mermaid anchors |
| 5 | User documentation and release notes |
| 6 | Durable implementation record |

## 7. Risks & Mitigations

- **Production origin differs from the guard allowlist.** Tests cover
  `tauri://localhost` and `http://tauri.localhost`; verify a release build with
  `npm run tauri build` if the guard blocks startup. The dev branch is separate
  and only active under `tauri::is_dev()`.
- **Opener failures vary by desktop environment.** Errors are surfaced as
  toasts; the commands re-canonicalize paths and validate URL schemes.
- **Fragment scroll races the render.** `openDocument` awaits `setActiveTab`,
  which awaits `renderActiveContent`; `scrollToAnchor` no-ops if the heading is
  absent.
- **A link source bypasses the delegate.** The navigation guard denies it, so
  the failure mode is a dead link or a backstop denial, never a destroyed UI.
  Any occurrence found in manual testing must be reported rather than ignored.
- **Percent-encoding ambiguity.** Decoding falls back to the raw text on
  malformed escapes; the classifier and resolver tests pin the behavior.
