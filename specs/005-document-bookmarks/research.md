# Phase 0 Research: Document and Section Bookmarks

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

All unknowns from the Technical Context are resolved below. No
`NEEDS CLARIFICATION` remains. The feature is webview-owned state with one
narrowly scoped Rust notification filter; no content-read command, new
permission or new dependency is required.

## R1 — Where bookmark state lives

**Decision**: Bookmarks are owned by the webview and persisted in a new
versioned `localStorage` key:

```text
docdeck.bookmarks.v1
{ "version": 1, "documents": [...], "sections": [...] }
```

Rust never stores bookmarks and never learns heading text. It receives only the
derived path set used to filter desktop popups (R13).

**Rationale**: Bookmarking is reader intent about documents the webview already
knows: open tabs, inventory rows, the active outline and unread state. The
constitution places view orchestration in the webview and permits versioned
`localStorage` preferences. Keeping the collection there means one source of
truth, one validation policy and no IPC round-trip on a star toggle.

**Alternatives considered**:
- **Persist in `config.toml`**: mixes reader state with watch configuration and
  would make the configuration editor responsible for bookmark schemas.
- **Persist in Rust (instance file / new store)**: duplicates the inventory and
  acknowledgement path model, and the webview would still own resolution.
- **Reuse `docdeck.preferences.v1`**: one corrupt bookmark entry would sit in the
  same envelope as UI toggles; the bookmark store needs its own per-entry
  recovery and a distinct lifecycle.
- **Session-only**: fails FR-029 and SC-002.

## R2 — Storage schema, validation and corruption recovery

**Decision**: Add `src/bookmarks-storage.ts` with a pure `decode(raw)` and a
debounced writer, modeled on `acknowledgements.ts`:

```json
{
  "version": 1,
  "documents": [
    { "path": "/home/u/devel/p/_ai/plan.md", "addedAt": 1763200000000 }
  ],
  "sections": [
    {
      "id": "sec-1763200000000-1",
      "path": "/home/u/devel/p/_ai/plan.md",
      "addedAt": 1763200000000,
      "anchor": {
        "text": "Risks",
        "depth": 2,
        "before": "Timeline",
        "after": "Open questions",
        "ordinal": 0,
        "order": 7
      }
    }
  ]
}
```

Validation rules:
- Corrupt JSON, a non-object envelope, or `version !== 1` → an empty collection;
  the app starts normally.
- `documents` and `sections` must be arrays; a malformed element is dropped and
  every valid sibling survives (FR-031).
- A document entry requires a non-empty `path` and finite `addedAt`. Duplicate
  paths collapse to the first valid entry.
- A section entry requires a non-empty unique `id`, non-empty `path`, finite
  `addedAt`, and an anchor with string `text` (possibly empty for an
  image-only heading), integer `depth` 1–4, `before`/`after` arrays of at most
  two strings (nearest first), and non-negative integer `ordinal`/`order`.
  Duplicate ids are dropped.
- Unknown fields survive a decode only if they are re-added by code; the writer
  emits exactly the v1 shape, so a future schema bumps the key rather than
  mutating v1.

Writes use one trailing debounce (250 ms) and flush on `pagehide`/`beforeunload`,
matching the acknowledgement store. Each mutation writes the whole collection,
which is small (a few hundred entries).

**Rationale**: Per-entry validation keeps one bad record from costing the reader
every bookmark, exactly as the spec's corruption edge case requires. A separate
key lets a future bookmark schema change coexist with v1 instead of migrating in
place.

**Alternatives considered**:
- **One array mixing both kinds**: toggling a document and finding its sections
  would require filtering and type checks everywhere; separate arrays make the
  "document unbookmarked, sections kept" rule structural.
- **Map keyed by path**: section bookmarks need a stable per-occurrence id, and
  duplicate-text headings cannot share a path key.
- **Immediate write on every mutation**: `localStorage` is synchronous; a burst
  of toggles would block the main thread.

## R3 — Section anchor identity and resolution

**Decision**: A section anchor captures the heading at bookmark time:

