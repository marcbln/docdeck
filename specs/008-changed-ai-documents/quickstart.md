# Quickstart: Changed `_ai` Documents

**Feature**: `008-changed-ai-documents` | **Date**: 2026-11-22

Runnable validation for the transient **Changed `_ai`** view and the
`docdeck --changed [path]` entry point. Payloads and invariants live in
[contracts/](./contracts/) and [data-model.md](./data-model.md); this file is the
run guide, not an implementation description.

## Prerequisites

- Linux, macOS or Windows with a desktop session.
- Node.js 20+, Rust 1.80+, the Tauri prerequisites for the platform, and `git`
  on `PATH` (`git --version`).
- A disposable fixture directory, because the scenarios stage, edit, delete and
  rename files. Do not point the watch configuration at a real project.

## Automated gates

From the repository root:

```bash
npm ci
npm run typecheck
npm run test:web
npm test            # cargo test + vitest
npm run lint:rs
```

Expected: all pass, including the new
`changed-ai-model`, `changed-ai-controller`, `changed-ai-rows`, extended
`sidebar-panel`/`preferences`/`shortcuts`/`shortcut-reference` suites, and the
Rust `changed_ai` / `paths` suites. The real-`git` smoke test skips itself when
`git` is absent; every other case uses fixture porcelain strings and temporary
directories.

Launch the app in development (stays attached to the terminal so Ctrl-C works):

```bash
npm run tauri dev
```

## Fixture

```bash
rm -rf /tmp/docdeck-changed && mkdir -p /tmp/docdeck-changed
for repo in alpha beta; do
  mkdir -p "/tmp/docdeck-changed/$repo/_ai/backlog"
  git -C "/tmp/docdeck-changed/$repo" init -q
  printf '# base\n' > "/tmp/docdeck-changed/$repo/_ai/backlog/plan.md"
  printf '# notes\n' > "/tmp/docdeck-changed/$repo/_ai/backlog/notes.md"
  git -C "/tmp/docdeck-changed/$repo" add _ai/backlog/plan.md
  git -C "/tmp/docdeck-changed/$repo" -c user.name=t -c user.email=t@t commit -qm init
done

# State variety in alpha
printf '# base\nstaged\n' > /tmp/docdeck-changed/alpha/_ai/backlog/plan.md
git -C /tmp/docdeck-changed/alpha add _ai/backlog/plan.md
printf '# notes\nunstaged\n' > /tmp/docdeck-changed/alpha/_ai/backlog/notes.md
printf '# new\n' > /tmp/docdeck-changed/alpha/_ai/backlog/new.md
printf 'x\n' > /tmp/docdeck-changed/alpha/_ai/backlog/ignored.txt
printf '# non-ai\n' > /tmp/docdeck-changed/alpha/README.md
git -C /tmp/docdeck-changed/alpha rm -q _ai/backlog/gone.md 2>/dev/null || true

# Beta gets one untracked document
printf '# beta\n' > /tmp/docdeck-changed/beta/_ai/backlog/fresh.md
```

Watch configuration (`~/.config/docdeck/config.toml`; back up any real file
first):

```toml
watch = ["/tmp/docdeck-changed/*/_ai"]
exclude = ["**/archive/**"]

[tray]
enabled = false
```

Expected repository states: alpha = `M ` (staged plan), ` M` (unstaged notes),
`??` (new.md); beta = `??` (fresh.md). `ignored.txt` is a non-Markdown sibling;
`README.md` is outside `_ai`.

## Scenario 1 — Completeness and exclusion (US1, SC-002)

1. Start docdeck and select **Changed `_ai`** in the browse mode row.
2. Confirm exactly four rows: alpha `plan.md` (Staged), alpha `notes.md`
   (Unstaged), alpha `new.md` (New), beta `fresh.md` (New).
3. Confirm each project chip reads `alpha` / `beta`, each row shows `_ai`-relative
   context, and `ignored.txt` / `README.md` never appear.
4. Confirm `plan.md` shows one row even though it has both staged and unstaged
   edits (stage one more edit to check "Staged + Unstaged" together).
5. Confirm newest first; create a fresh document and refresh to see it lead.
   Two rows with the same mtime must be ordered by path.

## Scenario 2 — Filter keeps order (FR-006)

Type `beta` in the shared filter: only `fresh.md` remains, still in the same
relative order; counts update. Type `zzz`: the existing "No documents match"
copy appears with **Clear**, not an empty-git message. Clear the filter and
confirm the full list returns unchanged.

## Scenario 3 — Opening never duplicates or bulk-opens (US2, SC-004)

1. Add thirty untracked documents:

   ```bash
   for n in $(seq -w 1 30); do
     printf '# %s\n' "$n" > "/tmp/docdeck-changed/alpha/_ai/backlog/bulk-$n.md"
   done
   ```

