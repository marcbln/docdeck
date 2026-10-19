---
filename: "_ai/backlog/active/261019_2002__DESIGN_HANDOFF__config-driven-watches-and-inbox.md"
title: "Design Handoff: Config-driven watches and the file inbox"
createdAt: 2026-10-19 20:02
updatedAt: 2026-10-19 20:02
status: validated
tags: [config, watcher, inbox, unread, ux, glob]
documentType: DESIGN_HANDOFF
---

# Design Handoff: Config-driven watches and the file inbox

## Context

docdeck currently watches documents only for the lifetime of a CLI invocation:
`docdeck ./_ai` opens a one-shot folder picker, the confirmed selection starts
recursive watches, and every new or modified file auto-opens as a background
tab. The request was for (a) a persistent config listing watched directories
and/or files with wildcards, modelled on super-bin's `repos.toml`, and (b) a new
Thunderbird-style view listing all matched files by modification time, newest
first, with files that changed since docdeck started shown in bold.

The discussion concluded that the inbox is most useful when it replaces
auto-open and the folder picker, not when it sits beside them: broad wildcard
selectors would otherwise create a tab per changed file.

## Decisions

1. **Global config, read once at startup.** `~/.config/docdeck/config.toml`
   (XDG-aware; `$DOCDECK_CONFIG` overrides for tests). Top-level `watch` and
   optional `exclude` arrays of paths/globs. No groups, no project-local config,
   no live reload. Rationale: matches the proven `repos.toml` model, one list
   covers all projects, and reconciliation of live-edited watches is complexity
   without a demonstrated need. Rules out named profiles and per-repo config for
   now.

2. **Selector semantics.** `~` is expanded; `*` matches one path segment; `**`
   matches any depth. Each match is classified: a directory contributes its
   recursive `*.md` tree; a file is watched explicitly and may be any extension
   (same rule as a CLI file argument). Matches are canonicalized and deduped.
   Hidden entries, symlinks, and `node_modules`, `target`, `dist`, `build`,
   `.venv`, `venv` are always skipped; `exclude` adds glob patterns on top. The
   same filter applies to the initial scan and to watcher events.

3. **Rust owns expansion and configuration.** A new `config.rs` parses and
   expands selectors as pure functions; `load_watches` registers watches and
   returns `{ entries: [{path, filename, modified_time}], errors: [] }`. The
   frontend receives resolved paths and never implements glob logic.

4. **The folder picker is removed.** `folder-modal.ts`, `file-tree.ts`, their
   tests, the `scan_folder` command, and picker CSS are deleted. A CLI folder
   argument registers a session watch and feeds the inbox; a CLI file argument
   opens a tab immediately. No create/modify event auto-opens a tab.

5. **Persistent left inbox panel.** Toggled by a header button, visible by
   default, persisted in the existing `docdeck.preferences.v1` object. Rows are
   sorted by mtime descending (ties by path) and show `[project] filename.md`,
   the muted full parent path, and a relative time with an exact timestamp in
   the tooltip. The project chip is the parent component of the deepest `_ai`
   path segment and is omitted when no `_ai` exists. Open tabs get a subtle row
   accent.

6. **Session-scoped unread model.** Nothing is bold at startup. A create or
   write while docdeck runs marks the file unread — bold filename plus amber dot
   — unless it is the active tab. Clicking the row or activating the tab clears
   it. Closing an unread tab does not clear it. No read state is persisted;
   restarting clears bold.

7. **Active-tab activity marker.** A write to the active document updates its
   mtime and row position but never marks it unread. Its tab shows the amber dot
   pulsing briefly, then fading. Settled rows and tabs are plain.

8. **New and deleted files.** A new or recreated file appears at the top as
   unread without opening a tab. A deleted file keeps a struck-through, muted
   row with its last mtime until it reappears or the session ends.

9. **Failures are non-fatal and visible.** Invalid TOML shows a parse error and
   registers no watches. Missing config shows a setup hint with an example.
   Unmatched selectors, vanished directories, permission errors and watch
   registration failures become warnings in the panel while valid selectors
   continue. Expansion is capped at 256 roots and 10,000 files, reporting the
   selector that was truncated.

