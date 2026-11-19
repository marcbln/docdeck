# Implementation Plan: Document and Section Bookmarks

**Branch**: `005-document-bookmarks` (feature identifier; the working checkout is on `main` — setup-plan did not create a git branch) | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-document-bookmarks/spec.md`

**Decision record**: `_ai/technical_decisions/ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md` (to be written during implementation; records the new persisted key, the section-anchor identity, and the bookmark-scoped notification filter).

## Summary

Add a third browse mode, **Bookmarks**, beside All documents and Recently
changed. It lists bookmarked documents, using All documents' project chip and
modified-time ordering (that view has no project header rows), and nests
bookmarked headings beneath their document. Whole-document and heading bookmarks
are created from the active document, the outline, any navigation row, or
`Ctrl`/`Cmd`+`D`, and persist across restarts in a new versioned `localStorage`
key.

Section bookmarks store the heading text, depth, a two-heading context window
on each side, occurrence among identical headings and document order. Resolution
prefers exact text, uses context to distinguish duplicates and to survive heading
edits, and falls back to occurrence only as a last resort. An unresolved or
ambiguous section becomes **stale** and never scrolls somewhere else; the reader
can re-anchor it to a heading chosen from the document's current outline.

Bookmarked documents reuse the existing unread rule and acknowledgement store.
An opt-in **bookmark-only** notification setting is persisted in the existing
preferences key and pushed to the Rust tray as a validated, metadata-only path
set; Rust continues to own OS notifications and the presence dot, filtering only
popups. Watched documents remain read-only and no document content is read just
to paint the sidebar.

The work is almost entirely in the webview. The only backend addition is one
validated in-memory notification filter command and its use in `tray.rs`; no new
permission, dependency, watcher or content-read command is introduced.

## Technical Context

**Language/Version**: TypeScript 6 (`ES2020`, `strict`) with vanilla DOM and CSS on Vite 8; Rust 1.80+ (edition 2021) and Tauri 2.12 for one command and tray filtering.

**Primary Dependencies**: Existing `@tauri-apps/api` `^2`, `marked` 18, highlight.js, Mermaid; existing Tauri tray and notification plugins. No new runtime or development dependency.

**Storage**: New versioned `localStorage` key `docdeck.bookmarks.v1` (`version: 1`, per-entry validation) for document and section bookmarks. `docdeck.preferences.v1` gains `browseMode: "bookmarks"` and `bookmarkNotificationsOnly: boolean`. The Rust notification filter is in-memory only and re-sent by the webview on every launch. Watched documents are never written.

**Testing**: Vitest with `happy-dom` for pure bookmark models, resolution, storage, view building and DOM controllers; extended `sidebar-panel`, `browse-modal`, `toc-panel`, `tab-menu`, `toast` and `preferences` suites. Rust `cargo test` for the new notification-filter validation and candidate filtering, plus the unchanged tray tests. Required gates: `npm run typecheck`, `npm run test:web`, `npm test`, `npm run lint:rs`.

**Target Platform**: Linux, macOS and Windows desktop (Tauri 2 / WebKitGTK, WKWebView, WebView2). The document shortcut is `Ctrl`+`D` on Linux/Windows and `Cmd`+`D` on macOS, matching the existing modifier convention.

**Project Type**: Desktop application with a Rust service layer and a vanilla TypeScript/DOM webview.

**Performance Goals**: Opening the Bookmarks view and applying the shared filter each complete under 100 ms with 500 bookmarks (SC-005); bookmark toggles acknowledge within 100 ms (FR-035); live watcher bursts never rebuild the full inventory DOM; section resolution is limited to the rendered active document and is O(headings × that document's section bookmarks).

**Constraints**: No new dependency; strict CSP and capabilities unchanged; no polling and no new content-read command; watched files stay read-only; bookmarks are local to the user/machine; storage corruption drops only invalid entries and never blocks startup; closed documents are not read merely to paint the sidebar, so their section status stays "not checked" until opened or activated.

**Scale/Scope**: Real agent workspaces with up to 10,000 watched documents and a few hundred bookmarks; headings h1–h4 (the existing outline depth); one new browse mode, one modal picker, one opt-in notification setting, one Rust command.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Boundary (P-I) | OS concerns in Rust; view state in the webview; typed command/event seam only | PASS — bookmark collection, anchors, resolution, view rows, unread composition and the notification preference are webview state. Rust keeps OS notifications and the tray; it receives one validated metadata-only filter through a typed command and never learns heading content. |
| G2 Pure logic + tests (P-II) | New state, parsing and view-model logic in DOM-free modules with deterministic tests; error/empty/boundary paths covered | PASS — `bookmarks-model`, `bookmark-anchors`, `bookmarks-storage`, `bookmarks-view` and `bookmarks-controller` are pure/injectable; DOM controllers use `happy-dom`; Rust validation/filtering is a plain tested function. |
| G3 Least privilege (P-III) | Treat the webview as untrusted; re-validate every input; no raw filesystem/shell access; no new permissions unless reviewed | PASS — the new command accepts only bounded, deduplicated, absolute path strings for comparison; it opens/reads nothing and exposes no filesystem access. Capabilities are unchanged. |
| G4 Read-only, never surprising (P-IV) | Never write watched documents; persisted vs session state explicit; empty/loading/error/partial/success states rendered with recovery | PASS — bookmarks are metadata written only to the new versioned key; section resolution is derived (only a confirmed anchor is updated); stale, unavailable, unverified, empty and filtered-empty states are explicit; removal is undoable. |
| G5 Performance (P-V) | Virtualized lists; no polling; debounced background work; feedback within 100 ms | PASS — bookmark rows use a second windowed list; the shared filter is a single O(n) pass; persistence is debounced; the view performs no document reads and no watcher polling. |
| G6 Quality gates | Typecheck, frontend tests, Rust tests, clippy | PASS — new and extended suites are part of the definition of done. |
| G7 Persistence constraint | Constitution enumerates every persisted store | **CONDITIONAL** — `docdeck.bookmarks.v1` is a new persisted store and must be added to Technical Constraints → Persistence before implementation is accepted. See Amendment Prerequisites. |
| G8 Dependencies | New runtime dependencies justified | PASS — none added. |
| G9 Rendering | GFM, syntax highlighting, Mermaid and frontmatter must not regress | PASS — the Markdown renderer is unchanged; the outline gains a sibling bookmark control, and scrolling reuses `scrollToAnchor` with the existing sticky-header offset. |
| G10 Platform | Linux, macOS and Windows; platform differences isolated | PASS — storage is `localStorage`, path handling reuses `project.ts`, and the shortcut accepts both modifiers. No platform-specific limitation is introduced. |

Post-Phase-1 re-check: the design keeps every non-conditional gate satisfied.
G7 remains a governance prerequisite (a storage amendment), not a design
violation. No `NEEDS CLARIFICATION` remains. The feature adds no capability
permission, no content-read command, no new dependency and no watcher change.

## Project Structure

### Documentation (this feature)

```text
specs/005-document-bookmarks/
├── plan.md                  # This file (/speckit.plan output)
├── research.md              # Phase 0 output
├── data-model.md            # Phase 1 output
├── quickstart.md            # Phase 1 output
├── contracts/
│   ├── bookmark-storage.md  # Persisted envelope, validation, corruption, undo
│   ├── section-resolution.md # Anchor identity, resolution rules, stale/re-anchor
│   ├── tauri-commands.md    # Notification-filter command and tray semantics
│   └── ui-interactions.md   # Surface, actions, keyboard, states, a11y
├── checklists/
│   └── requirements.md      # Existing spec quality checklist
└── tasks.md                 # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
index.html                        # EXTEND header: bookmark toggle for the active document
src/
├── main.ts                       # EXTEND wire controller, activation, unread, renames, shortcut, notification sync
├── bookmarks-model.ts            # NEW pure collection CRUD, toggle/dedupe, rename, notification paths, remove snapshots
├── bookmarks-model.test.ts       # NEW collection, toggle, duplicate, rename, undo snapshot cases
├── bookmarks-storage.ts          # NEW versioned localStorage codec + debounced writer
├── bookmarks-storage.test.ts     # NEW valid/corrupt/version/partial-entry/write cases
├── bookmark-anchors.ts           # NEW pure context capture and section resolution
├── bookmark-anchors.test.ts      # NEW unique/duplicate/reorder/edit/delete/ambiguity/depth cases
├── bookmarks-view.ts             # NEW availability + unread + resolution -> nested rows, ordering, filter, counts
├── bookmarks-view.test.ts        # NEW grouping, nesting, document order, filter, unavailable, shared-target cases
├── bookmarks-controller.ts       # NEW stateful owner: storage, session resolutions, undo, notification sync seam
├── bookmarks-controller.test.ts  # NEW injected clock/storage/sync, rename, removal/undo, re-anchor cases
├── bookmark-picker.ts            # NEW modal listing the document's current headings for re-anchoring
├── bookmark-picker.test.ts       # NEW list, select, cancel, empty, focus cases
├── sidebar-model.ts              # EXTEND BrowseMode with "bookmarks"; bookmark row types/helpers if shared
├── sidebar-panel.ts              # EXTEND third mode, bookmark list, empty/filter states, setting toggle, callbacks
├── sidebar-panel.test.ts         # EXTEND mode switch, nested rows, stars, count, stale/unavailable, setting
├── sidebar-rows.ts               # REFACTOR document row: main activation button + sibling star; keep two-line anatomy
├── browse-modal.ts               # EXTEND bookmark star on full-inventory rows
├── browse-modal.test.ts          # EXTEND star state and non-activating click
├── toc-panel.ts                  # EXTEND per-heading bookmark control and state
├── toc-panel.test.ts             # EXTEND star rendering, toggle callback, state refresh
├── tab-menu.ts                   # EXTEND document bookmark action in the row context menu
├── tab-menu.test.ts              # EXTEND dynamic label and callback
├── toast.ts                      # EXTEND optional inline action (Undo)
├── toast.test.ts                 # EXTEND action click, replacement, timeout
├── preferences.ts                # EXTEND browse mode + bookmark notifications preference
├── preferences.test.ts           # EXTEND defaults, legacy payload, invalid values
├── shortcuts.ts                  # NEW fixed-shortcut registry, label formatter, typing/modal guards
├── shortcuts.test.ts             # NEW matching, formatting, typing guard and modal predicate cases
├── virtual-list.ts               # EXTEND ignore inner-button clicks; configurable row selector
├── virtual-list.test.ts          # EXTEND button click/keyboard does not activate the row
├── style.css                     # EXTEND stars, nested section rows, picker, setting, empty/stale states
└── *.test.ts                     # existing suites updated as above
src-tauri/
├── src/bookmark_filter.rs        # NEW validated in-memory notification filter + candidates helper
├── src/bookmark_filter_test.rs   # NEW validation, dedupe, enabled/disabled, rename, empty-batch cases
├── src/tray.rs                   # EXTEND filter candidates before notify; presence unchanged
├── src/lib.rs                    # EXTEND register filter state + command
└── src/*_test.rs                 # existing tray/command suites unchanged or extended
README.md                         # EXTEND bookmarks, section stale/re-anchor, notification setting
CHANGELOG.md                      # ADD Unreleased entries
_ai/
├── context-definitions/bookmarks.md                                  # NEW feature/context reference
└── technical_decisions/
    ├── ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md # NEW decision record
    └── README.md                                                     # EXTEND ADR index
```

**Structure Decision**: Keep the existing flat `src/` layout and its pure-module
convention. Collection rules, anchor resolution, persistence decoding and view
composition are DOM-free modules with injected clocks/storage; the stateful
`BookmarksController` owns persistence, session resolutions and undo, and is
tested without Tauri. `SidebarPanel`, `TocPanel`, `TabContextMenu`,
`InboxBrowser` and `ToastHost` stay thin DOM controllers. Document rows are
refactored from a single `role="button"` row into a main activation button plus
sibling star/close buttons, because the new star must be independently
focusable and announced without nesting interactive controls. `main.ts` remains
the single orchestrator that connects document lifecycle, watcher events and the
new typed notification command. The only Rust module is a bounded filter state
used by the existing tray, because OS notification delivery stays in Rust.

A small `shortcuts.ts` module is the shared seam for the application's fixed
shortcut set, platform-aware hints, the typing-target guard and the modal-open
predicate. It exists now because `Ctrl`/`Cmd`+`D` must be registered rather than
hard-coded, and because feature 006's configurable copy shortcut will reuse the
same registry for conflict validation. It contains no user-configurable state
in this feature.

## Complexity Tracking

| Violation / complexity | Why needed | Simpler alternative rejected because |
|------------------------|------------|--------------------------------------|
| New persisted key `docdeck.bookmarks.v1` | FR-029/SC-002 require bookmarks across restarts; the constitution currently enumerates the persisted stores (G7) | Session-only bookmarks fail the core requirement; storing them in `docdeck.preferences.v1` would mix document metadata with UI preferences and make per-entry corruption recovery impossible |
| In-memory bookmark filter in Rust plus one command | FR-025–FR-027 require popup filtering while the tray keeps reflecting all changes, and the Rust tray owns notifications/throttle/mode | Moving notifications to the webview would duplicate tested Rust mode/throttle/body logic and need a JS notification permission; persisting paths in Rust would create a second source of truth and a second storage lifecycle |
| A second virtualized list for bookmark rows | SC-005 (500 bookmarks) and the constitution's virtualization rule; nested document/section rows are flattened | Rendering hundreds of nested rows on every watcher event risks the 100 ms budget; the existing windowed renderer supports one fixed row height and one item type |
| Section status is "not checked" for closed documents | Reading every bookmarked document to paint the sidebar would be unbounded I/O and could read large agent files; SC-003 only requires safe behaviour at activation | A background content-read queue needs a new command, per-file size limits and progressive status updates; activation already validates before scrolling, so no silent jump is possible |
| Toast gains an optional inline Undo action | FR-006 requires removal to be reversible or confirmed, from any affordance including ones outside the Bookmarks view | A modal confirm on every star toggle is disruptive; a view-local Undo button is unreachable when removal happens from All documents or the outline |
| Bookmark controls on every navigation row and outline heading | FR-002/FR-005 require creation from any document row and state on every affordance | A single header control would not satisfy "any row"; hiding stars until hover would violate keyboard and no-hover-only conventions |
| Refactors document rows into a main activation button plus sibling star/close buttons | A real focusable star/close cannot be nested inside today's `role="button"` row without making it presentational to assistive technology (FR-034) | Keeping the current nested controls would announce the row but not its actions; replacing them with spans and custom key handlers would lose native button semantics |
| `docdeck.preferences.v1` gains `bookmarkNotificationsOnly` | FR-027/FR-028 require an opt-in setting whose effect is visible and survives restarts | Putting it in `config.toml` would mix a per-user UI preference with watch configuration and make the tray the only owner of a reader preference |

## Constitution Amendment Prerequisites

Before implementation is accepted, amend `.specify/memory/constitution.md`:

1. **Technical Constraints → Persistence**: add `docdeck.bookmarks.v1` to the
   enumerated persisted stores. State that it is versioned, per-entry validated,
   contains only both bookmark kinds plus their anchors (paths, heading text,
   depth, neighbours, occurrence/order, timestamps), that invalid entries are
   discarded individually, and that section resolution status is session state.
2. Confirm that the existing `docdeck.preferences.v1` clause now includes the
   `browseMode: "bookmarks"` and `bookmarkNotificationsOnly` fields.
3. No platform, dependency or permission change requires an amendment.
