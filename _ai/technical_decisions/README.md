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
| [261024-2](ADR__261024-2__custom-html-context-menu.md) | Custom HTML context menu for in-app right-click actions | Accepted | 2026-10-24 |
| [261024-3](ADR__261024-3__windowed-inbox-list.md) | Windowed inbox list instead of full DOM rebuilds | Accepted | 2026-10-24 |
| [261024-4](ADR__261024-4__inline-pan-zoom-for-mermaid-diagrams.md) | Inline pan/zoom for Mermaid diagrams with source-keyed view state | Accepted | 2026-10-24 |
| [261029-1](ADR__261029-1__block-webview-navigation-and-dispatch-links-explicitly.md) | Block webview navigation and dispatch document links explicitly | Accepted | 2026-10-29 |

## Format

See [the ADR template](../../.claude/skills/adr-writer/assets/ADR_TEMPLATE.md):
`Context`, `Decision`, `Consequences`, `Alternatives Considered`, and — when
applicable — `Related Decisions`. Never add an `id:` frontmatter key; the ADR
number belongs in `adrId:`.