```ts
interface SectionAnchor {
  text: string;        // plain heading text from extractHeadings
  depth: number;       // 1–4, the outline's depth
  before: string[];    // up to 2 previous outline heading texts, nearest first
  after: string[];     // up to 2 next outline heading texts, nearest first
  ordinal: number;     // occurrence among headings with the same text
  order: number;       // outline index at capture (fallback ordering)
}
```

Text comparison normalizes by trimming and collapsing internal whitespace; it is
case-sensitive. A two-heading window on each side is used instead of a single
neighbour so that inserting another identical heading immediately before the
target still leaves discriminating context (`[A, A2]` vs `[T, A]`). Resolution
is a pure function over the current `Heading[]`:

1. **Exact text** — candidates whose normalized text equals the anchor text.
   - One candidate → resolved **via text**.
   - Several candidates → score each against the anchor's context window:
     nearest neighbour match +2, second neighbour +1, per side; same depth +1.
     A unique highest score wins (via text).
   - Occurrence is used **only when every candidate has a score of zero** (no
     context evidence at all) and the candidate at `anchor.ordinal` exists: that
     candidate wins via **occurrence**, the documented last resort. When
     candidates have positive but tied evidence, the resolver returns
     **stale/ambiguous** rather than guessing.
2. **No exact text** — candidates with the same depth and consistent evidence on
   both sides of the window (an empty matching side counts as evidence). A
   unique highest score (at least one neighbour per side) wins via **context**,
   which is the re-anchored case. Ties or no candidates → **stale**
   (`ambiguous` or `missing`); occurrence is deliberately *not* used here
   because the text changed, so an ordinal among new duplicate texts says
   nothing reliable about the old section. Requiring both sides prevents a
   deleted heading from handing its context to an unrelated neighbour.
3. **Never guess** — a resolved slug must be the heading the rules chose; an
   unresolved bookmark must not scroll. Two bookmarks resolving to the same slug
   are both kept and flagged as shared targets rather than silently merged.

**Rationale**: This mirrors the spec's clarified order (text first, context to
disambiguate, occurrence last) and SC-003's stricter promise: zero silent jumps
to a different section. A two-heading window is cheap, survives insertions
before the heading (the previous headings stay the same until content is inserted
between them), and distinguishes identical headings in different parts of a
document. Composite neighbour/depth scores avoid accepting a heading whose only
similarity is a common `Overview` neighbour.

**Alternatives considered**:
- **DOM id / slug as identity**: the slug is derived from the text, so every
  rename changes it; duplicates get ordinal suffixes, so an insertion also
  changes it.
- **Store the heading's absolute line number**: any insertion above the heading
  moves it, and agents rewrite constantly.
- **Full section hash**: changes on every edit inside the section, which makes
  the bookmark stale exactly when the reader wants it to follow.
- **Automatic re-anchor on any neighbour match**: too willing to follow an edit
  into an unrelated section; requiring depth plus at least one neighbour and a
  unique score keeps the failure mode visible.

## R4 — When resolution runs and what "not checked" means

**Decision**: Section resolution runs for the **active document** whenever its
content is rendered or reloaded. The resulting resolutions live in a session map
owned by `BookmarksController` and are never persisted as truth. A section
bookmark in a document that has not been rendered this session is shown as
**not checked**; activating it opens/focuses the document, resolves against the
fresh outline, and only then scrolls or reports stale.

The Bookmarks view never reads a closed document. A watched document that changes
while closed still updates availability and unread state through the existing
watcher, but its section rows stay unverified until opened.

**Rationale**: Resolving a section requires the document's headings, which only
the webview's `marked`-based extractor produces. Reading every bookmarked file
on startup would be unbounded I/O, could read large agent documents, and would
need a new content-read command and size limits. Activation validation already
satisfies SC-003: a stale section is detected before any scroll, so the reader is
never sent to the wrong place. "Not checked" is an explicit partial state, not a
claim that the section is current.

