/**
 * Pure geometry and validation for the four resizable pane boundaries.
 *
 * Stored preferences are validated per field and then resolved against the
 * current viewport. Resolution never mutates the stored values: a narrow window
 * clamps the effective layout but keeps the user's preference for when the
 * window grows again.
 */

export interface LayoutPreferences {
  sidebarWidth: number;
  tocWidth: number;
  eventLogHeight: number;
  /** Open Documents height as a percentage of the sidebar's usable height. */
  sidebarSplit: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface EffectiveLayout {
  sidebarWidth: number;
  tocWidth: number;
  eventLogHeight: number;
  /** Open Documents fraction, `0.15 … 0.85`. */
  openFraction: number;
  documentMin: number;
}

export interface Bounds {
  min: number;
  max: number;
}

export const DOCUMENT_MIN = 320;

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 600;
export const TOC_MIN = 160;
export const TOC_MAX = 480;
export const EVENT_LOG_MIN = 100;
export const EVENT_LOG_STORED_MAX = 10_000;
export const SPLIT_MIN = 15;
export const SPLIT_MAX = 85;

export const DEFAULT_LAYOUT: Readonly<LayoutPreferences> = Object.freeze({
  sidebarWidth: 300,
  tocWidth: 240,
  eventLogHeight: 200,
  sidebarSplit: 50,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sidebarBounds(viewportWidth: number): Bounds {
  return {
    min: SIDEBAR_MIN,
    max: Math.max(
      SIDEBAR_MIN,
      Math.min(SIDEBAR_MAX, Math.floor(viewportWidth / 2)),
    ),
  };
}

export function tocBounds(viewportWidth: number): Bounds {
  return {
    min: TOC_MIN,
    max: Math.max(TOC_MIN, Math.min(TOC_MAX, Math.floor(viewportWidth / 2))),
  };
}

export function eventLogBounds(viewportHeight: number): Bounds {
  return {
    min: EVENT_LOG_MIN,
    max: Math.max(
      EVENT_LOG_MIN,
      Math.min(EVENT_LOG_STORED_MAX, Math.floor(viewportHeight * 0.6)),
    ),
  };
}

export function clampSidebar(value: number, viewportWidth: number): number {
  const bounds = sidebarBounds(viewportWidth);
  return clamp(value, bounds.min, bounds.max);
}

export function clampToc(value: number, viewportWidth: number): number {
  const bounds = tocBounds(viewportWidth);
  return clamp(value, bounds.min, bounds.max);
}

export function clampEventLogHeight(
  value: number,
  viewportHeight: number,
): number {
  const bounds = eventLogBounds(viewportHeight);
  return clamp(value, bounds.min, bounds.max);
}

export function clampSidebarSplit(value: number): number {
  return clamp(value, SPLIT_MIN, SPLIT_MAX);
}

function readRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

/**
 * Decodes a stored `layout` object, validating each field independently. A bad
 * field costs only that field; the others survive.
 */
export function validateLayout(value: unknown): LayoutPreferences {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_LAYOUT };
  const record = value as Record<string, unknown>;

  return {
    sidebarWidth: readRange(
      record.sidebarWidth,
      SIDEBAR_MIN,
      SIDEBAR_MAX,
      DEFAULT_LAYOUT.sidebarWidth,
    ),
    tocWidth: readRange(
      record.tocWidth,
      TOC_MIN,
      TOC_MAX,
      DEFAULT_LAYOUT.tocWidth,
    ),
    eventLogHeight: readRange(
      record.eventLogHeight,
      EVENT_LOG_MIN,
      EVENT_LOG_STORED_MAX,
      DEFAULT_LAYOUT.eventLogHeight,
    ),
    sidebarSplit: readRange(
      record.sidebarSplit,
      SPLIT_MIN,
      SPLIT_MAX,
      DEFAULT_LAYOUT.sidebarSplit,
    ),
  };
}

/** Resolves stored preferences against the current viewport. */
export function resolveLayout(
  preferences: LayoutPreferences,
  viewport: Viewport,
): EffectiveLayout {
  const desiredSidebar = clampSidebar(preferences.sidebarWidth, viewport.width);
  const desiredToc = clampToc(preferences.tocWidth, viewport.width);

  const budget = viewport.width - DOCUMENT_MIN;
  const minimums = SIDEBAR_MIN + TOC_MIN;

  let sidebarWidth: number;
  let tocWidth: number;

  if (desiredSidebar + desiredToc <= budget) {
    sidebarWidth = desiredSidebar;
    tocWidth = desiredToc;
  } else if (budget <= minimums) {
    // The window cannot honour the floor: keep both minima and let the
    // document take the remainder (FR-032 / SC-005).
    sidebarWidth = SIDEBAR_MIN;
    tocWidth = TOC_MIN;
  } else {
    const remaining = budget - minimums;
    const aboveSidebar = Math.max(0, desiredSidebar - SIDEBAR_MIN);
    const aboveToc = Math.max(0, desiredToc - TOC_MIN);
    const totalAbove = aboveSidebar + aboveToc;

    const sidebarShare =
      totalAbove === 0 ? remaining / 2 : (remaining * aboveSidebar) / totalAbove;
    const tocShare =
      totalAbove === 0 ? remaining / 2 : (remaining * aboveToc) / totalAbove;

    sidebarWidth = Math.round(SIDEBAR_MIN + sidebarShare);
    tocWidth = Math.round(TOC_MIN + tocShare);

    // Rounding must not steal a pixel from the document floor.
    const drift = budget - (sidebarWidth + tocWidth);
    if (drift !== 0) {
      sidebarWidth = clamp(sidebarWidth + drift, SIDEBAR_MIN, budget - TOC_MIN);
    }
  }

  return {
    sidebarWidth,
    tocWidth,
    eventLogHeight: clampEventLogHeight(
      preferences.eventLogHeight,
      viewport.height,
    ),
    openFraction: clampSidebarSplit(preferences.sidebarSplit) / 100,
    documentMin: DOCUMENT_MIN,
  };
}
