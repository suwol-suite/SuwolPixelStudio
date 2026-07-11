import { blendPixelInto } from "./blend";
import { RgbaPixelSurface, IndexedPixelSurface, type PixelSurface } from "./surface";
import { getCel, getTilemapCel, onionSkinFrames, type OnionSkinSettings } from "./animation";
import { decodeTileCell } from "./tilemap";
import {
  intersectRect,
  type DocumentSnapshot,
  type FrameId,
  type ImageId,
  type IntRect,
  type LayerId,
  type PixelDocument,
  type Rgba,
  type TilemapImageId,
} from "./types";

export interface PixelSource {
  readonly model: PixelDocument;
  readonly activeFrameId?: FrameId;
  getSurface(imageId: ImageId): PixelSurface;
  getTilemapCells?(tilemapImageId: TilemapImageId): Uint32Array;
}

export interface CompositedRegion {
  readonly rect: IntRect;
  readonly pixels: Uint8Array;
}

export function compositeDocument(source: PixelSource): Uint8Array {
  const { width, height } = source.model.canvas;
  return compositeRegion(source, { x: 0, y: 0, width, height }).pixels;
}

export function compositeFrame(source: PixelSource, frameId: FrameId): Uint8Array {
  const { width, height } = source.model.canvas;
  return compositeRegionForFrame(source, { x: 0, y: 0, width, height }, frameId).pixels;
}

/** Composites only the requested rectangle so interactive strokes do not clone source images. */
export function compositeRegion(source: PixelSource, requested: IntRect): CompositedRegion {
  const frameId = source.activeFrameId ?? source.model.frameOrder[0];
  if (frameId === undefined) throw new Error("Document has no frame.");
  return compositeRegionForFrame(source, requested, frameId);
}

export function compositeRegionForFrame(
  source: PixelSource,
  requested: IntRect,
  frameId: FrameId,
  onlyLayerId?: string,
): CompositedRegion {
  const rect = intersectRect(requested, { x: 0, y: 0, width: source.model.canvas.width, height: source.model.canvas.height }),
    output = new Uint8Array(rect.width * rect.height * 4);
  if (onlyLayerId !== undefined) renderLayer(source, onlyLayerId, frameId, rect, output, 1);
  else for (const layerId of source.model.rootLayerIds) renderLayer(source, layerId, frameId, rect, output, 1);
  return { rect, pixels: output };
}

function renderLayer(
  source: PixelSource,
  layerId: LayerId,
  frameId: FrameId,
  rect: IntRect,
  target: Uint8Array,
  inheritedOpacity: number,
): void {
  const layer = source.model.layers[layerId];
  if (layer === undefined || !layer.visible || layer.opacity <= 0) return;
  if (layer.kind === "group") {
    const isolated = new Uint8Array(target.length);
    for (const childId of layer.childIds) renderLayer(source, childId, frameId, rect, isolated, 1);
    compositeBuffer(target, isolated, layer.blendMode, inheritedOpacity * layer.opacity);
    return;
  }
  if (layer.kind === "pixel") {
    const cel = getCel(source.model, layerId, frameId);
    if (cel === null || cel.opacity <= 0) return;
    const surface = source.getSurface(cel.imageId), opacity = inheritedOpacity * layer.opacity * cel.opacity;
    for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
      const sourceX = rect.x + x - cel.x, sourceY = rect.y + y - cel.y;
      if (sourceX < 0 || sourceY < 0 || sourceX >= surface.width || sourceY >= surface.height) continue;
      blendPixelInto(target, (y * rect.width + x) * 4, surface.getPixel(sourceX, sourceY), 0, layer.blendMode, opacity);
    }
    return;
  }
  const cel = getTilemapCel(source.model, layerId, frameId), tileSet = source.model.tileSets[layer.tileSetId];
  if (cel === null || cel.opacity <= 0 || tileSet === undefined || source.getTilemapCells === undefined) return;
  const meta = source.model.tilemaps[cel.tilemapImageId], cells = source.getTilemapCells(cel.tilemapImageId), atlas = source.getSurface(tileSet.atlasImageId);
  if (meta === undefined || cells.length !== meta.widthInTiles * meta.heightInTiles) return;
  const opacity = inheritedOpacity * layer.opacity * cel.opacity;
  for (let mapY = 0; mapY < meta.heightInTiles; mapY += 1) for (let mapX = 0; mapX < meta.widthInTiles; mapX += 1) {
    const decoded = decodeTileCell(cells[mapY * meta.widthInTiles + mapX] ?? 0);
    if (decoded.tileId === null || decoded.tileId >= tileSet.tileCount) continue;
    const atlasX = (decoded.tileId % tileSet.columns) * tileSet.tileWidth + (tileSet.margin ?? 0) + (decoded.tileId % tileSet.columns) * (tileSet.spacing ?? 0),
      atlasY = Math.floor(decoded.tileId / tileSet.columns) * tileSet.tileHeight + (tileSet.margin ?? 0) + Math.floor(decoded.tileId / tileSet.columns) * (tileSet.spacing ?? 0);
    for (let py = 0; py < tileSet.tileHeight; py += 1) for (let px = 0; px < tileSet.tileWidth; px += 1) {
      const transformed = transformTileCoordinate(px, py, tileSet.tileWidth, tileSet.tileHeight, decoded.flipX, decoded.flipY, decoded.rotation),
        documentX = cel.x + mapX * tileSet.tileWidth + px, documentY = cel.y + mapY * tileSet.tileHeight + py,
        outputX = documentX - rect.x, outputY = documentY - rect.y;
      if (outputX < 0 || outputY < 0 || outputX >= rect.width || outputY >= rect.height) continue;
      blendPixelInto(target, (outputY * rect.width + outputX) * 4, atlas.getPixel(atlasX + transformed.x, atlasY + transformed.y), 0, layer.blendMode, opacity);
    }
  }
}