**Alternatives considered**:
- **Read all bookmarked documents at startup**: with 500 bookmarks and large
  files this can take seconds and block nothing but wastes disk/CPU; it also
  duplicates `load_file` side effects (watch registration, summary snapshots).
- **Add a heading-extraction command in Rust**: two Markdown parsers that can
  disagree on setext headings, inline markup and slugs; the webview extractor is
  the single source of heading truth.
- **Background highlighter-style queue**: a defensible later enhancement, but it
  adds a command, per-file limits, progress states and cancellation for a first
  release the spec asked to keep simple.
- **Assume last-known status is still true**: would silently lie after a restart
  and is exactly the trust failure the constitution warns about.

## R5 — Where the Bookmarks view lives and how it is rendered

**Decision**: Bookmarks become a third `BrowseMode` in the existing browse
section (`All` | `Recently changed` | `Bookmarks`), not a window or a separate
sidebar. The view uses its own scroll host, `<ul>` and `VirtualList`, shown only
in bookmarks mode; All/Recent keep their existing list untouched. Rows are
flattened in this order:

```text
document row
  section row (document order)
  section row
document row
  ...
```

Document rows reuse the existing two-line `inbox-row` anatomy (project chip,
filename, unread dot, parent path, relative time) with the bookmark star added.
Section rows are single-line, indented by heading depth, with a status badge and
inline actions.

The mode button carries the total bookmark count; its accessible name is
`Bookmarks, N bookmarks`. A separate count is not maintained in two places.

**Rationale**: A dedicated list avoids overloading the existing
`VirtualList<InboxEntry>` with a union of row kinds and keeps All/Recent renders
byte-for-byte on their current path. Two lists on two scroll hosts can each own
their window without fighting over one `<ul>`. The fixed 48 px row height is the
existing virtualization contract; section rows use the same height so no
variable-height rework is needed.

**Alternatives considered**:
- **One union-typed list for all modes**: possible, but recycling a two-line
  document row into a section row would rebuild content and complicate the
  existing virtual list for no gain.
- **Non-virtualized nested list**: 500 bookmarks plus hundreds of sections on
  every watcher event violates the constitution's virtualization rule and risks
  SC-005.
- **Group header rows**: see R6.
- **Separate window/panel**: explicitly rejected by FR-008.

## R6 — Ordering and the meaning of "group by project"

**Decision**: The current **All documents** view is a flat, virtualized list
sorted by `modifiedTime` descending with a path tiebreak; each row carries an
`_ai` project chip. It has no project header rows. Bookmarks therefore reuse that
exact ordering and chip for available documents; unavailable documents sort
after available ones by filename/path. A document's sections always follow the
order of headings in the file (`resolution.index`, falling back to the stored
`anchor.order`).

**Rationale**: The spec says bookmarks are grouped and ordered "the same way All
documents does". Inventing project header rows would create a second ordering
pattern that All documents does not have, break the shared row anatomy, and make
400 section rows under headers much taller. Reusing the chip plus mtime ordering
is the faithful reading of the existing product. The Deep group headers in the
summary modal (`groupByProject`) are a report layout, not the navigation list.

**Alternatives considered**:
- **Project header rows**: not what All documents does today; would change the
  view's height and scrolling model and add a new grouping widget outside this
  feature.
- **Insertion order**: would not match All documents and would leave bookmarks in
  an arbitrary order.
- **Alphabetical**: predictable but not the stated "same as All documents".

## R7 — Availability and unread state

**Decision**: A bookmark is **available** when its path exists in the session
`InboxModel` and is not marked `deleted`; otherwise it is **unavailable**.
`InboxModel` already includes manually opened documents as `origin: "manual"` and
survives config reloads, so an open document outside every watch root stays
available for the session. After a restart, a bookmark outside the watch set is
unavailable until the document is opened again or a matching watch returns it,
which matches FR-021 and the spec's "no longer watched" edge case.

Unread state reuses the existing rule:
- available watch/manual rows use `InboxModel`'s `unread` flag, which
  `Acknowledgements` keeps correct across restarts;
