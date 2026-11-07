import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  DOCUMENT_MIN,
  clampEventLogHeight,
  clampSidebar,
  clampSidebarSplit,
  clampToc,
  eventLogBounds,
  resolveLayout,
  sidebarBounds,
  tocBounds,
  validateLayout,
  type LayoutPreferences,
} from "./layout-model";

function layout(overrides: Partial<LayoutPreferences> = {}): LayoutPreferences {
  return { ...DEFAULT_LAYOUT, ...overrides };
}

describe("layout defaults and bounds", () => {
  it("exposes the documented defaults", () => {
    expect(DEFAULT_LAYOUT).toEqual({
      sidebarWidth: 300,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
    expect(DOCUMENT_MIN).toBe(320);
  });

  it("bounds the sidebar by its static maximum and half the window", () => {
    expect(sidebarBounds(1000)).toEqual({ min: 200, max: 500 });
    expect(sidebarBounds(1600)).toEqual({ min: 200, max: 600 });
    expect(clampSidebar(50, 1600)).toBe(200);
    expect(clampSidebar(900, 1600)).toBe(600);
    expect(clampSidebar(700, 1000)).toBe(500);
  });

  it("bounds the outline by its static maximum and half the window", () => {
    expect(tocBounds(1000)).toEqual({ min: 160, max: 480 });
    expect(tocBounds(800)).toEqual({ min: 160, max: 400 });
    expect(clampToc(50, 1000)).toBe(160);
    expect(clampToc(900, 1000)).toBe(480);
    expect(clampToc(900, 800)).toBe(400);
  });

  it("bounds the event log height between 100 px and 60% of the window", () => {
    expect(eventLogBounds(800)).toEqual({ min: 100, max: 480 });
    expect(clampEventLogHeight(50, 800)).toBe(100);
    expect(clampEventLogHeight(4000, 800)).toBe(480);
    expect(clampEventLogHeight(240, 800)).toBe(240);
  });

  it("bounds the sidebar split between 15 and 85 percent", () => {
    expect(clampSidebarSplit(5)).toBe(15);
    expect(clampSidebarSplit(95)).toBe(85);
    expect(clampSidebarSplit(50)).toBe(50);
  });
});

describe("validateLayout", () => {
  it("returns defaults for a missing or non-object payload", () => {
    expect(validateLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(validateLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(validateLayout("nope")).toEqual(DEFAULT_LAYOUT);
  });

  it("falls back per field without discarding the valid fields", () => {
    expect(
      validateLayout({
        sidebarWidth: 420,
        tocWidth: "wide",
        eventLogHeight: NaN,
        sidebarSplit: 120,
      }),
    ).toEqual({
      sidebarWidth: 420,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
  });

  it("rejects non-finite and out-of-range values", () => {
    expect(
      validateLayout({
        sidebarWidth: Infinity,
        tocWidth: -1,
        eventLogHeight: 20_000,
        sidebarSplit: 0,
      }),
    ).toEqual(DEFAULT_LAYOUT);
  });
});

describe("resolveLayout", () => {
  it("uses the stored sizes when both panes fit", () => {
    const effective = resolveLayout(layout(), { width: 1000, height: 800 });
    expect(effective.sidebarWidth).toBe(300);
    expect(effective.tocWidth).toBe(240);
    expect(effective.eventLogHeight).toBe(200);
    expect(effective.openFraction).toBe(0.5);
    expect(effective.documentMin).toBe(320);
  });

  it("keeps a 320 px document floor at 700 px", () => {
    const effective = resolveLayout(layout(), { width: 700, height: 800 });
    expect(effective.sidebarWidth + effective.tocWidth).toBe(700 - 320);
    expect(effective.sidebarWidth).toBeGreaterThanOrEqual(200);
    expect(effective.tocWidth).toBeGreaterThanOrEqual(160);
  });

  it("keeps both pane minima at 680 px", () => {
    const effective = resolveLayout(layout(), { width: 680, height: 800 });
    expect(effective.sidebarWidth).toBe(200);
    expect(effective.tocWidth).toBe(160);
  });

  it("gives the document the remainder when below 680 px", () => {
    const effective = resolveLayout(layout(), { width: 640, height: 800 });
    expect(effective.sidebarWidth).toBe(200);
    expect(effective.tocWidth).toBe(160);
    expect(
      640 - effective.sidebarWidth - effective.tocWidth,
    ).toBeLessThan(DOCUMENT_MIN);
  });

  it("clamps the log height to 60% of the window", () => {
    expect(
      resolveLayout(layout({ eventLogHeight: 4000 }), {
        width: 1000,
        height: 800,
      }).eventLogHeight,
    ).toBe(480);
    expect(
      resolveLayout(layout({ eventLogHeight: 50 }), {
        width: 1000,
        height: 800,
      }).eventLogHeight,
    ).toBe(100);
  });

  it("clamps the split fraction", () => {
    expect(
      resolveLayout(layout({ sidebarSplit: 5 }), { width: 1000, height: 800 })
        .openFraction,
    ).toBe(0.15);
    expect(
      resolveLayout(layout({ sidebarSplit: 100 }), { width: 1000, height: 800 })
        .openFraction,
    ).toBe(0.85);
  });

  it("never mutates the stored preference", () => {
    const stored = layout({ sidebarWidth: 500, eventLogHeight: 3000 });
    const snapshot = { ...stored };
    resolveLayout(stored, { width: 700, height: 800 });
    expect(stored).toEqual(snapshot);
  });

  it("clamps the effective size on a narrow window without overwriting", () => {
    const stored = layout({ sidebarWidth: 500 });
    const effective = resolveLayout(stored, { width: 700, height: 800 });

    expect(effective.sidebarWidth).toBeLessThan(500);
    expect(stored.sidebarWidth).toBe(500);
  });
});
