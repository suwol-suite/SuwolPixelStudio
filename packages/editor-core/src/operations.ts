import {
  FunctionalCommand,
  PixelPatchCommand,
  TransactionCommand,
} from "./history";
import type { EditorSession } from "./session";
import { BitSelectionMask, type SelectionMask } from "./selection";
import { IndexedPixelSurface } from "./surface";
import {
  normalizeRgba,
  unionRect,
  type IntPoint,
  type IntRect,
  type LayerId,
  type Rgba,
} from "./types";

export interface FloatingSelection {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly pixels: Uint8Array;
  x: number;
  y: number;
  readonly source: "internal" | "clipboard";
  readonly format?: "rgba8" | "indexed8";
  readonly palette?: readonly Rgba[];
  readonly transparentIndex?: number;
}
export interface FloodFillComputation {
  readonly rect: IntRect;
  readonly pixels: Uint8Array;
}

export type ResizeAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export function applyRasterPoints(
  session: EditorSession,
  layerId: LayerId,
  points: readonly IntPoint[],
  color: Rgba,
  selection: SelectionMask | null,
  label: string,
): boolean {
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId),
    normalized = normalizeRgba(color);
  if (surface instanceof IndexedPixelSurface) {
    const paletteIndex = surface.indexForColor(normalized), unique = new Set<number>();
    let indexedBounds: IntRect | null = null;
    for (const point of points) {
      const x = Math.round(point.x), y = Math.round(point.y);
      if (x < 0 || y < 0 || x >= surface.width || y >= surface.height || selection !== null && !selection.contains(x, y)) continue;
      const index = y * surface.width + x;
      if (unique.has(index)) continue;
      unique.add(index);
      if (surface.getIndex(x, y) !== paletteIndex) indexedBounds = unionRect(indexedBounds, { x, y, width: 1, height: 1 });
    }
    if (indexedBounds === null) return false;
    const before = surface.readRegion(indexedBounds), after = before.slice();
    for (const index of unique) {
      const x = index % surface.width, y = Math.floor(index / surface.width);
      if (x >= indexedBounds.x && y >= indexedBounds.y && x < indexedBounds.x + indexedBounds.width && y < indexedBounds.y + indexedBounds.height)
        after[(y - indexedBounds.y) * indexedBounds.width + x - indexedBounds.x] = paletteIndex;
    }
    session.applyPixelPatch(layerId, indexedBounds, before, after, label);
    return true;
  }
  const unique = new Set<number>();
  let bounds: IntRect | null = null;
  for (const point of points) {
    const x = Math.round(point.x),
      y = Math.round(point.y);
    if (
      x < 0 ||
      y < 0 ||
      x >= surface.width ||
      y >= surface.height ||
      (selection !== null && !selection.contains(x, y))
    )
      continue;
    const index = y * surface.width + x;
    if (unique.has(index)) continue;
    unique.add(index);
    if (!equalColor(surface.getPixel(x, y), normalized))
      bounds = unionRect(bounds, { x, y, width: 1, height: 1 });
  }
  if (bounds === null) return false;
  const before = surface.readRegion(bounds),
    after = before.slice();
  for (const index of unique) {
    const x = index % surface.width,
      y = Math.floor(index / surface.width);
    if (
      x < bounds.x ||
      y < bounds.y ||
      x >= bounds.x + bounds.width ||
      y >= bounds.y + bounds.height
    )
      continue;
    after.set(normalized, ((y - bounds.y) * bounds.width + x - bounds.x) * 4);
  }
  session.applyPixelPatch(layerId, bounds, before, after, label);
  return true;
}

