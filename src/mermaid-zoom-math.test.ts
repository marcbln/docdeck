import { describe, expect, it } from "vitest";

import {
  centerOnContentPoint,
  clampScale,
  clampTranslation,
  contentPointAtViewportCenter,
  fitWholeScale,
  fitWidthScale,
  fittedHeight,
  scaleLimits,
  wheelZoomFactor,
  zoomAtPoint,
} from "./mermaid-zoom-math";

const NATURAL = { width: 1600, height: 800 };
const VIEWPORT = { width: 800, height: 600 };

describe("fit scales", () => {
  it("fits width without upscaling a small diagram", () => {
    expect(fitWidthScale({ width: 400, height: 200 }, VIEWPORT)).toBe(1);
  });

  it("scales a wide diagram down to the viewport width", () => {
    expect(fitWidthScale(NATURAL, VIEWPORT)).toBe(0.5);
  });

  it("fits the whole diagram inside both axes", () => {
    expect(fitWholeScale(NATURAL, VIEWPORT)).toBe(0.5);
    expect(fitWholeScale({ width: 1600, height: 1200 }, VIEWPORT)).toBe(0.5);
    expect(fitWholeScale({ width: 1600, height: 2000 }, VIEWPORT)).toBe(0.3);
  });

  it("computes the viewport height for a fit-width diagram", () => {
    expect(fittedHeight(NATURAL, VIEWPORT)).toBe(400);
  });

  it("falls back to natural size without a usable measurement", () => {
    expect(fitWidthScale(NATURAL, { width: 0, height: 0 })).toBe(1);
    expect(fitWholeScale({ width: 0, height: 0 }, VIEWPORT)).toBe(1);
  });
});

describe("scale limits", () => {
  it("allows a 10% floor for ordinary diagrams", () => {
    expect(scaleLimits(0.5)).toEqual({ min: 0.1, max: 8 });
  });

  it("lowers the floor for an enormous diagram that fits below 10%", () => {
    expect(scaleLimits(0.02).min).toBe(0.01);
  });

  it("clamps scales into the interval", () => {
    expect(clampScale(0.001, { min: 0.1, max: 8 })).toBe(0.1);
    expect(clampScale(12, { min: 0.1, max: 8 })).toBe(8);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the content under the cursor fixed", () => {
    const start = { scale: 1, x: 0, y: 0 };
    const point = { x: 200, y: 100 };
    const zoomed = zoomAtPoint(start, point, 2, { min: 0.1, max: 8 });

    const contentBefore = {
      x: (point.x - start.x) / start.scale,
      y: (point.y - start.y) / start.scale,
    };
    const contentAfter = {
      x: (point.x - zoomed.x) / zoomed.scale,
      y: (point.y - zoomed.y) / zoomed.scale,
    };

    expect(zoomed.scale).toBe(2);
    expect(contentAfter.x).toBeCloseTo(contentBefore.x);
    expect(contentAfter.y).toBeCloseTo(contentBefore.y);
  });

  it("returns the same transform when the limit is already reached", () => {
    const start = { scale: 8, x: 10, y: 20 };
    expect(
      zoomAtPoint(start, { x: 0, y: 0 }, 2, { min: 0.1, max: 8 }),
    ).toBe(start);
  });
});

describe("translation clamping", () => {
  it("centres content smaller than the viewport", () => {
    const next = clampTranslation(
      { scale: 0.5, x: 0, y: 0 },
      NATURAL,
      VIEWPORT,
    );
    expect(next.x).toBe(0);
    expect(next.y).toBe(100);
  });

  it("prevents a large diagram from leaving the viewport", () => {
    const pulledIn = clampTranslation(
      { scale: 1, x: 500, y: 300 },
      NATURAL,
      VIEWPORT,
    );
    expect(pulledIn.x).toBe(0);
    expect(pulledIn.y).toBe(0);

    const draggedOut = clampTranslation(
      { scale: 1, x: -2000, y: -2000 },
      NATURAL,
      VIEWPORT,
    );
    expect(draggedOut.x).toBe(VIEWPORT.width - NATURAL.width);
    expect(draggedOut.y).toBe(VIEWPORT.height - NATURAL.height);
  });
});

describe("fullscreen hand-off", () => {
  it("round-trips the content point at the viewport centre", () => {
    const natural = { width: 400, height: 200 };
    const start = { scale: 2, x: 0, y: 100 };
    const point = contentPointAtViewportCenter(start, VIEWPORT);
    const larger = { width: 1200, height: 900 };
    const next = centerOnContentPoint(point, 2, larger, natural);
    const roundTrip = contentPointAtViewportCenter(next, larger);

    expect(roundTrip.x).toBeCloseTo(point.x);
    expect(roundTrip.y).toBeCloseTo(point.y);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in for negative deltas and out for positive ones", () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
