# Quickstart: Watch Configuration and Inbox Follow-ups

**Feature**: `002-watch-inbox-followups` | **Date**: 2026-11-01

Validation guide for the feature. Run after `/speckit.implement` or phase by
phase. Contract details live in [`contracts/`](./contracts/); state rules live in
[`data-model.md`](./data-model.md).

## Prerequisites

```bash
cd /home/marc/devel/docdeck
npm install
```

Linux additionally needs the packages listed in `README.md`. macOS and Windows
need the standard Tauri 2 prerequisites (Rust toolchain, Node 20+, platform
webview/build tools).

## Automated checks

```bash
npm run typecheck
npm run test:web      # Vitest: acknowledgements, filter, config editor, inbox, sidebar
npm test              # cargo test + Vitest
npm run lint:rs       # cargo clippy -D warnings
```

Expected:

- Typecheck clean.
- New pure-module suites pass, including deterministic clock/temp-dir cases.
- Rust suites pass for config platform paths, selector normalization, TOML
  preservation, revision conflicts, atomic write, reload reconciliation, rename
  pairing, and command validation.
- Existing suites remain green (no regression in sidebar, unread, tray).

Optional packaging smoke:

```bash
npm run tauri build -- --no-bundle
```

## Manual verification

Use a scratch workspace so real documents are not touched:

```bash
mkdir -p /tmp/docdeck-e2e/_ai/backlog
export DOCDECK_CONFIG=/tmp/docdeck-e2e/config.toml
printf 'watch = ["/tmp/docdeck-e2e/_ai/**/*.md"]\nexclude = []\n' > "$DOCDECK_CONFIG"
npm run tauri dev
```

### 1. Live reload (P1)

1. With the app running, add `watch = ["/tmp/docdeck-e2e/extra/**/*.md"]` and
   save. Confirm new documents appear within ~2 s; open documents stay open.
2. Remove a selector. Confirm its rows leave the list; any open tabs stay open
   and readable.
3. Add `exclude = ["**/archive/**"]`. Confirm matching rows disappear and later
   writes to them are ignored.
4. Save malformed TOML (e.g. `watch = [`). Confirm the previous watches keep
   working and an actionable error names the file.
5. Fix the file. Confirm the error clears without restart.
6. Delete the config file. Confirm current watches continue and the setup hint
   reappears.
7. Launch with a folder argument (`docdeck /tmp/docdeck-e2e/extra`) and then
   edit/reload the config. Confirm the session folder is still watched.
8. Confirm no existing row becomes unread merely because of a reload.

### 2. Cross-session unread (P2)

1. First launch with no acknowledgement key: confirm nothing is unread.
2. Review a document (activate it), quit docdeck, modify a *different* watched
   document, restart. Confirm only the modified document is unread and near the
   top of All Documents; Recently Changed is empty.
3. Review the unread document; restart without changes. Confirm it is read.
4. Leave a document unread, restart, confirm the marker persists.
5. Modify a document while it is active, quit, restart. Confirm it is read
   (clarification).
6. Start once with malformed TOML (so no acknowledgement store is created), fix
   it, then restart twice. Confirm the first successful inventory marks nothing
   unread and later changes are detected.
7. Remove a selector so a document leaves all watches, then re-add it. Confirm
   it appears unread (clarification).
8. Corrupt the `docdeck.acknowledgements.v1` value in devtools. Restart.
   Confirm the app starts and shows no false unread.

### 3. Filtering (P3)

1. Point the config at a large tree (≈10,000 `.md` files).
2. Type part of a filename in the browse filter; confirm only matches remain in
   their original order and typing stays responsive.
3. Type a parent folder or project name; confirm its documents match.
4. Change case and add punctuation; confirm matching is case-insensitive and
   literal.
5. Switch to Recently Changed; confirm the filter still applies.
6. Clear with the clear control and with `Escape`; confirm the full list
   returns.
7. Enter a term with no matches; confirm the empty state explains it and offers
   a clear action.
