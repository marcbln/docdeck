---
title: Config-driven watch registry replaces the folder picker
status: Accepted
date: 2026-10-19
deciders: docdeck maintainer
tags: [config, watcher, glob, cli, ux]
adrId: 261019-1
---

# Config-driven watch registry replaces the folder picker

## Context

docdeck discovered documents through CLI arguments: files opened directly, and
a folder argument opened a checkbox picker whose confirmed selection started
recursive watches. That selection existed only for the session, so every launch
required the same command and the same confirmation. The desired workflow is a
persistent registry of watched directories and files with wildcards, modelled on
super-bin's `repos.toml`.

Two mechanisms could coexist: keep the picker as a per-session override, or make
the config the single watch source and let CLI folders add session watches. Two
selection models would mean two answers to "what is watched?" and two UIs to
keep consistent.

## Decision

The config is the primary watch source. It lives at
`~/.config/docdeck/config.toml` (XDG-aware, `$DOCDECK_CONFIG` overrides) and is
read once at startup. It has two flat arrays: `watch` and `exclude`. A selector
expands with `~`, `*` (one segment) and `**` (any depth). A matched directory
contributes its recursive `*.md` tree; a matched file is watched explicitly and
may be any extension. Canonicalization and deduplication follow expansion.

Hidden entries, symlinks, `node_modules`, `target`, `dist`, `build`, `.venv` and
`venv` are always skipped; `exclude` patterns apply on top. The same rules filter
the initial scan and watcher events. Expansion is capped at 256 roots and 10,000
files with a visible warning.

Rust owns parsing and expansion (`config.rs`); the frontend receives resolved
paths. A CLI folder argument adds a session watch through the same path; a CLI
file argument still opens a tab. The folder picker and its supporting modules are
removed.

## Consequences

Positive:
- One persistent answer to "what does docdeck watch?", independent of how it was
  launched.
- Broad selectors become practical because the inbox triages files instead of
  auto-opening a tab per file.
- Selector semantics live in one tested Rust module instead of being split
  between CLI classification and frontend tree building.

Negative:
- Editing the config requires a restart; there is no live reconciliation.
- Broad selectors can exhaust inotify watches, so defaults, excludes and caps
  are load-bearing.
- Removing the picker is a breaking UX change for anyone who relied on
  per-session file selection.
- A rename is still delete + create; the registry does not track file identity.

## Alternatives Considered

- **Named groups (`[groups.work] watch = [...]`).** Rejected: flat selectors
  cover the need; project identity is derivable from `_ai` paths.
- **Project-local `.docdeck.toml` merged with a global file.** Rejected: two
  sources and precedence rules for no demonstrated workflow.
- **Live reload of the config file.** Rejected: watch reconciliation, error
  rollback and selection preservation are real complexity; restart is acceptable.
- **Keep the picker for CLI folders or config matches.** Rejected: competing
  selection models and duplicate watch UIs.
- **Markdown-only scanning without built-in noise directories.** Rejected:
  `~/devel/*` would traverse build trees on first launch.
- **Configurable include patterns per selector.** Rejected: Markdown for
  directories plus explicit file selectors is sufficient.

## Related Decisions

- [261019-2](ADR__261019-2__session-scoped-unread-inbox.md) — the inbox that
  makes a hands-off watch registry usable.
