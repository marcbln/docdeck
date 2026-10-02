---
filename: "_ai/backlog/active/261001_2316__IMPLEMENTATION_PLAN__frontmatter_toc_theme_toggles.md"
title: "Frontmatter Metadata Table, Table of Contents, Light/Dark Theme and View Toggles for docdeck"
createdAt: 2026-10-01 23:16
updatedAt: 2026-10-01 23:16
status: completed
completedAt: 2026-10-02 08:35
priority: high
tags: [typescript, vite, markdown, frontmatter, yaml, toc, theming, vitest]
estimatedComplexity: moderate
documentRevision: 1
documentType: IMPLEMENTATION_PLAN
---

# Implementation Plan: Frontmatter Table, TOC, Light/Dark Theme and View Toggles

## 1. Problem Statement

docdeck renders YAML frontmatter as raw markdown body text. `marked` has no
frontmatter support, so a leading `---` block is tokenised as a thematic break
followed by a paragraph, and the reader sees the header as a wall of
`filename: "..." title: "..." status: completed` prose — the exact symptom
visible in the current screenshot. Agent documents are the primary use case for
this app, and every plan, report and status log in this repository carries
frontmatter, so this is the first thing every reader sees on every document.

Three further gaps share that root cause: the reader cannot tell at a glance what
a document's metadata says without scanning a paragraph; long agent documents
have no outline; and the app is locked to a dark palette, which is unreadable in
a bright room and hostile to anyone who prefers light.

Concretely:
- Frontmatter is rendered as body prose rather than a structured table.
- There is no way to hide frontmatter when reading body text.
- There is no table of contents for documents that run to dozens of sections.
- There is no light theme; `style.css` hard-codes the Mocha palette and
  `index.html` hard-codes `data-color-mode="dark"`.
- `npm test` runs `cargo test` only — there is no JS test runner, so frontend
  logic added by this plan would ship untested.

## 2. Executive Summary

This plan adds four reader-facing capabilities to docdeck and the test
infrastructure to keep them honest:

1. **Frontmatter as a table.** A pure `src/frontmatter.ts` module splits an
   anchored leading `---` block off the document, parses it with `yaml`, and
   flattens it into typed rows rendered as a two-column table inside a native
   `<details>` element. Malformed YAML degrades to a raw-text row instead of
   blanking the document.
2. **Table of contents.** `src/toc.ts` extracts `h1`–`h4` from marked's token
   tree (marked emits no heading IDs, so slugs are generated here with
   GitHub-compatible Unicode slugging and duplicate disambiguation). A
   dedicated collapsible sidebar column renders the outline with an
   `IntersectionObserver` scroll-spy, and a pinned leading **Document metadata**
   entry jumps to and expands the frontmatter table.
3. **Light/dark theme.** `src/theme.ts` swaps the `github-markdown-css` and
   `highlight.js` stylesheet hrefs and overrides seven CSS custom properties to
   Catppuccin Latte, matching the existing Mocha dark palette.
4. **Persisted toggles.** Theme, TOC visibility and frontmatter visibility are
   stored under one versioned `localStorage` key with per-field validation, so
   docdeck reopens the way it was left.

Each feature ships as its own module behind a narrow interface. Pure logic
(frontmatter parsing, heading extraction, preference decoding) is separated from
DOM controllers (theme, TOC panel, metadata table, toolbar buttons) and is unit
tested with vitest + happy-dom. `src/main.ts` remains the orchestrator; it grows
wiring, not logic.

## 3. Project Environment Details

```
Project:          docdeck v0.1.0 — tabbed Markdown viewer for AI agent documents
Location:         /home/marc/devel/docdeck
OS:               Linux (x86_64) — app is Linux-only (inotify + WebKitGTK)
Runtime:          Tauri v2 / WebKitGTK, single-instance CLI, debounced inotify watcher

Toolchain:
  Node.js         v20+ (v26.7.0 present)
  npm             ships with Node
  TypeScript      6.0.3, strict + noUnusedLocals + noUnusedParameters
  Vite            8.3.2 (dev server on :1420, strictPort, watches src/)
  Rust            stable 1.80+ (Tauri v2 backend, unchanged by this plan)

Existing frontend deps:
  marked            18.0.14   markdown -> HTML (Marked class, no frontmatter support)
  marked-highlight   2.2.4     syntax highlighting hook
  highlight.js      11.12.2   ~40 common languages via lib/common
  mermaid           11.17.2   diagrams, initialize()d with Mocha themeVariables
  github-markdown-css 5.9.0   ships -dark, -light, -dimmed, -high-contrast variants
  @tauri-apps/api   ^2        invoke() + listen()

Existing backend (Rust — NOT touched by this plan):
  lib.rs            builder, single-instance IPC, collect_paths()
  commands.rs       load_file, close_file, startup_paths
  watcher.rs        debounced inotify watcher + watch registry
  render.rs         WebKitGTK DMA-BUF configuration

Current source layout:
  index.html        <html data-color-mode="dark">, #app grid, header, #tabs-bar,
                    #content-container > (#empty-state, #markdown-viewer)
  src/main.ts       284 lines — AppState: tab registry, backend wiring, DOM painting
  src/markdown.ts   104 lines — marked -> hljs -> mermaid, wasTailing scroll logic
  src/style.css     352 lines — Catppuccin Mocha, 2 grid layouts, markdown overrides

Scripts:
  npm run dev | build | preview | tauri | typecheck
  npm test          -> cd src-tauri && cargo test          (cargo only today)
  npm run lint:rs   -> cargo clippy --all-targets -- -D warnings
  npm run check     -> typecheck && test && tauri build --no-bundle
  npm run simulate  -> scripts/simulate_agent_writes.sh

Git hygiene:
  _ai/backlog/{active,archive,epics,reports}, _ai/technical_decisions
  Report target: _ai/backlog/reports/261001_2316__IMPLEMENTATION_REPORT__*.md
```

---

## 4. Architectural Design & SOLID Alignment

`src/main.ts` is currently a single 284-line `AppState` mixing tab bookkeeping,
backend wiring and DOM painting. Adding three interactive features directly
would push it toward 500 lines with five unrelated responsibilities. This plan
splits it by responsibility, keeping `AppState` as the orchestrator it already
is.

### 4.1 Module boundaries

**Pure logic — no DOM access, fully unit-testable:**

| Module | Responsibility | Public surface |
| --- | --- | --- |
| `src/frontmatter.ts` | Split and parse the YAML header block | `splitFrontmatter`, `parseFrontmatterRows`, types |
| `src/toc.ts` | Extract headings and generate slugs from marked tokens | `extractHeadings`, types |
| `src/preferences.ts` | Versioned `localStorage` read/write with validation | `loadPreferences`, `savePreferences`, `ThemeMode` |

**DOM controllers — constructed with an element, expose narrow methods:**

| Module | Responsibility | Public surface |
| --- | --- | --- |
| `src/theme.ts` | Swap stylesheet hrefs, CSS vars, mermaid variables | `ThemeController.apply()` |
| `src/toc-panel.ts` | Outline rendering, scroll-spy, jump-to-heading | `TocPanel.rebuild()` |
| `src/metadata-table.ts` | Build the frontmatter `<details>` table | `MetadataTableView.mount()` |
| `src/toolbar.ts` | Reusable toggle button with `aria-pressed` | `ToggleButton` factory |

**Modified, responsibilities unchanged:**

- `src/markdown.ts` — still the render pipeline; gains a `headingSlugs` parameter
  and gives up its `innerHTML` write to the caller.
- `src/main.ts` — still the orchestrator; gains wiring only.

### 4.2 SOLID mapping

- **SRP** — each module owns one concern. `frontmatter.ts` knows nothing about
  tabs, tabs know nothing about YAML. `markdown.ts` keeps rendering; composing
  the view is `main.ts`'s job.
- **OCP** — `ThemeController` is constructed with a stylesheet-URL map. Adding
  a third stylesheet, or a high-contrast variant later, is a config change.
  `extractHeadings` takes a depth cap rather than hard-coding 4.
- **LSP/ISP** — controllers expose one method each (`apply`, `rebuild`, `mount`)
  rather than a wide interface consumers must partially implement.
- **DIP** — `main.ts` depends on the narrow exported functions and controller
  interfaces, not on DOM structure. Swapping `<details>` for a custom collapse
  widget touches `metadata-table.ts` only.

### 4.3 Data flow per render

```
reloadDocument / setActiveTab
        │
        ├─ splitFrontmatter(content) ──► { raw, body }
        │        raw === null  ->  body === content, table not mounted
        │
        ├─ parseFrontmatterRows(raw) ──► FrontmatterRow[]
        │
        ├─ extractHeadings(body) ──► Heading[]  (depth <= 4, unique slugs)
        │
        ├─ renderMarkdown(body, viewer, headingSlugs) ──► stamps ids on h1-h4
        │
        ├─ MetadataTableView.mount(rows, expanded)  ──► <details> above body
        │
        └─ TocPanel.rebuild(headings)  ──► LAST: queries the ids just stamped
```

Ordering is load-bearing. `TocPanel.rebuild()` must run last because it resolves
anchors through `document.getElementById` against ids the previous step wrote.

### 4.4 Decisions made during design (and why)

1. **Anchored frontmatter regex, not `---` detection anywhere.** The pattern
   requires `---` at offset 0, so a thematic break at line 40 of a document is
   not mistaken for a header.
2. **Stylesheet swap, not `display` toggling.** `github-markdown-dark.css` and
   `github-markdown-light.css` both define `.markdown-body`. Loading both and
   hiding one leaves the loser winning by cascade order. Exactly one may be
   linked at a time.
3. **Recursive heading-token walk.** `heading.text` retains raw markdown — for
   `## **Bold** and \`code\`` the token text is literally
   `**Bold** and \`code\``. Tokens also nest (`strong.tokens`, `link.tokens`),
   so a one-level-deep walk drops nested content.
