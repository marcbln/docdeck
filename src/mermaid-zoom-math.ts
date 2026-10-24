/** A point in viewport (CSS pixel) coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A width/height pair in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * The stage transform: `translate(x, y) scale(scale)` with a top-left origin.
 * `x`/`y` are offsets of the diagram's top-left corner inside the viewport.
 */
export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

const MIN_NATURAL_SCALE = 0.1;
const MAX_NATURAL_SCALE = 8;

export function clampScale(scale: number, limits: ScaleLimits): number {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/**
 * Scale limits around a fit scale.
 *
 * The absolute floor is 10% of natural size, but an enormous diagram may need
 * to fit below that; allow zooming out to half the fit scale in that case so
 * the reader can never get stuck above the overview.
 */
export function scaleLimits(fitWhole: number): ScaleLimits {
  return {
    min: Math.min(MIN_NATURAL_SCALE, fitWhole / 2),
    max: MAX_NATURAL_SCALE,
  };
}

/** Largest scale that shows the whole diagram without upscaling it. */
export function fitWholeScale(natural: Size, viewport: Size): number {
  if (
    natural.width <= 0 ||
    natural.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return 1;
  }
  return Math.min(
    1,
    viewport.width / natural.width,
    viewport.height / natural.height,
  );
}

/** Largest scale that fits the diagram's width without upscaling it. */
export function fitWidthScale(natural: Size, viewport: Size): number {
  if (natural.width <= 0 || viewport.width <= 0) return 1;
  return Math.min(1, viewport.width / natural.width);
}

/** Height the viewport needs to show a fit-width diagram without clipping. */
export function fittedHeight(natural: Size, viewport: Size): number {
  return natural.height * fitWidthScale(natural, viewport);
}

export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.002);
}

/** Zooms around a fixed point so the content under it does not move. */
export function zoomAtPoint(
  transform: ZoomTransform,
  point: Point,
  factor: number,
  limits: ScaleLimits,
): ZoomTransform {
  const scale = clampScale(transform.scale * factor, limits);
  if (scale === transform.scale) return transform;

  const ratio = scale / transform.scale;
  return {
    scale,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
  };
}

/**
 * Keeps the diagram inside its viewport: centred on an axis where it is
 * smaller than the viewport, edge-locked where it is larger.
 */
export function clampTranslation(
  transform: ZoomTransform,
  natural: Size,
  viewport: Size,
): ZoomTransform {
  const contentWidth = natural.width * transform.scale;
  const contentHeight = natural.height * transform.scale;

  const x =
    contentWidth <= viewport.width
      ? (viewport.width - contentWidth) / 2
      : Math.min(0, Math.max(viewport.width - contentWidth, transform.x));

  const y =
    contentHeight <= viewport.height
      ? (viewport.height - contentHeight) / 2
      : Math.min(0, Math.max(viewport.height - contentHeight, transform.y));

  return { ...transform, x, y };
}

/** A centred transform for a fit mode. */
export function centeredTransform(
  natural: Size,
  viewport: Size,
  scale: number,
): ZoomTransform {
  return clampTranslation({ scale, x: 0, y: 0 }, natural, viewport);
}

/** The content coordinate currently at the viewport's centre. */
export function contentPointAtViewportCenter(
  transform: ZoomTransform,
  viewport: Size,
): Point {
  return {
    x: (viewport.width / 2 - transform.x) / transform.scale,
    y: (viewport.height / 2 - transform.y) / transform.scale,
  };
}

/** A transform that puts a content point at the viewport centre. */
export function centerOnContentPoint(
  point: Point,
  scale: number,
  viewport: Size,
  natural: Size,
): ZoomTransform {
  return clampTranslation(
    {
      scale,
      x: viewport.width / 2 - point.x * scale,
      y: viewport.height / 2 - point.y * scale,
    },
    natural,
    viewport,
  );
}
