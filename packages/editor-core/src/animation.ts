import type { DocumentState } from "./document";
import type {
  Cel,
  FrameId,
  ImageId,
  PixelCel,
  LayerId,
  PixelDocument,
  Rgba,
  TagId,
  TilemapCel,
} from "./types";
import { BLEND_MODES, isPixelCel, isTilemapCel } from "./types";

export const DEFAULT_FRAME_DURATION_MS = 100;
export const MIN_FRAME_DURATION_MS = 10;
export const MAX_FRAME_DURATION_MS = 60_000;

export function celKey(layerId: LayerId, frameId: FrameId): string {
  return `${layerId.length}:${layerId}${frameId}`;
}

export function getCel(
  model: PixelDocument,
  layerId: LayerId,
  frameId: FrameId,
): PixelCel | null {
  const id = model.celByLayerAndFrame[celKey(layerId, frameId)];
  const cel = id === undefined ? undefined : model.cels[id];
  return cel !== undefined && isPixelCel(cel) ? cel : null;
}

export function getTilemapCel(
  model: PixelDocument,
  layerId: LayerId,
  frameId: FrameId,
): TilemapCel | null {
  const id = model.celByLayerAndFrame[celKey(layerId, frameId)];
  const cel = id === undefined ? undefined : model.cels[id];
  return cel !== undefined && isTilemapCel(cel) ? cel : null;
}

export function getAnyCel(
  model: PixelDocument,
  layerId: LayerId,
  frameId: FrameId,
): Cel | null {
  const id = model.celByLayerAndFrame[celKey(layerId, frameId)];
  return id === undefined ? null : (model.cels[id] ?? null);
}

export function requireFrameDuration(value: number): number {
  const duration = Math.round(value);
  if (
    !Number.isFinite(value) ||
    duration < MIN_FRAME_DURATION_MS ||
    duration > MAX_FRAME_DURATION_MS
  )
    throw new RangeError("Frame duration must be between 10 and 60000 ms.");
  return duration;
}

export function imageReferenceCounts(
  model: PixelDocument,
): ReadonlyMap<ImageId, number> {
  const counts = new Map<ImageId, number>();
  for (const cel of Object.values(model.cels))
    if (isPixelCel(cel))
      counts.set(cel.imageId, (counts.get(cel.imageId) ?? 0) + 1);
  return counts;
}

export function recountImageReferences(model: PixelDocument): void {
  const counts = imageReferenceCounts(model);
  for (const image of Object.values(model.images))
    image.refCount = counts.get(image.id) ?? 0;
  const tilemapCounts = new Map<string, number>();
  for (const cel of Object.values(model.cels))
    if (isTilemapCel(cel))
      tilemapCounts.set(cel.tilemapImageId, (tilemapCounts.get(cel.tilemapImageId) ?? 0) + 1);
  for (const tilemap of Object.values(model.tilemaps))
    tilemap.refCount = tilemapCounts.get(tilemap.id) ?? 0;
}

export function retainImage(model: PixelDocument, imageId: ImageId): void {
  const image = model.images[imageId];
  if (image === undefined) throw new Error("Cannot retain a missing image.");
  image.refCount += 1;
}

export function releaseImage(model: PixelDocument, imageId: ImageId): void {
  const image = model.images[imageId];
  if (image === undefined || image.refCount < 1)
    throw new Error("Cannot release an unreferenced image.");
  image.refCount -= 1;
}

export function collectUnreachableImages(state: DocumentState): ImageId[] {
  recountImageReferences(state.model);
  const removed: ImageId[] = [];
  for (const [imageId, image] of Object.entries(state.model.images))
    if (image.refCount === 0) {
      Reflect.deleteProperty(state.model.images, imageId);
      state.surfaces.delete(imageId);
      removed.push(imageId);
    }
  return removed;
}