4. **Unicode-aware slugging.** `Ünïcödé — “quoted” 100%` must become
   `unicode-quoted-100`, matching GitHub. An ASCII-only character class would
   collapse it to an empty string.
5. **`yaml.parse` in a try/catch.** It throws on malformed input (verified:
   `a: [unclosed` raises `YAMLParseError`). A broken header must never blank the
   document body.
6. **Native `<details>` for collapse.** Free keyboard accessibility and
   open/closed semantics; no custom ARIA wiring to get wrong.
7. **Metadata entry always pinned in the TOC.** An entry that disappears when
   the reader needs it is a trap.

---

## Phase 0: Test Harness and Dependencies

Establishes the safety net before behaviour changes. No user-visible output.

### Step 0.1: Install dependencies

`yaml` parses frontmatter; vitest and happy-dom test the frontend.

```bash
npm install yaml
npm install -D vitest happy-dom
```

Verified available at time of writing: `yaml@2.9.1`, `vitest@5.0.3`
(peer-compatible with `vite@^8.0.16`), `happy-dom@20.14.5`.

### Step 0.2: Configure vitest

[NEW FILE] `vitest.config.ts`
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
```

Separate from `vite.config.ts` so the Tauri dev-server settings (fixed port
1420, `src-tauri` watch exclusions) do not leak into the test runner.

The frontend needs the same ambient CSS-module typings Vite provides, because
`src/theme.ts` imports stylesheets with `?url`:

[NEW FILE] `src/vite-env.d.ts`
```ts
/// <reference types="vite/client" />
```

### Step 0.3: Wire the test script

[MODIFY] `package.json`
```json
{
  "scripts": {
    "test": "cd src-tauri && cargo test && cd .. && vitest run",
    "test:watch": "vitest",
    "test:web": "vitest run"
  }
}
```

`npm test` now runs both suites so CI-style invocation covers the frontend.
`test:watch` is pointed at vitest directly — the existing `cargo test -- --nocapture`
watch recipe is superseded.

---

## Phase 1: Preferences (Pure, Tested First)

Built first because theme and both toggles depend on it.

### Step 1.1: Implement the preferences module

[NEW FILE] `src/preferences.ts`
```ts
/** Single storage key. The version suffix lets a future schema change coexist
 *  with an old key rather than migrating it in place. */
const STORAGE_KEY = "docdeck.preferences.v1";

const SCHEMA_VERSION = 1;

export type ThemeMode = "dark" | "light";

export interface Preferences {
  themeMode: ThemeMode;
  tocVisible: boolean;
  frontmatterVisible: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  themeMode: "dark",
  tocVisible: false,
  frontmatterVisible: true,
});

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

/**
 * Decodes a stored payload into preferences, validating each field
 * independently.
 *
 * The layers fail independently on purpose. A `localStorage` read can throw in
 * a restricted webview, the JSON can be corrupt, and any single field can hold
 * the wrong type after a schema change. Validating per field means one bad
 * value costs the reader that preference, not all three.
 */
function decode(raw: string | null): Preferences {
  if (raw === null) return { ...DEFAULT_PREFERENCES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_PREFERENCES };
  }

  const record = parsed as Record<string, unknown>;
  return {
    themeMode: isThemeMode(record.themeMode)
      ? record.themeMode
      : DEFAULT_PREFERENCES.themeMode,
    tocVisible:
      typeof record.tocVisible === "boolean"
        ? record.tocVisible
        : DEFAULT_PREFERENCES.tocVisible,
    frontmatterVisible:
      typeof record.frontmatterVisible === "boolean"
        ? record.frontmatterVisible
        : DEFAULT_PREFERENCES.frontmatterVisible,
  };
}

export function loadPreferences(): Preferences {
  try {
    return decode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage can be unavailable (private mode, restricted webview context).
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...preferences }),
    );
  } catch {
    // Persistence is a convenience; failing to write must not break a toggle.
  }
}
```

[NEW FILE] `src/preferences.test.ts`
```ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "./preferences";

const KEY = "docdeck.preferences.v1";

describe("loadPreferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns defaults when nothing is stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips a saved preference set", () => {
    savePreferences({
      themeMode: "light",
      tocVisible: true,
      frontmatterVisible: false,
    });
    expect(loadPreferences()).toEqual({
      themeMode: "light",
      tocVisible: true,
      frontmatterVisible: false,
    });
  });

  it("falls back to defaults on corrupt JSON", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("falls back to defaults when the payload is not an object", () => {
    window.localStorage.setItem(KEY, '"a string"');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields when one field has the wrong type", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "light",
        tocVisible: "yes",
        frontmatterVisible: false,
      }),
    );
    const preferences = loadPreferences();
    expect(preferences.themeMode).toBe("light");
    expect(preferences.frontmatterVisible).toBe(false);
    expect(preferences.tocVisible).toBe(DEFAULT_PREFERENCES.tocVisible);
  });

  it("rejects an unknown theme mode", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, themeMode: "solarized" }),
    );
    expect(loadPreferences().themeMode).toBe("dark");
  });
});
```

### Step 1.2: Verify

```bash
npm run test:web
```

---

## Phase 2: Frontmatter Parsing (Pure, Tested)

### Step 2.1: Implement the frontmatter module

[NEW FILE] `src/frontmatter.ts`
```ts
import { parse as parseYaml } from "yaml";

export interface FrontmatterSplit {
  /** The raw YAML text between the fences, or null when absent. */
  raw: string | null;
  /** The document with the frontmatter block removed. */
  body: string;
}

export type FrontmatterValueKind =
  | "scalar"
  | "list"
  | "object"
  | "empty";

export interface FrontmatterRow {
  key: string;
  /** Already stringified for display; `null` only for `kind: "empty"`. */
  value: string | null;
  /** 0 for top-level keys, incremented per nesting level. */
  depth: number;
  kind: FrontmatterValueKind;
  /** Set when the block failed to parse and is shown verbatim. */
  malformed?: boolean;
}

/**
 * Matches a `---` fenced block anchored at the very start of the document.
 *
 * Anchoring at offset 0 is what distinguishes frontmatter from a thematic
 * break further down the document. The closing fence allows trailing
 * whitespace and tolerates CRLF line endings.
 */
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): FrontmatterSplit {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) return { raw: null, body: source };

  return { raw: match[1], body: source.slice(match[0].length) };
}

/** Renders any YAML value as a single display string. */
function formatValue(value: unknown): { text: string | null; kind: FrontmatterValueKind } {
  if (value === null || value === undefined) {
    return { text: null, kind: "empty" };
  }
  if (Array.isArray(value)) {
    // `[rust, tauri-v2]` reads better than Rust's multi-line array debug form.
    return { text: `[${value.map((item) => String(item)).join(", ")}]`, kind: "list" };
  }
  if (typeof value === "object") {
    return { text: "{…}", kind: "object" };
  }
  return { text: String(value), kind: "scalar" };
}

function flatten(
  entries: [string, unknown][],
  depth: number,
  rows: FrontmatterRow[],
): void {
  for (const [key, value] of entries) {
    const { text, kind } = formatValue(value);
    rows.push({ key, value: text, depth, kind });

    // Nested maps become indented sub-rows; arrays stay on one line.
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const nested = Object.entries(value as Record<string, unknown>);
      if (nested.length > 0) flatten(nested, depth + 1, rows);
    }
  }
}

/**
 * Parses raw YAML into display rows.
 *
 * `yaml.parse` throws on malformed input, so a broken header degrades to a
 * single verbatim row. A document with an unparseable header must still render
 * its body — losing the whole document to a typo in its metadata is the worst
 * possible failure mode here.
 */
export function parseFrontmatterRows(raw: string): FrontmatterRow[] {
  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch {
    return [{ key: "frontmatter", value: raw, depth: 0, kind: "scalar", malformed: true }];
  }

  // A frontmatter block that parses to a scalar or nothing (`---\n---\n`)
  // is not a key/value table.
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return [{ key: "frontmatter", value: raw, depth: 0, kind: "scalar", malformed: true }];
  }

  const rows: FrontmatterRow[] = [];
  flatten(Object.entries(document as Record<string, unknown>), 0, rows);
  return rows;
}
```

[NEW FILE] `src/frontmatter.test.ts`
```ts
import { describe, expect, it } from "vitest";

import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns the body untouched when there is no frontmatter", () => {
    const source = "# Title\n\nBody.\n";
    expect(splitFrontmatter(source)).toEqual({ raw: null, body: source });
  });

  it("splits a leading frontmatter block from the body", () => {
    const { raw, body } = splitFrontmatter("---\ntitle: Plan\n---\n\n# Heading\n");
    expect(raw).toBe("title: Plan");
    expect(body.trim()).toBe("# Heading");
  });

  it("ignores a thematic break further down the document", () => {
    const source = "# Title\n\nSome text.\n\n---\n\nMore text.\n";
    expect(splitFrontmatter(source).raw).toBeNull();
  });

  it("tolerates CRLF line endings", () => {
    const { raw, body } = splitFrontmatter("---\r\ntitle: Plan\r\n---\r\n\r\n# H\r\n");
    expect(raw).toBe("title: Plan");
    expect(body.trim()).toBe("# H");
  });

  it("handles an unterminated block as absent", () => {
    const source = "---\ntitle: Plan\n\n# Heading\n";
    expect(splitFrontmatter(source).raw).toBeNull();
  });

  it("returns null raw for an empty document", () => {
    expect(splitFrontmatter("")).toEqual({ raw: null, body: "" });
  });
});

