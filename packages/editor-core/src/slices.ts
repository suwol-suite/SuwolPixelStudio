import type { IntPoint, IntRect, SliceDefinition } from "./types";

export function validateSlice(slice: SliceDefinition, canvasWidth: number, canvasHeight: number): void {
  validateRect(slice.bounds, canvasWidth, canvasHeight, "Slice bounds");
  if (slice.center !== undefined) {
    validateRect(slice.center, canvasWidth, canvasHeight, "9-slice center");
    if (!containsRect(slice.bounds, slice.center)) throw new RangeError("9-slice center must be inside slice bounds.");
  }
  if (slice.pivot !== undefined && !containsPoint(slice.bounds, slice.pivot))
    throw new RangeError("Slice pivot must be inside slice bounds.");
}

export function normalizeSlice(slice: SliceDefinition, canvasWidth: number, canvasHeight: number): SliceDefinition {
  const normalized: SliceDefinition = {
    ...slice,
    name: slice.name.trim() || "Slice",
    bounds: normalizeRect(slice.bounds),
    ...(slice.center === undefined ? {} : { center: normalizeRect(slice.center) }),
    ...(slice.pivot === undefined ? {} : { pivot: { x: Math.round(slice.pivot.x), y: Math.round(slice.pivot.y) } }),
  };
  validateSlice(normalized, canvasWidth, canvasHeight);
  return normalized;
}
function normalizeRect(rect: IntRect): IntRect { return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; }
function validateRect(rect: IntRect, width: number, height: number, label: string): void { if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.width < 1 || rect.height < 1 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) throw new RangeError(`${label} is outside the canvas.`); }
function containsRect(outer: IntRect, inner: IntRect): boolean { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function containsPoint(rect: IntRect, point: IntPoint): boolean { return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height; }