8. While filtering, write a file that matches and one that does not; confirm the
   match appears and the non-match stays hidden.
9. Rename a matching file so it no longer matches; confirm it disappears.
10. Confirm filtering changed no unread/open/active/deleted state.

### 4. Rename and move (P4)

1. Open and read a document inside a watched folder; rename it in a terminal.
   Confirm one row with the new name, the tab stays open and active, and no
   deleted/unread marker appears. Restart and confirm it is still read (the
   acknowledgement moved with the rename).
2. Rename an unread document; confirm it stays unread.
3. Move a document between two watched locations; confirm it updates in place.
4. Move a document out of every watch; confirm its row leaves the browse list
   and any open tab shows the unavailable banner.
5. Move a document into a watched location; confirm it appears unread.
6. Rename a document into an excluded folder; confirm its row leaves.
7. Rename the same file three times quickly; confirm only the final name
   remains.
8. On macOS or Windows, change only the case of a filename; confirm one row.

### 5. In-app configuration (P5)

1. With no config file, open **Watches**, choose **Create from example**, add a
   selector, and save. Confirm documents appear without restart.
2. Add a second selector, save, and confirm it applies.
3. Enter an invalid selector or malformed value; confirm a precise error, no
   application, and the draft is preserved.
4. Put malformed TOML in the file and reopen the surface; confirm the parse
   error is shown, Save is disabled, and **Open config file** works.
5. Add the same selector twice; confirm it is folded/reported and no duplicate
   rows appear.
6. With the surface open, edit the file externally, then save. Confirm a
   conflict is surfaced and you can reload before overwriting (or explicitly
   overwrite).
7. Make the config read-only, save, and confirm the explanation, the previous
   active config, and retry.
8. Confirm the surface shows the effective path, validity, and last-reload
   result.
9. Close with unsaved changes; confirm the discard confirmation.

### 6. Platform parity (P6)

Run flows 1–5 on Linux, macOS, and Windows:

- First launch discovers the config in the platform-standard location
  (`~/Library/Application Support/docdeck/config.toml` on macOS,
  `%APPDATA%\docdeck\config.toml` on Windows).
- Forward-slash selectors work everywhere; a native backslash selector works on
  Windows.
- Rename/move, reload, unread, filtering, and the config surface behave the same.
- An unreadable or unwritable config produces the same guidance.

## Regression spot checks

- Open/close/close-all, context-menu copy path, Auto-Sort, `Ctrl+Shift+T`.
- Clear/Undo in Recently Changed.
- Ordinary deletion still shows a struck-through row and a deleted-tab banner.
- Tray presence dot and notifications still react to `paths-changed`.
- Virtual list scrolling with 10,000 rows; pop-out inventory.
- Theme, TOC, frontmatter, find, Mermaid zoom.

## Documentation updates (same commit)

- `README.md`: platform requirements, config path per platform, live reload,
  unread persistence, filter, rename behavior, config surface.
- `CHANGELOG.md`: user-visible additions.
- `_ai/`: config/reload and acknowledgement context; technical decision record
  if the rename/persistence approach is judged hard to reverse.
- `_ai/conventions.md` is generated by `ruleman`; do not hand-edit it.

## Definition of done

- [ ] All acceptance scenarios in `spec.md` pass, including the clarified cases.
- [ ] `npm run typecheck`, `npm run test:web`, `npm test`, and `npm run lint:rs`
      pass.
- [ ] No document other than the config file is ever written.
- [ ] Reload, rename, and unread survive rapid saves and restarts without
      duplicate or flickering rows.
- [ ] Filtering stays within 100 ms and does not disturb list order/state.
- [ ] Config saves preserve comments, formatting, and unknown keys.
- [ ] macOS/Windows flows pass or a concrete blocker is documented.
- [ ] Constitution amended for platform support and persisted acknowledgements.
- [ ] README/CHANGELOG/_ai documentation updated.