describe("parseFrontmatterRows", () => {
  it("parses scalar keys in document order", () => {
    const rows = parseFrontmatterRows('title: "A Plan"\nstatus: draft\n');
    expect(rows).toEqual([
      { key: "title", value: "A Plan", depth: 0, kind: "scalar" },
      { key: "status", value: "draft", depth: 0, kind: "scalar" },
    ]);
  });

  it("keeps an unquoted date-like value as a string", () => {
    const rows = parseFrontmatterRows("createdAt: 2026-10-01 21:16\n");
    expect(rows[0]?.value).toBe("2026-10-01 21:16");
  });

  it("formats a list inline", () => {
    const rows = parseFrontmatterRows("tags: [rust, tauri]\n");
    expect(rows[0]).toEqual({
      key: "tags",
      value: "[rust, tauri]",
      depth: 0,
      kind: "list",
    });
  });

  it("flattens a nested map into indented sub-rows", () => {
    const rows = parseFrontmatterRows("meta:\n  nested: true\n");
    expect(rows).toEqual([
      { key: "meta", value: "{…}", depth: 0, kind: "object" },
      { key: "nested", value: "true", depth: 1, kind: "scalar" },
    ]);
  });

  it("marks a valueless key as empty", () => {
    const rows = parseFrontmatterRows("emptyValue:\n");
    expect(rows[0]).toEqual({
      key: "emptyValue",
      value: null,
      depth: 0,
      kind: "empty",
    });
  });

  it("degrades malformed YAML to a single raw row", () => {
    const rows = parseFrontmatterRows("a: [unclosed\nb: 1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.malformed).toBe(true);
    expect(rows[0]?.value).toBe("a: [unclosed\nb: 1");
  });

  it("degrades a non-mapping block to a raw row", () => {
    expect(parseFrontmatterRows("just a string")[0]?.malformed).toBe(true);
  });
});
```

### Step 2.2: Verify

```bash
npm run test:web
```

The malformed-YAML test is the one to watch: it confirms `parseYaml` throws and
that the catch path returns a row instead of propagating.

---

## Phase 3: TOC Extraction (Pure, Tested)

### Step 3.1: Implement heading extraction

[NEW FILE] `src/toc.ts`
```ts
import type { Token } from "marked";
import type { Marked } from "marked";

export interface Heading {
  depth: number;
  /** Plain text with all inline markdown removed. */
  text: string;
  slug: string;
}

/** Deepest heading level listed in the outline. Agent plans rarely nest past h4. */
export const MAX_TOC_DEPTH = 4;

/**
 * Concatenates the plain text of a heading's inline token tree.
 *
 * `heading.text` retains raw markdown — for `## **Bold** and \`code\`` it is
 * literally "**Bold** and \`code\`". Tokens also nest (`strong.tokens`,
 * `link.tokens`), so this recurses. HTML tokens are skipped so inline markup in
 * a heading never leaks into the slug.
 */
function collectText(tokens: Token[] | undefined, parts: string[]): void {
  if (!tokens) return;
  for (const token of tokens) {
    switch (token.type) {
      case "html":
        break;
      case "text":
      case "codespan":
      case "del":
      case "strong":
      case "em":
        parts.push(token.text);
        break;
      default:
        collectText("tokens" in token ? token.tokens : undefined, parts);
    }
  }
}

/**
 * GitHub-compatible slug.
 *
 * Accents are folded, non-letter/non-number runs collapse to a single dash and
 * edge dashes are trimmed. Keeping Unicode letters matters: an ASCII-only class
 * reduces "Ünïcödé" to an empty string.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  // A heading made only of punctuation ("## ---") has no slug of its own.
  return slug.length > 0 ? slug : "section";
}

/**
 * Extracts the outline from a markdown source.
 *
 * `marked` emits no `id` attributes on headings, so this is the single source
 * of both the DOM ids stamped during rendering and the TOC's anchors — they
 * cannot drift apart because they are computed once.
 */
export function extractHeadings(
  marked: Marked,
  markdown: string,
  maxDepth: number = MAX_TOC_DEPTH,
): Heading[] {
  const headings: Heading[] = [];
  const used = new Map<string, number>();

  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== "heading" || token.depth > maxDepth) return;

    const parts: string[] = [];
    collectText(token.tokens, parts);
    const text = parts.join("").trim();

    const base = slugify(text);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);

    // Two headings slugifying alike must get distinct DOM ids or the TOC's
    // second link scrolls to the first heading.
    const slug = seen === 0 ? base : `${base}-${seen}`;
    headings.push({ depth: token.depth, text, slug });
  });

  return headings;
}
```

[NEW FILE] `src/toc.test.ts`
```ts
import { Marked } from "marked";
import { describe, expect, it } from "vitest";

import { extractHeadings, slugify } from "./toc";

