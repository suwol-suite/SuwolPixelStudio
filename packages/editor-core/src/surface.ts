import {
  intersectRect,
  normalizeRgba,
  type DirtyRegion,
  type ImageFormat,
  type IntRect,
  type Rgba,
} from "./types";

export const MAX_CANVAS_DIMENSION = 8_192;
export const MAX_SURFACE_BYTES = 256 * 1024 * 1024;

export interface PixelSurface {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Rgba;
  setPixel(x: number, y: number, color: Rgba): DirtyRegion | null;
  readRegion(rect: IntRect): Uint8Array;
  writeRegion(rect: IntRect, bytes: Uint8Array): DirtyRegion;
  clearRegion(rect: IntRect): DirtyRegion;
  clone(): PixelSurface;
  getBytes(): Uint8Array;
}

function checkedByteLength(width: number, height: number, stride: 1 | 4): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new RangeError("Surface dimensions must be positive integers.");
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION)
    throw new RangeError("Surface dimensions exceed the supported limit.");
  const bytes = width * height * stride;
  if (!Number.isSafeInteger(bytes) || bytes > MAX_SURFACE_BYTES)
    throw new RangeError("Surface allocation exceeds the supported limit.");
  return bytes;
}

function checkedRegionLength(rect: IntRect, stride: 1 | 4): number {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) ||
    rect.width < 0 ||
    rect.height < 0
  )
    throw new RangeError(
      "Region must use integer coordinates and non-negative dimensions.",
    );
  const bytes = rect.width * rect.height * stride;
  if (!Number.isSafeInteger(bytes) || bytes > MAX_SURFACE_BYTES)
    throw new RangeError("Region is too large.");
  return bytes;
}

abstract class BasePixelSurface {
  abstract readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;

  protected constructor(width: number, height: number, stride: 1 | 4) {
    checkedByteLength(width, height, stride);
    this.width = width;
    this.height = height;
  }

  protected clip(rect: IntRect): IntRect {
    return intersectRect(rect, {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    });
  }

  protected assertPoint(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height
    )
      throw new RangeError("Pixel coordinate is outside the surface.");
  }
}

export class RgbaPixelSurface extends BasePixelSurface implements PixelSurface {
  readonly format = "rgba8" as const;
  readonly #bytes: Uint8Array;