export function floodFill(
  session: EditorSession,
  layerId: LayerId,
  start: IntPoint,
  color: Rgba,
  selection: SelectionMask | null,
  label = "Flood Fill",
): IntRect | null {
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId),
    x0 = Math.round(start.x),
    y0 = Math.round(start.y);
  if (
    x0 < 0 ||
    y0 < 0 ||
    x0 >= surface.width ||
    y0 >= surface.height ||
    (selection !== null && !selection.contains(x0, y0))
  )
    return null;
  if (surface instanceof IndexedPixelSurface) {
    const result = computeFloodFillIndices(
      surface.getBytes(), surface.width, surface.height, { x: x0, y: y0 },
      surface.indexForColor(color),
      selection === null ? undefined : (x, y) => selection.contains(x, y),
    );
    if (result === null) return null;
    const before = surface.readRegion(result.rect);
    session.applyPixelPatch(layerId, result.rect, before, result.pixels, label);
    return result.rect;
  }
  const result = computeFloodFillBytes(
    surface.readRegion({
      x: 0,
      y: 0,
      width: surface.width,
      height: surface.height,
    }),
    surface.width,
    surface.height,
    { x: x0, y: y0 },
    color,
    selection === null ? undefined : (x, y) => selection.contains(x, y),
  );
  if (result === null) return null;
  commitFloodFillComputation(session, layerId, result, label);
  return result.rect;
}

export function computeFloodFillIndices(
  working: Uint8Array,
  width: number,
  height: number,
  start: IntPoint,
  replacement: number,
  contains?: (x: number, y: number) => boolean,
): FloodFillComputation | null {
  if (working.length !== width * height || !Number.isInteger(replacement) || replacement < 0 || replacement > 255)
    throw new RangeError("Indexed fill input is invalid.");
  const x0 = Math.round(start.x), y0 = Math.round(start.y);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height || contains !== undefined && !contains(x0, y0)) return null;
  const target = working[y0 * width + x0] ?? 0;
  if (target === replacement) return null;
  const matches = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && (contains === undefined || contains(x, y)) && working[y * width + x] === target;
  const stack = [x0, y0]; let bounds: IntRect | null = null;
  while (stack.length > 0) {
    const y = stack.pop(), seedX = stack.pop();
    if (y === undefined || seedX === undefined || !matches(seedX, y)) continue;
    let x = seedX; while (x > 0 && matches(x - 1, y)) x -= 1;
    let up = false, down = false;
    for (; x < width && matches(x, y); x += 1) {
      working[y * width + x] = replacement; bounds = unionRect(bounds, { x, y, width: 1, height: 1 });
      if (y > 0) { if (matches(x, y - 1)) { if (!up) stack.push(x, y - 1); up = true; } else up = false; }
      if (y + 1 < height) { if (matches(x, y + 1)) { if (!down) stack.push(x, y + 1); down = true; } else down = false; }
    }
  }
  if (bounds === null) return null;
  const pixels = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) pixels.set(working.subarray((bounds.y + y) * width + bounds.x, (bounds.y + y) * width + bounds.x + bounds.width), y * bounds.width);
  return { rect: bounds, pixels };
}

/** Mutates the supplied detached snapshot and returns only the minimal changed patch. */
export function computeFloodFillBytes(
  working: Uint8Array,
  width: number,
  height: number,
  start: IntPoint,
  color: Rgba,
  contains?: (x: number, y: number) => boolean,
): FloodFillComputation | null {
  validateRgba(working, width, height);
  const x0 = Math.round(start.x),
    y0 = Math.round(start.y);
  if (
    x0 < 0 ||
    y0 < 0 ||
    x0 >= width ||
    y0 >= height ||
    (contains !== undefined && !contains(x0, y0))
  )
    return null;
  const target = readColor(working, (y0 * width + x0) * 4),
    replacement = normalizeRgba(color);
  if (equalColor(target, replacement)) return null;
  const matches = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    (contains === undefined || contains(x, y)) &&
    equalBytes(working, (y * width + x) * 4, target);
  const stack: number[] = [x0, y0];
  let bounds: IntRect | null = null;
  while (stack.length > 0) {
    const y = stack.pop(),
      seedX = stack.pop();
    if (y === undefined || seedX === undefined || !matches(seedX, y)) continue;
    let x = seedX;
    while (x > 0 && matches(x - 1, y)) x -= 1;
    let spanUp = false,
      spanDown = false;
    for (; x < width && matches(x, y); x += 1) {
      working.set(replacement, (y * width + x) * 4);
      bounds = unionRect(bounds, { x, y, width: 1, height: 1 });
      if (y > 0) {
        if (matches(x, y - 1)) {
          if (!spanUp) {
            stack.push(x, y - 1);
            spanUp = true;
          }
        } else spanUp = false;
      }
      if (y < height - 1) {
        if (matches(x, y + 1)) {
          if (!spanDown) {
            stack.push(x, y + 1);
            spanDown = true;
          }
        } else spanDown = false;
      }
    }
  }
  if (bounds === null) return null;
  return { rect: bounds, pixels: extractRegion(working, width, bounds) };
}