const marked = new Marked();

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Problem Statement")).toBe("problem-statement");
  });

  it("strips inline markdown syntax", () => {
    expect(slugify("**Bold** and `code`")).toBe("bold-and-code");
  });

  it("folds accents and keeps unicode letters", () => {
    expect(slugify("café naïve")).toBe("cafe-naive");
  });

  it("collapses punctuation runs to a single dash", () => {
    expect(slugify("Ünïcödé — “quoted” 100%")).toBe("unicode-quoted-100");
  });

  it("returns a fallback when no slug survives", () => {
    expect(slugify("—")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("extractHeadings", () => {
  it("returns nothing for a document with no headings", () => {
    expect(extractHeadings(marked, "Just a paragraph.")).toEqual([]);
  });

  it("captures text with inline markdown removed", () => {
    const headings = extractHeadings(marked, "## **Bold** and `code` heading\n");
    expect(headings[0]).toEqual({
      depth: 2,
      text: "Bold and code heading",
      slug: "bold-and-code-heading",
    });
  });

  it("excludes headings deeper than the cap", () => {
    const headings = extractHeadings(marked, "#### four\n\n##### five\n");
    expect(headings.map((h) => h.depth)).toEqual([4]);
  });

  it("honours an explicit depth cap", () => {
    expect(extractHeadings(marked, "## two\n", 2)).toHaveLength(1);
    expect(extractHeadings(marked, "## two\n", 1)).toHaveLength(0);
  });

  it("disambiguates duplicate heading slugs", () => {
    const headings = extractHeadings(marked, "## Setup\n\n## Setup\n\n## Setup\n");
    expect(headings.map((h) => h.slug)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("does not leak inline html into the slug", () => {
    const headings = extractHeadings(marked, "## A <em>b</em> c\n");
    expect(headings[0]?.text).toBe("A b c");
    expect(headings[0]?.slug).toBe("a-b-c");
  });

  it("reads link text rather than the href", () => {
    const headings = extractHeadings(marked, "## [link](http://x) here\n");
    expect(headings[0]?.text).toBe("link here");
  });
});
```

### Step 3.2: Verify

```bash
npm run test:web
```

---

## Phase 4: Reusable Toggle Button

### Step 4.1: Implement the toolbar factory

[MODIFY] `src/toolbar.ts` — new file
```ts
export interface ToggleButtonOptions {
  /** Button element to decorate. */
  element: HTMLButtonElement;
  /** Glyph shown before the label, e.g. "☀". */
  icon: string;
  /** Text after the icon. */
  label: string;
  tooltip: string;
  initialState: boolean;
  onChange: (next: boolean) => void;
  /** Renders the visible text for a given state. */
  formatLabel: (state: boolean) => string;
}

/**
 * A toolbar button with a boolean state.
 *
 * Factored out because three new toggles would otherwise mean three copies of
 * the same click handler, class toggle and `aria-pressed` update — three places
 * to forget the ARIA state when a fourth arrives.
 */
export function createToggleButton(options: ToggleButtonOptions): {
  setState(next: boolean): void;
} {
  const { element, icon, label, tooltip, formatLabel, onChange } = options;

  element.classList.toggle("active", options.initialState);
  element.title = tooltip;
  element.setAttribute("aria-label", tooltip);
  element.setAttribute("aria-pressed", String(options.initialState));

  const paint = (state: boolean): void => {
    element.classList.toggle("active", state);
    element.setAttribute("aria-pressed", String(state));
    element.textContent = `${icon} ${label}: ${formatLabel(state)}`;
  };

  paint(options.initialState);

  element.addEventListener("click", () => {
    const next = element.getAttribute("aria-pressed") !== "true";
    paint(next);
    onChange(next);
  });

  return {
    setState(next: boolean): void {
      paint(next);
    },
  };
}
```

[NEW FILE] `src/toolbar.test.ts`
```ts
import { describe, expect, it, vi } from "vitest";

import { createToggleButton } from "./toolbar";

function makeButton(): HTMLButtonElement {
  document.body.replaceChildren();
  const button = document.createElement("button");
  document.body.appendChild(button);
  return button;
}

describe("createToggleButton", () => {
  it("reflects the initial state in its class and ARIA attribute", () => {
    const button = makeButton();
    createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: true,
      onChange: vi.fn(),
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    expect(button.classList.contains("active")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("☰ Outline: ON");
  });

  it("flips state and reports the new value on click", () => {
    const button = makeButton();
    const onChange = vi.fn();
    createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: false,
      onChange,
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    button.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("setState updates the visual state without firing onChange", () => {
    const button = makeButton();
    const onChange = vi.fn();
    const control = createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: false,
      onChange,
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    control.setState(true);
    expect(button.classList.contains("active")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

---

## Phase 5: Theme Controller

### Step 5.1: Convert stylesheet imports to URL imports

The two GitHub-markdown stylesheets both define `.markdown-body`, so loading
both and hiding one lets the loser win on cascade order. Exactly one may be
linked at a time — hence runtime href swapping rather than a class toggle.

[MODIFY] `src/style.css` — replace lines 1-2
```css
/* Stylesheets are linked at runtime by src/theme.ts — the dark and light
   github-markdown-css variants both define `.markdown-body`, so only one may be
   active at a time. Keep the @import below commented out; theme.ts appends
   the <link> elements to <head>. */
```

[MODIFY] `index.html`
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>docdeck</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
```

The `<link>` elements for the four swappable stylesheets are created by
`theme.ts` on boot (see Step 5.2), which is what allows their hrefs to be
retargeted.

### Step 5.2: Implement the theme controller

[NEW FILE] `src/theme.ts`
```ts
import markdownDarkHref from "github-markdown-css/github-markdown-dark.css?url";
import markdownLightHref from "github-markdown-css/github-markdown-light.css?url";
import hljsDarkHref from "highlight.js/styles/github-dark.css?url";
import hljsLightHref from "highlight.js/styles/github.css?url";

import type { ThemeMode } from "./preferences";

/**
 * Catppuccin Latte variables for Mermaid diagrams.
 *
 * Mirrors the Mocha set in markdown.ts. Mermaid bakes colors in at
 * initialize() time, so these must be re-applied whenever the mode changes.
 */
export const LIGHT_MERMAID_VARIABLES: Record<string, string> = {
  background: "#eff1f5",
  primaryColor: "#e6e9ef",
  primaryTextColor: "#4c4f69",
  primaryBorderColor: "#ccd0da",
  lineColor: "#9ca0b0",
  secondaryColor: "#ccd0da",
  tertiaryColor: "#eff1f5",
  textColor: "#4c4f69",
  mainBkg: "#e6e9ef",
  nodeBorder: "#ccd0da",
  clusterBkg: "#eff1f5",
  clusterBorder: "#acb0be",
  titleColor: "#4c4f69",
  edgeLabelBackground: "#eff1f5",
  fontSize: "14px",
};

const STYLESHEET_URLS = {
  dark: {
    markdown: markdownDarkHref,
    highlight: hljsDarkHref,
  },
  light: {
    markdown: markdownLightHref,
    highlight: hljsLightHref,
  },
} as const;

/** Re-applies Mermaid's theme. Supplied by markdown.ts, which owns the instance. */
export type MermaidThemeApplier = (mode: ThemeMode) => void;

export interface ThemeControllerOptions {
  /** Called after the mode changes, so diagrams can be re-themed. */
  onMermaidThemeChange: MermaidThemeApplier;
  /** Called after the mode changes, so rendered SVGs can be refreshed. */
  onModeApplied?: (mode: ThemeMode) => void;
}

export class ThemeController {
  private mode: ThemeMode = "dark";
  private readonly links: HTMLLinkElement[] = [];

  constructor(private readonly options: ThemeControllerOptions) {
    this.attachStylesheets();
  }

  /**
   * Adds the four swappable stylesheets as real `<link>` elements so their
   * hrefs can be retargeted. Two of each variant are loaded at once, but only
   * one of any pair is ever active — the inactive one is detached rather than
   * hidden, because `.markdown-body` rules from both would otherwise collide.
   */
  private attachStylesheets(): void {
    const head = document.head;
    for (const [mode, urls] of Object.entries(STYLESHEET_URLS)) {
      for (const href of Object.values(urls)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.themeMode = mode;
        head.appendChild(link);
        this.links.push(link);
      }
    }
  }

  private applyStylesheets(): void {
    for (const link of this.links) {
      // Detach the inactive pair so its `.markdown-body` rules leave the
      // cascade entirely; re-attaching a <link> re-fetches from cache.
      const shouldApply = link.dataset.themeMode === this.mode;
      if (shouldApply && !link.isConnected) {
        document.head.appendChild(link);
      } else if (!shouldApply && link.isConnected) {
        link.remove();
      }
    }
  }

  public apply(mode: ThemeMode): void {
    this.mode = mode;
    document.documentElement.dataset.colorMode = mode;
    this.applyStylesheets();
    this.options.onMermaidThemeChange(mode);
    this.options.onModeApplied?.(mode);
  }

  public getMode(): ThemeMode {
    return this.mode;
  }
}
```

### Step 5.3: Add the Latte variable overrides

[MODIFY] `src/style.css` — append after the existing `:root` block
```css
/* --------------------------------------------------------------------------
   Light theme — Catppuccin Latte.

   The dark `:root` set above is Mocha; Latte is its documented light
   counterpart, so accent and semantic colors stay coherent across the switch.
   --------------------------------------------------------------------------- */

[data-color-mode="light"] {
  --bg-primary: #eff1f5;
  --bg-secondary: #e6e9ef;
  --bg-elevated: #ccd0da;
  --border-color: #bcc0cc;
  --text-primary: #4c4f69;
  --text-muted: #6c6f85;
  --accent-color: #1e66f5;
  --dot-color: #fe640b;
  --danger-color: #d20f39;
  color-scheme: light;
}

[data-color-mode="light"] .header-controls button:hover,
[data-color-mode="light"] .header-controls button.active {
  color: #eff1f5;
}

[data-color-mode="light"] .markdown-body code {
  background-color: rgba(172, 176, 190, 0.4);
}

[data-color-mode="light"] .markdown-body table tr:nth-child(2n) {
  background-color: rgba(172, 176, 190, 0.25);
}
```

The two trailing overrides exist because `.header-controls button:hover` sets
`color: var(--bg-primary)`, which on Latte is near-white — correct on Mocha's
dark background, but unreadable on Latte's light accent.

### Step 5.4: Expose Mermaid theme variables from markdown.ts

[MODIFY] `src/markdown.ts` — lift the existing `themeVariables` object literal out
of `mermaid.initialize` into a named constant, byte-for-byte unchanged, then
add the theme switcher:

```ts
import { LIGHT_MERMAID_VARIABLES } from "./theme";
import type { ThemeMode } from "./preferences";

/**
 * Mocha variables, unchanged from the previous hard-coded literal.
 *
 * "base" plus explicit variables: mermaid's stock "dark" theme fights the
 * Catppuccin surface and renders near-invisible diagram labels.
 */
const DARK_MERMAID_VARIABLES: Record<string, string> = {
  background: "#181825",
  primaryColor: "#313244",
  primaryTextColor: "#cdd6f4",
  primaryBorderColor: "#585b70",
  lineColor: "#6c7086",
  secondaryColor: "#45475a",
  tertiaryColor: "#181825",
  textColor: "#cdd6f4",
  mainBkg: "#313244",
  nodeBorder: "#585b70",
  clusterBkg: "#181825",
  clusterBorder: "#45475a",
  titleColor: "#cdd6f4",
  edgeLabelBackground: "#181825",
  fontSize: "14px",
};

/**
 * Re-initialises Mermaid for the active theme.
 *
 * Mermaid bakes its colors into the SVG at render time, so a mode change must
 * be followed by a re-render of the active document; already-drawn diagrams keep
 * the previous palette until then. This is the one place theme and content
 * state genuinely couple.
 */
export function applyMermaidTheme(mode: ThemeMode): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    themeVariables:
      mode === "dark" ? DARK_MERMAID_VARIABLES : LIGHT_MERMAID_VARIABLES,
  });
}

applyMermaidTheme("dark");
```

The `mermaid.initialize(...)` call at the top of the file is **replaced** by the
`applyMermaidTheme("dark")` call at the bottom, so the dark palette is still
applied before the first render.

### Step 5.5: Verify

```bash
npm run typecheck && npm run tauri dev -- ./README.md
```

Check: the toggle swaps chrome and markdown surfaces; code blocks change from
`github-dark` to `github`; a Mermaid diagram's colors change after the re-render.

---

## Phase 6: Metadata Table View

### Step 6.1: Implement the table view

[NEW FILE] `src/metadata-table.ts`
```ts
import type { FrontmatterRow } from "./frontmatter";

/** Placeholder for a key declared without a value. */
const EMPTY_PLACEHOLDER = "—";

export interface MetadataTableOptions {
  /** Rendered as the summary row; also the TOC's metadata anchor. */
  title?: string;
  /** Defaults to true. Optional so callers can pass `{}`. */
  expanded?: boolean;
}

/**
 * Renders frontmatter as a two-column table inside a `<details>`.
 *
 * The native element supplies the disclosure semantics, keyboard handling and
 * open/closed state, so no custom ARIA wiring is needed. Expanded state is
 * owned by the caller because it must survive the live reloads that rebuild
 * this element from scratch.
 */
export function createMetadataTable(
  rows: FrontmatterRow[],
  options: MetadataTableOptions = {},
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "metadata-table";
  details.id = "doc-metadata";
  details.open = options.expanded ?? true;

  const summary = document.createElement("summary");
  summary.className = "metadata-summary";
  summary.textContent = options.title ?? "Document metadata";
  details.appendChild(summary);

  const table = document.createElement("table");
  table.className = "metadata-grid";

  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Field", "Value"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.appendChild(cell);
  }
  header.appendChild(headerRow);
  table.appendChild(header);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.depth > 0) tr.className = "metadata-row-nested";

    const key = document.createElement("th");
    key.scope = "row";
    // Nested keys indent rather than repeat the parent path, so a wide value
    // column stays readable.
    key.textContent = row.depth > 0 ? `↳ ${row.key}` : row.key;
    key.classList.add("metadata-key");

    const value = document.createElement("td");
    value.classList.add("metadata-value");
    if (row.kind === "empty") {
      value.textContent = EMPTY_PLACEHOLDER;
      value.classList.add("metadata-empty");
    } else {
      value.textContent = row.value ?? EMPTY_PLACEHOLDER;
    }
    if (row.malformed) tr.classList.add("metadata-malformed");

    tr.append(key, value);
    body.appendChild(tr);
  }

  table.appendChild(body);
  details.appendChild(table);
  return details;
}
```

[NEW FILE] `src/metadata-table.test.ts`
```ts
import { describe, expect, it } from "vitest";

import { createMetadataTable } from "./metadata-table";
import { parseFrontmatterRows } from "./frontmatter";

describe("createMetadataTable", () => {
  it("renders one row per frontmatter field", () => {
    const table = createMetadataTable(
      parseFrontmatterRows("title: A Plan\nstatus: draft"),
    );
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]?.textContent).toContain("title");
    expect(bodyRows[0]?.textContent).toContain("A Plan");
  });

  it("uses a summary as the disclosure label", () => {
    const table = createMetadataTable([]);
    const summary = table.querySelector("summary");
    expect(summary?.textContent).toBe("Document metadata");
  });

  it("honours the requested expanded state", () => {
    expect(createMetadataTable([], { expanded: true }).open).toBe(true);
    expect(createMetadataTable([], { expanded: false }).open).toBe(false);
  });

  it("marks nested keys and indents them", () => {
    const table = createMetadataTable(parseFrontmatterRows("meta:\n  nested: true\n"));
    const rows = table.querySelectorAll("tbody tr");
    expect(rows[0]?.classList.contains("metadata-row-nested")).toBe(false);
    expect(rows[1]?.classList.contains("metadata-row-nested")).toBe(true);
    expect(rows[1]?.textContent).toContain("↳ nested");
  });

  it("shows a placeholder for a valueless key", () => {
    const table = createMetadataTable(parseFrontmatterRows("emptyValue:\n"));
    const cell = table.querySelector(".metadata-empty");
    expect(cell?.textContent).toBe("—");
  });

  it("flags malformed frontmatter for styling", () => {
    const table = createMetadataTable(parseFrontmatterRows("a: [unclosed"));
    expect(
      table.querySelector("tbody tr")?.classList.contains("metadata-malformed"),
    ).toBe(true);
  });
});
```

### Step 6.2: Style the table

[MODIFY] `src/style.css` — append
```css
/* --------------------------------------------------------------------------
   Frontmatter metadata table

   Sits above the document body inside the scroll pane, so it scrolls with the
   content and is reachable by the TOC's "Document metadata" entry.
   -------------------------------------------------------------------------- */

.markdown-body .metadata-table {
  margin: 0 0 24px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-secondary);
  overflow: hidden;
}

.markdown-body .metadata-summary {
  cursor: pointer;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
  list-style-position: inside;
}

.markdown-body .metadata-summary:hover {
  color: var(--text-primary);
}

.markdown-body .metadata-grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 0;
}

.markdown-body .metadata-grid th,
.markdown-body .metadata-grid td {
  border: none;
  border-top: 1px solid var(--border-color);
  padding: 6px 12px;
  text-align: left;
  vertical-align: top;
}

.markdown-body .metadata-grid thead th {
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.markdown-body .metadata-grid tbody tr {
  background-color: transparent;
}

.markdown-body .metadata-key {
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Code", monospace;
  color: var(--accent-color);
  white-space: nowrap;
  width: 1%;
}

.markdown-body .metadata-value {
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Code", monospace;
  color: var(--text-primary);
  /* Long values (a full path, a wrapped title) must wrap rather than force the
     whole table wider than the pane. */
  overflow-wrap: anywhere;
}

.markdown-body .metadata-row-nested .metadata-key {
  padding-left: 26px;
}

.markdown-body .metadata-empty {
  color: var(--text-muted);
}

.markdown-body .metadata-malformed .metadata-value {
  color: var(--danger-color);
  white-space: pre-wrap;
}
```

### Step 6.3: Verify

```bash
npm run test:web
```

---

## Phase 7: TOC Panel

### Step 7.1: Implement the panel

[NEW FILE] `src/toc-panel.ts`
```ts
import type { Heading } from "./toc";

/** Id of the metadata table the pinned TOC entry jumps to. */
const METADATA_ANCHOR_ID = "doc-metadata";
const METADATA_LABEL = "Document metadata";

/** Offset in px used when jumping to a heading, clearing the sticky header. */
const SCROLL_OFFSET_PX = 12;

export interface TocPanelOptions {
  /** The <nav> that lists the outline. */
  container: HTMLElement;
  /** The scrollable pane the headings live in. */
  scrollParent: HTMLElement;
  /** Expands the metadata table before scrolling to it. */
  onJumpToMetadata?: () => void;
}

/**
 * Renders the outline and tracks the reading position.
 *
 * The observer is rebuilt on every render — the underlying heading elements are
 * replaced wholesale by each live reload, so stale observers would reference
 * detached nodes and silently stop tracking.
 */
export class TocPanel {
  private observer: IntersectionObserver | null = null;
  private readonly entryBySlug = new Map<string, HTMLLIElement>();
  private readonly headings: Heading[] = [];
  private readonly metadataEntry: HTMLLIElement;
  private readonly list: HTMLUListElement;

  constructor(private readonly options: TocPanelOptions) {
    this.options.container.replaceChildren();

    this.list = document.createElement("ul");
    this.list.className = "toc-list";

    // The metadata entry is always present — an entry that vanished when the
    // reader needed it would be a trap.
    this.metadataEntry = document.createElement("li");
    this.metadataEntry.className = "toc-item toc-item-metadata";
    const metadataLink = document.createElement("a");
    metadataLink.className = "toc-link";
    metadataLink.href = `#${METADATA_ANCHOR_ID}`;
    metadataLink.textContent = METADATA_LABEL;
    metadataLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.options.onJumpToMetadata?.();
    });
    this.metadataEntry.appendChild(metadataLink);

    this.options.container.append(this.metadataEntry, this.list);
  }

  public rebuild(headings: Heading[]): void {
    this.headings.splice(0, this.headings.length, ...headings);
    this.list.replaceChildren();
    this.entryBySlug.clear();
    this.disconnect();

    if (headings.length === 0) {
      this.options.container.classList.add("toc-empty");
      return;
    }
    this.options.container.classList.remove("toc-empty");

    for (const heading of headings) {
      const item = document.createElement("li");
      item.className = `toc-item toc-depth-${heading.depth}`;

      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = `#${heading.slug}`;
      link.textContent = heading.text;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.scrollTo(heading.slug);
      });

      item.appendChild(link);
      this.list.appendChild(item);
      this.entryBySlug.set(heading.slug, item);
    }

    this.observe();
  }

  private scrollTo(slug: string): void {
    const target = document.getElementById(slug);
    if (!target) return;

    const top =
      target.getBoundingClientRect().top -
      this.options.scrollParent.getBoundingClientRect().top +
      this.options.scrollParent.scrollTop -
      SCROLL_OFFSET_PX;
    this.options.scrollParent.scrollTo({ top, behavior: "smooth" });
    this.setActive(slug);
  }

  private observe(): void {
    if (typeof IntersectionObserver === "undefined") return;

    this.observer = new IntersectionObserver(
      (entries) => {
        // The topmost intersecting heading is the one being read.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        const first = visible[0];
        if (!first) return;
        this.setActive(first.target.id);
      },
      {
        root: this.options.scrollParent,
        // A band near the top of the pane: a heading counts as "current" once it
        // reaches the top third rather than merely being on screen.
        rootMargin: `-${SCROLL_OFFSET_PX}px 0px -70% 0px`,
        threshold: 0,
      },
    );

    for (const heading of this.headings) {
      const element = document.getElementById(heading.slug);
      if (element) this.observer.observe(element);
    }
  }

  private setActive(slug: string): void {
    for (const [key, item] of this.entryBySlug) {
      item.classList.toggle("active", key === slug);
    }

    const active = this.entryBySlug.get(slug);
    if (active) {
      // Keep the active entry in view without scrolling the whole page.
      active.scrollIntoView({ block: "nearest" });
    }
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
```

### Step 7.2: Wire the metadata jump

[NEW FILE] `src/tetadata-jump.ts`
```ts
import { createMetadataTable, type MetadataTableOptions } from "./metadata-table";
import type { FrontmatterRow } from "./frontmatter";

const METADATA_ANCHOR_ID = "doc-metadata";

/**
 * Owns the frontmatter table's collapsed state.
 *
 * Collapsed state lives here rather than on the element because every live
 * reload rebuilds the `<details>` from scratch — without a durable record, an
 * agent appending to a document would silently re-expand the table the reader
 * had just folded away.
 */
export class MetadataView {
  private expanded: boolean;
  private current: HTMLDetailsElement | null = null;
  private readonly viewer: HTMLElement;

  constructor(viewer: HTMLElement, expanded: boolean) {
    this.viewer = viewer;
    this.expanded = expanded;
  }

  public isExpanded(): boolean {
    return this.expanded;
  }

  /** Mounts (or updates) the table at the top of the viewer. */
  public mount(rows: FrontmatterRow[], options: MetadataTableOptions = {}): void {
    const table = createMetadataTable(rows, { ...options, expanded: this.expanded });
    this.current = table;

    // Re-read the element's own state: the reader may have folded the table
    // without going through any of our own controls.
    table.addEventListener("toggle", () => {
      this.expanded = table.open;
    });

    // Placed before the existing body content so the header reads as a header.
    this.viewer.prepend(table);
  }

  /** Expands the table and scrolls it into view. Used by the TOC entry. */
  public reveal(): void {
    if (!this.current) return;
    this.current.open = true;
    this.expanded = true;
    this.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  public clear(): void {
    this.current = null;
  }
}

export { METADATA_ANCHOR_ID };
```

[NEW FILE] `src/metadata-jump.test.ts`
```ts
import { beforeEach, describe, expect, it } from "vitest";

import { parseFrontmatterRows } from "./frontmatter";
import { MetadataView } from "./metadata-jump";

const ROWS = parseFrontmatterRows("title: A Plan\nstatus: draft");

describe("MetadataView", () => {
  let viewer: HTMLElement;
  let view: MetadataView;

  beforeEach(() => {
    document.body.replaceChildren();
    viewer = document.createElement("article");
    document.body.appendChild(viewer);
    view = new MetadataView(viewer, true);
  });

  it("mounts the table as the viewer's first child", () => {
    viewer.appendChild(document.createElement("h1"));
    view.mount(ROWS);
    expect(viewer.firstElementChild?.tagName).toBe("DETAILS");
  });

  it("records a fold made directly on the element", () => {
    view.mount(ROWS);
    const table = viewer.querySelector("details");
    expect(table).not.toBeNull();
    if (!table) return;

    table.open = false;
    table.dispatchEvent(new Event("toggle"));
    expect(view.isExpanded()).toBe(false);
  });

  it("keeps a folded table folded across the remount a reload causes", () => {
    view.mount(ROWS);
    const first = viewer.querySelector("details");
    if (!first) throw new Error("metadata table was not mounted");
    first.open = false;
    first.dispatchEvent(new Event("toggle"));

    // The reload path clears and re-mounts; an agent appending to the document
    // must not silently re-expand what the reader folded away.
    view.clear();
    view.mount(ROWS);
    expect(viewer.querySelector("details")?.open).toBe(false);
  });

  it("reveal expands the table", () => {
    view.mount(ROWS);
    const table = viewer.querySelector("details");
    if (!table) throw new Error("metadata table was not mounted");
    table.open = false;

    view.reveal();
    expect(view.isExpanded()).toBe(true);
    expect(viewer.querySelector("details")?.open).toBe(true);
  });

  it("reveal is a no-op when no table is mounted", () => {
    expect(() => view.reveal()).not.toThrow();
  });
});
```

### Step 7.3: Add TOC grid area and styling

[MODIFY] `src/style.css` — modify the layout rules
```css
/* The outline is a third grid column between the tab bar and the document.
   It collapses to zero width when hidden so the document pane reclaims the
   space without a reflow of its own internals. */
.app-layout {
  grid-template-columns: auto auto minmax(0, 1fr);
  grid-template-areas:
    "header header header"
    "tabs   toc    content";
}

.layout-top {
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    "header"
    "tabs   toc"
    "tabs   content";
}

#toc-panel {
  grid-area: toc;
  width: 240px;
  min-width: 0;
  overflow-y: auto;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 12px 0;
}

#toc-panel[hidden] {
  display: none;
}
```

[MODIFY] `src/style.css` — append
```css
/* --------------------------------------------------------------------------
   Table of contents sidebar
   -------------------------------------------------------------------------- */

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-item {
  margin: 0;
}

.toc-link {
  display: block;
  padding: 4px 14px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-muted);
  text-decoration: none;
  border-left: 2px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-link:hover {
  color: var(--text-primary);
}

/* Indentation mirrors heading depth so the outline's shape is visible. */
.toc-depth-1 .toc-link {
  padding-left: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.toc-depth-2 .toc-link {
  padding-left: 24px;
}

.toc-depth-3 .toc-link {
  padding-left: 34px;
}

.toc-depth-4 .toc-link {
  padding-left: 44px;
}

.toc-item.active > .toc-link {
  color: var(--accent-color);
  border-left-color: var(--accent-color);
  background-color: var(--bg-elevated);
}

.toc-item-metadata {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
}

.toc-item-metadata .toc-link {
  font-weight: 600;
  color: var(--text-primary);
}

.toc-empty .toc-list {
  display: none;
}
```

### Step 7.4: Add the panel markup

[MODIFY] `index.html`
```html
      <nav id="tabs-bar" class="tabs-container"></nav>
      <nav id="toc-panel" hidden aria-label="Table of contents"></nav>
```

---

## Phase 8: Toolbar Buttons and App Wiring

### Step 8.1: Add toolbar buttons

[MODIFY] `index.html`
```html
        <div class="header-controls">
          <button id="toggle-layout-btn" title="Toggle Sidebar/Top Tabs">
            &#8644; Layout
          </button>
          <button id="toggle-autosort-btn" title="Toggle Auto-sort by Last Modified">
            &#9889; Auto-Sort: OFF
          </button>
          <button id="toggle-toc-btn" title="Toggle Table of Contents">
            &#9776; Outline: OFF
          </button>
          <button id="toggle-frontmatter-btn" title="Toggle Document Metadata">
            &#9881; Frontmatter: ON
          </button>
          <button id="toggle-theme-btn" title="Toggle Light/Dark Theme">
            &#9788; Theme: Dark
          </button>
        </div>
```

### Step 8.2: Persist debounced writes

[MODIFY] `src/preferences.ts` — append
```ts
/**
 * Writes preferences on a trailing debounce.
 *
 * Four toggles flapping in quick succession should cost one write, not four,
 * and `localStorage` is synchronous — it blocks the webview's main thread.
 */
export function createPreferenceWriter(delayMs = 250): {
  schedule(preferences: Preferences): void;
  flush(preferences: Preferences): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Preferences | null = null;

  return {
    schedule(preferences: Preferences): void {
      pending = preferences;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) savePreferences(pending);
        pending = null;
      }, delayMs);
    },
    flush(preferences: Preferences): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      savePreferences(preferences);
    },
  };
}
```

### Step 8.3: Rewrite `main.ts` as orchestrator

[MODIFY] `src/main.ts` — full replacement

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parseFrontmatterRows, splitFrontmatter } from "./frontmatter";
import { applyMermaidTheme, marked, renderMarkdown } from "./markdown";
import { MetadataView } from "./metadata-jump";
import {
  createPreferenceWriter,
  loadPreferences,
  type Preferences,
  type ThemeMode,
} from "./preferences";
import { createToggleButton } from "./toolbar";
import { extractHeadings } from "./toc";
import { TocPanel } from "./toc-panel";
import { ThemeController } from "./theme";

interface FilePayload {
  path: string;
  filename: string;
  content: string;
  modified_time: number;
}

interface Tab {
  path: string;
  filename: string;
  content: string;
  modifiedTime: number;
  hasUnreadUpdate: boolean;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: #${id}`);
  return el as T;
}