## Rejected Alternatives

- **Keep auto-open and add the inbox.** Rejected: broad selectors turn into tab
  spam, and the inbox's main value is triage before opening.
- **Auto-open only the first time a file appears.** Rejected: the initial scan
  of a broad selector would still open a tab per file.
- **Persist last-viewed timestamps (true cross-session unread).** Rejected: the
  requirement is explicitly session-scoped; persistence adds state and migration
  surface for no stated benefit.
- **Mark the active document unread on every write.** Rejected: it repaints in
  front of the reader, so bold conveys nothing; the transient tab dot covers
  feedback.
- **Only files without tabs become unread.** Rejected: a changed background tab
  would go unnoticed.
- **Named groups or a project-local `.docdeck.toml`.** Rejected: flat selectors
  cover the need; project identity is already derivable from `_ai`.
- **Live config reload or a manual reload button.** Rejected: startup-only read
  avoids watch reconciliation; sessions are short-lived.
- **Modal overlay or empty-state-only list.** Rejected: the panel must remain
  visible while reading.
- **Directory-grouped inbox rows.** Rejected: loses the requested global
  newest-first ordering; the project chip preserves scanability.
- **Fallback project label from the watch-root basename.** Rejected: labels such
  as `devel` or `reports` would be misleading.
- **Configurable include patterns.** Rejected: Markdown for directories and
  explicit files for the rest is enough power.
- **Markdown-only with no built-in noise directories.** Rejected: a fresh config
  would immediately explode on build trees.
- **Keep the picker for CLI folders or config matches.** Rejected: two
  competing selection models; the inbox is the single entry point.

## Constraints Discovered

- `watcher.rs` filters events through `is_relevant`, which currently knows only
  about open files, Markdown, and watched roots. Excludes and built-in noise
  directories must be enforced there too, or excluded files leak into the
  inbox.
- `paths-changed` currently carries `{path, exists}`. It needs
  `modified_time` (sampled after debounce) so the inbox can update sorting and
  relative time without re-reading document contents.
- `load_file` both reads content and registers a per-file watch. The initial
  inventory must use a metadata-only path; loading every matched document would
  be wasteful.
- `folder.rs` already skips hidden entries, backups (`~`) and symlinks; the
  built-in noise-directory rule belongs in the same layer.
- Single-instance forwarding resolves relative CLI paths against the sender's
  cwd. A forwarded folder must flow through the same add-watch path as a
  first-launch folder.
- Backend has no TOML or glob dependency yet: add `toml` and `glob`.
- Preferences are versioned in `localStorage`; adding `inboxVisible` must keep
  old stored objects valid and default to `true`.
- Existing tests live beside modules in Rust (`*_test.rs`) and in vitest files
  per frontend module; pure config and inbox-model functions must stay
  DOM-free to remain testable.

## Open Questions

- Confirm the `glob` crate's exact `**` behaviour for top-level files (for
  example whether `~/notes/**/*.md` matches `~/notes/a.md`). Owner: implementer;
  adjust patterns or traversal if it does not.
- Decide whether the inbox shows a loading state while the initial scan runs, or
  whether the panel simply fills in when ready. Owner: implementer; loading
  state preferred for broad selectors.
- Exact relative-time formatting (`Intl.RelativeTimeFormat` vs a small custom
  formatter). Owner: implementer; must be deterministic in tests.

## Scope Boundary

**In scope**

- TOML config loading, selector expansion, excludes, caps and diagnostics.
- Watcher changes for inventory metadata and filtered events.
- Removing the folder picker and auto-open behavior.
- The inbox panel, project chip, sorting, unread model, active-tab flash,
  deleted rows and persisted visibility toggle.
- Rust and vitest coverage, a config-fixture end-to-end simulation, README and
  CHANGELOG updates.

**Out of scope**

- Live config reload, config editing UI, named groups or profiles.
- Persisted read/unread state across restarts.
- Inbox search/filtering, notifications, or sound.
- Rename tracking; a rename still appears as delete + create.
- Document editing and non-Markdown rendering changes.
- Windows or macOS support.
