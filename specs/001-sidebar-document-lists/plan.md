# Implementation Plan: Left Sidebar Document Navigation

**Branch**: `001-sidebar-document-lists` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-sidebar-document-lists/spec.md`

## Summary

Replace the horizontal tab strip with a single always-present left sidebar that
stacks two sections: **Open Documents** (a row-based replacement for tabs) above
a **browse** section that switches between **All Documents** and **Recently
Changed**. The tab registry and lifecycle stay exactly as they are; only the
rendering surface and the activity model change. Recently Changed gains a
session-scoped, de-duplicated activity set with a Clear action that also
acknowledges unread markers, plus undo. The backend (filesystem watching,
config expansion, file reads) is untouched.

## Technical Context

**Language/Version**: TypeScript 6 (webview), Rust 1.80+ (Tauri backend, unchanged), HTML/CSS

**Primary Dependencies**: Tauri 2, Vite 8, marked 18, highlight.js, mermaid; no new dependency required

**Storage**: In-memory session state for documents/recent activity; `localStorage` (`docdeck.preferences.v1`) for UI preferences; filesystem reads through existing Tauri commands

**Testing**: Vitest + happy-dom for pure frontend modules and panel rendering; `npm run typecheck`; Rust `cargo test` only if backend files change (expected: none)

**Target Platform**: Linux desktop (Tauri/WebKitGTK), single window

**Project Type**: Desktop application — frontend-only feature

**Performance Goals**: Browse list scroll and document switching respond within 100 ms with 10,000 watched documents (SC-002); no full-inventory DOM on render

**Constraints**: Session-scoped unread and recent activity survive tab switches but not restarts; no new runtime dependencies; TOC remains a separate column

**Scale/Scope**: Up to 10,000 watched documents, tens of open documents, two sections, two browse modes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unedited template, so no ratified
gates exist. Until `/speckit.constitution` is run, the following provisional
gates are taken from the repository's own conventions (`AGENTS.md`,
`_ai/conventions.md`, `package.json`):

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Tests | Every new pure module has Vitest coverage; `npm run test:web` passes | PASS (planned) |
| G2 Types | `npm run typecheck` passes | PASS (planned) |
| G3 Scope | No Rust/backend change unless a requirement cannot be met otherwise | PASS (frontend-only) |
| G4 Dependencies | No new runtime dependency without justification | PASS (none needed) |
| G5 Reuse | Reuse existing primitives: toggle button, toast, preferences, windowing | PASS (planned) |
| G6 Behavior | Preserve session unread semantics and all document actions | PASS (spec FR-005, FR-023) |

No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-sidebar-document-lists/
├── plan.md                      # This file
├── research.md                  # Phase 0 output
├── data-model.md                # Phase 1 output
├── quickstart.md                # Phase 1 output
├── contracts/
│   └── ui-interactions.md       # Phase 1 output — user-visible action contract
├── checklists/
│   └── requirements.md          # Spec quality checklist
└── tasks.md                     # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
index.html                 # remove #tabs-bar; sidebar host replaces #inbox-panel
src/
├── main.ts                # AppState: swap tab rendering for SidebarPanel wiring
├── sidebar-model.ts       # NEW pure state: open rows, recent set, clear/undo, ordering
├── sidebar-panel.ts       # NEW renderer: both sections, mode switch, collapse, status
├── virtual-list.ts        # NEW extracted windowing (from inbox-panel.ts)
├── browse-modal.ts        # MOVED InboxBrowser from inbox-panel.ts (pop-out view)
├── inbox-model.ts         # EXTEND: observation time, recent selection, acknowledge
├── inbox-panel.ts         # REMOVE section renderer after migration
├── preferences.ts         # EXTEND: browse mode + section collapse state
├── style.css              # NEW sidebar grid/layout and row styles
└── *.test.ts              # updated/added unit tests
src-tauri/                 # UNCHANGED
```

**Structure Decision**: Single frontend project with the existing flat `src/`
layout. The feature is a view-and-state refactor, not a new subsystem, so it
stays in flat modules rather than introducing directories. `main.ts` keeps
document lifecycle ownership; the new `SidebarPanel` owns only presentation and
forwards actions through callbacks, matching the existing `InboxPanel` seam.

## Complexity Tracking

> No constitution violations. One deliberate complexity is retained:

| Complexity | Why Needed | Simpler Alternative Rejected Because |
|------------|------------|--------------------------------------|
| Shared windowed list renderer used by both the inline browse list and the pop-out modal | The inline list now shows up to 10,000 documents and must meet SC-002; the modal already solved this | Rendering every row inline would make each watcher event an O(n) DOM rebuild and fail SC-002 |
| Separate `changedAt` observation timestamp for recent activity | Clear/undo must be deterministic and immune to file-mtime skew or a scan discovering old files after a clear | Filtering by file mtime lets a post-clear scan surface pre-clear files as "recent"; a raw event log grows unbounded and repeats paths |