export function commitFloodFillComputation(
  session: EditorSession,
  layerId: LayerId,
  result: FloodFillComputation,
  label = "Flood Fill",
): boolean {
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId);
  const expected = result.rect.width * result.rect.height * (surface.format === "rgba8" ? 4 : 1);
  if (result.pixels.byteLength !== expected)
    throw new RangeError("Flood fill result length is invalid.");
  const before = surface.readRegion(result.rect);
  if (equalArrays(before, result.pixels)) return false;
  session.applyPixelPatch(layerId, result.rect, before, result.pixels, label);
  return true;
}

export function copyPixels(
  session: EditorSession,
  layerId: LayerId,
  selection: SelectionMask | null,
  source: FloatingSelection["source"] = "internal",
): FloatingSelection {
  requiredLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId),
    bounds = selection?.bounds ?? {
      x: 0,
      y: 0,
      width: surface.width,
      height: surface.height,
    };
  if (bounds.width === 0 || bounds.height === 0)
    throw new Error("There are no pixels to copy.");
  const pixels = surface.readRegion(bounds);
  if (selection !== null)
    for (let y = 0; y < bounds.height; y += 1)
      for (let x = 0; x < bounds.width; x += 1)
        if (!selection.contains(bounds.x + x, bounds.y + y)) {
          if (surface instanceof IndexedPixelSurface)
            pixels[y * bounds.width + x] = session.model.palette.transparentIndex ?? 0;
          else pixels.fill(0, (y * bounds.width + x) * 4, (y * bounds.width + x + 1) * 4);
        }
  return {
    sourceWidth: bounds.width,
    sourceHeight: bounds.height,
    pixels,
    x: bounds.x,
    y: bounds.y,
    source,
    format: surface.format,
    ...(surface instanceof IndexedPixelSurface
      ? { palette: session.model.palette.entries.map((entry) => entry.rgba), transparentIndex: session.model.palette.transparentIndex ?? 0 }
      : {}),
  };
}

export function deleteSelectedPixels(
  session: EditorSession,
  layerId: LayerId,
  selection: SelectionMask,
  label = "Delete Selection",
): boolean {
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId),
    bounds = selection.bounds;
  if (bounds === null) return false;
  const before = surface.readRegion(bounds),
    after = before.slice();
  let changed = false;
  for (let y = 0; y < bounds.height; y += 1)
    for (let x = 0; x < bounds.width; x += 1)
      if (selection.contains(bounds.x + x, bounds.y + y)) {
        const stride = surface.format === "rgba8" ? 4 : 1,
          offset = (y * bounds.width + x) * stride,
          nonEmpty = surface instanceof IndexedPixelSurface
            ? after[offset] !== (session.model.palette.transparentIndex ?? 0)
            : after[offset + 3] !== 0;
        if (nonEmpty) {
          if (surface instanceof IndexedPixelSurface)
            after[offset] = session.model.palette.transparentIndex ?? 0;
          else after.fill(0, offset, offset + 4);
          changed = true;
        }
      }
  if (!changed) return false;
  session.applyPixelPatch(layerId, bounds, before, after, label);
  return true;
}

