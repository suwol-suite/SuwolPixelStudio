import { intersectRect, unionRect, type IntPoint, type IntRect, type TilemapPatch } from "./types";

export const TILE_ID_MASK = 0x0fff_ffff;
export const TILE_FLIP_X = 0x1000_0000;
export const TILE_FLIP_Y = 0x2000_0000;
export const TILE_ROTATE_MASK = 0xc000_0000;
export const TILE_ROTATE_SHIFT = 30;
export const EMPTY_TILE = 0;

export interface TileCell {
  readonly tileId: number | null;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly rotation: 0 | 1 | 2 | 3;
}

export function encodeTileCell(cell: TileCell): number {
  if (cell.tileId === null) return EMPTY_TILE;
  if (!Number.isInteger(cell.tileId) || cell.tileId < 0 || cell.tileId >= TILE_ID_MASK)
    throw new RangeError("Tile id is outside the tile32 range.");
  if (![0, 1, 2, 3].includes(cell.rotation)) throw new RangeError("Tile rotation is invalid.");
  return (((cell.tileId + 1) & TILE_ID_MASK) |
    (cell.flipX ? TILE_FLIP_X : 0) |
    (cell.flipY ? TILE_FLIP_Y : 0) |
    (cell.rotation << TILE_ROTATE_SHIFT)) >>> 0;
}

export function decodeTileCell(value: number): TileCell {
  const encoded = value >>> 0, storedId = encoded & TILE_ID_MASK;
  return {
    tileId: storedId === 0 ? null : storedId - 1,
    flipX: (encoded & TILE_FLIP_X) !== 0,
    flipY: (encoded & TILE_FLIP_Y) !== 0,
    rotation: ((encoded & TILE_ROTATE_MASK) >>> TILE_ROTATE_SHIFT) as 0 | 1 | 2 | 3,
  };
}

export function tilemapToLittleEndian(cells: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(cells.length * 4), view = new DataView(bytes.buffer);
  for (let index = 0; index < cells.length; index += 1) view.setUint32(index * 4, cells[index] ?? 0, true);
  return bytes;
}

export function tilemapFromLittleEndian(bytes: Uint8Array): Uint32Array {
  if (bytes.byteLength % 4 !== 0) throw new RangeError("tile32 blob length must be divisible by four.");
  const cells = new Uint32Array(bytes.byteLength / 4), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < cells.length; index += 1) cells[index] = view.getUint32(index * 4, true);
  return cells;
}

export class TilemapSurface {
  readonly width: number;
  readonly height: number;
  readonly #cells: Uint32Array;

