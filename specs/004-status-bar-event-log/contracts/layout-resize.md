# Contract: Pane Layout and Resizing

**Feature**: `004-status-bar-event-log` | **Date**: 2026-11-06

User-observable geometry and interaction contract. Defaults, limits, and the
allocation algorithm live in [`../data-model.md`](../data-model.md).

## 1. Boundaries

| Boundary | Controls | Orientation | Default |
|----------|----------|-------------|---------|
| Sidebar / document | Sidebar width | Vertical | 300 px |
| Outline / document | Outline width | Vertical | 240 px |
| Event log / document | Event log height | Horizontal | 200 px |
| Open / Browse (inside sidebar) | Split ratio | Horizontal | 50% |

## 2. Mouse behavior

- Dragging a boundary resizes only the adjacent pane(s); the document area
  reflows to the remaining width and stays usable.
- The sidebar/outline boundaries clamp within their stated bounds and never
  consume the 320 px document minimum when the window permits.
- The log boundary clamps between 100 px and 60% of the window height.
- The Open/Browse boundary clamps each section to 15–85% of the sidebar's usable
  height.
- **Double-click** any boundary to restore its default.
- Dragging never re-renders Markdown, scrolls the document, or changes the active
  tab. Only pane geometry changes (SC-007).
- Releasing the pointer persists the final size; intermediate drag frames do not
  write storage.

## 3. Keyboard and accessibility

- Every enabled boundary is reachable with `Tab` and exposes
  `role="separator"`.
- Announced attributes: a human-readable `aria-label`, the matching
  `aria-orientation`, and `aria-valuemin` / `aria-valuemax` / `aria-valuenow`.
- `ArrowLeft` / `ArrowRight` adjust a vertical boundary; `ArrowUp` /
  `ArrowDown` adjust a horizontal boundary.
- `Home` / `End` jump to the minimum / maximum; `Enter` / `Space` restore the
  default.
- Focus is always visible against both themes.
- When a pane is hidden or collapsed, its boundary is inert: not focusable, not
  draggable, and announced as unavailable. Visible panes are unaffected
  (FR-029).

## 4. Persistence and window resize

| Situation | Result |
|-----------|--------|
| App restarted after resizing | All four sizes restored within 2 px (SC-006) |
| Stored values missing/corrupt/out of range | Defaults for the affected fields (other fields and other preferences survive) |
| Window narrower than stored widths | Panes are re-clamped so the document keeps its usable minimum; stored preference is **not** overwritten (FR-032) |
| Window enlarged again | The user's stored sizes take effect again |
| Log closed then reopened | Last height is restored |
| Log visibility, filter, follow state | Not persisted; session-only |
| First run / never resized | Exactly the current defaults: sidebar 300, outline 240, log 200, even split (SC-008) |

## 5. Bounds summary

```text
sidebarWidth    : 200 … min(600, floor(windowWidth / 2))
tocWidth        : 160 … min(480, floor(windowWidth / 2))
eventLogHeight  : 100 … floor(0.6 * windowHeight)   (when open)
sidebarSplit    : 15% … 85%
documentWidth   : >= 320 (window min width raised to 700 so both panes can be at
                          their minima; when the window is narrower than 680 the
                          algorithm gives panes their minima and the document the
                          remainder)
```

## 6. Non-goals

- No snapping, presets, or layout profiles.
- No persistence of which panes are visible.
- No drag on hidden panes.
- No reflow of document internals beyond the change in available width.