export function commitFloatingSelection(
  session: EditorSession,
  layerId: LayerId,
  floating: FloatingSelection,
  label = "Paste",
): boolean {
  validateFloatingSelection(floating);
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId);
  const target = {
    x: Math.max(0, floating.x),
    y: Math.max(0, floating.y),
    width: Math.max(
      0,
      Math.min(surface.width, floating.x + floating.sourceWidth) -
        Math.max(0, floating.x),
    ),
    height: Math.max(
      0,
      Math.min(surface.height, floating.y + floating.sourceHeight) -
        Math.max(0, floating.y),
    ),
  };
  if (target.width === 0 || target.height === 0) return false;
  const before = surface.readRegion(target),
    after = before.slice();
  let changed = false;
  for (let y = 0; y < target.height; y += 1)
    for (let x = 0; x < target.width; x += 1) {
      const sx = target.x - floating.x + x,
        sy = target.y - floating.y + y;
      if (surface instanceof IndexedPixelSurface) {
        const targetOffset = y * target.width + x;
        let paletteIndex: number;
        if (floating.format === "indexed8") {
          const sourceIndex = floating.pixels[sy * floating.sourceWidth + sx] ?? 0;
          if (sourceIndex === (floating.transparentIndex ?? 0)) continue;
          const color = floating.palette?.[sourceIndex];
          if (color === undefined) throw new RangeError("Indexed clipboard palette is incomplete.");
          paletteIndex = surface.indexForColor(color);
        } else {
          const sourceOffset = (sy * floating.sourceWidth + sx) * 4;
          if ((floating.pixels[sourceOffset + 3] ?? 0) === 0) continue;
          paletteIndex = surface.indexForColor([
            floating.pixels[sourceOffset] ?? 0,
            floating.pixels[sourceOffset + 1] ?? 0,
            floating.pixels[sourceOffset + 2] ?? 0,
            floating.pixels[sourceOffset + 3] ?? 0,
          ]);
        }
        if (after[targetOffset] !== paletteIndex) {
          after[targetOffset] = paletteIndex;
          changed = true;
        }
      } else {
        const targetOffset = (y * target.width + x) * 4;
        let pixel: Uint8Array;
        if (floating.format === "indexed8") {
          const sourceIndex = floating.pixels[sy * floating.sourceWidth + sx] ?? 0;
          if (sourceIndex === (floating.transparentIndex ?? 0)) continue;
          const color = floating.palette?.[sourceIndex];
          if (color === undefined) throw new RangeError("Indexed clipboard palette is incomplete.");
          pixel = Uint8Array.from(color);
        } else {
          const sourceOffset = (sy * floating.sourceWidth + sx) * 4;
          if ((floating.pixels[sourceOffset + 3] ?? 0) === 0) continue;
          pixel = floating.pixels.subarray(sourceOffset, sourceOffset + 4);
        }
        if (!equalBytes(after, targetOffset, pixel)) {
          after.set(pixel, targetOffset);
          changed = true;
        }
      }
    }
  if (!changed) return false;
  session.applyPixelPatch(layerId, target, before, after, label);
  return true;
}

