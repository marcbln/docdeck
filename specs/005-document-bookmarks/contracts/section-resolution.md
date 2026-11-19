# Contract: Section Resolution and Re-anchoring

**Feature**: `005-document-bookmarks` | **Date**: 2026-11-15

This is the user-visible and testable contract for finding a bookmarked heading
after the document has been rewritten. The pure implementation lives in
`src/bookmark-anchors.ts`; it consumes the existing `Heading[]` from
`extractHeadings` (plain text, depth, slug, document order).

## Identity

A section bookmark stores one `SectionAnchor`:

```ts
interface SectionAnchor {
  text: string;          // plain heading text
  depth: 1 | 2 | 3 | 4;  // outline depth
  before: string[];      // up to 2 previous outline heading texts, nearest first
  after: string[];       // up to 2 next outline heading texts, nearest first
  ordinal: number;       // occurrence among same-text headings (0-based)
  order: number;         // outline index at capture
}
```

Comparison normalizes text with `trim()` and collapses internal whitespace runs
to one space. Comparison is case-sensitive.

`captureAnchor(headings, index)` derives all fields from the current outline;
`ordinal` counts earlier headings with the same normalized text. The context
window is at most `CONTEXT_WINDOW = 2` headings per side.

## Resolution algorithm

Input: `anchor`, current `headings`. Output: `HeadingResolution` (never throws).

```text
normalize(text) = text.trim().replace(/\s+/g, " ")

sideScore(anchorSide, candidateSide):
    score = 0
    for i in 0 .. min(anchorSide.length, CONTEXT_WINDOW) - 1:
        if normalize(candidateSide[i]) == normalize(anchorSide[i]):
            score += (i == 0 ? 2 : 1)
    if anchorSide.length == 0 and candidateSide.length == 0:
        score += 2                      # "nothing on this side" is evidence too
    return score

score(candidate) =
    sideScore(anchor.before, candidate.before)
  + sideScore(anchor.after,  candidate.after)
  + (candidate.depth == anchor.depth ? 1 : 0)

textCandidates = indices i where normalize(headings[i].text) == normalize(anchor.text)

if textCandidates.length == 1:
    return resolved(index, via = "text")

if textCandidates.length > 1:
    scores = map(score, textCandidates)
    best = max(scores)
    tied = candidates with score == best
    if tied.length == 1: return resolved(tied[0], via = "text")
    if best == 0 and anchor.ordinal < textCandidates.length:
        return resolved(textCandidates[anchor.ordinal], via = "occurrence")
    return stale(reason = "ambiguous")   # positive evidence conflicts or ties

# No exact text: context fallback (the heading text was edited).
contextCandidates = indices i where
    headings[i].depth == anchor.depth
    and (
        sideScore(anchor.before, headings[i].before) > 0
        or sideScore(anchor.after,  headings[i].after)  > 0
    )

if contextCandidates is empty: return stale(reason = "missing")

scores = map(score, contextCandidates)
best = max(scores)
tied = candidates with score == best
if tied.length == 1: return resolved(tied[0], via = "context")
return stale(reason = "ambiguous")
```

**Rules that must not change without a new decision record**
- Exact text is always tried first.
- Context uses a two-heading window plus depth; a context-only match requires the
  same depth and at least one matching window position or an empty matching side.
- Occurrence is used only when duplicate exact-text candidates have no context
  evidence at all (`best == 0`). Positive but tied evidence is stale rather than
  a guess. Occurrence is **not** used in the context fallback.
- Ties are stale; the resolver never picks arbitrarily.
- A stale resolution carries no slug and therefore cannot scroll.

## Resolution status and view state

`HeadingResolution` is session-only. The view derives:

| View status | Condition |
|-------------|-----------|
| `unavailable` | Parent document is absent from the inventory or marked deleted |
| `stale` | Resolver returned `stale` |
| `unverified` | No resolution exists for this bookmark this session |
| `re-anchored` | Resolved with `via: "context"` or `via: "picker"` |
| `current` | Resolved with `via: "text"` or `via: "occurrence"` |
| `shared` annotation | Resolved slug is also the target of another section bookmark |

