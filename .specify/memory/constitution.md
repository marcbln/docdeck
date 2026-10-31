# docdeck Constitution

## Core Principles

### I. OS Concerns in Rust, View State in the Webview

Rust MUST remain the service layer for operating-system concerns: process IPC,
filesystem watching, disk reads, configuration expansion, and renderer setup.
The webview MUST own all view orchestration: which documents are open, the
active document, layout, unread state, and preferences.

- The two sides MUST meet only through explicit `#[tauri::command]` handlers and
  named events with typed payloads. The frontend MUST reach them through one
  typed wrapper, not scattered `invoke()` calls.
- Rust MUST NOT contain window or UI logic. The webview MUST NOT read the
  filesystem directly or shell out.
- New backend commands MUST validate every argument and return a typed result.

**Rationale**: This boundary is the reason the app is testable and secure: OS
behavior is exercised as plain Rust functions, and view behavior is exercised in
Vitest without a real filesystem.

### II. Testable Pure Logic, Deterministic Tests

New state, geometry, parsing, and view-model logic MUST live in pure modules
that do not touch the DOM, and it MUST ship with unit tests. DOM controllers are
tested with happy-dom; Rust changes are tested with `cargo test`.

- Tests MUST be deterministic: inject clocks, use temporary directories, and
  never depend on the network, wall-clock time, or shared global state.
- `npm run typecheck` and `npm run test:web` MUST pass before a change is
  considered complete. Any Rust change MUST pass `npm test` and
  `npm run lint:rs`.
- Tests MUST cover error paths, empty states, and boundary conditions, not only
  the happy path.

**Rationale**: The repository already separates pure models (`inbox-model`,
`find-text`, `mermaid-zoom-math`, `links`, `preferences`) from DOM and Tauri
wiring. Keeping that split is what makes regressions cheap to catch.

### III. Untrusted Webview, Least Privilege

The webview MUST be treated as untrusted. Rust MUST re-validate every path, URL,
size, and identifier it receives; the frontend MUST never receive raw
filesystem, shell, or database access.

- Secrets, tokens, and private keys MUST NOT appear in frontend code, `VITE_*`
  variables, or committed configuration.
- Capabilities MUST follow least privilege, the Content Security Policy MUST
  stay strict, and adding a permission is a security change that requires review.
- Links MUST NOT navigate the app window. External links go to the OS handler;
  unsupported schemes are blocked and reported.
- Watched files are read-only input. docdeck MUST NOT write to or delete them.

**Rationale**: A viewer that renders agent-authored Markdown must assume that
content is hostile. The current link classifier and renderer configuration exist
for this reason and MUST be preserved.

### IV. Read-Only and Never Surprising

docdeck renders documents; it does not edit them. User-visible behavior MUST be
predictable and reversible where practical.

- Closing a tab MUST only release the watch; it MUST NOT delete or modify the
  file. Reopening a closed document MUST remain available for the session.
- Destructive or hard-to-reverse UI actions MUST be confirmed or undoable.
- State that appears persistent MUST actually be persisted, and state that is
  session-scoped MUST be documented and cleared on restart. Never silently widen
  persistence.
- Empty, loading, error, partial, and success states MUST each be rendered
  explicitly, each with a recovery path where one exists.

**Rationale**: Users leave docdeck open while agents rewrite files. Surprises
about what the app changed or remembered destroy trust faster than any missing
feature.

### V. Performance by Design

The application MUST remain responsive at the scale of real agent workspaces,
including thousands of watched documents.

- Long lists MUST be virtualized; rendering MUST NOT be proportional to the full
  inventory on every watcher event.
- Background work (scans, watches, reads) MUST NOT block document switching or
  scrolling.
- The app MUST use backend events instead of polling when an event is available,
  and MUST debounce burst writes.
- Interactive feedback MUST appear within 100 ms; operations longer than one
  second MUST show progress.

**Rationale**: An always-open monitoring window that stutters is worse than no
window. The existing windowed inventory and debounced watcher are the standard
to maintain.

## Technical Constraints

- **Platform**: Linux desktop only, built on Tauri 2 (WebKitGTK) with Rust 1.80+
  and Node.js 20+.
- **Frontend**: TypeScript with Vite and vanilla DOM and CSS. The app is
  intentionally not built on a component framework or UI kit; adopting one
  requires an ADR.
- **Dependencies**: Add runtime dependencies deliberately and keep the tree
  small. A new dependency requires justification in the change.
- **Persistence**: UI preferences use the versioned
  `docdeck.preferences.v1` `localStorage` key with per-field validation.
  Document content and session state are never persisted. Configuration is read
  once at startup unless a feature explicitly adds live reload.
- **Rendering**: GitHub-flavoured Markdown, syntax highlighting, Mermaid, and
  frontmatter tables are core behavior and MUST NOT regress.
- **Themes**: Dark and light palettes use the Catppuccin token set; components
  consume CSS custom properties rather than hard-coded colors.

## Development Workflow & Quality Gates

- Significant features follow the Spec Kit workflow in this order: specify,
  plan, tasks, implement. Specifications describe user-visible behavior and MUST
  NOT prescribe implementation.
- Every change MUST update affected documentation (`README.md`,
  `CHANGELOG.md`, and `_ai/` context) in the same commit. `_ai/conventions.md`
  is generated by `ruleman`; it is read, never hand-edited.
- Significant, hard-to-reverse decisions MUST be recorded as an ADR in
  `_ai/technical_decisions/`. Accepted ADRs are immutable and are superseded, not
  rewritten.
- Commits use Conventional Commit style (`feat(scope):`, `fix(scope):`,
  `docs:`, and so on). Do not commit secrets, tokens, or machine-specific
  backups.
- A change is complete only when typecheck, the frontend test suite, and any
  required Rust checks pass, and the manual steps in the feature's quickstart
  have been exercised.

## Governance

This constitution supersedes other project practices when they conflict.
`_ai/conventions.md` remains the detailed, generated reference; this document
states the non-negotiable principles those conventions implement.

- **Amendments**: Propose changes as a pull request that edits this file and
  includes a Sync Impact Report. Amendments require review and approval before
  merge.
- **Versioning**: Governance versions follow Semantic Versioning. MAJOR for
  removed or redefined principles, MINOR for a new principle or materially
  expanded guidance, PATCH for clarifications that do not change meaning.
- **Compliance**: Reviews MUST verify that a change does not violate a
  principle. Any intentional violation MUST be justified in the change and, if
  lasting, recorded as an ADR. Unjustified complexity is rejected.
- **Runtime guidance**: `AGENTS.md` and `_ai/conventions.md` provide agent and
  coding guidance; they MUST remain consistent with this document. If they
  disagree, this document wins and the guidance is corrected.

**Version**: 1.0.0 | **Ratified**: 2026-10-31 | **Last Amended**: 2026-10-31
