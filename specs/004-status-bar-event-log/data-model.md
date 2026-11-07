# Phase 1 Data Model: Status Bar, Event Log, Window Title, and Resizable Panes

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

Everything here is webview state. There is no database, no new backend model,
and no persisted event history. The only persisted data is the existing
`docdeck.preferences.v1` payload, extended with one validated `layout` object.

## Entity: StatusEvent

One watch/scan lifecycle occurrence. Pure value object; never contains document
content.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `number` | yes | Monotonic within a session; never reused, even after `clear()` |
| `at` | `number` | yes | Epoch ms from the injected clock |
| `kind` | `EventKind` | yes | `scan-start` · `scan-complete` · `reload` · `watch-added` · `watch-removed` · `warning` · `truncated` · `error` |
| `severity` | `EventSeverity` | yes | `info` · `warning` · `error` |
| `message` | `string` | yes | One line, plain text; used by the status bar |
| `detail` | `string` | no | Full warning/error text; shown in the log row |

**Validation / invariants**
- `severity` and `kind` are closed unions; unknown values are never created.
- `message` is non-empty after trimming.
- `at` is a finite number.
- `detail`, when present, is plain text and is rendered with `textContent`.
- Events are append-only from the store's perspective; the store never mutates an
  existing entry.

**Lifecycle**

```text
(absent) --record()--> retained
retained --capacity exceeded--> evicted (oldest first)
retained --clear()--> (absent, session-only)
app exit --> all entries gone; never written to disk
```

## Entity: EventLog

Session-scoped, bounded collection of `StatusEvent`, plus derived queries.

| Member | Type | Notes |
|--------|------|-------|
| `capacity` | `number` | Fixed at 500 (FR-016) |
| `entries()` | `readonly StatusEvent[]` | Oldest first; newest last |
| `warnings()` | `readonly StatusEvent[]` | Filter `severity === "warning"` |
| `record(input)` | `StatusEvent` | Assigns `id` and `at`; evicts oldest when full |
| `clear()` | `void` | Empties entries; keeps the id counter and capacity |
| `size` | `number` | `0 … 500` |

**Invariants**
- `entries().length <= 500` at all times.
- Ordering is strictly increasing by insertion; ids increase monotonically.
- No persistence: constructing the app always starts with an empty log.
- Only call sites for watch/scan lifecycle may record (FR-012, FR-014).

## Entity: StatusBarView

Derived, never stored. The status bar controller receives one of these per
render.

| Field | Type | Notes |
|-------|------|-------|
| `phase` | `"scanning" \| "idle"` | Scanning wins over the latest event |
| `location` | `string \| null` | Current scan path (already shortened for display) |
| `directories` | `number` | Scan only |
| `files` | `number` | Scan only |
| `event` | `StatusEvent \| null` | Newest log entry when not scanning |
| `warningCount` | `number` | Count of warning entries currently in the log |
| `severity` | `EventSeverity` | Severity of the active content |
| `text` | `string` | Final one-line summary text |

**Derivation rules**
- While `phase === "scanning"`: `Scanning <location> (<n> folders · <m> files)`,
  with a fallback `Scanning watched paths…` when progress has not arrived yet.
- Otherwise, if `event !== null`: the event's one-line `message` and severity.
- Otherwise: a quiet idle line (`Ready` or `Watching <n> folders`).
- `warningCount > 0` renders the warning chip; zero hides it (FR-008, edge case).
- `location` shortens before counts: `compactPath` plus CSS ellipsis on the
  location segment; count segments are non-shrinking (FR-009).
- The line never disappears or grows beyond one line (US1 scenario 4).

## Entity: DocumentIdentity / WindowTitle

Derived from the active path; never stored.

| Field | Type | Notes |
|-------|------|-------|
| `activePath` | `string \| null` | `null` means no document is active |
| `project` | `string \| null` | Component directly above the deepest `_ai` segment |
| `filename` | `string \| null` | Last path component |
| `title` | `string` | Final OS title |

**Composition (FR-001 – FR-003)**

| Condition | `title` |
|-----------|---------|
| `activePath === null` | `docdeck` |
| project present | `<project> — <filename> — docdeck` |
| no project | `<filename> — docdeck` |

The separator is one em dash with single spaces. The deepest `_ai` wins; an
`_ai` at the path root yields no project; Windows separators are handled by the
existing `project.ts` helpers.

**Update points (FR-004)**: tab activation, document open, active-tab close,
close-all, active-tab rename, and initial mount. Updates are synchronous before
the Markdown render, so the 200 ms budget is met even for large documents.

## Entity: LayoutPreference (persisted)

Stored inside `docdeck.preferences.v1` under a `layout` object.