export function movePixels(
  session: EditorSession,
  layerId: LayerId,
  selection: SelectionMask | null,
  dx: number,
  dy: number,
  label = "Move Pixels",
  onSelectionMove?: (dx: number, dy: number) => void,
): boolean {
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (dx === 0 && dy === 0) return false;
  editableLayer(session, layerId);
  const surface = session.getActiveSurfaceForRead(layerId),
    sourceBounds =
      selection === null
        ? { x: 0, y: 0, width: surface.width, height: surface.height }
        : selection.bounds;
  if (sourceBounds === null) return false;
  const destination = {
    x: sourceBounds.x + dx,
    y: sourceBounds.y + dy,
    width: sourceBounds.width,
    height: sourceBounds.height,
  };
  const canvas = { x: 0, y: 0, width: surface.width, height: surface.height };
  const clippedSource = clipRect(sourceBounds, canvas),
    clippedDestination = clipRect(destination, canvas);
  const dirty = unionRect(clippedSource, clippedDestination);
  if (dirty === null || dirty.width === 0 || dirty.height === 0) return false;
  const sourcePixels = surface.readRegion(sourceBounds),
    before = surface.readRegion(dirty),
    after = before.slice(),
    stride = surface.format === "rgba8" ? 4 : 1,
    transparent = surface instanceof IndexedPixelSurface
      ? session.model.palette.transparentIndex ?? 0
      : 0;
  const selected = (x: number, y: number) =>
    selection === null || selection.contains(x, y);
  const write = (x: number, y: number, pixel: Uint8Array) => {
    if (
      x < dirty.x ||
      y < dirty.y ||
      x >= dirty.x + dirty.width ||
      y >= dirty.y + dirty.height
    )
      return;
    after.set(pixel, ((y - dirty.y) * dirty.width + x - dirty.x) * stride);
  };
  for (let y = 0; y < sourceBounds.height; y += 1)
    for (let x = 0; x < sourceBounds.width; x += 1) {
      const sx = sourceBounds.x + x,
        sy = sourceBounds.y + y;
      if (selected(sx, sy)) write(sx, sy, Uint8Array.of(transparent, ...(stride === 4 ? [0, 0, 0] : [])));
    }
  for (let y = 0; y < sourceBounds.height; y += 1)
    for (let x = 0; x < sourceBounds.width; x += 1) {
      const sx = sourceBounds.x + x,
        sy = sourceBounds.y + y;
      if (selected(sx, sy))
        write(
          sx + dx,
          sy + dy,
          sourcePixels.subarray(
            (y * sourceBounds.width + x) * stride,
            (y * sourceBounds.width + x + 1) * stride,
          ),
        );
    }
  if (equalArrays(before, after)) return false;
  const activeCel = session.getActiveCel(layerId);
  if (activeCel === null) {
    session.applyPixelPatch(layerId, dirty, before, after, label);
    if (selection !== null && onSelectionMove !== undefined)
      onSelectionMove(dx, dy);
    return true;
  }
  const pixelCommand = new PixelPatchCommand(label, {
    imageId: activeCel.imageId,
    rect: dirty,
    before,
    after,
  });
  if (selection !== null && onSelectionMove !== undefined) {
    const selectionCommand = new FunctionalCommand(
      "selection.move",
      "Move Selection",
      1,
      () => onSelectionMove(dx, dy),
      () => onSelectionMove(-dx, -dy),
    );
    session.execute(
      new TransactionCommand(label, [pixelCommand, selectionCommand]),
    );
  } else session.execute(pixelCommand);
  return true;
}

export function resizeNearestRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8Array {
  validateRgba(source, sourceWidth, sourceHeight);
  validateDimensions(width, height);
  const result = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(
          sourceWidth - 1,
          Math.floor((x * sourceWidth) / width),
        ),
        sy = Math.min(
          sourceHeight - 1,
          Math.floor((y * sourceHeight) / height),
        ),
        sourceOffset = (sy * sourceWidth + sx) * 4,
        targetOffset = (y * width + x) * 4;
      result.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      if (result[targetOffset + 3] === 0)
        result.fill(0, targetOffset, targetOffset + 4);
    }
  return result;
}

export function resizeNearestIndexed(source: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number): Uint8Array {
  if (source.byteLength !== sourceWidth * sourceHeight) throw new RangeError("Indexed byte length does not match image dimensions.");
  validateDimensions(width, height);
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const sx = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width)), sy = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height)); result[y * width + x] = source[sy * sourceWidth + sx] ?? 0; }
  return result;
}

export function canvasResizeRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  fill: Rgba,
): Uint8Array {
  validateRgba(source, sourceWidth, sourceHeight);
  validateDimensions(width, height);
  const result = new Uint8Array(width * height * 4),
    normalized = normalizeRgba(fill);
  for (let offset = 0; offset < result.length; offset += 4)
    result.set(normalized, offset);
  for (let sy = 0; sy < sourceHeight; sy += 1)
    for (let sx = 0; sx < sourceWidth; sx += 1) {
      const dx = sx + offsetX,
        dy = sy + offsetY;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
      result.set(
        source.subarray(
          (sy * sourceWidth + sx) * 4,
          (sy * sourceWidth + sx + 1) * 4,
        ),
        (dy * width + dx) * 4,
      );
    }
  return result;
}

export function canvasResizeIndexed(source: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number, offsetX: number, offsetY: number, fillIndex: number): Uint8Array {
  if (source.byteLength !== sourceWidth * sourceHeight || !Number.isInteger(fillIndex) || fillIndex < 0 || fillIndex > 255) throw new RangeError("Indexed resize input is invalid.");
  validateDimensions(width, height);
  const result = new Uint8Array(width * height).fill(fillIndex);
  for (let sy = 0; sy < sourceHeight; sy += 1) for (let sx = 0; sx < sourceWidth; sx += 1) { const dx = sx + offsetX, dy = sy + offsetY; if (dx >= 0 && dy >= 0 && dx < width && dy < height) result[dy * width + dx] = source[sy * sourceWidth + sx] ?? fillIndex; }
  return result;
}

