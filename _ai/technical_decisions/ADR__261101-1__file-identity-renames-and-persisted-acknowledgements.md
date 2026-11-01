---
title: File-identity rename pairing and persisted review acknowledgements
status: Accepted
date: 2026-11-01
deciders: docdeck maintainer
tags: [watcher, rename, unread, persistence, inbox]
adrId: 261101-1
---

# File-identity rename pairing and persisted review acknowledgements

## Context

Two requirements in the watch/inbox follow-up feature are hard to reverse once
shipped:

1. A rename or move inside watched locations must update one row in place,
   carrying open, active and read state, while a move out of every watch must be
   distinguishable from an ordinary delete (which keeps the existing
   struck-through row).
2. Read/unread state must survive restarts without turning every document
   unread on a first launch or after corrupt storage.

`notify-debouncer-mini` collapses every event to `Any`, so the old watcher could
not tell a rename-from from a delete. Session-scoped unread (ADR `261019-2`) is
explicitly superseded by this feature.

## Decision

**Rename pairing.** Replace `notify-debouncer-mini` with
`notify-debouncer-full` to preserve `notify::EventKind`. Keep a backend-only
cache of stable file identities (`dev`/`ino` on Unix and macOS,
`volume_serial_number`/`file_index` on Windows) seeded from inventory scans and
opened files. A `From` is held for two seconds; a matching-identity `To` emits
one `renamed` transition (`path` = new, `fromPath` = old). A `From` that waits
out the hold becomes `movedOut`; a `To`/create with no match becomes `created`;
a plain `Remove` stays `deleted`. Identities are metadata only — no document
content is read and no hash is computed.

**Persisted acknowledgements.** Store per-document review acknowledgements in
`localStorage` under the versioned key `docdeck.acknowledgements.v1`:

```text
{ version: 1, entries: { "<path>": { mtime: <number>, at: <number> } } }
```

`mtime` is the document's filesystem mtime observed at review time, not the
wall-clock review time, so a document is unread only when its mtime actually
advanced. With no store at all, nothing is unread and the first successful
inventory seeds a baseline. Once a store exists, a watched path with no entry is
new/re-added work and is unread. Activating, opening, or writing to the active
document refreshes its entry; a rename moves it; leaving all watches prunes it.
Corrupt JSON, a wrong version, or a malformed entry is treated as a first launch
and never blocks startup. `Recently Changed` activity remains session-scoped.

## Consequences

Positive:
- A rename is one transition, so the reader keeps their place and their read
  state; move-out and delete remain distinguishable.
- Rapid and case-only renames settle on one row because they share an identity.
- Unread is stable across clock changes, time zones and future mtimes.
- Persistence stays in the webview (P-I) and reuses the established versioned
  `localStorage` pattern; no new IPC is needed per acknowledgement.

Negative:
- The backend must maintain an identity cache and a two-second pending queue.
- Filesystems without usable identity fall back to delete-plus-create.
- A new versioned storage key must be documented and kept compatible.
- The identity cache grows with the inventory (bounded by the 10,000-file cap)
  and is lost with the process.

## Alternatives Considered

- Pairing by filename or mtime only: invents renames on unrelated delete/create
  bursts and cannot detect a move-out.
- Hashing document contents: reads every changed file, violates the
  metadata-only inventory rule, and is slow.
- Re-serializing `WatchConfig` with `toml`: destroys comments and unknown keys.
- Wall-clock review timestamps: break when the clock moves backwards or a file
  carries a future mtime.
- A Rust-owned JSON file for acknowledgements: moves view state out of the
  webview and adds IPC for every review.

## Related Decisions

- Supersedes the session-scoped unread decision in
  [ADR 261019-2](ADR__261019-2__session-scoped-unread-inbox.md).
- Builds on the config-driven watch registry in
  [ADR 261019-1](ADR__261019-1__config-driven-watch-registry.md).