function transformTileCoordinate(x: number, y: number, width: number, height: number, flipX: boolean, flipY: boolean, rotation: 0 | 1 | 2 | 3): Readonly<{ x: number; y: number }> {
  let tx = flipX ? width - 1 - x : x, ty = flipY ? height - 1 - y : y;
  if (rotation === 1) [tx, ty] = [ty, width - 1 - tx];
  else if (rotation === 2) [tx, ty] = [width - 1 - tx, height - 1 - ty];
  else if (rotation === 3) [tx, ty] = [height - 1 - ty, tx];
  return { x: tx, y: ty };
}

function compositeBuffer(target: Uint8Array, source: Uint8Array, mode: PixelDocument["layers"][string]["blendMode"], opacity: number): void {
  for (let offset = 0; offset < source.length; offset += 4) blendPixelInto(target, offset, source, offset, mode, opacity);
}

export function compositeSnapshot(snapshot: DocumentSnapshot): Uint8Array {
  return compositeDocument({
    model: snapshot.model,
    getSurface(imageId) {
      const bytes = snapshot.images.get(imageId), meta = snapshot.model.images[imageId];
      if (bytes === undefined || meta === undefined) throw new Error("Snapshot image is missing.");
      return meta.format === "indexed8"
        ? new IndexedPixelSurface(meta.width, meta.height, bytes, snapshot.model.palette.entries.map((entry) => entry.rgba), snapshot.model.palette.transparentIndex ?? 0)
        : new RgbaPixelSurface(meta.width, meta.height, bytes);
    },
    getTilemapCells(tilemapImageId) {
      const cells = snapshot.tilemaps?.get(tilemapImageId);
      if (cells === undefined) throw new Error("Snapshot tilemap is missing.");
      return cells;
    },
  });
}

export function readCompositePixel(source: PixelSource, x: number, y: number): Rgba | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= source.model.canvas.width || y >= source.model.canvas.height) return null;
  const result = compositeRegion(source, { x, y, width: 1, height: 1 }).pixels;
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0, result[3] ?? 0];
}

export function compositeOnionSkin(source: PixelSource, activeFrameId: FrameId, settings: OnionSkinSettings, activeLayerId?: string): Uint8Array {
  const { width, height } = source.model.canvas, result = new Uint8Array(width * height * 4), frames = onionSkinFrames(source.model.frameOrder, activeFrameId, settings), layer = settings.source === "activeLayer" ? activeLayerId : undefined;
  const compositeSide = (ids: readonly FrameId[], opacity: number, tint: Rgba | null) => {
    ids.forEach((frameId, index) => {
      const pixels = compositeRegionForFrame(source, { x: 0, y: 0, width, height }, frameId, layer).pixels, distanceOpacity = opacity / Math.max(1, ids.length - index);
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (tint !== null && (pixels[offset + 3] ?? 0) > 0) { pixels[offset] = Math.round(((pixels[offset] ?? 0) + tint[0]) / 2); pixels[offset + 1] = Math.round(((pixels[offset + 1] ?? 0) + tint[1]) / 2); pixels[offset + 2] = Math.round(((pixels[offset + 2] ?? 0) + tint[2]) / 2); }
        blendPixelInto(result, offset, pixels, offset, "normal", distanceOpacity);
      }
    });
  };
  compositeSide(frames.previous, settings.previousOpacity, settings.previousTint);
  compositeSide(frames.next, settings.nextOpacity, settings.nextTint);
  const current = compositeFrame(source, activeFrameId);
  compositeBuffer(result, current, "normal", 1);
  return result;
}

export function hashSnapshot(snapshot: DocumentSnapshot): string {
  let hash = 2166136261;
  const update = (byte: number) => { hash ^= byte; hash = Math.imul(hash, 16777619) >>> 0; };
  const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : typeof value !== "object" || value === null ? value : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  const model = { ...snapshot.model, revision: 0, palette: { ...snapshot.model.palette, colors: undefined }, layerOrder: undefined }, metadata = JSON.stringify(canonicalize(model));
  for (const byte of new TextEncoder().encode(metadata)) update(byte);
  for (const imageId of Object.keys(snapshot.model.images).sort()) { const bytes = snapshot.images.get(imageId); if (bytes === undefined) throw new Error("Snapshot image is missing."); for (const byte of bytes) update(byte); }
  for (const tilemapId of Object.keys(snapshot.model.tilemaps).sort()) { const cells = snapshot.tilemaps?.get(tilemapId); if (cells === undefined) throw new Error("Snapshot tilemap is missing."); const view = new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength); for (const byte of view) update(byte); }
  return hash.toString(16).padStart(8, "0");
}