export function anchorOffset(
  anchor: ResizeAnchor,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): IntPoint {
  const horizontal = anchor.endsWith("left")
      ? 0
      : anchor.endsWith("right")
        ? width - sourceWidth
        : Math.floor((width - sourceWidth) / 2),
    vertical = anchor.startsWith("top")
      ? 0
      : anchor.startsWith("bottom")
        ? height - sourceHeight
        : Math.floor((height - sourceHeight) / 2);
  return { x: horizontal, y: vertical };
}

export function selectionForFloating(
  floating: FloatingSelection,
  canvasWidth: number,
  canvasHeight: number,
): BitSelectionMask {
  validateFloatingSelection(floating);
  const mask = new BitSelectionMask(canvasWidth, canvasHeight);
  mask.setRect(
    {
      x: floating.x,
      y: floating.y,
      width: floating.sourceWidth,
      height: floating.sourceHeight,
    },
    "replace",
  );
  return mask;
}
export function validateFloatingSelection(input: FloatingSelection): void {
  if (input.format === "indexed8") {
    validateDimensions(input.sourceWidth, input.sourceHeight);
    if (input.pixels.byteLength !== input.sourceWidth * input.sourceHeight)
      throw new RangeError("Indexed floating selection length is invalid.");
    if (input.palette === undefined || input.palette.length === 0 || input.palette.length > 256)
      throw new RangeError("Indexed floating selection palette is invalid.");
    for (const index of input.pixels)
      if (index >= input.palette.length) throw new RangeError("Indexed floating selection contains an invalid palette index.");
  } else validateRgba(input.pixels, input.sourceWidth, input.sourceHeight);
  if (!Number.isInteger(input.x) || !Number.isInteger(input.y))
    throw new RangeError("Floating selection position must be integral.");
}

function editableLayer(session: EditorSession, layerId: LayerId) {
  const layer = requiredLayer(session, layerId);
  if (layer.locked || !layer.visible)
    throw new Error("The active layer cannot be edited.");
  return layer;
}
function requiredLayer(session: EditorSession, layerId: LayerId) {
  const layer = session.model.layers[layerId];
  if (layer === undefined) throw new Error("Layer does not exist.");
  return layer;
}
function equalColor(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
function equalBytes(
  bytes: Uint8Array,
  offset: number,
  color: ArrayLike<number>,
): boolean {
  return (
    bytes[offset] === color[0] &&
    bytes[offset + 1] === color[1] &&
    bytes[offset + 2] === color[2] &&
    bytes[offset + 3] === color[3]
  );
}
function equalArrays(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
function readColor(bytes: Uint8Array, offset: number): Rgba {
  return [
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  ];
}
function extractRegion(
  bytes: Uint8Array,
  width: number,
  rect: IntRect,
): Uint8Array {
  const result = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const start = ((rect.y + y) * width + rect.x) * 4;
    result.set(
      bytes.subarray(start, start + rect.width * 4),
      y * rect.width * 4,
    );
  }
  return result;
}
function clipRect(rect: IntRect, bounds: IntRect): IntRect {
  const x = Math.max(rect.x, bounds.x),
    y = Math.max(rect.y, bounds.y),
    right = Math.min(rect.x + rect.width, bounds.x + bounds.width),
    bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}
function validateDimensions(width: number, height: number): void {
  const bytes = width * height * 4;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    !Number.isSafeInteger(bytes) ||
    bytes > 256 * 1024 * 1024
  )
    throw new RangeError("Image dimensions exceed the supported limit.");
}
function validateRgba(bytes: Uint8Array, width: number, height: number): void {
  validateDimensions(width, height);
  if (bytes.byteLength !== width * height * 4)
    throw new RangeError("RGBA byte length does not match image dimensions.");
}