| Field | Type | Default | Stored-valid range | Effective bound |
|-------|------|---------|--------------------|-----------------|
| `sidebarWidth` | `number` | `300` | `200 … 600` | also ≤ 50% of window width |
| `tocWidth` | `number` | `240` | `160 … 480` | also ≤ 50% of window width |
| `eventLogHeight` | `number` | `200` | `100 … 10000` (finite sanity bound) | also ≤ 60% of window height |
| `sidebarSplit` | `number` | `50` | `15 … 85` | percent of sidebar usable height |

**Validation (per field, independently)**
- Missing `layout`, missing field, non-number, `NaN`/`Infinity`, or a value
  outside the stored-valid range → that field's default (spec edge case:
  "missing, corrupt, or out of range → defaults are used").
- Other preference fields are unaffected by a bad layout field and vice versa.
- The top-level `version` stays `1`; the `layout` object is additive and
  backward-compatible.
- Only the four sizes are persisted. Log visibility, filter, follow state,
  active tab, open documents, and browse filter are not.

## Entity: EffectiveLayout (derived)

Computed from `LayoutPreference` and the current viewport; never written back.

| Field | Type | Notes |
|-------|------|-------|
| `sidebarWidth` | `number` | Final CSS width |
| `tocWidth` | `number` | Final CSS width |
| `eventLogHeight` | `number` | Final CSS height |
| `openFraction` | `number` | Final Open/Browse fraction, `0.15 … 0.85` |
| `documentMin` | `number` | Constant `320` (SC-005) |

**Resolution algorithm** (`resolveLayout(preferences, viewport)`)

1. Clamp each stored value to its static range (already validated on load).
2. For each side pane: `max = min(staticMax, floor(viewportWidth / 2))`.
3. Reserve `documentMin = 320`. Let `budget = viewportWidth - 320`.
4. If `sidebar + toc <= budget`, use the desired widths.
   Otherwise give both their minimums and distribute the remaining budget in
   proportion to each pane's desired distance above its minimum.
5. Clamp `eventLogHeight` to `100 … floor(viewportHeight * 0.6)`.
6. Clamp `openFraction` to `0.15 … 0.85`.

The app's minimum window width is raised to **700 px** so step 3 can always honor
both pane minima (200 + 160) plus the 320 px document floor (680 px required).
Window resize recomputes this derived object and updates CSS; it never changes
the stored preference (FR-032).

## Entity: ResizeBoundary (ephemeral UI state)

| Field | Type | Notes |
|-------|------|-------|
| `pane` | `"sidebar" \| "toc" \| "event-log" \| "sidebar-split"` | Which size it controls |
| `orientation` | `"vertical" \| "horizontal"` | ARIA orientation |
| `dragging` | `boolean` | True between pointerdown and pointerup/cancel |
| `origin` | `number` | Pointer coordinate at drag start |
| `startSize` | `number` | Size at drag start |
| `enabled` | `boolean` | False when the pane is hidden/collapsed |

**Transitions**

```text
idle --pointerdown (enabled)--> dragging
dragging --pointermove--> dragging (size clamped, CSS updated, no persist)
dragging --pointerup/cancel/blur--> idle (final value persisted, debounced)
idle --dblclick--> idle (default restored and persisted)
idle --Arrow/Home/End/Enter--> idle (size updated and persisted)
hidden/collapsed --> enabled=false, tabindex=-1, no drag possible
```

**Invariants**
- A drag never re-renders Markdown or changes the active document.
- Effective size always stays inside the bounds from R7 and leaves the document
  area at least 320 px whenever the window permits.
- Keyboard changes and double-click use the same clamping and persistence path as
  a drag.

## Cross-entity flow

```text
backend event ──> main.ts ──> EventLog.record(...)
                         └──> StatusBar.render(deriveStatusBar(...))
                         └──> EventLogPanel.append(...) (if open)
                         └──> sidebar hint only (config missing)

tab activate/open/close/rename ──> activePath ──> composeWindowTitle ──> document.title + Window.setTitle

pointer/keyboard/dblclick ──> ResizeBoundary ──> resolveLayout ──> CSS custom properties
                                             └──> savePreferences (debounced, drag end only)
```

## Boundary conditions covered by tests

- Empty log, clear, 500-entry eviction, and a 501st entry.
- Warning count zero (no chip) and non-zero (chip opens warnings filter).
- Scanning with no progress yet, with progress, and after completion.
- Title with no document, no project, project, multiple `_ai` segments, and
  Windows-shaped paths.
- Layout defaults, legacy payload without `layout`, one bad field, out-of-range
  values, a narrow window, and a window resize that clamps but does not persist.
- Resize handle at minimum, at maximum, double-click reset, keyboard Home/End,
  hidden outline, collapsed section, and log closed.
- Escape inside the log closes it without closing the active document.