- activating a bookmark goes through `setActiveTab`, which calls
  `inbox.markRead` and `acks.acknowledge`, so reviewing clears the marker;
- first launch seeds the acknowledgement baseline, so no document is unread
  merely because it is bookmarked (US3 scenario 3);
- unavailable rows show no unread marker and no relative time.

Unread indicators keep the existing dot plus the existing class/textual title;
the new view does not introduce a color-only signal. Scope stays document-level
(section-level change indicators are out of scope).

**Rationale**: Reusing one inbox and one acknowledgement store keeps the dot
meaning identical everywhere, avoids a second mtime comparison, and makes
rename/move unread behavior work through the existing `acks.move` call. Using
inventory membership avoids a new stat command and keeps the "watched locations"
definition the spec uses.

**Alternatives considered**:
- **Stat every bookmarked path at startup**: adds a command and a second
  availability source; inventory membership is already the app's definition of a
  live document.
- **Keep unavailable rows unread**: a missing document cannot have unread
  content; the unavailable badge is the honest state.
- **Section-level unread**: explicitly out of scope.

## R8 — Rename, move-out, delete and return

**Decision**: Hook bookmark maintenance into the existing watcher branches in
`main.ts`:
- `renamed`: re-key the document bookmark (deduplicating a pre-existing target)
  and every section bookmark from `fromPath` to `path`, and move the session
  resolution entries with them; then sync the notification filter.
- `movedOut` and `deleted`: keep every bookmark and section row, mark the
  document unavailable, and leave unread suppressed. No cascade delete.
- `created`/`modified` at a bookmarked path: the path becomes available again
  through the inbox; the document is treated as changed (normal acknowledgement
  rule), and section resolution re-runs only when the document is rendered.
- Config reload reconciliation removes watch rows; bookmarks to those paths are
  retained as unavailable and reappear if a later watch matches them.

**Rationale**: This reuses the file-identity rename pairing from ADR 261101-1;
bookmarks follow the same identity transition as tabs, inbox rows and
acknowledgements. Retaining unavailable bookmarks satisfies FR-021 and avoids
silent data loss.

**Alternatives considered**:
- **Delete bookmarks on move-out/delete**: violates FR-021 and US1 scenario 8.
- **Watch bookmarked paths independently**: introduces a second watcher, which
  the spec assumptions forbid.
- **Store file identity instead of path**: the store is plain JSON and may
  outlive the platform identity; path plus the watcher's rename event is enough.

## R9 — Document bookmark affordances and the shortcut

**Decision**:
- A header toggle (`★ Bookmark: ON/OFF`) reflects and toggles the active
  document; disabled with no active document.
- Every open-document row and every navigation document row (All, Recently
  changed, Bookmarks, and the full-inventory modal) carries a real
  `<button>` star with `aria-pressed`, an accessible name including the filename,
  and a filled/empty glyph. Clicking it must not activate the row. Document rows
  are structured as a main activation button plus sibling star/close buttons so
  the star is not nested inside a `role="button"` row.
- The document row context menu gains `Bookmark document` /
  `Remove bookmark`.
- `Ctrl`+`D` (macOS `Cmd`+`D`) toggles the active document. The handler ignores
  events from inputs, textareas and contenteditable elements, and from any
  keyboard event while a modal dialog is open, and prevents the webview's
  default.
- A heading is bookmarked by focusing it in the outline and activating its star;
  there is deliberately no scroll-position section shortcut (clarified in the
  spec).

**Rationale**: FR-002/FR-005 require every row to be a first-class affordance,
and the existing toggle helper already centralizes `aria-pressed` rendering. A
real button inside a row is keyboard reachable and does not need hover. `Ctrl+D`
is the conventional "bookmark this page" gesture and is free in the app's
current shortcut set (`Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+Shift+T`, `Ctrl+\``).

**Alternatives considered**:
- **Header control only**: fails the "any row" requirement.
- **Context menu only**: not discoverable and not "one action" for SC-001.
- **`Ctrl+B`**: also used for bold in editors and less discoverable as bookmark.
- **A section shortcut at the reading position**: explicitly out of scope.

