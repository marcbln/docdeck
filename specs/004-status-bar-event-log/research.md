# Phase 0 Research: Status Bar, Event Log, Window Title, and Resizable Panes

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

All unknowns from the Technical Context are resolved below. No
`NEEDS CLARIFICATION` remains. The feature is webview-only apart from one
narrowly scoped Tauri capability permission and one window-size constraint.

## R1 — How the native window title is updated

**Decision**: Compose the title purely in the webview, then update both
`document.title` and the native window title:

```ts
const title = composeWindowTitle(this.activePath);
document.title = title;
void getCurrentWindow().setTitle(title).catch((error) => {
  console.error("Failed to set the window title", error);
});
```

`getCurrentWindow` comes from `@tauri-apps/api/window`. The capability
`src-tauri/capabilities/default.json` gains exactly one permission,
`core:window:allow-set-title`, scoped to the existing `main` window.

**Rationale**: Tauri's `set_title` command is not part of
`core:window:default`, so `getCurrentWindow().setTitle()` fails without the
permission. Writing `document.title` first gives the webview an immediate,
synchronous fallback and keeps the title correct even if the native call is
rejected. The call is fire-and-forget from the view layer, so a platform title
quirk cannot block tab switching.

**Alternatives considered**:
- **`document.title` alone**: not reliable across Tauri/WebViewGTK/WebView2; the
  native title may stay at the configured `docdeck`.
- **A new Rust `set_window_title` command**: moves view state into Rust and
  violates Principle I; it also creates a second IPC surface for something the
  official window API already does.
- **Rust `on_window_event` / title observer**: unnecessary; Rust must not own
  active-document state.

