---
id: watch-reload-and-acknowledgements
title: Live watch reload and cross-session unread acknowledgements
type: context
updated: 2026-11-01
related:
  - ADR__261101-1__file-identity-renames-and-persisted-acknowledgements
  - ADR__261019-1__config-driven-watch-registry
---

# Live watch reload and cross-session unread acknowledgements

## Live reload

The watch configuration is a TOML file at the platform-standard user config path
(`$DOCDECK_CONFIG` overrides). Rust watches its **parent directory** with a
300 ms debounce, re-reads and expands the file, and reconciles watches by
ownership:

- `config` roots/files are replaced on every successful reload.
- `session` roots (CLI folders) are never removed; they are rescanned under the
  new excludes.
- An invalid/unreadable file keeps the previous watch plan and emits an error in
  the reload result.

Every pass carries a monotonic `generation`. The webview applies only the newest
one. A reload whose bytes match the last applied revision is skipped (only the
status line changes). The shared `reconcile_config` entry point is used by
startup (`load_watches`), the file watcher, and the save/reload commands.

`config-reloaded` carries `{ generation, at, path, found, revision, watch,
exclude, roots, entries, warnings, error, truncated }`. Entries are tagged with
`origin: "config" | "session"`.

## Webview reconciliation

`InboxModel.reconcile(entries)`:

- replaces config rows and updates surviving paths without changing their
  `unread`/`changedAt`;
- adds newly matched paths as unread (inventory rows, `changedAt = 0`);
- keeps `manual` rows (documents opened directly, outside every watch);
- removes departed config/session rows. Open tabs are untouched; only inventory
  membership ends.

Reload must never mark a surviving document unread merely because it reloaded.

## Acknowledgements

Key: `docdeck.acknowledgements.v1`.

```text
{ version: 1, entries: { "<path>": { mtime: number, at: number } } }
```

- `mtime` is the filesystem mtime observed when the reader reviewed the
  document.
- Unread = `document.modifiedTime > entry.mtime`. No entry + an existing store
  means unread (new/re-added work). No store at all means first launch: nothing
  unread, and a baseline is seeded after the first **successful** inventory.
- Review points: activating a row/tab, opening a document, and a watcher write
  while the document is active.
- Renames move the entry; a move out of all watches prunes it; every successful
  reload prunes paths that are no longer watched.
- Corrupt JSON, a wrong version, or a malformed entry is ignored per entry; bad
  storage behaves as a first launch.
- Writes are debounced and flushed on `pagehide`/`beforeunload`.
- `Recently Changed` (`changedAt`, `clearedAt`, clear snapshots) stays
  session-scoped and is never persisted.

## Rename and move events

`paths-changed` now carries `kind` (`created`, `modified`, `deleted`, `renamed`,
`movedOut`) and an optional `fromPath`. Pairing uses a backend-only file-identity
cache and a two-second hold. The webview re-keys tabs, the active path, reload
tokens and acknowledgement entries on `renamed`; removes the row and marks an
open tab unavailable on `movedOut`; and adds new unread work on `created`.