  constructor(width: number, height: number, cells?: Uint32Array) {
    const length = checkedTilemapLength(width, height);
    if (cells !== undefined && cells.length !== length) throw new RangeError("Tilemap cell length is invalid.");
    this.width = width;
    this.height = height;
    this.#cells = cells?.slice() ?? new Uint32Array(length);
  }
  get(x: number, y: number): number { this.#assertPoint(x, y); return this.#cells[y * this.width + x] ?? EMPTY_TILE; }
  set(x: number, y: number, value: number): boolean {
    if (!inside(this, x, y)) return false;
    const encoded = value >>> 0, offset = y * this.width + x;
    if (this.#cells[offset] === encoded) return false;
    this.#cells[offset] = encoded;
    return true;
  }
  readRegion(rect: IntRect): Uint32Array {
    const clipped = clipTileRect(rect, this.width, this.height), result = new Uint32Array(clipped.width * clipped.height);
    for (let row = 0; row < clipped.height; row += 1) result.set(this.#cells.subarray((clipped.y + row) * this.width + clipped.x, (clipped.y + row) * this.width + clipped.x + clipped.width), row * clipped.width);
    return result;
  }
  writeRegion(rect: IntRect, cells: Uint32Array): IntRect {
    if (cells.length !== rect.width * rect.height) throw new RangeError("Tilemap patch length is invalid.");
    const clipped = clipTileRect(rect, this.width, this.height);
    for (let row = 0; row < clipped.height; row += 1) {
      const source = (clipped.y - rect.y + row) * rect.width + clipped.x - rect.x;
      this.#cells.set(cells.subarray(source, source + clipped.width), (clipped.y + row) * this.width + clipped.x);
    }
    return clipped;
  }
  floodFill(start: IntPoint, replacement: number): TilemapPatch | null {
    const x0 = Math.round(start.x), y0 = Math.round(start.y);
    if (!inside(this, x0, y0)) return null;
    const target = this.get(x0, y0), next = replacement >>> 0;
    if (target === next) return null;
    const beforeAll = this.#cells.slice(), stack: number[] = [x0, y0];
    let bounds: IntRect | null = null;
    const matches = (x: number, y: number) => inside(this, x, y) && this.#cells[y * this.width + x] === target;
    while (stack.length > 0) {
      const y = stack.pop(), seedX = stack.pop();
      if (y === undefined || seedX === undefined || !matches(seedX, y)) continue;
      let x = seedX;
      while (x > 0 && matches(x - 1, y)) x -= 1;
      let up = false, down = false;
      for (; x < this.width && matches(x, y); x += 1) {
        this.#cells[y * this.width + x] = next;
        bounds = unionRect(bounds, { x, y, width: 1, height: 1 });
        if (y > 0) { if (matches(x, y - 1)) { if (!up) stack.push(x, y - 1); up = true; } else up = false; }
        if (y + 1 < this.height) { if (matches(x, y + 1)) { if (!down) stack.push(x, y + 1); down = true; } else down = false; }
      }
    }
    if (bounds === null) return null;
    const after = this.readRegion(bounds), before = extractTileRegion(beforeAll, this.width, bounds);
    return { tilemapImageId: "detached", rect: bounds, before, after };
  }
  clone(): TilemapSurface { return new TilemapSurface(this.width, this.height, this.#cells); }
  getCells(): Uint32Array { return this.#cells.slice(); }
  #assertPoint(x: number, y: number): void { if (!inside(this, x, y)) throw new RangeError("Tile coordinate is outside the map."); }
}

export function visibleTileRange(
  viewport: IntRect,
  tileWidth: number,
  tileHeight: number,
  mapWidth: number,
  mapHeight: number,
  origin: IntPoint = { x: 0, y: 0 },
): IntRect {
  if (tileWidth < 1 || tileHeight < 1) throw new RangeError("Tile dimensions must be positive.");
  const x = Math.floor((viewport.x - origin.x) / tileWidth), y = Math.floor((viewport.y - origin.y) / tileHeight),
    right = Math.ceil((viewport.x + viewport.width - origin.x) / tileWidth), bottom = Math.ceil((viewport.y + viewport.height - origin.y) / tileHeight);
  return intersectRect({ x, y, width: right - x, height: bottom - y }, { x: 0, y: 0, width: mapWidth, height: mapHeight });
}

export function validateTileIds(cells: Uint32Array, tileCount: number): void {
  if (!Number.isInteger(tileCount) || tileCount < 1) throw new RangeError("Tile count is invalid.");
  for (const encoded of cells) { const { tileId } = decodeTileCell(encoded); if (tileId !== null && tileId >= tileCount) throw new RangeError("Tilemap references an undefined tile."); }
}

function checkedTilemapLength(width: number, height: number): number {
  const length = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || !Number.isSafeInteger(length) || length * 4 > 256 * 1024 * 1024) throw new RangeError("Tilemap dimensions exceed the supported limit.");
  return length;
}
function clipTileRect(rect: IntRect, width: number, height: number): IntRect {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.width < 0 || rect.height < 0) throw new RangeError("Tile rectangle is invalid.");
  return intersectRect(rect, { x: 0, y: 0, width, height });
}
function inside(surface: Readonly<{ width: number; height: number }>, x: number, y: number): boolean { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < surface.width && y < surface.height; }
function extractTileRegion(cells: Uint32Array, width: number, rect: IntRect): Uint32Array { const result = new Uint32Array(rect.width * rect.height); for (let y = 0; y < rect.height; y += 1) result.set(cells.subarray((rect.y + y) * width + rect.x, (rect.y + y) * width + rect.x + rect.width), y * rect.width); return result; }