export interface IntegrityResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateDocumentIntegrity(model: PixelDocument): IntegrityResult {
  const errors: string[] = [];
  const frameIds = new Set(model.frameOrder);
  const allLayerIds = Object.keys(model.layers),
    layerIds = new Set(allLayerIds),
    rootIds = new Set(model.rootLayerIds);
  if (model.frameOrder.length < 1) errors.push("Document must contain a frame.");
  if (frameIds.size !== model.frameOrder.length)
    errors.push("Frame order contains duplicate ids.");
  if (new Set(model.layerOrder).size !== model.layerOrder.length)
    errors.push("Layer order contains duplicate ids.");
  for (const id of model.frameOrder) {
    const frame = model.frames[id];
    if (frame?.id !== id) errors.push(`Frame ${id} is missing.`);
    else {
      try {
        requireFrameDuration(frame.durationMs);
      } catch {
        errors.push(`Frame ${id} has an invalid duration.`);
      }
    }
  }
  if (rootIds.size !== model.rootLayerIds.length)
    errors.push("Root layer order contains duplicate ids.");
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string, parentId: string | null): void => {
    const layer = model.layers[id];
    if (layer?.id !== id) {
      errors.push(`Layer ${id} is invalid.`);
      return;
    }
    if (layer.parentId !== parentId)
      errors.push(`Layer ${id} has an inconsistent parent.`);
    if (!BLEND_MODES.includes(layer.blendMode))
      errors.push(`Layer ${id} has an invalid blend mode.`);
    if (visiting.has(id)) {
      errors.push("Layer tree contains a cycle.");
      return;
    }
    if (visited.has(id)) {
      errors.push(`Layer ${id} has multiple parents.`);
      return;
    }
    visiting.add(id);
    if (layer.kind === "group")
      for (const childId of layer.childIds) visit(childId, id);
    if (layer.kind === "tilemap" && model.tileSets[layer.tileSetId] === undefined)
      errors.push(`Tilemap layer ${id} references a missing tile set.`);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of model.rootLayerIds) visit(id, null);
  for (const id of allLayerIds)
    if (!visited.has(id)) errors.push(`Layer ${id} is unreachable.`);
  if (
    model.layerOrder.length !== visited.size ||
    model.layerOrder.some((id) => !visited.has(id))
  ) errors.push("Flattened layer adapter is inconsistent.");
  const seenKeys = new Set<string>();
  for (const [id, cel] of Object.entries(model.cels)) {
    const key = celKey(cel.layerId, cel.frameId);
    if (cel.id !== id) errors.push(`Cel ${id} has a mismatched id.`);
    if (!layerIds.has(cel.layerId)) errors.push(`Cel ${id} references a missing layer.`);
    if (!frameIds.has(cel.frameId)) errors.push(`Cel ${id} references a missing frame.`);
    const layer = model.layers[cel.layerId];
    if (layer?.kind === "group") errors.push(`Group layer ${cel.layerId} cannot have a cel.`);
    if (isPixelCel(cel)) {
      if (layer?.kind !== "pixel") errors.push(`Pixel cel ${id} is on a non-pixel layer.`);
      if (model.images[cel.imageId] === undefined)
        errors.push(`Cel ${id} references a missing image.`);
    } else {
      if (layer?.kind !== "tilemap") errors.push(`Tilemap cel ${id} is on a non-tilemap layer.`);
      if (model.tilemaps[cel.tilemapImageId] === undefined)
        errors.push(`Cel ${id} references a missing tilemap image.`);
    }
    if (!Number.isInteger(cel.x) || !Number.isInteger(cel.y))
      errors.push(`Cel ${id} has a non-integral position.`);
    if (!Number.isFinite(cel.opacity) || cel.opacity < 0 || cel.opacity > 1)
      errors.push(`Cel ${id} has invalid opacity.`);
    if (seenKeys.has(key)) errors.push(`Multiple cels occupy ${key}.`);
    seenKeys.add(key);
    if (model.celByLayerAndFrame[key] !== id)
      errors.push(`Cel lookup for ${id} is inconsistent.`);
  }
  for (const [key, id] of Object.entries(model.celByLayerAndFrame))
    if (model.cels[id] === undefined || !seenKeys.has(key))
      errors.push(`Cel lookup ${key} is orphaned.`);
  const counts = imageReferenceCounts(model);
  for (const [id, image] of Object.entries(model.images)) {
    if (image.id !== id || image.width < 1 || image.height < 1)
      errors.push(`Image ${id} metadata is invalid.`);
    if (image.refCount !== (counts.get(id) ?? 0))
      errors.push(`Image ${id} reference count is inconsistent.`);
    const expectedFormat = model.canvas.colorMode === "indexed" ? "indexed8" : "rgba8";
    if (image.format !== expectedFormat)
      errors.push(`Image ${id} format does not match the document color mode.`);
  }
  if (model.palette.entries.length > model.palette.maxSize || model.palette.maxSize > 256)
    errors.push("Palette exceeds its configured size.");
  const paletteIndices = new Set<number>();
  for (const entry of model.palette.entries) {
    if (entry.index < 0 || entry.index > 255 || paletteIndices.has(entry.index))
      errors.push("Palette indices must be unique bytes.");
    paletteIndices.add(entry.index);
  }
  if (model.canvas.colorMode === "indexed") {
    const transparent = model.canvas.transparentIndex;
    if (transparent === undefined || transparent !== model.palette.transparentIndex || !paletteIndices.has(transparent))
      errors.push("Indexed document transparent index is inconsistent.");
  }
  for (const [id, tilemap] of Object.entries(model.tilemaps))
    if (tilemap.id !== id || tilemap.widthInTiles < 1 || tilemap.heightInTiles < 1)
      errors.push(`Tilemap ${id} metadata is invalid.`);
    else if (tilemap.refCount !== Object.values(model.cels).filter((cel) => isTilemapCel(cel) && cel.tilemapImageId === id).length)
      errors.push(`Tilemap ${id} reference count is inconsistent.`);
  for (const [id, tileSet] of Object.entries(model.tileSets)) {
    const atlas = model.images[tileSet.atlasImageId];
    if (tileSet.id !== id || atlas === undefined)
      errors.push(`Tile set ${id} references a missing atlas.`);
    if (![tileSet.tileWidth, tileSet.tileHeight, tileSet.columns, tileSet.tileCount].every((value) => Number.isInteger(value) && value > 0))
      errors.push(`Tile set ${id} dimensions are invalid.`);
    if ((tileSet.spacing ?? 0) < 0 || (tileSet.margin ?? 0) < 0 || tileSet.emptyTileId < 0 || tileSet.emptyTileId >= tileSet.tileCount)
      errors.push(`Tile set ${id} metadata is invalid.`);
  }
  const canvasBounds = { x: 0, y: 0, width: model.canvas.width, height: model.canvas.height };
  const insideCanvas = (rect: { x: number; y: number; width: number; height: number }) =>
    rect.width >= 0 && rect.height >= 0 && rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.width <= canvasBounds.width && rect.y + rect.height <= canvasBounds.height;
  for (const [id, slice] of Object.entries(model.slices)) {
    if (slice.id !== id || !insideCanvas(slice.bounds)) errors.push(`Slice ${id} bounds are invalid.`);
    if (slice.center !== undefined && (
      !insideCanvas(slice.center) ||
      slice.center.x < slice.bounds.x || slice.center.y < slice.bounds.y ||
      slice.center.x + slice.center.width > slice.bounds.x + slice.bounds.width ||
      slice.center.y + slice.center.height > slice.bounds.y + slice.bounds.height
    )) errors.push(`Slice ${id} center is invalid.`);
  }
  for (const [id, tag] of Object.entries(model.tags)) {
    if (
      tag.id !== id ||
      !frameIds.has(tag.fromFrameId) ||
      !frameIds.has(tag.toFrameId)
    )
      errors.push(`Tag ${id} references an invalid range.`);
  }
  return { valid: errors.length === 0, errors };
}

