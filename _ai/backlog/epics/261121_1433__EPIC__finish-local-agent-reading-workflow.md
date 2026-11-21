---
filename: "_ai/backlog/epics/261121_1433__EPIC__finish-local-agent-reading-workflow.md"
title: "EPIC: Finish the local agent-reading workflow"
createdAt: 2026-11-21 14:33
updatedAt: 2026-11-21 14:33
status: active
priority: high
tags: [epic, roadmap, clipboard, export, cli, chrome, bookmarks, backlog]
estimatedComplexity: epic
documentRevision: 1
sourceSpec: "specs/005-document-bookmarks/spec.md; specs/006-copy-markdown-content/spec.md; specs/007-app-chrome-baseline/spec.md"
sourceHandoff: ""
sourceAdrs: ["_ai/technical_decisions/ADR__261019-1__config-driven-watch-registry.md", "_ai/technical_decisions/ADR__261106-1__session-event-log-and-resizable-panes.md", "_ai/technical_decisions/ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md"]
documentType: EPIC
---

# EPIC: Finish the local agent-reading workflow

## Decision

docdeck remains a **local, personal reading surface for agent-authored
Markdown**. It is not a collaboration, sync or mail product. Local export and
clipboard handoff are allowed because they let the reader move a document into
tools they already use; accounts, address books, SMTP and shared state are not.

This decision was made on 2026-11-21 and is recorded in
`specs/007-app-chrome-baseline/checklists/requirements.md`. Anything that
contradicts it needs a goals change and an ADR before implementation.

## Why this epic exists

The original feature list mixed shipped work, small follow-ups, one product
direction that contradicts the goals, and two features whose technical shape is
still unknown. This epic reconciles the list against `HEAD`, keeps the remaining
work in priority order, and parks the out-of-scope cluster with its rationale so
it is not rediscovered as a "quick feature" later.

## Status reconciliation (2026-11-21)

Do not re-plan these; only their listed verification remains.

| Original request | Evidence | Remaining |
| --- | --- | --- |
| Bookmarks | Implemented in `9958f9d`; spec `005`; ADR `261115-1` | T054/T063 verification in `specs/005-document-bookmarks/tasks.md` |
| Browse filter while typing | Shipped | — |
| Copy a document path | Shipped in the tab/row context menu | — |
| `Ctrl+Shift+T` reopens closed documents | Shipped | — |
| Middle-click closes a tab | Shipped in `src/sidebar-panel.ts` for open and browse rows | — |
| `?` overlay with shortcuts and a manual tab | Implemented as spec `007` (uncommitted) | T013 GUI quickstart; commit |
| `Ctrl+W` closes the active document | Implemented as spec `007` (uncommitted) | T013 GUI quickstart; commit |
| Copy Markdown **path** | Shipped as **Copy path** | — |
| Copy Markdown **content** | Spec `006` written; `plan.md` is still the template; no code | Stream B |

## Open work

### Stream A — Close what is already in flight (P1, small)

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| A1 | Verify bookmarks: run `specs/005-document-bookmarks/tasks.md` T054 and T063, including restart, rename, missing heading and bookmark-only notification cases | ready | S | Both tasks checked; any regression fixed or filed |
| A2 | Verify and commit spec `007`: run its `quickstart.md` in `npm run tauri dev`, especially `?` outside/inside inputs, focus restore, `Ctrl+W`, `Ctrl+Shift+T`, manual tab | ready | S | T013 checked; typecheck, web tests and build green; committed |
| A3 | Update the living docs for both: `CHANGELOG.md`, `README.md`, `_ai/context-definitions/` where behavior is durable | ready | S | Docs merged with the code, not later |

### Stream B — Copy Markdown content (P1, medium)

