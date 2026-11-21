# Implementation Plan: Keyboard Shortcuts Help and Tab Closing

**Branch**: `007-app-chrome-baseline` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-app-chrome-baseline/spec.md`

## Summary

Add a modal help surface opened by `?` with two tabs: a shortcut reference
derived from `FIXED_SHORTCUTS`, and a bundled manual rendered through the
existing Markdown pipeline. Add `Ctrl+W` to the shortcut registry and dispatch
it to the existing close-tab path. No Rust changes are needed; closing already
releases the file watch and records the path for `Ctrl+Shift+T`.

## Technical Context

**Language/Version**: TypeScript (Vite), existing app; no Rust change.

**Primary Dependencies**: none added. Reuses `marked`/`renderMarkdown` for the
manual and the existing modal/DOM conventions.

**Storage**: none. The help dialog is session state; no preference is persisted.

**Testing**: Vitest with happy-dom. Pure reference building is tested without
DOM; the dialog controller is tested as a DOM controller.

**Target Platform**: Linux, macOS, Windows desktop.

**Project Type**: Tauri desktop application.

**Constraints**: No dependency, no new persisted state, no network. The manual
is imported at build time with Vite `?raw`.

## Constitution Check

| Principle | Status | Note |
| --- | --- | --- |
| I. OS in Rust, view state in webview | Pass | Pure UI feature; no Rust or filesystem access. |
| II. Pure logic with tests | Pass | `shortcut-reference.ts` is pure and unit-tested; modal has DOM tests. |
| III. Untrusted webview | Pass | Bundled trusted Markdown only; no new IPC, paths or URLs. |
| IV. Read-only and never surprising | Pass | `Ctrl+W` calls the existing close path; it never deletes files or quits. |
| V. Performance by design | Pass | Static list and one cached-size dialog; no watcher or render work. |

## Design Decisions

1. **One shortcut source of truth.** `FIXED_SHORTCUTS` gains `close-tab` and the
   reference builder reads it by id. Literal interactions that are not modifier
   chords (help, Escape, context-menu key, middle-click) are declared next to
   the groups, not in the registry, because `matchesShortcut` cannot represent
   them.
2. **Ctrl-only close.** `modifier: "ctrl"` makes `formatShortcut` print
   `Ctrl+W` on every platform and prevents matching `Cmd+W`, leaving the macOS
   window action untouched.
3. **Reference completeness is a test invariant.** The test walks
   `FIXED_SHORTCUTS` and fails if an id has no entry, so adding a registry entry
   without a label is a test failure, not a silent omission.
4. **Manual as an imported asset.** `docs/manual.md?raw` keeps the content
   editable as Markdown and out of the bundle's JS strings. `renderMarkdown`
   gives it the same typography and code-block treatment as documents.
5. **Two-tab ARIA pattern.** `role="tablist"`, `role="tab"` and
   `role="tabpanel"` with `aria-selected`/`hidden`; Left/Right/Home/End move
   between tabs. Help reopens on Shortcuts by design (spec FR-007).

## Project Structure

### Documentation

```text
specs/007-app-chrome-baseline/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
docs/manual.md
```

### Source

```text
src/shortcut-reference.ts        # pure grouped reference
src/shortcut-reference.test.ts
src/shortcuts-modal.ts           # modal controller, two tabs
src/shortcuts-modal.test.ts
src/shortcuts.ts                 # add close-tab, registry stays canonical
src/shortcuts.test.ts            # close-tab coverage
src/main.ts                      # help action, ? and Ctrl+W handlers
src/style.css                    # dialog and shortcut table styles
index.html                       # header help button
```

## Implementation Outline

1. Add `close-tab` to `FIXED_SHORTCUTS` with a Ctrl-only modifier.
2. Write `shortcut-reference.ts`: groups, key formatting, literal entries.
3. Write `shortcuts-modal.ts`: mount/close, tabs, keyboard handling, manual
   rendering, error state.
4. Wire `main.ts`: instantiate with `docs/manual.md?raw`, bind the header
   button, `?`, and `Ctrl+W`.
5. Add styles and the manual.
6. Update README and CHANGELOG.
7. Run `npm run typecheck` and `npm run test:web`.

## Risks and Mitigations

- **Webview swallows Ctrl+W on some platforms.** The handler prevents default
  and the spec scopes the key to closing a document, not the window. Platform
  behaviour is documented in the manual.
- **Manual drifts from behaviour.** Keep it short and link to the shortcut tab;
  review it with the same change that adds a surface.
- **Focus loss when the dialog closes.** The dialog remembers the element that
  had focus before opening and restores it on close where it still exists.
- **Shortcut registry grows later (006).** The completeness test makes the
  reference update mandatory.