class AppState {
  private readonly tabs = new Map<string, Tab>();
  private activePath: string | null = null;
  private autoSort = false;
  private sidebarLayout = false;

  /**
   * Monotonic token per document. A reload only paints when it is still the
   * newest request for that path, so a slow read cannot overwrite a newer one.
   */
  private readonly reloadTokens = new Map<string, number>();

  private preferences: Preferences = loadPreferences();

  private readonly appRoot = must<HTMLDivElement>("app");
  private readonly tabsBar = must<HTMLElement>("tabs-bar");
  private readonly emptyState = must<HTMLElement>("empty-state");
  private readonly viewer = must<HTMLElement>("markdown-viewer");
  private readonly contentContainer = must<HTMLElement>("content-container");
  private readonly tocPanelEl = must<HTMLElement>("toc-panel");
  private readonly layoutBtn = must<HTMLButtonElement>("toggle-layout-btn");
  private readonly autosortBtn = must<HTMLButtonElement>("toggle-autosort-btn");

  private readonly writer = createPreferenceWriter();
  private readonly tocPanel: TocPanel;
  private readonly metadata: MetadataView;
  private readonly theme: ThemeController;

  constructor() {
    this.metadata = new MetadataView(
      this.viewer,
      this.preferences.frontmatterVisible,
    );
    this.tocPanel = new TocPanel({
      container: this.tocPanelEl,
      scrollParent: this.contentContainer,
      onJumpToMetadata: () => this.metadata.reveal(),
    });
    this.theme = new ThemeController({
      onMermaidThemeChange: applyMermaidTheme,
      // Mermaid bakes colors into the SVG at render time, so a mode change has
      // to be followed by a re-render or diagrams keep the old palette.
      onModeApplied: () => void this.renderActiveContent(),
    });

    this.applyPreferencesToUi();
    this.bindControls();
    this.theme.apply(this.preferences.themeMode);
    void this.start();
  }

