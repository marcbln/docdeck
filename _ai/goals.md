# Goals

## What docdeck is for

docdeck is a lightweight desktop Markdown viewer for watching documents that AI
agents write. Agents stream plans, progress logs and status reports to the local
filesystem; docdeck lists those files in a sidebar, keeps open documents
live-reloading as they change, and marks unseen changes unread. It replaces the
loop of re-opening a file or re-pointing a browser at it by hand.

It is a reading surface, not a workspace: it watches local files, shows them
faithfully, and stays out of the way while an agent works somewhere else.

## Primary goals

1. **Always-current documents** — a write on disk is reflected in an open
   document without user action, preserving reading position and diagram state.
2. **Fast triage of agent output** — list watched documents by name, folder or
   project; surface recently changed ones; track unread; filter and summarize,
   so the next thing to read is obvious.
3. **Zero-friction reading** — open a file or folder from the CLI into the
   running window, switch and cycle tabs, search within a document, and follow
   the outline without leaving the keyboard.
4. **Correct, faithful rendering** — GitHub-flavoured Markdown, task lists,
   syntax-highlighted code, frontmatter tables and zoomable Mermaid diagrams.
5. **Small and native** — a dependency-light Tauri app (Rust backend, webview
   frontend) that starts fast and does not bundle an editor, browser or git host.

## Non-goals

- **Not a Markdown editor** — docdeck never modifies documents; editing belongs
  to the user's editor or the agent.
- **Not a general document viewer** — Markdown only, not PDF, Office or images.
- **Not a collaboration or sync product** — no team sharing, cloud storage or
  accounts; files stay local.
- **Not a git client** — it may open files a workflow produces, but it does not
  commit, diff or manage repositories.
- **Not a web or mobile app** — a desktop application only.

## How we judge success

- After an agent writes a watched file, the document updates on screen and its
  unread dot appears until it is reviewed.
- A reviewer can find and open a specific agent document in seconds using the
  sidebar, browse filter or Recently changed list.
- Markdown renders correctly and scroll/diagram state survives live reloads and
  theme switches.
- `npm run check` (typecheck, Rust and web tests, build) stays green.

## Who it is for

- Developers running AI coding agents that emit `_ai` plans, logs and reports.
- Anyone who needs to review agent output on a desktop while working elsewhere.

## Constraints and simplicity

- OS concerns live in Rust; all view state lives in the webview, meeting only
  through typed `#[tauri::command]` handlers.
- Pure logic ships with unit tests; tests are deterministic and offline.
- Prefer live filesystem events over polling, and a small dependency set over
  convenience libraries.

## Platform support

- Linux, macOS and Windows, distributed as a Tauri desktop build.
- Installed via the shell installer, which also registers docdeck as a Markdown
  handler on Linux.
