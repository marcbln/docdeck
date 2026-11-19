# Contract: Bookmark UI Interactions

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

This is a desktop UI feature, so the contract is the user-visible surface, the
actions, and the observable states. It is not a network API.

## Surface

```text
#header-bar
└── button#toggle-bookmark-btn          ★/☆ Bookmark: ON/OFF, aria-pressed, disabled with no active document

#sidebar
├── section[data-section="open"]
│   └── li.sidebar-row
│       ├── button.sidebar-row-main        opens/focuses the document
│       ├── button.sidebar-row-bookmark    ★/☆, aria-pressed
│       └── button.sidebar-row-close       closes the document
└── section[data-section="browse"]
    ├── div[role="group"]               mode switch
    │   ├── button[data-mode="all"]
    │   ├── button[data-mode="recent"]
    │   └── button[data-mode="bookmarks"]  label + count badge; aria-label "Bookmarks, N bookmarks"
    ├── input.sidebar-filter-input      shared filter
    ├── button.sidebar-browse-action    popout (All/Recent only)
    ├── div.sidebar-bookmarks-settings  (Bookmarks only)
    │   ├── label/input "Notify only for bookmarked documents"
    │   └── p                            effect note (with/without bookmarks)
    ├── div.sidebar-browse-scroll       All/Recent list (existing)
    └── div.sidebar-bookmarks-scroll    Bookmarks list (new)
        └── ul.inbox-list--virtual
            ├── li.inbox-row.bookmark-document
            │   ├── button.inbox-row-main       opens/focuses the document
            │   └── button.inbox-bookmark       ★/☆, aria-pressed
            └── li.bookmark-section-row
                ├── button.bookmark-section-open
                └── span/button.bookmark-section-status + Re-anchor + Remove

#toc-panel
└── li.toc-item
    ├── a.toc-link                     existing scroll link
    └── button.toc-bookmark            ★/☆, aria-pressed (mixed when shared)

inbox-overlay (full inventory modal)
└── li.inbox-row
    ├── button.inbox-row-main          opens/focuses the document
    └── button.inbox-bookmark          same state as the inline row

inbox-overlay (re-anchor picker)
├── dialog title "Re-anchor bookmark"
├── p                                document filename + section text
├── ul                               current headings, indented by depth
└── button                            select heading; Remove when no headings
```

## Actions

| Action | Trigger | Preconditions | Response | Postconditions |
|--------|---------|---------------|----------|----------------|
| Toggle active document bookmark | Header star, `Ctrl`/`Cmd`+`D` | Active document exists | Add/remove document bookmark | Every star for that document updates; toast with Undo on removal; notification filter re-synced |
| Toggle document bookmark from a row | Row star, context menu | Row exists | Add/remove without opening or changing the active document | Row star and all other affordances update; view updates without clearing the filter |
| Toggle section bookmark | Outline star | Outline heading exists | Add a section bookmark for that exact heading, or remove the bookmark(s) resolving to it | Star state updates; section appears/disappears under its document; notification filter re-synced |
| Open document entry | Row click / `Enter` / `Space` | Row exists | Open or focus the document | Document active; unread cleared through the existing acknowledgement path |
| Open section entry | Section row activation | Document available | Open/focus, resolve, then scroll to the heading below the sticky header | Section visible; anchor confirmed; status current/re-anchored |
| Stale section activation | Section row activation | Document available, resolver stale | Open/focus the document; do not scroll | Row shows `Not found`; Re-anchor/Remove offered; toast explains |
| Re-anchor | `Re-anchor` on a stale row | Document available | Open the heading picker | Choosing a heading replaces the anchor; Escape/cancel changes nothing |
| Remove bookmark | Row Remove, star toggle | Bookmark exists | Remove document or section marker | Toast with Undo; document removal keeps sections; view updates |
| Undo removal | Toast `Undo` | Snapshot exists | Restore the exact bookmark(s) | Star/view state restored; notification filter re-synced |
| Switch to Bookmarks | Mode button | — | Render the bookmarks list; keep the filter term | `aria-pressed` moves; mode persisted |
| Enable bookmark-only notifications | Checkbox in Bookmarks toolbar | — | Persist preference and sync filter | Effect note updates; tray dot behavior unchanged |
| Clear filter | Filter clear / `Escape` in empty filter | Term non-empty | Clear the shared term | All matching rows return; no bookmark state changes |
| Dismiss picker | Escape / overlay / close | Picker open | Close | Focus returns to the Re-anchor control |

Row activation must not fire when the click or key press lands on an inner
button (star, Remove, Re-anchor, close). Document rows expose a main activation
button and keep the star/close as sibling buttons, so no interactive control is
nested inside another; `VirtualList` treats `.inbox-row-main` and the row padding
as activation and ignores other buttons. Panel handlers follow the same rule.

## Bookmarks view composition

- Mode: a third mode in the existing browse section (FR-008), never a separate
  window.
- Document rows reuse the existing two-line row anatomy: project chip, filename,
  unread dot, compact parent path, relative time, plus the star.
- Section rows are single-line, indented one step per heading depth, showing the
  heading text, a status badge when applicable, and inline actions.