  constructor(width: number, height: number, bytes?: Uint8Array) {
    super(width, height, 4);
    const byteLength = checkedByteLength(width, height, 4);
    if (bytes !== undefined && bytes.byteLength !== byteLength)
      throw new RangeError(
        "Pixel byte length does not match the surface dimensions.",
      );
    this.#bytes = bytes === undefined ? new Uint8Array(byteLength) : bytes.slice();
    for (let offset = 0; offset < this.#bytes.length; offset += 4)
      if (this.#bytes[offset + 3] === 0)
        this.#bytes.fill(0, offset, offset + 4);
  }

  getPixel(x: number, y: number): Rgba {
    this.assertPoint(x, y);
    const offset = (y * this.width + x) * 4;
    return [
      this.#bytes[offset] ?? 0,
      this.#bytes[offset + 1] ?? 0,
      this.#bytes[offset + 2] ?? 0,
      this.#bytes[offset + 3] ?? 0,
    ];
  }

  setPixel(x: number, y: number, color: Rgba): DirtyRegion | null {
    if (!inside(this, x, y)) return null;
    const normalized = normalizeRgba(color),
      offset = (y * this.width + x) * 4;
    if (normalized.every((value, index) => this.#bytes[offset + index] === value))
      return null;
    this.#bytes.set(normalized, offset);
    return { x, y, width: 1, height: 1 };
  }

  readRegion(rect: IntRect): Uint8Array {
    checkedRegionLength(rect, 4);
    const clipped = this.clip(rect),
      result = new Uint8Array(clipped.width * clipped.height * 4);
    for (let row = 0; row < clipped.height; row += 1) {
      const sourceOffset = ((clipped.y + row) * this.width + clipped.x) * 4;
      result.set(
        this.#bytes.subarray(sourceOffset, sourceOffset + clipped.width * 4),
        row * clipped.width * 4,
      );
    }
    return result;
  }

  writeRegion(rect: IntRect, rgba: Uint8Array): DirtyRegion {
    const expectedLength = checkedRegionLength(rect, 4);
    if (rgba.byteLength !== expectedLength)
      throw new RangeError("Region byte length does not match its dimensions.");
    const clipped = this.clip(rect);
    for (let row = 0; row < clipped.height; row += 1)
      for (let column = 0; column < clipped.width; column += 1) {
        const sourceX = clipped.x - rect.x + column,
          sourceY = clipped.y - rect.y + row,
          sourceOffset = (sourceY * rect.width + sourceX) * 4,
          targetOffset = ((clipped.y + row) * this.width + clipped.x + column) * 4,
          alpha = rgba[sourceOffset + 3] ?? 0;
        if (alpha === 0) this.#bytes.fill(0, targetOffset, targetOffset + 4);
        else this.#bytes.set(rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    return clipped;
  }

  clearRegion(rect: IntRect): DirtyRegion {
    checkedRegionLength(rect, 4);
    const clipped = this.clip(rect);
    for (let row = 0; row < clipped.height; row += 1) {
      const offset = ((clipped.y + row) * this.width + clipped.x) * 4;
      this.#bytes.fill(0, offset, offset + clipped.width * 4);
    }
    return clipped;
  }

  clone(): RgbaPixelSurface {
    return new RgbaPixelSurface(this.width, this.height, this.#bytes);
  }
  getBytes(): Uint8Array {
    return this.#bytes.slice();
  }
}

/** One-byte-per-pixel surface. RGBA lookup is a view and is never stored. */
export class IndexedPixelSurface extends BasePixelSurface implements PixelSurface {
  readonly format = "indexed8" as const;
  readonly #indices: Uint8Array;
  #palette: readonly Rgba[];
  #transparentIndex: number;

  constructor(
    width: number,
    height: number,
    indices?: Uint8Array,
    palette: readonly Rgba[] = [[0, 0, 0, 0]],
    transparentIndex = 0,
  ) {
    super(width, height, 1);
    const byteLength = checkedByteLength(width, height, 1);
    if (indices !== undefined && indices.byteLength !== byteLength)
      throw new RangeError("Index byte length does not match the surface dimensions.");
    this.#indices = indices === undefined
      ? new Uint8Array(byteLength).fill(transparentIndex)
      : indices.slice();
    this.#palette = palette.map(normalizeRgba);
    this.#transparentIndex = checkedIndex(transparentIndex);
    this.#validateIndices();
  }

  updatePalette(palette: readonly Rgba[], transparentIndex: number): void {
    if (palette.length < 1 || palette.length > 256)
      throw new RangeError("Indexed palette must contain 1 to 256 entries.");
    this.#palette = palette.map(normalizeRgba);
    this.#transparentIndex = checkedIndex(transparentIndex);
    this.#validateIndices();
  }

  getIndex(x: number, y: number): number {
    this.assertPoint(x, y);
    return this.#indices[y * this.width + x] ?? this.#transparentIndex;
  }

  setIndex(x: number, y: number, index: number): DirtyRegion | null {
    if (!inside(this, x, y)) return null;
    const normalized = checkedIndex(index);
    if (normalized >= this.#palette.length)
      throw new RangeError("Palette index is not defined.");
    const offset = y * this.width + x;
    if (this.#indices[offset] === normalized) return null;
    this.#indices[offset] = normalized;
    return { x, y, width: 1, height: 1 };
  }

  getPixel(x: number, y: number): Rgba {
    const index = this.getIndex(x, y);
    if (index === this.#transparentIndex) return [0, 0, 0, 0];
    return this.#palette[index] ?? [0, 0, 0, 0];
  }

  setPixel(x: number, y: number, color: Rgba): DirtyRegion | null {
    const normalized = normalizeRgba(color);
    return this.setIndex(x, y, this.indexForColor(normalized));
  }

  indexForColor(color: Rgba): number {
    const normalized = normalizeRgba(color);
    if (normalized[3] === 0) return this.#transparentIndex;
    let best = 0,
      bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.#palette.length; index += 1) {
      if (index === this.#transparentIndex) continue;
      const candidate = this.#palette[index] ?? [0, 0, 0, 0],
        distance = colorDistance(normalized, candidate);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  readRegion(rect: IntRect): Uint8Array {
    checkedRegionLength(rect, 1);
    const clipped = this.clip(rect),
      result = new Uint8Array(clipped.width * clipped.height);
    for (let row = 0; row < clipped.height; row += 1) {
      const sourceOffset = (clipped.y + row) * this.width + clipped.x;
      result.set(
        this.#indices.subarray(sourceOffset, sourceOffset + clipped.width),
        row * clipped.width,
      );
    }
    return result;
  }

  writeRegion(rect: IntRect, indices: Uint8Array): DirtyRegion {
    const expectedLength = checkedRegionLength(rect, 1);
    if (indices.byteLength !== expectedLength)
      throw new RangeError("Region index length does not match its dimensions.");
    for (const index of indices)
      if (index >= this.#palette.length)
        throw new RangeError("Region contains an undefined palette index.");
    const clipped = this.clip(rect);
    for (let row = 0; row < clipped.height; row += 1) {
      const sourceX = clipped.x - rect.x,
        sourceY = clipped.y - rect.y + row,
        sourceOffset = sourceY * rect.width + sourceX,
        targetOffset = (clipped.y + row) * this.width + clipped.x;
      this.#indices.set(
        indices.subarray(sourceOffset, sourceOffset + clipped.width),
        targetOffset,
      );
    }
    return clipped;
  }

  clearRegion(rect: IntRect): DirtyRegion {
    checkedRegionLength(rect, 1);
    const clipped = this.clip(rect);
    for (let row = 0; row < clipped.height; row += 1) {
      const offset = (clipped.y + row) * this.width + clipped.x;
      this.#indices.fill(this.#transparentIndex, offset, offset + clipped.width);
    }
    return clipped;
  }

  clone(): IndexedPixelSurface {
    return new IndexedPixelSurface(
      this.width,
      this.height,
      this.#indices,
      this.#palette,
      this.#transparentIndex,
    );
  }
  getBytes(): Uint8Array {
    return this.#indices.slice();
  }

  #validateIndices(): void {
    if (this.#palette.length < 1 || this.#palette.length > 256)
      throw new RangeError("Indexed palette must contain 1 to 256 entries.");
    if (this.#transparentIndex >= this.#palette.length)
      throw new RangeError("Transparent index is not defined by the palette.");
    for (const index of this.#indices)
      if (index >= this.#palette.length)
        throw new RangeError("Surface contains an undefined palette index.");
  }
}

function checkedIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 255)
    throw new RangeError("Palette index must be between 0 and 255.");
  return index;
}
function inside(surface: Readonly<{ width: number; height: number }>, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < surface.width && y < surface.height;
}
function colorDistance(left: Rgba, right: Rgba): number {
  const red = left[0] - right[0],
    green = left[1] - right[1],
    blue = left[2] - right[2],
    alpha = left[3] - right[3];
  return red * red * 2 + green * green * 4 + blue * blue * 3 + alpha * alpha;
}
