---
title: Runtime stylesheet swapping for the light/dark theme
status: Accepted
date: 2026-10-02
deciders: docdeck maintainer
tags: [theming, css, vite, webview]
adrId: 261002-1
---

# Runtime stylesheet swapping for the light/dark theme

## Context

docdeck shipped with a dark-only palette: `src/style.css` `@import`ed
`github-markdown-dark.css` and `highlight.js/styles/github-dark.css`, and
`index.html` hard-coded `data-color-mode="dark"`. Supporting a second theme meant
deciding how the markdown and syntax-highlighting stylesheets get swapped.

The constraint that decides the design: `github-markdown-dark.css` and
`github-markdown-light.css` **both** define `.markdown-body` with equal
specificity. Any scheme that keeps both documents loaded and hides the inactive
one lets the loser win on cascade order, which produces a half-dark, half-light
render rather than a clean switch. Exactly one variant may be *in the document*
at a time.

## Decision

`src/theme.ts` owns all four stylesheets as real `<link>` elements created at
runtime and imported with Vite's `?url` suffix. The controller attaches the dark
and light pairs on construction, then on every `apply(mode)` it appends the
active pair and removes the inactive pair — it never toggles `display`. Because
the inactive `<link>` is detached, its `.markdown-body` rules leave the cascade
entirely. Re-attaching a `<link>` re-fetches from the HTTP cache.

Alongside it:
- App chrome colours stay in `src/style.css` as custom properties, with a
  `[data-color-mode="light"]` block overriding the nine Mocha values with their
  Catppuccin Latte counterparts.
- Mermaid bakes its palette into the SVG at render time, so `markdown.ts` exports
  `applyMermaidTheme(mode)` and `ThemeController.onModeApplied` triggers a
  re-render of the active document after each switch.
- The style switch itself lives in `src/preferences.ts` under the versioned
  `docdeck.preferences.v1` key, with per-field validation.

## Consequences

Positive:
- The switch is unambiguous in both directions; there is no cascade fight and no
  flash of the wrong palette (verified visually in light and dark).
- Adding a third variant (dimmed, high-contrast) is a config change in
  `STYLESHEET_URLS`, not a CSS refactor.
- The `?url` imports are fingerprinted by Vite, so both palettes are cacheable
  production assets rather than runtime string concatenation.

Negative:
- `src/style.css` can no longer `@import` the markdown styles itself; a future
  contributor adding a stylesheet must know that `theme.ts` owns those four
  links, or the two will fight over `.markdown-body` again.
- A theme change forces a full re-render of the active document, so an open
  Mermaid diagram briefly re-renders. Unavoidable — Mermaid has no recolour API.
- The stylesheets are only attached once the JS bundle boots, so there is a
  sub-frame of unstyled markdown on first paint.

## Alternatives Considered

- **Keep both stylesheets and toggle a class on `<html>`.** Rejected: the two
  variants target the same selector with equal specificity, so the winner is
  whichever `<link>` comes last in the document — the switch silently does
  nothing.
- **Prefix the selectors** (`body.dark .markdown-body`) so both can coexist.
  Rejected: requires forking both upstream stylesheets, which makes every
  `github-markdown-css` and `highlight.js` upgrade a merge conflict.
- **Inline the palette as CSS variables only** and drop the GitHub stylesheets.
  Rejected: markdown typography (tables, task lists, blockquote metrics) is
  several hundred lines that would have to be reimplemented and maintained.