**Known platform limitation**: on Linux Wayland some compositors do not repaint
their own client-side header bar after `setTitle` even though the taskbar title
and `Window.title()` update (Tauri issue #13749). This is upstream; the README
and quickstart record it. XWayland and the other platforms update normally.

## R2 — How the title is composed

**Decision**: Add `src/window-title.ts` with one pure function:

```ts
composeWindowTitle(activePath: string | null): string
```

Rules:
- `activePath === null` → `"docdeck"` (FR-003).
- `projectName(activePath) !== null` → `` `${project} — ${fileName(path)} — docdeck` ``
  (FR-001).
- no project → `` `${fileName(path)} — docdeck` `` (FR-002).

The separator is U+2014 EM DASH surrounded by single spaces. It reuses the
existing `projectName` and `fileName` helpers from `project.ts`, so the deepest
`_ai` segment, Windows separators, and Unicode filenames behave exactly as they
already do elsewhere.

**Rationale**: One pure function is trivially testable and prevents the title
rules from drifting across the six call sites (activate, open, render, close,
close-all, rename). Existing path helpers already implement the spec's edge
cases: deepest `_ai`, `null` when `_ai` is at the root, and cross-platform
separators.

**Alternatives considered**:
- **Putting the logic inline in `main.ts`**: six copies or one untested helper;
  the title is user-visible behavior with explicit fallbacks.
- **Using the watch root or cwd as the project fallback**: explicitly rejected by
  the spec assumptions; labels such as `devel` would mislead.
- **Reading the title from the backend**: the backend does not know the active
  document; that is webview view state.

## R3 — Where status information lives

**Decision**: The sidebar stops rendering scan progress, reload summaries,
warning lists, truncation notices, and watch errors. It keeps only:
- document lists and their existing empty states; and
- the actionable "no configuration found" hint, including
  `~/.config/docdeck/config.toml` and the example TOML (FR-011).

A new one-line `#status-bar` spans the full window width at the bottom
(FR-005). Its view model has three inputs:
1. live scan progress (while a scan is in flight);
2. the newest event log entry (after a scan/reload/error);
3. the current count of warning-severity entries in the log.

Precedence: live scan progress > latest event > idle. Idle text is a calm
`Ready` / `Watching N folders` line so the bar never disappears (US1 scenario
4). The location segment is shortened with the existing `compactPath` helper and
CSS `text-overflow: ellipsis`; counts are `flex: 0 0 auto`, so the location
shortens before counts disappear (FR-009). Severity is conveyed by a text
label/icon in addition to color.

The warning chip is shown only when the count is non-zero and opens the log with
the warnings filter selected. Clicking the rest of the status bar toggles the log
(FR-017). After the user clears the log, the warning chip disappears because
there are no entries left to reveal; a later warning event recreates it. This
keeps the chip's promise ("activate to see the entries") honest.

**Rationale**: The sidebar's job is navigation. A dedicated single line is the
smallest surface that keeps watch health visible. Deriving the warning count
from the log guarantees that the count always maps to reachable entries (SC-003)
and makes the clear action coherent.

**Alternatives considered**:
- **Keep a separate persistent warning count**: after `Clear`, the chip would
  advertise entries that no longer exist.
- **Put the status line inside the sidebar footer**: still competes with
  navigation and does not span the window.
- **Use a toast for status**: transient, not a durable health indicator, and
  would violate "quiet single line".

## R4 — Event log storage, scope, and retention

**Decision**: Add `src/event-log.ts`, a DOM-free session store:

```ts
type EventSeverity = "info" | "warning" | "error";
type EventKind =
  | "scan-start" | "scan-complete" | "reload"
  | "watch-added" | "watch-removed"
  | "warning" | "truncated" | "error";

interface StatusEvent {
  id: number;          // monotonic, session-local
  at: number;          // epoch ms, injected clock
  kind: EventKind;
  severity: EventSeverity;
  message: string;     // one line, plain text
  detail?: string;     // full warning/error text
}
```

`EventLog` has a fixed capacity of 500, appends newest last, evicts the oldest
when full (FR-016), never persists (FR-015), and `clear()` empties the entries
without resetting the id counter. The store records only watch/scan lifecycle
events (FR-012, FR-014). Tests use an injected clock and assert ordering,
eviction, clear, and severity filtering.

**Rationale**: 500 entries is small enough that a plain, incrementally updated
`<ol>` is fast and simpler than virtualization. Virtualizing would add complexity
to scroll-follow and filter behavior for no measurable gain. Keeping the store
pure makes retention and clear semantics deterministic.

**Alternatives considered**:
- **Persist the log**: the spec says session-only, and persisting would silently
  widen the app's storage surface (P-IV).
- **Unbounded array**: long agent sessions would grow memory without bound.
- **Virtualize the list**: overkill at 500 rows and makes the "stay at bottom"
  behavior harder to get right.

## R5 — Event log open/close, follow, filter, and clear

**Decision**: The log is a full-width docked row above the status bar
(PhpStorm-style). Its DOM controller (`src/event-log-panel.ts`) owns transient UI
state, not the event data:

- **Open/close**: status-bar click, a keyboard shortcut, and the panel's close
  button toggle it. `Escape` closes it only when focus is inside the panel and
  **does not** stop propagation to document/tab handlers (FR-017, US3 scenario 5).
  Opening expands a grid row, so the document area shrinks rather than being
  covered (FR-018).
- **Keyboard shortcut**: `Ctrl+\`` (Control + Backquote) toggles the log,
  matching common docked-panel conventions. The handler ignores the shortcut when
  the event target is an input/textarea/contenteditable, so typing a backtick in
  the filter does not close the panel.
- **Follow**: the panel is "following" when its scroll position is within 24 px
  of the bottom. New entries append and keep the bottom visible. If the user
  scrolls up, following pauses, the scroll position is preserved, and a small
  "N new events" pill appears. Scrolling back to the bottom clears the counter and
  resumes following (FR-020).
- **Filter**: `All` / `Warnings` segmented buttons filter the rendered list; the
  filter survives new entries and clear. Empty results show the explicit empty
  state ("No warnings in this session").
- **Clear**: removes all entries for the rest of the session and starts a fresh
  list (FR-019). The view stays open; the empty state appears immediately.
- **Focus/Escape**: the close/clear/filter controls are real buttons, so Tab
  reaches them. Escape restores focus to the status bar control that opened the
  log.

**Rationale**: A grid row is the only way to guarantee the document area is
pushed rather than covered. Incremental append plus `scrollTop` arithmetic is
deterministic and testable; re-rendering the whole list on every event would
break the user's scroll position and cost more than necessary at 500 entries.

**Alternatives considered**:
- **Floating overlay**: covers content, violating FR-018.
- **Always-follow scroll**: yanks the view away while the user reads warnings.
- **Full re-render on each event**: loses scroll position and is wasteful.
- **Persisting visible/filter state**: the spec says only sizes persist; log
  visibility and filter are session state.

## R6 — Dock layout and resize mechanics

**Decision**: Extend the existing CSS grid rather than introducing a flex shell:

```css
.app-layout {
  grid-template-columns: var(--sidebar-width) var(--toc-width) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas:
    "header header header"
    "sidebar toc   content"
    "log    log    log"
    "status status status";
}
```

- `#sidebar` and `#toc-panel` keep their existing grid areas; their widths are
  driven by `--sidebar-width` / `--toc-width` custom properties set on the app
  root.
- `#event-log` is the `log` row, full width; when closed it is `hidden` and the
  row collapses to zero because the element is gone from layout.
- `#status-bar` is the always-present `status` row.
- Resize handles are dedicated elements positioned at the sidebar's right edge,
  the outline's right edge, the log's top edge, and between the Open/Browse
  sections. They use `position: absolute` inside their pane (or the sidebar body
  for the split), so no extra grid columns are needed.
- Dragging updates only the relevant CSS custom property (and, for the sidebar
  split, a percentage), never Markdown. The app does not call
  `renderActiveContent` during a drag.

The log row is full width because that is the PhpStorm convention and the spec
only requires the status bar (not the log) to span the full width. The sidebar
therefore loses vertical room while the log is open, which is expected for a
docked bottom panel.

**Rationale**: The grid already encodes the pane relationships. Adding a fourth
row and driving sizes through custom properties is the smallest change, keeps
the document pane's `minmax(0, 1fr)` scrolling intact, and keeps resizing a
pure layout operation.

**Alternatives considered**:
- **Flexbox shell**: rewrites the existing layout and risks the sidebar inflating
  the header row (the reason the grid comment exists).
- **CSS `resize` property on panes**: not reliably usable with a split header,
  not keyboard accessible, and not consistently styled.
- **Third-party split-pane library**: new dependency, and the app is deliberately
  framework-free (constitution, Technical Constraints).

## R7 — Size bounds, defaults, and the 320 px document floor

**Decision**: Add `src/layout-model.ts` with static defaults and limits:

| Pane | Default | User bound | Notes |
|------|---------|------------|-------|
| Sidebar width | 300 px | 200–600 px, and ≤ 50% of window width | FR-023 |
| Outline width | 240 px | 160–480 px, and ≤ 50% of window width | FR-024 |
| Event-log height | 200 px | 100 px–60% of window height | FR-025 |
| Open/Browse split | 50% | 15–85% | FR-026 |

`resolveLayout(stored, viewport)` returns the **effective** sizes:
1. Clamp each value to its static range (stored values outside the range are
   rejected earlier and replaced by the default, per the spec edge case).
2. Clamp sidebar/outline to `min(staticMax, floor(viewportWidth / 2))`.
3. Reserve a 320 px document floor. If the two side panes still fit in
   `viewportWidth - 320`, keep them. Otherwise, give each its minimum and
   distribute the remaining space in proportion to how far each desired value is
   above its minimum. This is deterministic and keeps both panes at or above
   their stated minima.
4. Clamp the log height to `100 … floor(viewportHeight * 0.6)`.

The static borders plus the 320 px floor require at least 680 px, so
`tauri.conf.json` `minWidth` moves from 640 to 700 px (a little room for the
handles/borders). The window remains resizable and the default layout is
unchanged for existing users (SC-008).

**Rationale**: Without the minimum-width change, a 640 px window cannot show both
side panes at their required minima and keep a 320 px document area. Raising the
floor is a one-line, honest fix; silently violating a pane minimum or SC-005
would be worse. The effective sizes are derived on every window resize and are
never written back, satisfying FR-032.

**Alternatives considered**:
- **Allow the document area below 320 px**: violates SC-005.
- **Auto-hide the outline below a breakpoint**: surprises the user and is not in
  the spec.
- **Raise the pane minima instead**: violates the explicit pixel bounds.

## R8 — Persisting layout preferences

**Decision**: Extend the existing `Preferences` interface and decoder in
`src/preferences.ts`:

```ts
interface LayoutPreferences {
  sidebarWidth: number;   // default 300
  tocWidth: number;       // default 240
  eventLogHeight: number; // default 200
  sidebarSplit: number;   // default 50 (percent)
}
interface Preferences {
  // ...existing fields...
  layout: LayoutPreferences;
}
```

Decoding follows the existing per-field philosophy: a missing `layout` object or
a bad field falls back to that field's default without discarding the other
preferences. Values must be finite and within the static ranges in R7; anything
else is replaced by the default (the spec's "missing, corrupt, or out of range →
defaults" rule). Saves reuse `createPreferenceWriter`, so rapid drags are
debounced. The top-level storage key and `version: 1` stay unchanged; this is an
additive, backward-compatible shape.

Log **visibility**, the active filter, and the paused/following state are not
persisted. The log height is persisted because it is one of the four sizes
FR-031 names.

**Rationale**: Reusing the versioned key and writer is exactly what the
constitution's Persistence rule permits, and per-field validation already
handles schema drift. A separate key would fragment UI preferences and require a
second corruption story.

**Alternatives considered**:
- **New `docdeck.layout.v1` key**: duplicates storage, cleanup, and validation.
- **Persist the whole live layout object on every pointermove**: blocks the main
  thread; the debounced writer and final write on pointerup avoid this.
- **Persist effective (clamped) sizes**: would silently overwrite the user's
  preference when the window is small (violates FR-032).

## R9 — Resize handle interaction and accessibility

**Decision**: Add `src/layout-resizer.ts`, a small controller used for all four
boundaries. Each handle is a `div` with:

```html
<div role="separator"
     tabindex="0"
     aria-orientation="vertical"        <!-- horizontal for log/split -->
     aria-label="Resize the document sidebar"
     aria-valuemin="200" aria-valuemax="600" aria-valuenow="300">
```

Behavior:
- Pointer down captures the pointer (guarded for happy-dom), records the origin
  and starting size, and adds `pointermove` / `pointerup` / `pointercancel` on
  `window`; pointer up commits the final value through the debounced writer.
- **Double-click** restores that pane's default (FR-027).
- **Keyboard**: `ArrowLeft`/`ArrowRight` on vertical separators and
  `ArrowUp`/`ArrowDown` on horizontal separators adjust by 10 px (or 2% for the
  split); `Home`/`End` jump to the minimum/maximum; `Enter`/`Space` restore the
  default. `aria-valuenow` is updated after every change.
- **Inert**: when the pane is hidden (outline off, log closed) or collapsed
  (Open/Browse section collapsed), the handle gets `hidden`, `tabindex="-1"`,
  and `aria-disabled="true"`, and it cannot start a drag (FR-029).
- Focus-visible styling uses the existing accent token; the handle is 5 px wide
  with a larger invisible hit area, and the cursor matches the orientation.
- Window resize recomputes effective sizes; handles update `aria-valuenow`
  without writing preferences.

**Rationale**: `role="separator"` with `aria-valuenow` is the established
accessible pattern for adjustable boundaries and works without a dependency.
Pointer capture plus window-level listeners mirrors the existing mermaid-zoom
drag controller, keeping event cleanup consistent.

**Alternatives considered**:
- **Mouse-only `mousedown`**: fails FR-028 (keyboard operable, announced).
- **`<input type="range">`**: visually wrong for a pane boundary and awkward to
  position.
- **Passive drag with no capture**: loses the pointer when it leaves the handle.

## R10 — Which events are recorded

**Decision**: Map existing backend signals to log entries as follows:

| Source | Entry |
|--------|-------|
| `loadWatchConfig` start | `scan-start` / info: "Scanning watched paths…" |
| `scan-progress` events | Status bar only; **never** a log entry (avoids a tick per directory, per spec edge case) |
| `loadWatchConfig` success | `scan-complete` / info: "Scan complete — N documents in M watch roots" (detail optional) |
| each `result.warnings[]` | `warning` / warning: first line in `message`, full text in `detail` |
| `result.truncated` | `truncated` / warning: "Some paths were skipped at the configured limits." |
| config load error | `error` / error: "Could not load the watch configuration: …" |
| `config-reloaded` success | `reload` / info: "Configuration reloaded" (warning severity if it carries warnings/truncation) |
| each reload `warnings[]` | `warning` / warning with full `detail` |
| reload error | `error` / error with the backend message |
| roots added/removed by reload/scan | `watch-added` / `watch-removed` / info, one per root |
| `addWatch` start | `scan-start` / info: "Scanning session folder(s)…" |
| `addWatch` success | `watch-added` / info per session folder, then `scan-complete` / info |
| `addWatch` warnings/error | `warning` / `error` entries |

Explicitly excluded (FR-014): document opens, tab switches/closes, link
handling, copy actions, summary requests, and watcher document-change events.
The status bar's "latest event" is the newest entry in this log; during a scan,
live progress temporarily takes precedence. Warnings are individual entries so
the warnings filter and the two-interaction promise (SC-003) hold.

**Rationale**: The backend already emits every needed signal. Logging at the
boundary between the backend event and the model keeps event semantics in one
place and avoids adding Rust event types. Not logging progress ticks keeps the
log meaningful and cheap.

**Alternatives considered**:
- **Log every `paths-changed` event**: violates FR-014 and floods the log.
- **Log scan progress ticks**: explicitly rejected by the spec edge case.
- **One combined reload entry**: the warnings filter could not reveal individual
  full-text warnings.

## R11 — Keeping the setup hint without status noise

**Decision**: `SidebarPanel` loses `status` and `setProgress()`. It keeps a
single `configHintPath: string | null` in its view state, rendered only when the
config is missing and there is no load error. The hint keeps the exact path and
the example TOML. The browse empty state stays separate.

`main.ts` still owns `InboxStatus` (the backend model) but forwards only the hint
to the sidebar; scan progress goes directly to the status bar controller, so a
scan tick no longer repaints the sidebar at all (a performance win as well as the
required behavior).

**Rationale**: FR-010/FR-011 require exactly this split: all diagnostics out,
the actionable first-run hint in. Removing `setProgress` from the sidebar also
removes a full sidebar repaint per scan tick.

**Alternatives considered**:
- **Leave `InboxStatus` on the sidebar and hide it with CSS**: the DOM would
  still be built and tested, and errors could leak back into view.
- **Move the hint to the status bar**: the spec explicitly keeps it in the
  sidebar.

## R12 — Testing strategy and seams

**Decision**:
- Pure suites: `window-title.test.ts`, `layout-model.test.ts`,
  `event-log.test.ts`, `status-view.test.ts` with injected clocks and no DOM.
- DOM suites: `status-bar.test.ts`, `event-log-panel.test.ts`,
  `layout-resizer.test.ts` under `happy-dom`, following the existing
  `mermaid-zoom`/`tab-menu` event patterns (`new MouseEvent("pointerdown", …)`,
  guarded `setPointerCapture`, explicit `window` listeners).
- Existing suites updated: `preferences.test.ts` (layout defaults, legacy
  payloads, bad fields, out-of-range), `sidebar-panel.test.ts` (no scan/reload
  text; hint retained; split hooks present).
- Manual quickstart covers the OS title, Wayland caveat, 500-entry behavior, and
  restart persistence.

No new test dependency. `ResizeObserver` remains optional and guarded.

**Rationale**: The repository's convention is pure models plus thin DOM
controllers; matching it keeps tests deterministic and avoids a real filesystem,
wall clock, or network.

**Alternatives considered**:
- **Playwright/end-to-end**: the project has no browser test harness, and the
  quickstart already covers OS-level title and native window behavior.
- **Testing `main.ts` directly**: it is a large orchestrator with Tauri imports;
  keeping the new logic in pure modules is the established seam.
