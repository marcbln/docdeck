# Implementation Plan: Status Bar, Event Log, Window Title, and Resizable Panes

**Branch**: `004-status-bar-event-log` (feature identifier; the working checkout is on `main` — setup-plan did not create a git branch) | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-status-bar-event-log/spec.md`

**Decision record**: `_ai/technical_decisions/ADR__261106-1__session-event-log-and-resizable-panes.md` (to be written during implementation; records the session-only log, the layout-preference extension, and the single added Tauri permission)

## Summary

Give docdeck a quiet, predictable chrome: a single full-width status line at the
bottom, a PhpStorm-style docked event log that pushes content up when open, and
an OS window title of `project — filename — docdeck`. Scan and reload chatter
leaves the left sidebar entirely; the sidebar keeps only document navigation and
the actionable "no configuration" hint.

All four pane boundaries — sidebar width, outline width, event-log height, and
the Open/Browse split — become mouse- and keyboard-resizable, return to their
defaults on double-click, and persist through the existing versioned
`docdeck.preferences.v1` key. The event log is deliberately session-only and
capped at 500 entries.

The work is webview-side. One narrow capability permission
(`core:window:allow-set-title`) is added so the webview can update the native
window title; no Rust command, watcher behavior, or document handling changes.

## Technical Context

**Language/Version**: TypeScript 6 (`ES2020`, `strict`) with vanilla DOM and CSS
on the existing Vite 8 build; Rust 1.80+ and Tauri 2.12 unchanged.

**Primary Dependencies**: Existing `@tauri-apps/api` `^2` (`core`, `event`,
`window`). No new runtime or development dependency.

**Storage**: `localStorage` key `docdeck.preferences.v1` gains an optional,
per-field-validated `layout` object (`sidebarWidth`, `tocWidth`,
`eventLogHeight`, `sidebarSplit`). The event log is in-memory only and is never
written to disk. No backend storage changes.

**Testing**: Vitest with `happy-dom` for pure modules (`window-title`,
`layout-model`, `event-log`) and DOM controllers (`status-bar`,
`event-log-panel`, `layout-resizer`, updated `sidebar-panel`, extended
`preferences`); `npm run typecheck` and `npm run test:web`. The Rust suite is
unchanged and must stay green (`npm test`, `npm run lint:rs`).

**Target Platform**: Linux, macOS and Windows desktop (Tauri 2 / WebKitGTK,
WKWebView, WebView2). Linux Wayland compositors may not repaint their own
header bar after `setTitle` (upstream Tauri limitation); the taskbar title and
the webview `document.title` still update, and this is documented rather than
silently ignored.

**Project Type**: Desktop application with a Rust service layer and a vanilla
TypeScript/DOM webview.

**Performance Goals**: Window title changes within 200 ms of a tab change
(SC-002); resize drags update only layout CSS and never re-render Markdown
(SC-007); the event log appends incrementally and stays responsive at its
500-entry cap (SC-004); opening or clearing the log takes under 100 ms.

**Constraints**: No new dependencies; watched documents stay read-only; the
strict CSP is unchanged; status bar and log must not intercept document
scrolling, tab switching, or link activation; only one permission is added; the
event log is session-scoped and must never be persisted; layout values are
validated per field and clamped on window resize without overwriting the stored
preference.

**Scale/Scope**: Real agent workspaces with thousands of watched documents, but
the event log is capped at 500 entries and rendered as a simple list (no
virtualization needed at that size). Four resize boundaries, three transient
status severities, one new docked pane.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Boundary (P-I) | OS concerns in Rust; view state in the webview; typed command/event seam only | PASS — title composition, status/log state, layout, and preferences live in the webview. The OS title is set through the existing typed Tauri window API, not a new Rust command. Rust is untouched. |
| G2 Pure logic + tests (P-II) | New state, geometry, parsing, and view-model logic in DOM-free modules with deterministic tests | PASS — `window-title`, `layout-model`, and `event-log` are pure and injected-clock friendly; DOM controllers are covered with `happy-dom`. Error, empty, boundary, corrupt-storage, and 500-entry cases are required. |
| G3 Least privilege (P-III) | Treat the webview as untrusted; re-validate inputs; no new broad access | **PASS WITH REVIEW** — exactly one permission, `core:window:allow-set-title`, scoped to the `main` window. It can only change the window's own title. Event detail is rendered with `textContent`, never HTML. No filesystem, network, or shell access is added. |
| G4 Read-only, never surprising (P-IV) | Never write watched documents; persisted vs session state explicit; render empty/loading/error/partial/success states | PASS — documents are untouched; the event log is explicitly session-only and cleared on restart; layout preferences use the existing validated key; the log has an explicit empty state, warnings filter, and clear action. |
| G5 Performance (P-V) | Virtualized lists; no polling; debounced background work; feedback within 100 ms | PASS — scan progress still arrives by event; the log appends incrementally and is capped at 500; resize changes CSS custom properties only; preference writes reuse the existing debounced writer; no new polling. |
| G6 Quality gates | Typecheck, frontend tests, Rust tests, clippy | PASS — new Vitest suites plus updated preferences/sidebar suites; existing `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs` remain required. |
| G7 Platform constraint | Linux, macOS, Windows desktop; platform limitations documented | PASS — uses the cross-platform Tauri window API; the Wayland header-bar limitation is documented in the README and quickstart. |
| G8 Rendering | GFM, syntax highlighting, Mermaid, frontmatter must not regress | PASS — resizing only changes pane geometry; `renderActiveContent` is not invoked by drag or window resize. |
| G9 Dependencies | New runtime dependencies justified | PASS — none added. |

Post-Phase-1 re-check: the design resolves every unknown with existing
dependencies, keeps the Rust/webview boundary intact, and confines persistence to
the already-sanctioned preferences key. The only governance-sensitive item is
the single window-title permission, flagged for security review in Complexity
Tracking. No gate is violated.

## Project Structure

### Documentation (this feature)

```text
specs/004-status-bar-event-log/
├── plan.md                  # This file (/speckit.plan output)
├── research.md              # Phase 0 output
├── data-model.md            # Phase 1 output
├── quickstart.md            # Phase 1 output
├── contracts/
│   ├── window-title.md      # Title composition, fallback, timing, permission
│   ├── status-bar-event-log.md  # Status-line and log behavior
│   └── layout-resize.md     # Bounds, geometry, keyboard, persistence
├── checklists/
│   └── requirements.md      # Existing spec quality checklist
└── tasks.md                 # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
index.html                         # EXTEND app shell: status bar + docked log skeleton
src/
├── main.ts                        # EXTEND integrate title, status, log, layout; remove sidebar status wiring
├── preferences.ts                 # EXTEND persisted layout fields + per-field validation
├── preferences.test.ts            # EXTEND layout round-trip, corrupt/legacy/out-of-range cases
├── window-title.ts                # NEW pure title composition
├── window-title.test.ts           # NEW project / no-project / none / deepest _ai cases
├── layout-model.ts                # NEW defaults, limits, validation, viewport clamping, split math
├── layout-model.test.ts           # NEW boundary, narrow-window, resize, corrupt-value cases
├── layout-resizer.ts              # NEW pointer + keyboard + double-click separator controller
├── layout-resizer.test.ts         # NEW drag, clamp, reset, inert, keyboard, a11y cases
├── event-log.ts                   # NEW session-only bounded event store
├── event-log.test.ts              # NEW ordering, capacity, clear, severity cases
├── status-view.ts                 # NEW pure status-line view model
├── status-view.test.ts            # NEW scanning / last event / warning / idle / shortening cases
├── status-bar.ts                  # NEW one-line status bar DOM controller
├── status-bar.test.ts             # NEW click-to-open, warning chip, non-blocking cases
├── event-log-panel.ts             # NEW docked log DOM controller (filter, clear, follow, Escape)
├── event-log-panel.test.ts        # NEW empty, filter, clear, follow/pause, Escape cases
├── sidebar-panel.ts               # EXTEND remove scan/status rendering; keep setup hint + split host
├── sidebar-panel.test.ts          # EXTEND no status text, hint retained, split hooks
└── style.css                      # EXTEND grid rows/areas, status bar, log, resizers, focus states
src-tauri/
├── tauri.conf.json                # EXTEND minWidth 640 -> 700 (320 px document floor + both panes)
└── capabilities/default.json      # EXTEND add `core:window:allow-set-title` (security review)
README.md                          # EXTEND window title, status bar, log, resizing, Wayland note
CHANGELOG.md                       # ADD Unreleased entries
_ai/
├── context-definitions/status-bar-event-log.md   # NEW feature/context reference
└── technical_decisions/
    ├── ADR__261106-1__session-event-log-and-resizable-panes.md  # NEW decision record
    └── README.md                  # EXTEND ADR index