- Documents order like All documents: available by `modifiedTime` descending,
  path tiebreak; unavailable after available. Sections follow document order.
- A document with section bookmarks but no document bookmark is still shown as
  the container row (FR-007, US2 scenario 8), with an empty star.
- Counts: the mode button's accessible name and badge report the total number of
  bookmark markers (document + section). The count is not colour-dependent.
- The view is virtualized with a fixed 48 px row; only the visible window plus
  overscan exists in the DOM.

## Filter contract

The existing single browse filter applies in Bookmarks mode (FR-013):

| Term matches | Rows shown |
|--------------|------------|
| Document filename/path/project | The document and **all** of its bookmarked sections |
| Only one or more section heading texts | The document as a container with **only** matching sections |
| Nothing | The filtered-empty state with `Clear filter` |
| Empty/whitespace | The full bookmark list |

- Matching is a literal, case-insensitive substring after trimming, reusing the
  All documents vocabulary (`filterEntries`).
- Ordering, star/unread/stale state and the term itself are preserved.
- Adding/removing a bookmark while a term is active re-renders the filtered rows
  without clearing the input.

## Keyboard contract

| Key | Context | Result |
|-----|---------|--------|
| `Ctrl`/`Cmd`+`D` | Global (not in an input/textarea/contenteditable) | Toggle the active document's bookmark |
| `Enter` / `Space` | Focused row | Activate the document/section row |
| `Enter` / `Space` | Focused star, Remove, Re-anchor | Perform that button's action; do not activate the row |
| `Shift+F10` / ContextMenu | Focused navigation row | Open the row menu (includes Bookmark document) |
| `Escape` | Filter with a non-empty term | Clear the shared filter (existing behavior) |
| `Escape` | Re-anchor picker | Close the picker, restore focus |
| `Tab` | Anywhere | Reach mode buttons, filter, stars, section actions and row links in visual order |

No section shortcut at the reading position is added (spec clarification). A
section bookmark is created from the outline control (FR-034).

## States

| State | Rendering | Recovery |
|-------|-----------|----------|
| No bookmarks | Explanation of how to bookmark a document/heading (`Ctrl+D`, stars) and a `Browse all documents` action | Switches to All |
| Filter matches nothing | `No bookmarks match “term”.` + `Clear filter` | Clears the term |
| Document available, section unverified | `Not checked` badge | Activate to validate |
| Section current | No badge | Activate/scroll |
| Section re-anchored | `Moved` badge with explanation | Activate/scroll |
| Section shared | `Shared` badge with explanation; both rows remain | Activate or remove one |
| Section stale | `Not found` badge, `Re-anchor`, `Remove`; no activation scroll | Pick a heading or remove |
| Document unavailable | `Unavailable` badge, `Remove`; no activation; sections also unavailable | Remove or restore the document/watch |
| Empty outline in picker | `This document has no headings to anchor to.` + `Remove bookmark` | Remove or cancel |
| Notification setting on, no bookmarks | `No bookmarks yet, so no change notifications will appear.` | Add a bookmark or turn the setting off |
| Notification sync error | Error toast; bookmark action still succeeds | Retry by changing a bookmark/setting; log retains detail |

## Accessibility

- Every star, status action and picker row is a real button or anchor with an
  accessible name that includes the document/section name.
- Document rows use a real main activation button with sibling action buttons;
  no interactive element is nested inside another.
- `aria-pressed` conveys document/heading bookmark state; `aria-pressed="mixed"`
  conveys a shared target on the outline star.
- State uses text badges in addition to colour (FR-024).
- Focus is visible and never removed; the picker returns focus to the control
  that opened it.
- The notification checkbox has a visible label and explanatory text linked with
  `aria-describedby`.
- The mode button's count is part of its accessible name, not a visual-only
  badge.
- `prefers-reduced-motion` continues to suppress transition/animation effects.

## Performance feedback

- A star toggle updates its pressed state and the affected rows synchronously
  before persistence and notification sync (well under 100 ms).
- The Bookmarks view never reads a file, never re-renders Markdown, and never
  changes the active document when a bookmark is toggled from a row.
- Live watcher events update availability/unread and repaint only the visible
  bookmark window.

## Out of scope (enforced by this contract)

- Passage/quote bookmarks, notes, highlights, annotations.
- Section-level change indicators or section-scoped unread.
- Folders, watch configurations, URLs.
- Export/import, CLI access, cross-device sync.
- Persisting the filter term, picker open state, section resolution status or
  notification-undo state.
- Writing anything into watched documents.

## Test seams

- Pure: `bookmarks-model`, `bookmarks-view`, `bookmark-anchors`,
  `bookmarks-storage`, `bookmarks-controller` (injected clock/storage/sync).
- DOM (`happy-dom`): `SidebarPanel` (third mode, nested rows, stars, counts,
  filter, setting, stale/unavailable, empty), `TocPanel` (stars, mixed state,
  callback), `InboxBrowser` (row star), `TabContextMenu` (dynamic bookmark
  item), `ToastHost` (action), `BookmarkPicker` (select/cancel/empty/focus),
  `VirtualList` (inner button does not activate the row).