Precedence: `unavailable` > `stale` > `shared` > `re-anchored` > `current` >
`unverified`.

A shared target is **not** de-duplicated: both rows stay visible, both are
activatable, and both carry a `Shared` badge explaining that another bookmark
points at the same heading. A resolver-level tie is different: it is `stale`.

## When resolution runs

- After every successful render/reload of the **active** document, resolve all
  of that document's section bookmarks against the freshly extracted headings.
- On activation of a section bookmark, open/focus the document first, then
  resolve against the current outline before scrolling.
- Closed or not-yet-rendered documents remain `unverified`; the sidebar never
  reads document content to resolve sections (see research R4).
- Rename moves session resolutions to the new path. Remove/undo updates or
  discards them. Restart starts with none.

## Activation

Given a section row:

1. If unavailable → no action (only Remove is offered).
2. If the document is not open → `openDocument(path)`; otherwise
   `setActiveTab(path)`. This acknowledges unread state through the existing
   path.
3. Resolve against the current headings of the now-active document.
4. **Resolved**:
   - scroll with `scrollToAnchor(contentContainer, slug)`, which already applies
     `SCROLL_OFFSET_PX` below the sticky header;
   - commit the resolved anchor (text, depth, before/after, ordinal, order) to
     the bookmark and persist it, so later edits resolve from the confirmed
     position;
   - keep the session status (`current`, `re-anchored` or `shared`).
5. **Stale**:
   - do not scroll;
   - store the stale resolution in the session map and repaint the row as
     `Not found`;
   - offer `Re-anchor` (if the outline has headings) and `Remove`.
6. **Unverified** cannot remain after step 3; the activation check resolves it.

Activating a stale or unavailable bookmark never scrolls to a different
section (FR-020).

## Re-anchoring

`Re-anchor` opens a modal listing the active document's current headings in
document order (`h1…h4`), indented by depth.

- The current resolved heading, when any, is marked.
- Selecting a heading captures a fresh anchor from the current headings and
  replaces the bookmark's anchor; the id, path and `addedAt` stay.
- The session resolution becomes `resolved` with `via: "picker"` and the row
  shows `Re-anchored` for the rest of the session.
- Escape, overlay click or Cancel closes without changing the anchor and returns
  focus to the `Re-anchor` control.
- An empty outline shows `This document has no headings to anchor to.` plus a
  `Remove bookmark` action.
- If the document is unavailable, `Re-anchor` is not offered.

## Undo interaction

Removing a stale/unavailable section creates the normal removal snapshot. Undo
restores the anchor exactly as it was before removal, not as the stale resolver
saw it.

## Accessibility and feedback

- Every `Re-anchor` and `Remove` control is a real button with an accessible
  name including the section text and document filename.
- Status is conveyed by text (`Not checked`, `Not found`, `Moved`, `Shared`,
  `Unavailable`), not colour alone.
- A successful re-anchor shows a confirmation toast; a stale activation shows a
  toast explaining that the section was not found and can be re-anchored.
- Errors opening the document use the existing error toast and leave the row
  unchanged.

## Test matrix

- Duplicate text distinguished by the two-heading context window; both sides
  identical; insertion of a same-text heading before the target (including
  immediately before); reorder; text edited with unique context; text edited
  with ambiguous context; heading deleted; depth changed; empty text; document
  with one heading; no headings; depth > 4 (not in outline).
- Occurrence fallback used only when every candidate has zero context evidence;
  a positive-evidence tie is stale rather than a guess. A duplicate inserted
  immediately before a final heading with no distinguishing neighbours is stale,
  never moved to the inserted heading.
- Shared-target annotation for two valid bookmarks; both remain.
- Activation: resolved scrolls to the right slug; stale/unavailable never
  scrolls; anchor committed after activation.
- Picker: select, cancel/Escape/overlay, empty outline, focus restoration.
