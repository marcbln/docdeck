# Tasks: Keyboard Shortcuts Help and Tab Closing

**Input**: Design documents from `specs/007-app-chrome-baseline/`

**Prerequisites**: `spec.md`, `plan.md`

**Tests**: Required by Constitution II. Pure reference building and the DOM
controller both ship with tests; write them before the implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files)
- **[Story]**: `[US1]`–`[US3]` mapping to `spec.md`

## Phase 1: Setup

- [X] T001 Add `close-tab` to `FIXED_SHORTCUTS` in `src/shortcuts.ts` with
  `key: "w"`, `modifier: "ctrl"`, `shift: false`.
- [X] T002 [P] Add a `shortcuts.test.ts` case proving `Ctrl+W` matches and
  `Cmd+W`/`Ctrl+Shift+W` do not, and that the label is `Ctrl+W` on both
  platforms.

## Phase 2: Shortcut reference (US1)

- [X] T003 Write `src/shortcut-reference.ts` with `ShortcutReferenceEntry`,
  `ShortcutReferenceGroup`, and `buildShortcutReference(platform)`. Read every
  registered chord through `formatShortcut`; declare literal entries for `?`,
  `Esc`, the context-menu key and middle-click.
- [X] T004 [P] Write `src/shortcut-reference.test.ts`: every
  `FIXED_SHORTCUTS` id appears exactly once, ids are unique, keys and
  descriptions are non-empty, `Ctrl+W` stays Ctrl on macOS, `Cmd+Shift+T`
  formats for macOS, and the literal help/context-menu/middle-click entries are
  present.

## Phase 3: Help dialog (US1, US2)

- [X] T005 Write `src/shortcuts-modal.ts`: mount an `aria-modal` dialog with a
  header, tablist, Shortcuts panel, Manual panel and close control. `open()`
  renders the manual through `renderMarkdown`, resets to Shortcuts and restores
  focus on close. Escape, backdrop click and close control all close. Arrow,
  Home and End keys move between tabs.
- [X] T006 [P] Write `src/shortcuts-modal.test.ts` covering open/mount,
  accessible dialog attributes, tab switching and ARIA state, Escape and
  backdrop close, no duplicate overlay on repeated open, Markdown rendering in
  the manual tab, and the error message when manual rendering fails.
- [X] T007 Add dialog, tab, shortcut-row and manual styles to `src/style.css`
  using the existing tokens.

## Phase 4: Wiring (US1, US3)

- [X] T008 Add `docs/manual.md` covering opening documents, reading and live
  reload, views and filtering, bookmarks, clipboard actions, keyboard shortcuts
  pointer, watches/configuration and troubleshooting.
- [X] T009 Wire `src/main.ts`: import the manual with `?raw`, instantiate
  `ShortcutsModal`, bind `#toggle-help-btn`, handle `?` outside editable fields
  and dialogs, and dispatch `Ctrl+W` to `closeTabPath(this.activePath)` when no
  modal is open.
- [X] T010 Add the header help button to `index.html`.

## Phase 5: Documentation and verification

- [X] T011 Update `README.md` with a Help section linking `docs/manual.md` and
  mentioning `?` and `Ctrl+W`.
- [X] T012 Update `CHANGELOG.md` under Unreleased.
- [ ] T013 Run `npm run typecheck`, `npm run test:web`, and manually verify the
  quickstart: `?` opens help; typing `?` in the find field inserts text;
  Escape closes; Ctrl+W closes a document; Ctrl+Shift+T reopens it; the manual
  tab renders offline.