Source: `specs/006-copy-markdown-content/spec.md`. The spec and clarifications
are complete; `plan.md` is untouched.

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| B1 | Run the plan/tasks step for `006`; resolve the open implementation questions below | ready | S | `plan.md`, `research.md` and `tasks.md` are concrete, no template markers |
| B2 | Add **Copy Markdown** to the tab menu, copying the right-clicked tab without switching | ready | M | Menu action copies exact source, frontmatter included, toast shown |
| B3 | Add the configurable shortcut, persisted in `shortcuts.toml`, with a settings control and conflict rejection | ready | M | Survives restart; conflicts with reserved chords are rejected with a message |
| B4 | Validate conflicts against `buildShortcutReference()`, not only `FIXED_SHORTCUTS`, so `?`, `Esc`, context-menu, middle-click and `Ctrl+W` are reserved too | ready | S | Unit test proves every reference entry is unavailable |
| B5 | Add tests for menu targeting, source fidelity, modal suppression and shortcut persistence | ready | M | `npm run typecheck`, `npm run test:web` green |

Implementation notes:

- Raw source already lives in `Tab.content`; no backend read is needed.
- `copyText()` already handles the WebKitGTK clipboard fallback.
- Do not copy the rendered HTML in this stream; that belongs to Stream D.

### Stream C — Surface changed `_ai` documents (P2, medium)

This is the strongest differentiator still open: it deepens triage of agent
output instead of widening the product.

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| C1 | Specify the selection semantics: staged + unstaged + untracked, `_ai/**/*.md` only, deleted files skipped, deduplicated, newest first | needs-decision | S | Spec answers: what "changed" means; which repo/cwd; whether opening all is allowed |
| C2 | Add a Rust command that runs git with an argument array in the resolved repository and returns typed entries | ready after C1 | M | Pure parsing tested; no shell interpolation; missing git/repo returns an actionable error |
| C3 | Expose it as a CLI flag and/or an in-app action | needs-decision | M | Decision recorded; loading/empty/error states rendered; Ctrl/Cmd-accessible refresh path |
| C4 | Decide tab flood vs transient view | needs-decision | S | A document set of 30 changes does not open 30 tabs by default |

Recommended default: a transient **Changed `_ai`** view with the shared filter,
opening only on activation. Keep the CLI flag as the agent-friendly entry point.

### Stream D — Export and local handoff (P2, medium; spike first)

The list asked for "Convert to PDF", PDFs for the team, and sending rendered
documents. Only the first is in scope as an export; the other two are the
reader's own sharing workflow. `copy_file_reference` already exists, so the
missing piece is producing the file.

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| D1 | Timebox a spike: `window.print()` behavior on WebKitGTK, WKWebView and WebView2; rich-text copy by selecting the rendered article and `execCommand("copy")` | ready | S | Findings written down with platform limits; no production code yet |
| D2 | Decide the primary handoff: **Copy formatted** (HTML/rich text) or **Export PDF**, or both | needs-decision | S | ADR/spec records the choice and why |
| D3 | Implement the chosen action; if PDF, allow "print/save" plus a follow-up **Copy file** using the existing command | blocked on D2 | M | One action produces a usable PDF or formatted clipboard entry; failures show recovery text |
| D4 | Guarantee export never overwrites a watched document | ready | S | Writes only to a user-chosen/new path; overwrite requires explicit confirmation |

Recommendation: validate **Copy formatted** first. It covers the Slack/e-mail
use case with no PDF engine and no new dependency; PDF becomes optional rather
than foundational.

### Stream E — Second instance or second window (P3, decision first)

The original request was a CLI option to open a new instance. Spec `001`
explicitly keeps docdeck single-window, and a second process shares
`localStorage` (unread state, bookmarks, preferences) and config files.

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| E1 | Write an ADR comparing second process with namespaced storage versus a second window in one process with per-window watch state | needs-decision | S | Trade-offs, migration and failure modes recorded |
| E2 | Implement only if the ADR justifies it | blocked on E1 | L | Either behavior is documented, or the item is closed as rejected |

Do not implement `--new-instance` by simply skipping the single-instance plugin;
that creates two writers for the same state files.

### Stream F — Reusable Tauri app baseline (P3, documentation)

The list says every Tauri app should have `?`, `Ctrl+W` and `Ctrl+Shift+T`.
docdeck now does. Extract the pattern before it drifts.

