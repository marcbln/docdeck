# Implementation Plan: Watch Configuration and Inbox Follow-ups

**Branch**: `002-watch-inbox-followups` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-watch-inbox-followups/spec.md`

## Summary

Deliver the deferred half of the config-driven watch design: live configuration
reload, cross-session unread awareness, browse-list filtering, rename/move
tracking, an in-app configuration surface, and macOS/Windows parity.

The existing boundary stays intact. Rust remains the service layer for
operating-system concerns: platform configuration paths, filesystem watching,
config-file watching and atomic writes, selector expansion, watch
reconciliation, and file-identity-based rename detection. The webview remains
the owner of view state: open documents, active document, unread
acknowledgements, filter term, and the configuration-editing draft. The two
sides meet through the existing typed Tauri command/event seam.

The work splits into three backend capabilities and four webview capabilities:

1. A config watcher that debounces saves/external edits, reloads only valid
   configurations, reconciles watches by ownership (config vs session), and
   emits a generation-tagged `config-reloaded` result.
2. Event-kind-preserving watch events plus a file-identity cache, so a rename is
   one transition (carrying open/read/active state) and a move-out is
   distinguishable from a delete.
3. Config read/save commands that edit the TOML surgically (`toml_edit`),
   preserve comments/formatting/unknown keys, detect outside edits by revision,
   validate before applying, and write atomically.
4. A versioned `docdeck.acknowledgements.v1` store that compares stored
   acknowledgement mtimes with current document mtimes, with a first-launch
   baseline, active-document refresh, pruning, and corruption recovery.
5. A pure filter module and a filter control in the browse toolbar, preserving
   ordering, virtualization, focus, and all document state.
6. A configuration surface reachable from the header, backed by a pure draft
   model, with location/status/last-reload display, add/remove selectors,
   create-from-example, conflict handling, and precise errors that preserve
   input.
7. Platform path resolution and Windows selector normalization, plus a
   cross-platform build/test audit.

## Technical Context

**Language/Version**: TypeScript 6 (webview); Rust 1.80+ (Tauri backend, edition 2021)

**Primary Dependencies**: Tauri 2, Vite 8, marked 18, highlight.js, mermaid,
notify 6.1, toml 0.8, globset, walkdir. Add `notify-debouncer-full` (replaces
`notify-debouncer-mini`) and `toml_edit`; no new frontend dependency.

**Storage**: Watch configuration is a TOML file in the platform-standard user
configuration directory (`$DOCDECK_CONFIG` overrides). UI preferences remain in
`docdeck.preferences.v1`; unread acknowledgements use a new versioned
`docdeck.acknowledgements.v1` `localStorage` key. Document content is never
persisted and watched documents are never written.

**Testing**: Vitest + happy-dom for pure frontend modules and panel rendering;
`cargo test` for config parsing/editing, path normalization, rename pairing,
watch reconciliation, and commands; `npm run typecheck`, `npm run test:web`,
`npm test`, and `npm run lint:rs`.

**Target Platform**: Desktop on Linux, macOS, and Windows (Tauri 2). The current
constitution's Linux-only constraint must be amended before acceptance.

**Project Type**: Desktop application — Rust service layer plus vanilla
TypeScript/DOM webview, single window.

**Performance Goals**: Filter a 10,000-document list within 100 ms of a
keystroke (SC-003); apply a valid configuration and reflect it in the browse list
within 2 seconds for normal selectors (SC-001); settle a rename within 2 seconds
(SC-004); reload and rename work never block document switching or scrolling.

**Constraints**: No new frontend dependency; documents stay read-only; the only
file docdeck writes is its own configuration file (plus `localStorage`); no
polling; no full-inventory DOM; keep the virtual list; strict CSP and existing
capabilities unchanged; config editing must preserve hand-written content.

**Scale/Scope**: Up to 10,000 watched documents, 256 watched roots, 100,000 scan
entries, tens of open documents, two browse modes, three desktop platforms.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 Boundary (P-I) | OS work in Rust; view state in the webview; typed command/event seam only | PASS — config watch/write, rename identity, platform paths in Rust; unread, filter, editor draft, open/active state in the webview |
| G2 Pure logic + tests (P-II) | Pure modules with deterministic tests; error/empty/boundary paths covered | PASS — new pure modules on both sides; injected clocks, temporary directories, synthetic watch events |
| G3 Least privilege (P-III) | Re-validate every path/input; no raw filesystem access in the webview; no new permissions | PASS — save/read commands validate selectors, revision, and target path; capabilities unchanged |
| G4 Read-only, never surprising (P-IV) | Never write watched documents; persisted vs session state explicit; explicit states | PASS — writes are limited to `config.toml` and a versioned acknowledgement key; filter stays session-only; loading/error/empty states specified |
| G5 Performance (P-V) | Virtualized lists; no polling; debounced background work | PASS — filter operates on the existing windowed list; reload/rename use events and debounce |
| G6 Quality gates | Typecheck, frontend tests, Rust tests, clippy | PASS — part of the definition of done |
| G7 Platform constraint | Constitution currently declares Linux-only | **CONDITIONAL** — macOS/Windows is in scope (spec Assumption). Requires a constitution amendment before implementation is accepted. |
| G8 Persistence constraint | Constitution says session state is never persisted | **CONDITIONAL** — cross-session unread persists acknowledgements by design. Requires a constitution amendment documenting the new persisted state and its schema. |
| G9 Dependencies | New runtime dependencies justified | PASS — two Rust dependencies justified in research R10; no frontend dependency added |

Post-Phase-1 re-check: the design keeps every non-conditional gate satisfied.
G7 and G8 remain governance prerequisites, not design violations; they are
tracked in Complexity Tracking and in the spec's assumptions.

## Project Structure

### Documentation (this feature)

```text
specs/002-watch-inbox-followups/
├── plan.md                      # This file
├── research.md                  # Phase 0 output
├── data-model.md                # Phase 1 output
├── quickstart.md                # Phase 1 output
├── contracts/
│   ├── tauri-commands.md        # Command and event payload contracts
│   └── ui-interactions.md       # User-visible action contract
├── checklists/
│   └── requirements.md          # Spec quality checklist
└── tasks.md                     # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
index.html                       # add the header "Watches" control
src/
├── main.ts                      # orchestrate reload, rename, unread, filter, editor
├── acknowledgements.ts          # NEW pure persisted review state + baseline/prune
├── filter-documents.ts          # NEW pure case-insensitive filter over name/path/project
├── config-editor-model.ts       # NEW pure draft/validation/conflict state
├── config-panel.ts              # NEW modal configuration surface
├── inbox-model.ts               # EXTEND origin-aware merge/reconcile/rename/move-out,
│                                #        acknowledgement seeding, filter-neutral state
├── sidebar-panel.ts             # EXTEND filter input, config action, filtered counts/empty
├── browse-modal.ts              # EXTEND to render the filtered inventory
├── sidebar-rows.ts              # unchanged row anatomy
├── preferences.ts               # unchanged (filter stays session-only)
├── style.css                    # filter, config modal, conflict/error, rename states
└── *.test.ts                    # new/extended Vitest suites
src-tauri/
├── Cargo.toml                   # + notify-debouncer-full, toml_edit
├── src/
│   ├── config.rs                # EXTEND platform paths, selector normalization,
│   │                            #        surgical TOML edit helpers, revision
│   ├── config_edit.rs           # NEW pure TOML edit/validation + atomic write
│   ├── config_watch.rs          # NEW config-file watcher + reload orchestration
│   ├── watcher.rs               # EXTEND full event kinds, ownership sets,
│   │                            #        file-identity cache, rename pairing
│   ├── paths.rs                 # EXTEND platform/file-identity helpers
│   ├── commands.rs              # EXTEND reload result; add read/save/reload commands
│   ├── lib.rs                   # wire config watcher + commands
│   └── *_test.rs                # new/extended Rust suites
├── capabilities/default.json    # unchanged
└── tauri.conf.json              # verify bundle/identifier on macOS and Windows
scripts/
├── simulate_folder_watch.sh     # extend for reload/rename smoke run
└── simulate_agent_writes.sh     # unchanged
README.md, CHANGELOG.md, _ai/   # document new behavior, persistence, platforms
```

**Structure Decision**: Keep the established flat layout on both sides. Rust
gains two focused modules (`config_edit`, `config_watch`) rather than growing
`config.rs` into a second application; the webview gains pure models
(`acknowledgements`, `filter-documents`, `config-editor-model`) and one DOM
component (`config-panel`) so every rule is testable without a window. `main.ts`
remains the single orchestrator and continues to own tab lifecycle and view
state.

## Complexity Tracking

| Violation / complexity | Why needed | Simpler alternative rejected because |
|-----------------------|------------|--------------------------------------|
| macOS and Windows support conflicts with the constitution's Linux-only technical constraint (G7) | The spec explicitly requires platform parity (User Story 6, FR-040–FR-042) | Documenting macOS/Windows as unsupported fails the spec's success criteria; Tauri already builds on all three desktops |
| Persisting unread acknowledgements conflicts with "session state is never persisted" (G8) | Cross-session unread is the P2 requirement | Session-only unread is exactly the behavior this feature replaces; re-deriving unread from file mtime alone cannot distinguish reviewed from unreviewed documents |
| `notify-debouncer-full` replaces `notify-debouncer-mini` | Rename vs delete vs move-out cannot be distinguished after mini collapses every event to `Any` | Pairing only `exists=false` → `exists=true` cannot tell a move-out from a delete, so FR-026 and existing delete behavior would conflict; a hand-written debouncer duplicates tested crate behavior |
| `toml_edit` runtime dependency | FR-036 requires preserving comments, formatting, and unknown keys while changing selectors | Re-serializing `WatchConfig` with `toml` destroys comments and formatting; line-based editing in the webview duplicates TOML parsing and cannot validate atomically |
| Backend file-identity cache | FR-024/FR-029/FR-030 require one row across rename, rapid renames, and case-only renames | Path-only pairing creates false pairs on delete+create, and reading document content to hash it violates the metadata-only inventory rule and performs work proportional to file size |
| Full rescan on each valid reload | Correctly re-applies excludes and selectors, including session folders | Incremental per-selector diffing needs a selector-to-path provenance map and still misses exclude changes; reloads are debounced, generation-tagged, and run off the main thread |

## Constitution Amendment Prerequisites

Before implementation is accepted, amend `.specify/memory/constitution.md`:

1. Technical Constraints → Platform: replace "Linux desktop only" with the three
   supported desktop platforms and note any platform-specific caveats.
2. Technical Constraints → Persistence: list the new
   `docdeck.acknowledgements.v1` key, its versioning/validation rules, and that
   document content and session activity remain unpersisted.
3. Development Workflow → add a live-reload exception to "configuration is read
   once at startup unless a feature explicitly adds live reload" (already
   permitted by the clause) and reference this feature's ADR if one is written.

## Platform Build Audit (T052)

Audited `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json`:

- Identifier is `com.marc.docdeck` (stable reverse-DNS; no platform-specific
  suffix needed).
- Bundle targets are `"all"` and the icon list includes `icon.icns` (macOS) and
  `icon.ico` (Windows) alongside the PNG set.
- The single capability (`core:default`) grants no filesystem or shell access,
  so no permission change is needed on any platform.
- Unix-only test code (`config_test`, `folder_test`) is `#[cfg(unix)]`-gated and
  `render::configure` is `#[cfg(target_os = "linux")]`-gated, so `cargo test`
  compiles on Windows/macOS.
- Rename identities use `MetadataExt` on Unix/macOS and Windows; the watcher,
  notification plugin and single-instance plugin all support the three
  desktops.

Result: no configuration change required; nothing in this specification is
documented as Linux-only.