  /** Applies the restored preferences before any control is clicked. */
  private applyPreferencesToUi(): void {
    this.tocPanelEl.hidden = !this.preferences.tocVisible;
  }

  private persist(): void {
    this.writer.schedule(this.preferences);
  }

  private async start(): Promise<void> {
    // Listeners first, so no CLI or watcher event can arrive unhandled.
    await this.bindBackend();
    await this.loadStartupPaths();
  }

  /// Pulls the documents this process was launched with. `startup_paths` is a
  /// command rather than an event precisely because the webview may not have
  /// mounted yet when the app finishes setting itself up.
  private async loadStartupPaths(): Promise<void> {
    try {
      const paths = await invoke<string[]>("startup_paths");
      for (const path of paths) {
        await this.openDocument(path);
      }
    } catch (error) {
      console.error("Failed to read startup paths", error);
    }
  }

  // -- wiring ---------------------------------------------------------------

  private bindControls(): void {
    this.layoutBtn.addEventListener("click", () => {
      this.sidebarLayout = !this.sidebarLayout;
      this.appRoot.classList.toggle("layout-top", !this.sidebarLayout);
      this.appRoot.classList.toggle("layout-side", this.sidebarLayout);
    });

    this.autosortBtn.addEventListener("click", () => {
      this.autoSort = !this.autoSort;
      this.autosortBtn.classList.toggle("active", this.autoSort);
      this.autosortBtn.textContent = `⚡ Auto-Sort: ${
        this.autoSort ? "ON" : "OFF"
      }`;
      this.renderTabs();
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-toc-btn"),
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle Table of Contents",
      initialState: this.preferences.tocVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.tocVisible = next;
        this.tocPanelEl.hidden = !next;
        this.persist();
      },
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-frontmatter-btn"),
      icon: "⚙",
      label: "Frontmatter",
      tooltip: "Toggle Document Metadata",
      initialState: this.preferences.frontmatterVisible,
      formatLabel: (state) => (state ? "ON" : "OFF"),
      onChange: (next) => {
        this.preferences.frontmatterVisible = next;
        const table = this.viewer.querySelector("details.metadata-table");
        if (table) table.remove();
        if (next) void this.renderActiveContent();
        this.persist();
      },
    });