export function assertDocumentIntegrity(model: PixelDocument): void {
  const result = validateDocumentIntegrity(model);
  if (!result.valid) throw new Error(result.errors.join(" "));
}

export interface TimelineVisibleRange {
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}

export function timelineVisibleRange(
  frameCount: number,
  scrollLeft: number,
  viewportWidth: number,
  cellWidth: number,
  overscan = 2,
): TimelineVisibleRange {
  const count = Math.max(0, Math.floor(frameCount));
  if (count === 0) return { start: 0, end: 0, offset: 0 };
  const width = Math.max(1, cellWidth);
  const start = Math.max(0, Math.floor(Math.max(0, scrollLeft) / width) - overscan);
  const end = Math.min(
    count,
    Math.ceil((Math.max(0, scrollLeft) + Math.max(0, viewportWidth)) / width) + overscan,
  );
  return { start, end, offset: start * width };
}

export function updateFrameSelection(
  order: readonly FrameId[],
  current: ReadonlySet<FrameId>,
  anchor: FrameId | null,
  frameId: FrameId,
  mode: "replace" | "range" | "toggle",
): { readonly selected: ReadonlySet<FrameId>; readonly anchor: FrameId } {
  if (!order.includes(frameId)) throw new Error("Selected frame does not exist.");
  if (mode === "replace") return { selected: new Set([frameId]), anchor: frameId };
  if (mode === "toggle") {
    const selected = new Set(current);
    if (selected.has(frameId)) selected.delete(frameId);
    else selected.add(frameId);
    return { selected, anchor: frameId };
  }
  const from = order.indexOf(anchor ?? frameId),
    to = order.indexOf(frameId),
    selected = new Set<FrameId>();
  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const id = order[index];
    if (id !== undefined) selected.add(id);
  }
  return { selected, anchor: anchor ?? frameId };
}