## R10 — Outline bookmark control and duplicate headings

**Decision**: `TocPanel` gains one star button per outline heading and a
`setBookmarkedSlugs(Set<string>)` refresh path. A star is `aria-pressed="true"`
when a section bookmark for the active document resolves to that heading's slug.
Activating the star toggles the bookmark for that exact outline heading.

When several bookmarks resolve to the same heading (a possible result of edits),
the outline shows a mixed/ambiguous state (`aria-pressed="mixed"` plus a label
saying how many bookmarks target it); activating it removes all of them in one
action and the removal is undoable. The Bookmarks view keeps both rows visible
and marks them as shared, rather than silently de-duplicating.

**Rationale**: The outline is the only per-heading surface, and the spec makes
that surface the keyboard path for section bookmarks. Removing all colliding
bookmarks on one explicit toggle restores the "no duplicates" invariant instead
of leaving one behind invisibly; the toast/undo makes the multi-removal
reversible.

**Alternatives considered**:
- **Remove only the newest**: leaves a duplicate that the star no longer
  represents clearly.
- **Open a disambiguation dialog**: extra friction for a rare repair case; the
  shared badge in the view already explains the state.
- **Hide the star on duplicates**: removes the only repair path.

## R11 — Removal, undo and empty/error states

**Decision**: Every bookmark removal (document star, section star, context menu,
view remove action, outline toggle) creates a session-only `RemovedBookmark`
snapshot in `BookmarksController` and shows a toast with an inline `Undo`
button. Undo restores the exact bookmark(s) and anchor(s), including `addedAt`.
A new removal replaces the previous snapshot. `ToastHost` gains an optional
action callback while keeping its single-node, non-stacking behavior and
`role="status"` live region.

The Bookmarks view has explicit states:
- **empty collection**: explains how to create a bookmark (star on a document or
  heading, `Ctrl+D`) and offers a `Browse all documents` action that switches to
  All;
- **filtered to nothing**: `No bookmarks match “term”` plus `Clear filter`;
- **unavailable document**: `Unavailable` badge, remove action, no activation;
- **stale section**: `Not found` badge, `Re-anchor` and `Remove`;
- **unverified section**: `Not checked` badge, activation validates first;
- **re-anchored/shared**: `Moved` / `Shared` badges with explanatory titles.

**Rationale**: A confirm dialog on every star click would make the primary
interaction hostile, while a view-local undo would be unreachable when the
removal happened in All documents or the outline. The toast is the lightest
global, reversed-on-demand surface. Explicit states satisfy the constitution's
"empty, loading, error, partial, success" rule.

**Alternatives considered**:
- **Immediate permanent removal**: violates FR-006.
- **Modal confirmation**: too heavy for a toggle.
- **Undo stack in the view**: invisible from other modes and lost on mode switch.

## R12 — Filtering the Bookmarks view

**Decision**: Reuse the existing single browse filter input and term. A pure
`filterBookmarkRows(view, term)` applies the already-normalized literal
substring to:
- document filename, full path and project name (same fields as
  `filterEntries`); and
- section heading text.

Rules:
- A matching document shows the document row **and all of its bookmarked
  sections** (the whole document is relevant).
- A document that does not match but has matching sections is shown as the
  container with **only the matching sections** nested under it (the clarified
  behavior).
- Ordering is never changed; state (stars, unread, stale) is preserved; the term
  is neither cleared nor persisted by bookmark actions.
- An unavailable document is included only when its filename/path/project
  matches; its section badges remain unavailable.

**Rationale**: One shared term and one matching vocabulary keep the three views
coherent, and the two inclusion rules cover both "find the doc" and "find the
section" without duplicating a second filter UI. Section text is the only extra
field the Bookmarks view needs.

**Alternatives considered**:
- **Filter sections only when the document matches**: hides a matching section
  behind a non-matching document, contradicting the clarified behavior.
- **Filter sections out when the document matches**: surprising; selecting a
  document should not hide its bookmarked children.