```

**Structure Decision**: Keep the existing flat `src/` layout and its pure-module
convention (`inbox-model`, `find-text`, `preferences`): new geometry, event
storage, title composition, and status derivation are DOM-free modules with their
own `*.test.ts` files; DOM controllers (`status-bar`, `event-log-panel`,
`layout-resizer`) stay thin and are tested with `happy-dom`. `main.ts` remains the
single orchestrator that wires backend events to the models and controllers. The
feature adds no Rust module because no OS concern is introduced: the only native
call is the existing Tauri window-title setter, which is view chrome.

## Complexity Tracking

| Violation / complexity | Why needed | Simpler alternative rejected because |
|-----------------------|------------|--------------------------------------|
| Adds `core:window:allow-set-title` to the `main` capability | Tauri does not expose `set_title` under `core:window:default`; `document.title` alone does not reliably update the native window title | A custom Rust command would move view state into Rust (violates P-I) and broaden the IPC surface more than one narrowly scoped permission; omitting the permission leaves the title unchanged on Linux/Windows |
| Raises the configured minimum window width from 640 to 700 px | Both side panes at their stated minimums (200 + 160) plus the 320 px document floor require 680 px; 700 leaves room for the splitter and borders | Allowing the document area below 320 px violates SC-005; silently shrinking panes below their stated minimums violates FR-023/FR-024 |
| Extends `docdeck.preferences.v1` with a nested `layout` object | FR-031/FR-032 require restart persistence and window-resize clamping | A second storage key or an unversioned key breaks the constitution's persistence rule; not persisting fails FR-031 |
| A session-only 500-entry log rather than durable history | The spec explicitly scopes the log to the session and bounds it | Persisting it would silently widen persistence (P-IV) and require migration/cleanup the spec rejects |