    createToggleButton({
      element: must<HTMLButtonElement>("toggle-theme-btn"),
      icon: "☀",
      label: "Theme",
      tooltip: "Toggle Light/Dark Theme",
      initialState: this.preferences.themeMode === "light",
      formatLabel: (state) => (state ? "Light" : "Dark"),
      onChange: (next) => {
        const mode: ThemeMode = next ? "light" : "dark";
        this.preferences.themeMode = mode;
        this.theme.apply(mode);
        this.persist();
      },
    });
  }

  private async bindBackend(): Promise<void> {
    try {
      // A second `docdeck <file>` in another shell, or args from the first launch.
      await listen<string>("open-file-cli", (event) => {
        void this.openDocument(event.payload);
      });

      // A background write settled by the debounced inotify watcher.
      await listen<string>("file-updated", (event) => {
        void this.reloadDocument(event.payload);
      });
    } catch (error) {
      console.error("Failed to attach backend listeners", error);
      this.showMessage("Could not connect to the docdeck backend.");
    }
  }

  // -- document lifecycle ---------------------------------------------------

  public async openDocument(rawPath: string): Promise<void> {
    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: rawPath });

      const existing = this.tabs.get(data.path);
      if (existing) {
        existing.filename = data.filename;
        existing.content = data.content;
        existing.modifiedTime = data.modified_time;
      } else {
        this.tabs.set(data.path, {
          path: data.path,
          filename: data.filename,
          content: data.content,
          modifiedTime: data.modified_time,
          hasUnreadUpdate: false,
        });
      }

      this.setActiveTab(data.path);
    } catch (error) {
      console.error(`Failed to load file: ${rawPath}`, error);
      this.showMessage(`Could not open ${rawPath}`);
    }
  }

  private async reloadDocument(path: string): Promise<void> {
    const tab = this.tabs.get(path);
    if (!tab) return;

    const token = (this.reloadTokens.get(path) ?? 0) + 1;
    this.reloadTokens.set(path, token);

    try {
      const data = await invoke<FilePayload>("load_file", { pathStr: path });
      if (this.reloadTokens.get(path) !== token) return; // superseded

      tab.content = data.content;
      tab.modifiedTime = data.modified_time;

      if (this.activePath === path) {
        // Reading this tab, so the change is not "unread" — paint it straight away.
        tab.hasUnreadUpdate = false;
      } else {
        tab.hasUnreadUpdate = true;
      }

      this.renderTabs();
      if (this.activePath === path) {
        await this.renderActiveContent();
      }
    } catch (error) {
      console.error(`Failed to reload modified file: ${path}`, error);
    }
  }

  public setActiveTab(path: string): void {
    this.activePath = path;
    const tab = this.tabs.get(path);
    if (tab) tab.hasUnreadUpdate = false;

    this.renderTabs();
    void this.renderActiveContent();
  }

  private async closeTab(path: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      await invoke("close_file", { pathStr: path });
    } catch (error) {
      console.error(`Failed to release watch for ${path}`, error);
    }

    this.tabs.delete(path);
    this.reloadTokens.delete(path);

    if (this.activePath === path) {
      const remaining = [...this.tabs.keys()];
      this.activePath = remaining[remaining.length - 1] ?? null;
    }

    this.renderTabs();
    await this.renderActiveContent();
  }

  // -- rendering ------------------------------------------------------------

  private renderTabs(): void {
    this.tabsBar.replaceChildren();

    const ordered = [...this.tabs.values()];
    if (this.autoSort) {
      ordered.sort((a, b) => b.modifiedTime - a.modifiedTime);
    }

    for (const tab of ordered) {
      const item = document.createElement("div");
      item.className = "tab-item";
      item.setAttribute("role", "tab");
      item.setAttribute("tabindex", "0");
      if (tab.path === this.activePath) item.classList.add("active");
      if (tab.hasUnreadUpdate) item.classList.add("has-update");
      item.addEventListener("click", () => this.setActiveTab(tab.path));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.setActiveTab(tab.path);
        }
      });

      const dot = document.createElement("span");
      dot.className = "tab-dot";

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.filename;
      title.title = tab.path;

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("role", "button");
      close.setAttribute("aria-label", `Close ${tab.filename}`);
      close.addEventListener("click", (event) => {
        void this.closeTab(tab.path, event);
      });

      item.append(dot, title, close);
      this.tabsBar.appendChild(item);
    }
  }

  /**
   * Paints the active document.
   *
   * Order matters: frontmatter is split off and rendered above the body, the
   * body is compiled with heading slugs stamped onto its h1-h4 elements, and
   * only then is the TOC rebuilt — it resolves anchors by id against the
   * elements the previous step wrote.
   */
  private async renderActiveContent(): Promise<void> {
    const tab = this.activePath ? this.tabs.get(this.activePath) : undefined;

    if (!tab) {
      this.emptyState.classList.remove("hidden");
      this.viewer.classList.add("hidden");
      this.viewer.replaceChildren();
      this.metadata.clear();
      this.tocPanel.rebuild([]);
      return;
    }

    this.emptyState.classList.add("hidden");
    this.viewer.classList.remove("hidden");

    const { raw, body } = splitFrontmatter(tab.content);

    try {
      this.metadata.clear();
      this.viewer.replaceChildren();

      if (raw !== null && this.preferences.frontmatterVisible) {
        this.metadata.mount(parseFrontmatterRows(raw));
      }

      const headings = extractHeadings(marked, body);
      await renderMarkdown(body, this.viewer, headings);

      this.tocPanel.rebuild(headings);
    } catch (error) {
      console.error("Failed to render markdown", error);
      this.showMessage(`Could not render ${tab.filename}`);
    }
  }

  private showMessage(message: string): void {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    this.emptyState.replaceChildren(paragraph);
    this.emptyState.classList.remove("hidden");
    this.viewer.classList.add("hidden");
  }
}