export type PlaybackMode = "loop" | "once" | "pingpong";
export interface PlaybackCursor {
  readonly index: number;
  readonly direction: 1 | -1;
  readonly elapsedInFrame: number;
  readonly isPlaying: boolean;
}

export function advancePlayback(
  durations: readonly number[],
  cursor: PlaybackCursor,
  elapsedMs: number,
  mode: PlaybackMode,
): PlaybackCursor {
  if (durations.length === 0) throw new Error("Playback requires at least one frame.");
  let index = Math.min(durations.length - 1, Math.max(0, cursor.index));
  let direction: 1 | -1 = cursor.direction;
  let remaining = Math.max(0, cursor.elapsedInFrame + Math.min(elapsedMs, 3_600_000));
  let playing = cursor.isPlaying;
  if (!playing || durations.length === 1)
    return { index, direction, elapsedInFrame: remaining % requireFrameDuration(durations[index] ?? 100), isPlaying: playing };
  let guard = 0;
  while (remaining >= requireFrameDuration(durations[index] ?? 100) && guard < 200_000) {
    remaining -= requireFrameDuration(durations[index] ?? 100);
    guard += 1;
    const next = index + direction;
    if (next >= 0 && next < durations.length) index = next;
    else if (mode === "loop") index = direction === 1 ? 0 : durations.length - 1;
    else if (mode === "pingpong") {
      direction = direction === 1 ? -1 : 1;
      index = Math.min(durations.length - 1, Math.max(0, index + direction));
    } else {
      index = direction === 1 ? durations.length - 1 : 0;
      remaining = 0;
      playing = false;
      break;
    }
  }
  return { index, direction, elapsedInFrame: remaining, isPlaying: playing };
}

export function playbackFrameRange(
  model: PixelDocument,
  activeTagId: TagId | null,
): readonly FrameId[] {
  if (activeTagId === null) return model.frameOrder;
  const tag = model.tags[activeTagId];
  if (tag === undefined) return model.frameOrder;
  const from = model.frameOrder.indexOf(tag.fromFrameId),
    to = model.frameOrder.indexOf(tag.toFrameId);
  if (from < 0 || to < 0) return model.frameOrder;
  const range = model.frameOrder.slice(Math.min(from, to), Math.max(from, to) + 1);
  return tag.playback === "reverse" ? range.reverse() : range;
}

export interface OnionSkinSettings {
  enabled: boolean;
  previousFrames: number;
  nextFrames: number;
  previousOpacity: number;
  nextOpacity: number;
  previousTint: Rgba | null;
  nextTint: Rgba | null;
  source: "activeLayer" | "composite";
}

export const DEFAULT_ONION_SKIN: OnionSkinSettings = {
  enabled: false,
  previousFrames: 1,
  nextFrames: 1,
  previousOpacity: 0.3,
  nextOpacity: 0.3,
  previousTint: [255, 96, 96, 255],
  nextTint: [96, 144, 255, 255],
  source: "composite",
};

export function onionSkinFrames(
  order: readonly FrameId[],
  activeFrameId: FrameId,
  settings: OnionSkinSettings,
): { readonly previous: readonly FrameId[]; readonly next: readonly FrameId[] } {
  const index = order.indexOf(activeFrameId);
  if (!settings.enabled || index < 0) return { previous: [], next: [] };
  return {
    previous: order.slice(Math.max(0, index - Math.max(0, settings.previousFrames)), index),
    next: order.slice(index + 1, index + 1 + Math.max(0, settings.nextFrames)),
  };
}
