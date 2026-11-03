---
title: Change summaries use a Rig agent over session snapshots and TOC tools
status: Accepted
date: 2026-11-03
deciders: docdeck maintainer
tags: [summary, ai, rig, snapshots, tools]
adrId: 261103-2
---

# Change summaries use a Rig agent over session snapshots and TOC tools

## Context

The Recently changed list tells the reader *which* documents an agent touched,
but not what the work was about. Summarizing needs three things the inventory
does not keep: the documents' contents, a baseline to diff against, and a way to
read long plans without sending every byte. docdeck is a Tauri app with a Rust
backend and a webview frontend; the webview is untrusted by design, and an
LLM provider may be remote.

## Decision

**Rig in the Rust backend.** The summary is produced by `rig-core` +
`rig-agent` inside a Tauri command, not by spawning a CLI agent and not by
calling a vendor HTTP API directly. `[summary]` in `config.toml` selects
`provider`, `model`, optional `base_url` and optional `api_key_env`; API keys
are read only from environment variables and never stored. The supported
providers are the Rig clients docdeck builds explicitly.

**Session-scoped two-version snapshots.** `SummaryStore` keeps `previous` and
`current` content for documents the watcher settled and documents `load_file`
read. It is bounded (64 documents, ~256 KiB per version, 8 MiB read cap, LRU)
and disappears on exit. A document's first observation has no baseline and the
agent is told so; later writes produce unified diffs. A document never opened or
changed before the request falls back to current content rather than inventing a
change.

**Outline first, budgeted tools.** The prompt carries frontmatter, a numbered
TOC and a short diff excerpt per document. The agent can call `get_toc`,
`get_sections` (selection expressions `7`, `7-9`, `2.1, 7`, title substring),
`search_sections` and `get_change`, sharing one per-run tool-call budget
(`max_tool_calls`, default 8). The selection parser is a Rust port of the one in
`sb`, so the two tools read sections the same way.

**Structured UI payload.** The run returns `{ overview, documents[] }` through
Rig's typed prompting. The webview renders the overview immediately and the
per-document entries behind a single Details disclosure. Closing the modal
discards the request's result; closing does not cancel the provider call.

## Consequences

Positive:
- No API keys in the config file or webview bundle; the filesystem allowlist is
  the store the watcher filled, not arbitrary paths from the webview.
- Real diffs for the common case without reading every watched file at startup.
- Long plans cost an outline instead of a full document, with a hard budget.
- Provider choice is a config edit; the UI is provider-agnostic.

Negative:
- The first write to a never-seen document has no baseline.
- Session-only: a restart loses summaries and baselines.
- Two large dependencies (`rig-core`, `rig-agent`) and their TLS stack.
- A provider call cannot be cancelled once the modal closes; its result is
  ignored.
- Providers that do not support native structured output rely on the typed
  parser and may fail on prose-wrapped JSON.

## Alternatives Considered

- Spawn a configured CLI agent (`opencode run`, `claude -p`): no new Rust
  dependencies, but output parsing, credentials, streaming and tool access move
  outside the app, and the backend cannot enforce the document allowlist.
- Copy a prompt to the clipboard: no secrets or network in docdeck, but it is
  not a button that produces an overview and loses the section tools.
- Call an HTTP provider directly: duplicates Rig's provider matrix and typed
  tool loop for no benefit.
- Git diffs via `git diff`/`git log`: precise for committed work, but fails
  outside repositories and does not cover a document that was never committed.
- Read and send every matched document in full: simple, but expensive and
  defeats the point of the section tools.
- Persist summaries and snapshots across restarts: a separate storage and
  migration feature; the Recently changed list it summarizes is session-scoped
  too.

## Related Decisions

- Follows the session-scoped activity model in
  [ADR 261019-2](ADR__261019-2__session-scoped-unread-inbox.md).
- Reuses the config-preserving save path from
  [ADR 261019-1](ADR__261019-1__config-driven-watch-registry.md): unknown keys,
  including `[summary]`, survive in-app watch edits.
