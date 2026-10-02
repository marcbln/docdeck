import markdownDarkHref from "github-markdown-css/github-markdown-dark.css?url";
import markdownLightHref from "github-markdown-css/github-markdown-light.css?url";
import hljsDarkHref from "highlight.js/styles/github-dark.css?url";
import hljsLightHref from "highlight.js/styles/github.css?url";

import type { ThemeMode } from "./preferences";

/**
 * Catppuccin Latte variables for Mermaid diagrams.
 *
 * Mirrors the Mocha set in markdown.ts. Mermaid bakes colors in at
 * initialize() time, so these must be re-applied whenever the mode changes.
 */
export const LIGHT_MERMAID_VARIABLES: Record<string, string> = {
  background: "#eff1f5",
  primaryColor: "#e6e9ef",
  primaryTextColor: "#4c4f69",
  primaryBorderColor: "#ccd0da",
  lineColor: "#9ca0b0",
  secondaryColor: "#ccd0da",
  tertiaryColor: "#eff1f5",
  textColor: "#4c4f69",
  mainBkg: "#e6e9ef",
  nodeBorder: "#ccd0da",
  clusterBkg: "#eff1f5",
  clusterBorder: "#acb0be",
  titleColor: "#4c4f69",
  edgeLabelBackground: "#eff1f5",
  fontSize: "14px",
};

const STYLESHEET_URLS = {
  dark: {
    markdown: markdownDarkHref,
    highlight: hljsDarkHref,
  },
  light: {
    markdown: markdownLightHref,
    highlight: hljsLightHref,
  },
} as const;

/** Re-applies Mermaid's theme. Supplied by markdown.ts, which owns the instance. */
export type MermaidThemeApplier = (mode: ThemeMode) => void;

export interface ThemeControllerOptions {
  /** Called after the mode changes, so diagrams can be re-themed. */
  onMermaidThemeChange: MermaidThemeApplier;
  /** Called after the mode changes, so rendered SVGs can be refreshed. */
  onModeApplied?: (mode: ThemeMode) => void;
}

export class ThemeController {
  private mode: ThemeMode = "dark";
  private readonly links: HTMLLinkElement[] = [];

  private readonly options: ThemeControllerOptions;

  constructor(options: ThemeControllerOptions) {
    this.options = options;
    this.attachStylesheets();
  }

  /**
   * Adds the four swappable stylesheets as real `<link>` elements so their
   * hrefs can be retargeted. Only the active pair is kept in the document: the
   * inactive one is detached rather than hidden, because `.markdown-body` rules
   * from both variants would otherwise collide on cascade order.
   */
  private attachStylesheets(): void {
    const head = document.head;
    for (const [mode, urls] of Object.entries(STYLESHEET_URLS)) {
      for (const href of Object.values(urls)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.themeMode = mode;
        head.appendChild(link);
        this.links.push(link);
      }
    }
  }

  private applyStylesheets(): void {
    for (const link of this.links) {
      const shouldApply = link.dataset.themeMode === this.mode;
      if (shouldApply && !link.isConnected) {
        document.head.appendChild(link);
      } else if (!shouldApply && link.isConnected) {
        link.remove();
      }
    }
  }

  public apply(mode: ThemeMode): void {
    this.mode = mode;
    document.documentElement.dataset.colorMode = mode;
    this.applyStylesheets();
    this.options.onMermaidThemeChange(mode);
    this.options.onModeApplied?.(mode);
  }

  public getMode(): ThemeMode {
    return this.mode;
  }
}