function bootstrap(): void {
  try {
    new AppState();
  } catch (error) {
    console.error("docdeck failed to start", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
```

`extractHeadings(marked, body)` receives the `Marked` instance exported from
`markdown.ts` in Step 8.4, so the outline is lexed by the same parser that
renders the body and the two cannot disagree on tokenization.

### Step 8.4: Export the Marked instance and accept heading slugs

[MODIFY] `src/markdown.ts`
```ts
/** Exported so TOC extraction lexes with the exact same parser the renderer
 *  uses. Two instances could disagree on tokenization and produce slugs that do
 *  not match the rendered headings. */
export const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);
```

Change the function signature and stamp ids after parsing:
```ts
export async function renderMarkdown(
  content: string,
  targetEl: HTMLElement,
  headings: Heading[] = [],
): Promise<void> {
  const scrollParent = targetEl.parentElement;
  const previousScrollTop = scrollParent?.scrollTop ?? 0;
  const wasTailing =
    !!scrollParent &&
    scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight <=
      TAIL_THRESHOLD_PX;

  // `marked.parse` is typed `string | Promise<string>`. It resolves
  // synchronously here because no async extension is registered, but the type
  // is the contract — keep the await rather than asserting the narrowing away.
  const html: string = await marked.parse(content);
  targetEl.innerHTML = html;

  stampHeadingIds(targetEl, headings);

  // ... existing task-list, mermaid and scroll restoration logic unchanged ...
}
```

with:
```ts
/**
 * Writes the pre-computed slug onto each rendered heading.
 *
 * `marked` emits no `id` attributes, so the TOC's anchors have no target without
 * this. Headings are matched by document order, which is exactly how
 * `extractHeadings` produced the slug list.
 */
function stampHeadingIds(
  targetEl: HTMLElement,
  headings: Heading[],
): void {
  if (headings.length === 0) return;

  const elements = targetEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
  headings.forEach((heading, index) => {
    const element = elements[index];
    if (element) element.id = heading.slug;
  });
}
```

Add the type import at the top of `markdown.ts`:
```ts
import type { Heading } from "./toc";
```

### Step 8.5: Make the metadata anchor scroll target work

The metadata jump scrolls the whole `<details>` into view, which is sufficient
because `MetadataView.reveal()` calls `scrollIntoView` directly.

### Step 8.6: Verify the full build

```bash
npm run typecheck
npm run test:web
npm run test
npm run lint:rs
npm run tauri dev -- ./_ai/backlog/active/261001_2316__IMPLEMENTATION_PLAN__frontmatter_toc_theme_toggles.md
```

Check against this plan file, which exercises every case:
- The `---` block renders as a table, not prose; no stray `<hr>` above it.
- `tags: [typescript, vite, ...]` renders as `[typescript, vite, ...]`.
- `createdAt: 2026-10-01 23:16` renders as a string, not a mangled date.
- `filename:` wraps rather than widening the table.
- Outline lists `Problem Statement`, `Executive Summary`, … to depth 4.
- Clicking an outline entry scrolls the heading to the pane top.
- Clicking `Document metadata` expands the table if folded and scrolls to it.
- Theme toggle flips chrome, markdown surface, code colors and diagram colors.
- All three new toggles survive a restart.

---

## Phase 9: End-to-End Simulation Update

### Step 9.1: Extend the verification checklist

[MODIFY] `scripts/simulate_agent_writes.sh` — extend the closing checklist and
seed a frontmatter block so the simulated documents exercise the new path.

```bash
printf -- '---\ntitle: "Agent Alpha"\nstatus: in-progress\ntags: [agent, alpha]\n---\n\n# Agent Alpha — Initial Plan\n\n- [ ] Step pending\n' > "$DOC_ALPHA"
printf -- '---\ntitle: "Agent Beta"\nstatus: in-progress\ntags: [agent, beta]\n---\n\n# Agent Beta — Initial Report\n\n- [ ] Step pending\n' > "$DOC_BETA"
```

And in the `cat <<'EOF'` block, add:
```
  5. Both simulated documents open with a frontmatter table above the body.
  6. The Outline button lists the documents' headings and jumps to one.
  7. Folding the metadata table survives the agent's background appends.
  8. The Theme button flips chrome, code blocks and Mermaid colors.
```

### Step 9.2: Verify

```bash
npm run simulate
```

---

## Phase 10: Project Housekeeping and User Documentation

### Step 10.1: `.gitignore`

No new file types, directories or build artifacts are introduced. `vitest`
creates no coverage output unless `--coverage` is passed, and `dist/` is already
ignored. One optional addition if coverage is ever enabled:

[MODIFY] `.gitignore`
```gitignore
# Vitest coverage output
coverage/
```

Already present (`coverage/` and `htmlcov/` are listed). **No change required.**

### Step 10.2: README

[MODIFY] `README.md` — three edits.

Add to the Features list:
```markdown
- **Frontmatter as a table** — YAML headers render as a collapsible,
  two-column metadata table instead of raw text, with a TOC entry that jumps
  to it.
- **Table of contents** — an `h1`–`h4` outline in a collapsible sidebar that
  tracks the reading position as you scroll.
- **Light and dark themes** — Catppuccin Mocha and Latte, covering the app
  chrome, GitHub markdown styles, syntax highlighting and Mermaid diagrams.
```

Extend the controls table:
```markdown
| `☰ Outline` | Show or hide the table of contents sidebar |
| `⚙ Frontmatter` | Show or hide the metadata table above each document |
| `☀ Theme` | Switch between the dark and light palettes |
```

Add a Preferences subsection after Usage:
```markdown
### Preferences

Theme, outline visibility and frontmatter visibility are stored under the
`docdeck.preferences.v1` key in `localStorage`, so docdeck reopens the way you
left it. Clear that key to reset to defaults (dark theme, outline hidden,
frontmatter shown).
```

Update the Architecture tree:
```
src/                  Frontend — tab state, layout, markdown rendering
  main.ts             AppState: tab registry, CLI events, watcher events, wiring
  markdown.ts         marked + highlight.js + mermaid pipeline, heading ids
  frontmatter.ts      YAML header split + parse into table rows
  toc.ts              Heading extraction and GitHub-compatible slugs
  toc-panel.ts        Outline sidebar, scroll-spy, jump-to-heading
  theme.ts            Stylesheet swap, Catppuccin Latte, mermaid theming
  metadata-table.ts   Frontmatter <details> table view
  metadata-jump.ts    Metadata collapsed state and reveal
  toolbar.ts          Reusable toggle button
  preferences.ts      Versioned localStorage persistence
  style.css           Catppuccin Mocha + Latte, layouts, markdown overrides
```

And the Development block:
```bash
npm run test:web                   # vitest (frontend unit tests)
npm test                           # cargo test + vitest
```

### Step 10.3: CHANGELOG

[MODIFY] `CHANGELOG.md` — add under `## [Unreleased]`
```markdown
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
```

### Step 10.4: Commit

```bash
git add -A
git commit -m "feat: frontmatter table, table of contents, light/dark theme and view toggles"
```

---

## Phase 11: Implementation Report

Write to `_ai/backlog/reports/261001_2316__IMPLEMENTATION_REPORT__frontmatter_toc_theme_toggles.md`.

```markdown
---
filename: "_ai/backlog/reports/261001_2316__IMPLEMENTATION_REPORT__frontmatter_toc_theme_toggles.md"
title: "Report: Frontmatter Metadata Table, Table of Contents, Light/Dark Theme and View Toggles for docdeck"
createdAt: <completion timestamp>
updatedAt: <completion timestamp>
planFile: "_ai/backlog/active/261001_2316__IMPLEMENTATION_PLAN__frontmatter_toc_theme_toggles.md"
project: "docdeck"
status: completed
completedAt: 2026-10-02 08:35
filesCreated: 0
filesModified: 0
filesDeleted: 0
tags: [typescript, vite, markdown, frontmatter, yaml, toc, theming, vitest]
documentType: IMPLEMENTATION_REPORT
---

# Implementation Report: Frontmatter Table, TOC, Theme and Toggles

## 1. Summary
<2-3 sentences: what was built, what now renders, what the user can do.>

## 2. Files Changed
**New**: `src/frontmatter.ts`, `src/frontmatter.test.ts`, `src/toc.ts`,
`src/toc.test.ts`, `src/preferences.ts`, `src/preferences.test.ts`,
`src/toolbar.ts`, `src/toolbar.test.ts`, `src/theme.ts`,
`src/metadata-table.ts`, `src/metadata-table.test.ts`, `src/metadata-jump.ts`,
`src/toc-panel.ts`, `vitest.config.ts`.

**Modified**: `src/main.ts` (orchestrator rewrite), `src/markdown.ts` (export
`marked`, accept heading slugs, theme-aware mermaid init), `src/style.css`
(Latte variables, TOC grid area, metadata + TOC styles), `index.html` (TOC
nav, three buttons), `package.json` (deps, scripts), `README.md`, `CHANGELOG.md`,
`scripts/simulate_agent_writes.sh`.

**Deleted**: none.

## 3. Key Changes
- <bullet list of the main technical changes actually made>

## 4. Deviations from Plan
- <what broke, what differed, why a different approach was taken; "None" if not>

## 5. Technical Decisions
- <design decisions and trade-offs, including any that superseded the plan>

## 6. Testing Notes
- `npm run test:web` — N tests across 5 suites
- `npm test` — cargo + vitest
- Manual checklist from Phase 8.6, with results
- Note what was deliberately not unit tested (IntersectionObserver scroll-spy)
  and why

## 7. Usage Examples
Not applicable — no CLI surface changed. The controls are toolbar buttons.

## 8. Documentation Updates
- README: features, controls table, preferences, architecture tree, dev scripts
- CHANGELOG: Unreleased Added + Changed entries

## 9. Next Steps
- <follow-up work, or "None">
```

---

## Appendix A: Pre-Verification Evidence

Every TypeScript module and every test file in this plan was extracted and
executed before the plan was committed. Results:

| Check | Result |
| --- | --- |
| `tsc --noEmit` against the project's own `tsconfig.json` (strict, `noUnusedLocals`, `noUnusedParameters`) | clean, 0 errors |
| All 6 `.test.ts` files run verbatim under vitest 5.0.3 + happy-dom 20.14.5 | **45 passed, 0 failed** |
| `src/frontmatter.ts` + `src/toc.ts` logic re-checked against real `yaml@2.9.1` and `marked@18.0.14` | 32 assertions passed |
| `?url` CSS imports resolve under Vite 8.3.2 | all 4 stylesheets emitted as fingerprinted assets |
| Emitted href shape | root-absolute `/assets/*.css`, the same form Vite already produces for the existing `/src/style.css` link |

Two defects were found and fixed during this verification:

1. **`MetadataTableOptions.expanded` was required**, so `metadata-jump.ts`'s
   `mount(rows, options = {})` failed to typecheck. The field is now optional and
   defaults via `options.expanded ?? true`.
2. **Constructor parameter properties** (`constructor(private readonly x: T)`)
   are used nowhere else in this codebase and are rejected by Node's
   strip-only TypeScript loader. All new classes use explicit field
   declarations instead, matching `main.ts`.

Facts confirmed by direct probing, which the plan's assertions depend on:

- `yaml.parse("createdAt: 2026-10-01 21:16")` returns a **string**, not a `Date`.
- `yaml.parse("a: [unclosed")` **throws** `YAMLParseError` — the catch path in
  `parseFrontmatterRows` is required, not defensive.
- `marked` emits **no** `id` attributes on headings, so `stampHeadingIds` is
  mandatory.
- `heading.text` retains raw markdown (`## **Bold** and \`code\`` yields
  `"**Bold** and \`code\`"`), and inline tokens nest, so the TOC walker recurses
  and skips `html` tokens.
- `## A <em>b</em> c` yields text `A b c` — the `html` skip is what keeps the
  tags out of both the label and the slug.

## Appendix B: Verification Matrix

| Requirement | Verified by | Phase |
| --- | --- | --- |
| Frontmatter renders as a table | `frontmatter.test.ts`, manual | 2, 8 |
| Table is toggleable (global + per-table) | `metadata-table.test.ts`, manual | 6, 8 |
| Mid-document `---` is not frontmatter | `splitFrontmatter` test | 2 |
| Malformed YAML does not blank the document | `parseFrontmatterRows` test | 2 |
| Light/dark toggle | manual, Step 5.5 | 5, 8 |
| Theme covers chrome, markdown, code, mermaid | manual, Step 5.5 | 5 |
| TOC toggle + sidebar | manual, Step 8.6 | 7, 8 |
| Metadata is a TOC entry | manual, Step 8.6 | 7, 8 |
| Scroll-spy highlights the current heading | manual | 7 |
| Preferences persist across restart | `preferences.test.ts`, manual | 1, 8 |
| No regressions in Rust | `npm run lint:rs`, `cargo test` | 8 |

## Appendix C: Known Risks

1. **Stylesheet swap correctness.** The plan's approach attaches one `<link>` per
   variant and detaches the inactive one. If both remain attached, light's
   `.markdown-body` rules may win on cascade order and the dark theme will look
   subtly wrong. Verify visually in both directions; `applyStylesheets()` is the
   single place this can break.
2. **happy-dom lacks `IntersectionObserver`.** `TocPanel.observe()` guards with
   `typeof IntersectionObserver === "undefined"`, so the TOC still renders and
   jumps work under test; only the active highlight is untested there.
3. **Heading id matching is positional.** `stampHeadingIds` pairs slugs with
   rendered headings by document order. Both come from one `extractHeadings`
   call, so they cannot drift — but a future change that filters headings in
   one place and not the other would silently break every anchor.
4. **`marked.parse` typing.** Returns `string | Promise<string>`. Currently
   synchronous because no async extension is registered; adding one later would
   still work because the `await` is kept.