- **A separate bookmark filter**: fragments the shared filter and state.

## R13 — Bookmark-scoped desktop notifications

**Decision**: Keep notification delivery, mode, throttling and the presence dot
in Rust. The webview syncs a derived filter through one new typed command:

```text
set_bookmark_notification_filter
args: { filter: { enabled: boolean, paths: string[] } }
```

- `enabled` comes from the persisted `bookmarkNotificationsOnly` preference
  (default `false`).
- `paths` is the sorted, deduplicated set of paths that have a document
  bookmark **or at least one section bookmark** (FR-025), including currently
  unavailable paths (they simply will not match a live change).
- Rust stores `{ enabled, paths: HashSet<String> }` in an in-memory
  `Mutex`, validates the payload (absolute path, no NUL, ≤ 4096 bytes, ≤ 10,000
  entries, dedupe) and filters each settled `paths-changed` batch:
  - disabled → every change is a candidate (existing behavior);
  - enabled → only changes whose new path **or** rename source path is in the
    set are candidates;
  - enabled with an empty set → no popup at all.
- The tray presence dot is updated from the **full batch before filtering**, so
  it still reflects every detected change (FR-026).
- Mode (`off`/`unfocused`/`always`), focus and throttle are applied to the
  filtered batch. An empty filtered batch returns before the throttle check and
  does not consume the notification window.
