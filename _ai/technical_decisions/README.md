# Architecture Decision Records

Significant, hard-to-reverse technical decisions taken in docdeck. Numbered per
decision date (`YYMMDD-N`); an ADR is never edited after it is accepted — a
changed decision is a new ADR that supersedes the old one.

## Index

### 2026

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [261002-1](ADR__261002-1__runtime-stylesheet-swapping-for-themes.md) | Runtime stylesheet swapping for the light/dark theme | Accepted | 2026-10-02 |
| [261019-1](ADR__261019-1__config-driven-watch-registry.md) | Config-driven watch registry replaces the folder picker | Accepted | 2026-10-19 |
| [261019-2](ADR__261019-2__session-scoped-unread-inbox.md) | Session-scoped unread inbox with an active-tab flash | Accepted | 2026-10-19 |
| [261024-1](ADR__261024-1__css-custom-highlight-api-for-in-document-find.md) | CSS Custom Highlight API for in-document find | Accepted | 2026-10-24 |

## Format

See [the ADR template](../../.claude/skills/adr-writer/assets/ADR_TEMPLATE.md):
`Context`, `Decision`, `Consequences`, `Alternatives Considered`, and — when
applicable — `Related Decisions`. Never add an `id:` frontmatter key; the ADR
number belongs in `adrId:`.