| ID | Work | Status | Size | Done when |
| --- | --- | --- | --- | --- |
| F1 | Write a short baseline note or context definition: shortcut registry as source of truth, help overlay, Ctrl-only close decision, focus restore, manual bundling | ready | S | Another app can copy the pattern without reading docdeck's whole history |
| F2 | Decide whether a shared package is warranted | needs-decision | S | Explicit "not yet" with a trigger, or a follow-up epic |

## Icebox — not planned, retained for traceability

These are intentionally out of the current product. They are not "later tasks"
until the goals change.

| Original request | Why parked | Only viable light version |
| --- | --- | --- |
| "Senden an …" with address book and free-text recipients, sending rendered HTML plus Markdown/ODT/DOCX/PDF attachments | Adds SMTP credentials, address-book storage, mail composition, attachment generation and failure handling; contradicts "local, no accounts, small dependency set" | Generate a local `.eml` (HTML body + attachments) and open it in the user's mail client; no SMTP, no stored secrets |
| PDFs visible to the team; members send Markdown documents back and forth | Collaboration/sync is a non-goal; docdeck does not own shared folders or delivery | Export a PDF into a folder the team already shares; the reader shares it with existing tools |
| DOCX/ODT attachments | Requires a conversion engine or an external office suite, for a format the reader does not read in docdeck | Convert outside docdeck; attach the source Markdown or exported PDF |

If any of these becomes essential, the order is: amend `_ai/goals.md`, write an
ADR, then open a new epic. Do not implement them inside Stream D.

## Candidate ideas — unvalidated, do not schedule yet

- **Copy as rich text** — likely part of Stream D; no separate item.
- **Reveal in file manager / open in editor** — `open_local_path` already exists;
  low cost, but only if readers ask for it.
- **Unread-only filter** — small extension of the browse filter; would help
  triage, needs a spec.
- **Command palette** — can reuse the `?` overlay shell, but adds a second
  navigation model; defer until the changed-`_ai` view exists.

## Suggested sequence

1. **A** — close verification debt and commit `007`.
2. **B** — ship Copy Markdown content; it is specified and creates the
   configurable-shortcut foundation.
3. **C** — ship changed `_ai` documents; highest remaining product value.
4. **D1 → D2** — run the export spike and choose Copy formatted or PDF.
5. **E1** and **F1** — decisions/docs that can run in parallel with B and C.
6. Revisit the icebox only after a goals change.

Streams B and C touch different surfaces and can run in parallel once their
specs are settled. Stream A should not wait for either.

Spec numbering: `006` is already allocated to Copy Markdown; use `008` for
Stream C and `009` for Stream D once D2 chooses an approach. Stream E needs an
ADR, not a spec, until it is approved.

## Cross-cutting requirements

- Every stream follows spec → plan → tasks → implement, with pure logic covered
  by deterministic tests.
- No new runtime dependency without justification in the change.
- Export and clipboard features must never write to watched documents.
- Any UI addition updates `README.md`, `CHANGELOG.md` and the relevant
  `_ai/context-definitions/` note in the same change.
- `npm run check` (typecheck, Rust and web tests, build) stays green.
- New persisted state must update the Persistence section of the constitution
  and be validated per entry.

## Definition of done for this epic

- Streams A–D are delivered and verified; E has an accepted ADR (implemented or
  rejected); F is documented.
- The status reconciliation table has no rows left except the icebox.
- The original feature list is retired or archived with links to the specs and
  ADRs that replaced it.
- `_ai/goals.md` still describes the product as built; if not, the epic stops
  and the goals change is handled first.

## Traceability from the original list

| Original item | Disposition |
| --- | --- |
| Bookmarks | Done; A1 verification |
| "Senden an …" and address book | Icebox |
| Browse filter | Done |
| Copy path | Done |
| `Ctrl+Shift+T` | Done |
| Convert to PDF and copy the file | Stream D |
| PDFs for the team / exchanging Markdown | Icebox |
| Copy Markdown path and/or content | Path done; content in Stream B |
| `?` shortcuts modal with manual tab | Done in `007`; A2 verification |
| `?` / `Ctrl+W` / `Ctrl+Shift+T` in every Tauri app | docdeck done; Stream F |
| Middle-click closes a tab | Done |
| Command for staged/uncommitted `_ai` documents | Stream C |
| CLI option for a new instance | Stream E |