- The notification title/body are built from the filtered candidates only
  (FR-026's "only popups are filtered").
- The webview re-sends the filter on startup and after every bookmark or setting
  change (add, remove, undo, rename). Rust never persists it, so the webview
  remains the source of truth. If the sync command fails, the webview logs the
  error and shows a toast when the setting is on; the tray keeps its previous
  filter until the next successful sync.

**Rationale**: This keeps OS concerns in Rust (P-I) without duplicating the
notification body/throttle/mode logic in TypeScript or adding a JS notification
permission. The path filter is metadata only and matches the exact canonical
strings the watcher emits, so Rust never needs document content or bookmark
anchors. Filtering before the throttle check makes "unbookmarked changes produce
zero popups" true even when they arrive first in a mixed burst.

**Alternatives considered**:
- **Move notifications to the webview** using the notification plugin's JS API:
  would need a capability permission and a second implementation of mode/
  throttle/body logic, and the tray menu's off state would no longer compose
  naturally.
- **Ask Rust to query the webview**: Tauri events are fire-and-forget; there is
  no synchronous reply, and an async round-trip would race the watcher batch.
- **Write the bookmark set to a file Rust reads**: creates an unsanctioned
  persisted store and a second source of truth.
- **Filter only by document bookmark, not sections**: violates FR-025.

## R14 — The notification setting surface

**Decision**: The setting is a labelled checkbox in the Bookmarks mode toolbar:
`Notify only for bookmarked documents`, with a short description
(`Tray dot still shows all changes`). It is persisted as
`bookmarkNotificationsOnly` in `docdeck.preferences.v1` (default `false`) and
reuses the existing debounced preference writer. When enabled, an inline note
appears in the view:
- with bookmarks: `Desktop notifications are limited to bookmarked documents.`;
- with no bookmarks: `No bookmarks yet, so no change notifications will appear.`
  (FR-028).

The existing tray menu remains the owner of `Off` / `Unfocused` / `Always`; the
checkbox only narrows which changes qualify within the active mode.

**Rationale**: The Bookmarks view is where the reader expects bookmark-related
choices, and keeping the checkbox out of the TOML editor avoids conflating a
per-user preference with watch configuration. The note makes the empty-set
effect visible instead of leaving a silently broken setting.

**Alternatives considered**:
- **Header toggle**: a seventh header control; less discoverable and not
  contextual.
- **Config panel/TOML**: mixing UI preference with watch configuration and
  requiring a config reload.
- **Tray menu submenu**: the tray menu is owned by Rust and the preference is
  webview state; adding a second menu source would duplicate state.

## R15 — No new dependency, permission or watcher

**Decision**: Add nothing to `package.json` or `Cargo.toml`; do not modify
`src-tauri/capabilities/default.json`; do not add a watcher. Reuse `extractHeadings`,
`scrollToAnchor`, `projectName`, `Acknowledgements`, `InboxModel`,
`createPreferenceWriter`, the existing virtual list and modal/overlay CSS. The
new command is a custom `#[tauri::command]`, which needs no capability
permission.

**Rationale**: The required primitives already exist and are tested. A new
Markdown parser, date library, UUID package or state store would be unjustified
complexity. Section ids are generated from the injected clock plus a
collection-local counter (`sec-<epoch>-<n>`), checked for uniqueness; tests pass
explicit ids.

**Alternatives considered**:
- **A markdown-AST or heading-index dependency**: the existing `marked` walk is
  authoritative.
- **A state library**: the app is deliberately framework-free.
- **`crypto.randomUUID()`**: needs a secure context and a browser API that the
  app otherwise does not depend on; a clock+counter with uniqueness checking is
  deterministic in tests.
- **A new Rust content-read command**: see R4.

## R16 — Testing strategy and seams

**Decision**:
- **Pure suites** (injected clock/storage, no DOM): `bookmarks-model.test.ts`
  (toggle/dedupe/rename/undo snapshots/notification paths), `bookmark-anchors.test.ts`
  (unique text, duplicate context, insertion before, reorder, edited text,
  deleted, ties/ambiguity, missing neighbours, depth limit, normalization),
  `bookmarks-storage.test.ts` (valid, corrupt, wrong version, partial entries,
  duplicate ids/paths, debounce/flush), `bookmarks-view.test.ts` (availability,
  unread, ordering, nesting, filter document-vs-section, counts, shared targets,
  unavailable sections).
- **Controller suite**: `bookmarks-controller.test.ts` with memory storage, a
  fake clock, a fake notification sync and injected resolutions (add/remove/undo,
  rename re-key, re-anchor commits, sync calls).
- **DOM suites** (`happy-dom`): `sidebar-panel`, `browse-modal`, `toc-panel`,
  `tab-menu`, `toast`, `bookmark-picker`, `virtual-list` for the new controls and
  non-activating inner buttons.
- **Rust**: `bookmark_filter_test.rs` covers validation (relative/empty/NUL/
  oversized/too many), dedupe, disabled pass-through, enabled empty set,
  mixed batches, rename source/target matching; the existing tray tests remain
  green. `cargo test` and `cargo clippy --all-targets -- -D warnings`.
- **Manual quickstart**: restart persistence, live renames/moves, stale and
  re-anchor, unread across restarts, bookmark-only notifications with the tray
  dot, corrupt storage, keyboard-only use and 500-bookmark timing.

**Rationale**: The repository's convention is pure models plus thin DOM
controllers; this feature's risk lives in resolution and persistence, both of
which are fully testable without a window or filesystem. Tauri command logic is
validated as a plain function rather than through IPC.

**Alternatives considered**:
- **End-to-end browser tests**: no harness exists, and OS notifications/tray
  behavior are manual by nature.
- **Testing `main.ts` directly**: it imports Tauri and owns the whole app; the
  controller seam keeps the new logic testable.

## R17 — Documentation and decision record

**Decision**: Update `README.md` (bookmarks, stale/re-anchor, notification
setting, shortcut), `CHANGELOG.md` (Unreleased → Added/Changed), add
`_ai/context-definitions/bookmarks.md`, and write
`_ai/technical_decisions/ADR__261115-1__webview-owned-bookmarks-with-context-anchors.md`
with the new persisted key, the anchor resolution rules and the Rust notification
filter. Add it to the ADR index.

**Rationale**: The constitution requires documentation and an ADR for
significant, hard-to-reverse decisions in the same change. The storage schema and
the cross-boundary notification filter both qualify.

**Alternatives considered**:
- **README only**: the schema/resolution decision would be lost to history.
- **No ADR**: conflicts with the governance rules for persisted state and a new
  IPC surface.
