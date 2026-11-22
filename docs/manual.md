# docdeck manual

docdeck is a read-only Markdown viewer for documents that AI agents write. It
watches folders on disk, lists the Markdown files it finds, and keeps open
documents current without asking you to reload.

## Opening documents

- Start the app with one or more paths: `docdeck plan.md reports/`, or run it
  with no arguments and pick a document from the sidebar.
- `docdeck <path>` in a second terminal adds that path to the window that is
  already running instead of starting another process.
- `docdeck --quit` asks the running instance to exit without opening a window.
- `docdeck --changed [path]` shows uncommitted `_ai` documents in the running
  window, scoped to the repository containing `path` (or the caller's directory
  when `path` is omitted). It never creates a second window and never opens a
  document by itself.
- The **Open documents** list at the top of the sidebar holds every open
  document. Activate a row to switch to it, close it with `×` or a middle-click,
  and right-click for **Copy path**, **Copy file** and bookmark actions.
- The lower list switches between **All documents**, **Recently changed**,
  **Bookmarks** and **Changed `_ai`**. The filter field narrows the visible rows
  as you type.

## Reading

- A file written by an agent reloads in place. Scroll position, diagram zoom and
  the find selection survive the reload; a reader parked at the bottom stays
  pinned to new content.
- An amber dot means the document changed since you last read it. Opening the
  document acknowledges the change, and that state survives a restart.
- The outline on the right follows the current reading position. Select a
  heading to jump to it; use the star beside it to bookmark the section.
- **Find** overlays matches in the document. Match case is a toggle; live
  reloads keep the search and the current match.
- Frontmatter is shown as a collapsible metadata table. Toggle it from the
  header.
- Mermaid diagrams can be dragged and zoomed with Ctrl/Cmd + wheel. The hover
  toolbar fits, resets and opens a diagram fullscreen.

## Views and sorting

- **Recently changed** is a session activity list ordered by when docdeck saw
  each write. **Clear** empties it and acknowledges its unread markers; **Undo**
  restores both.
- **Auto-sort** bumps documents that just changed to the top of Open documents.
- The filter is session-only and never changes a document's open, unread or
  deleted state.
- **Bookmarks** lists bookmarked documents and headings. A heading bookmark
  follows edits by text and surrounding headings; if the heading disappears, it
  is marked **Not found** and can be re-anchored from the current outline.
- **Changed `_ai`** lists every uncommitted Markdown document under an `_ai`
  segment across the watched repositories, newest modification first. Each row
  shows its project, path context and **Staged**/**Unstaged**/**New** badges.
  Activate one row to open or focus that document; the view itself never opens
  documents, and it has no dismiss, star or unread control. The saved browse mode
  is untouched: closing docdeck and reopening restores the previous mode.
- A scoped launch (`docdeck --changed [path]`) shows a banner naming the
  repository and offers **Show all watched repositories** in one action.
- **Refresh** (or `Ctrl`/`Cmd`+`Shift`+`R`) re-reads git without moving tabs,
  scroll positions, unread markers or bookmarks. A repository that cannot be
  read is named with its reason while the others still list; git missing, empty,
  no-repository and scope-error states each explain what happened. Only
  `git status` is run, so the repository and its index are never modified.

## Clipboard

- **Copy path** puts the absolute path on the clipboard; **Copy file** puts a
  file reference there for pasting into a file manager, upload control or chat
  attachment field.
- Every code block has a copy button. Diagrams do not.
- On Linux, **Copy file** needs `xclip` on X11 or `wl-copy` on Wayland.

## Configuration

Watches live in the platform config file, not in the application state:

| Platform | Default path |
| --- | --- |
| Linux / other Unix | `~/.config/docdeck/config.toml` |
| macOS | `~/Library/Application Support/docdeck/config.toml` |
| Windows | `%APPDATA%\docdeck\config.toml` |

`DOCDECK_CONFIG` overrides the path. The **Watches** header button edits the
same file through a validated form. A valid edit reloads watches within a couple
of seconds; an invalid save keeps the last working set and reports the problem.

```toml
watch = [
  "~/devel/*/_ai",
  "~/notes/**/*.md",
]
exclude = [
  "**/archive/**",
]
```

## Keyboard

Press `?` to open the shortcut list. It is generated from the same registry the
application uses, so it always matches the current build. `Esc` closes help,
menus and the find bar.

`Ctrl+W` closes the active document and leaves the application open;
`Ctrl+Shift+T` reopens it. `Ctrl+W` is Ctrl-only on every platform, so on macOS
`Cmd+W` remains the window action. `Ctrl`/`Cmd`+`Shift`+`R` refreshes
**Changed `_ai`** (and switches to it when another browse mode is showing).

## When something looks wrong

- **The list is empty** — check the config path shown in the empty-state hint and
  make sure at least one pattern matches an existing file or folder.
- **A document is unavailable** — it was moved or deleted outside docdeck.
  Reopen it from its new location; the tab keeps the last rendered content until
  then.
- **Clipboard actions fail** — install `xclip` or `wl-clipboard` on Linux. Text
  copy falls back to the legacy webview path; file references require one of
  these tools.
- **Desktop notifications do not appear** — the desktop must provide a
  notification service. The tray presence dot still tracks changes.
- **Changed `_ai` says git is missing** — install `git` and make sure it is on
  `PATH`, then press **Refresh**. If one repository is named with an error while
  others list rows, only that repository failed; the rest of the app still
  works. A scope error names the requested path and offers **Show all watched
  repositories**.