2. Refresh the view and confirm the row count grows without creating any tab.
3. Activate one row: exactly one tab opens with that document's content and
   becomes active.
4. Activate the same row again: the same tab is activated, no duplicate.
5. Activate a row for a document already open from All documents: no duplicate.
6. Confirm the row remains in the changed list with no dismiss, star or unread
   control.

## Scenario 4 — Ordering, scroll and refresh safety (US4, FR-015)

1. Open a long document, scroll halfway, then click **Changed `_ai`**, then
   click the same mode entry again to refresh.
2. Confirm the tab stays open, stays active, and keeps its scroll position.
   Confirm unread dots and bookmark stars did not change.
3. Change a file on disk (edit `notes.md`). Refresh: its row updates and moves to
   the top. Delete `new.md`: its row disappears.

## Scenario 5 — Partial failure (FR-016, SC-008)

1. Break one repository's readability, e.g. `chmod 000 /tmp/docdeck-changed/beta/.git`.
2. Refresh the view.
3. Confirm beta is named with an actionable message and alpha's four (or more)
   docs still list. Confirm the rest of the app, including opening a document
   from alpha, still works.
4. Restore with `chmod 755 /tmp/docdeck-changed/beta/.git` and refresh.

## Scenario 6 — CLI against the running window (US3, SC-007)

With the window open and focused on another project:

```bash
cd /tmp/docdeck-changed/alpha && docdeck --changed
```

Confirm: the existing window comes forward, the changed view is scoped to alpha,
the scope banner names alpha and a **Show all watched repositories** action is
present, no second window or process appears, and no document opens. Repeat with:

```bash
docdeck --changed /tmp/docdeck-changed/beta/_ai/backlog/fresh.md
```

Confirm the same window is rescoped to beta. Then choose **Show all watched
repositories** and confirm the full merged list returns in one action.

## Scenario 7 — CLI with docdeck stopped, no terminal (FR-023, SC-011)

Use a release binary (`npm run tauri build -- --no-bundle`, then
`src-tauri/target/release/docdeck`) from a script whose stdin is not a terminal:

```bash
cd /tmp/docdeck-changed/beta && DOCDECK_FOREGROUND= timeout 10 \
  sh -c 'docdeck --changed; echo "returned $?"'
```

Expected: the command returns promptly with success while the window opens and
stays open independently, scoped to beta. Confirm no second instance starts when
run twice. Errors such as `docdeck --changed /nope/missing` print on stderr and
the running window shows its scope-error state naming the path.

## Scenario 8 — Transient across restart (SC-009)

1. Set the saved mode to Recently changed.
2. Open Changed `_ai`, scope it with `docdeck --changed`, then quit and restart
   without the flag.
3. Confirm the app opens on Recently changed, with none of the changed view,
   scope, rows or filter surviving.

## Scenario 9 — Keyboard and AT (FR-024, SC-012)

Without a pointer: `Tab` to the mode row, open Changed `_ai`, `Tab` into the
filter, type a term, `Tab` to a row, open it with `Enter`, return to the mode and
press it with `Enter` to refresh, then `Tab` to **Show all watched repositories**
after a scoped launch. Confirm visible focus on every control and that a screen
reader announces the mode name, each row's filename/project/states/time, the
loading/empty/partial/scope-error states, and the visible count.

## Scenario 10 — Read-only audit (SC-005, FR-019)

```bash
before_status=$(git -C /tmp/docdeck-changed/alpha status --porcelain=v1)
before_index=$(sha256sum /tmp/docdeck-changed/alpha/.git/index)
# open/refresh the changed view several times, and open a document
after_status=$(git -C /tmp/docdeck-changed/alpha status --porcelain=v1)
after_index=$(sha256sum /tmp/docdeck-changed/alpha/.git/index)
test "$before_status" = "$after_status" && test "$before_index" = "$after_index" \
  && echo "repository unchanged"
```

Expected: `repository unchanged`; documents on disk are byte-identical, and
`.git/index` was not refreshed (`--no-optional-locks`).

## Scenario 11 — No `_ai` folder in a repository

Point the config at a folder with no `_ai` (e.g. `/tmp/docdeck-changed/plain`).
Expected: "No watched `_ai` folder is inside a git repository." with **Refresh**,
distinct from "No uncommitted `_ai` documents in N repositories." when a clean
repository has an `_ai` folder.

## Scenario 12 — Scale (FR-022, SC-003)

Generate 500 untracked Markdown documents under alpha's `_ai`. Activate the view:
the loading state must appear immediately, every one of the 500+ rows must be
reachable, and scrolling must stay smooth. No row is hidden by a limit and the
command must resolve within the 1.8 s budget on a warm cache.

## Scenario 13 — Missing git (edge case)

With a built binary, run it under a `PATH` that has the Tauri runtime libraries
but no `git` binary. Expected: the app starts, documents still open, and the view
names git as missing with a refresh action. Restore `PATH` and refresh.
