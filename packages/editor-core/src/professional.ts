import { getAnyCel, recountImageReferences } from "./animation";
import { compositeFrame } from "./composite";
import { cloneDocumentModel } from "./document";
import { convertRgbaToIndexed, indexedToRgba, type IndexedConversionOptions } from "./indexed";
import { createGroupLayer, descendantLayerIds, flattenLayerTree, reparentLayer } from "./layer-tree";
import { remapIndices, reorderPalettePreservingAppearance } from "./palette";
import type { EditorSession } from "./session";
import { normalizeSlice } from "./slices";
import { decodeTileCell, encodeTileCell, TilemapSurface, type TileCell } from "./tilemap";
import {
  makeId,
  type BlendMode,
  type DocumentSnapshot,
  type ImageId,
  type LayerId,
  type PaletteEntry,
  type Rgba,
  type SliceDefinition,
  type TileSet,
  type TileSetId,
} from "./types";

export function convertSessionToIndexed(
  session: EditorSession,
  options: IndexedConversionOptions,
): void {
  if (session.model.canvas.colorMode === "indexed") return;
  const before = session.snapshot(), orderedIds = Object.keys(before.model.images).sort(), buffers = orderedIds.map((id) => before.images.get(id));
  if (buffers.some((bytes) => bytes === undefined)) throw new Error("Document image is missing.");
  const totalBytes = buffers.reduce((sum, bytes) => sum + (bytes?.byteLength ?? 0), 0);
  if (totalBytes > 256 * 1024 * 1024) throw new RangeError("Color conversion exceeds the input memory budget.");
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const bytes of buffers) { if (bytes === undefined) continue; combined.set(bytes, offset); offset += bytes.byteLength; }
  const result = convertRgbaToIndexed(combined, combined.length / 4, 1, options), images: [ImageId, Uint8Array][] = [];
  offset = 0;
  for (const imageId of orderedIds) {
    const source = before.images.get(imageId);
    if (source === undefined) throw new Error("Document image is missing.");
    const pixels = source.byteLength / 4;
    images.push([imageId, result.indices.slice(offset, offset + pixels)]);
    offset += pixels;
  }
  commitPreparedIndexedConversion(session, { palette: result.palette, transparentIndex: result.transparentIndex, images }, options.maxColors);
}

export interface PreparedIndexedConversion {
  readonly palette: readonly Rgba[];
  readonly transparentIndex: number;
  readonly images: readonly (readonly [ImageId, Uint8Array])[];
}

export function commitPreparedIndexedConversion(session: EditorSession, result: PreparedIndexedConversion, maxPaletteSize: number): void {
  if (session.model.canvas.colorMode !== "rgba") throw new Error("Only an RGBA document can accept Indexed conversion output.");
  if (result.palette.length < 1 || result.palette.length > maxPaletteSize || maxPaletteSize < 2 || maxPaletteSize > 256 || result.transparentIndex < 0 || result.transparentIndex >= result.palette.length)
    throw new RangeError("Prepared Indexed conversion palette is invalid.");
  const before = session.snapshot(), model = cloneDocumentModel(before.model), images = new Map<ImageId, Uint8Array>();
  if (result.images.length !== Object.keys(model.images).length) throw new Error("Prepared Indexed conversion image set is incomplete.");
  for (const [imageId, bytes] of result.images) {
    const meta = model.images[imageId];
    if (meta === undefined || bytes.byteLength !== meta.width * meta.height) throw new Error("Prepared Indexed image is invalid.");
    images.set(imageId, bytes.slice()); meta.format = "indexed8";
  }
  const entries: PaletteEntry[] = result.palette.map((rgba, index) => ({ id: makeId("palette"), index, rgba }));
  model.canvas.colorMode = "indexed";
  model.canvas.transparentIndex = result.transparentIndex;
  model.palette = { entries, colors: entries, transparentIndex: result.transparentIndex, maxSize: maxPaletteSize };
  session.replaceDocumentSnapshot({ model, images, tilemaps: cloneTilemaps(before) }, "Convert to Indexed", "sprite.convertToIndexed");
}

export function convertSessionToRgba(session: EditorSession): void {
  if (session.model.canvas.colorMode === "rgba") return;
  const before = session.snapshot(), model = cloneDocumentModel(before.model), palette = model.palette.entries.map((entry) => entry.rgba), transparent = model.palette.transparentIndex;
  if (transparent === null) throw new Error("Indexed document transparent index is missing.");
  const images = new Map<ImageId, Uint8Array>();
  for (const [imageId, meta] of Object.entries(model.images)) {
    const bytes = before.images.get(imageId);
    if (bytes === undefined) throw new Error("Document image is missing.");
    images.set(imageId, indexedToRgba(bytes, palette, transparent));
    meta.format = "rgba8";
  }
  model.canvas = { width: model.canvas.width, height: model.canvas.height, colorMode: "rgba", colorSpace: "srgb" };
  model.palette = { entries: model.palette.entries, colors: model.palette.entries, transparentIndex: null, maxSize: model.palette.maxSize };
  session.replaceDocumentSnapshot({ model, images, tilemaps: cloneTilemaps(before) }, "Convert to RGBA", "sprite.convertToRgba");
}

export function reorderSessionPalette(session: EditorSession, orderedIds: readonly string[]): void {
  if (session.model.canvas.colorMode !== "indexed") throw new Error("Palette remap requires an indexed document.");
  const before = session.snapshot(), model = cloneDocumentModel(before.model), result = reorderPalettePreservingAppearance(model.palette.entries, orderedIds), images = new Map<ImageId, Uint8Array>();
  for (const [imageId, bytes] of before.images) images.set(imageId, remapIndices(bytes, result.mapping));
  model.palette.entries = result.entries;
  model.palette.colors = result.entries;
  const transparent = model.palette.transparentIndex;
  if (transparent !== null) {
    const remapped = result.mapping.get(transparent);
    if (remapped === undefined) throw new Error("Transparent index remap is missing.");
    model.palette.transparentIndex = remapped;
    model.canvas.transparentIndex = remapped;
  }
  session.replaceDocumentSnapshot({ model, images, tilemaps: cloneTilemaps(before) }, "Reorder Palette", "palette.reorder");
}

export function remapSessionPalette(
  session: EditorSession,
  entries: readonly PaletteEntry[],
  mapping: ReadonlyMap<number, number>,
  transparentIndex: number,
  label = "Remap Palette",
): void {
  if (session.model.canvas.colorMode !== "indexed") throw new Error("Palette remap requires an indexed document.");
  if (entries.length < 1 || entries.length > session.model.palette.maxSize || !entries.some((entry) => entry.index === transparentIndex)) throw new RangeError("Remapped palette is invalid.");
  const before = session.snapshot(), model = cloneDocumentModel(before.model), normalized = entries.map((entry, index) => ({ ...entry, index })), images = new Map<ImageId, Uint8Array>();
  for (const [imageId, bytes] of before.images) images.set(imageId, remapIndices(bytes, mapping));
  model.palette.entries = normalized; model.palette.colors = normalized; model.palette.transparentIndex = transparentIndex; model.canvas.transparentIndex = transparentIndex;
  session.replaceDocumentSnapshot({ model, images, tilemaps: cloneTilemaps(before) }, label, "palette.remap");
}

export function addGroup(session: EditorSession, name = "Group", parentId: LayerId | null = null): LayerId {
  const snapshot = mutableSnapshot(session.snapshot()), group = createGroupLayer(snapshot.model, name, parentId);
  session.replaceDocumentSnapshot(snapshot, "Add Group", "layer.addGroup");
  return group.id;
}

export function moveLayerToParent(session: EditorSession, layerId: LayerId, parentId: LayerId | null, index: number): void {
  const snapshot = mutableSnapshot(session.snapshot());
  reparentLayer(snapshot.model, layerId, parentId, index);
  session.replaceDocumentSnapshot(snapshot, "Move Layer", parentId === null ? "layer.outdent" : "layer.indent");
}

export function setLayerBlendMode(session: EditorSession, layerId: LayerId, blendMode: BlendMode): void {
  const snapshot = mutableSnapshot(session.snapshot()), layer = snapshot.model.layers[layerId];
  if (layer === undefined) throw new Error("Layer does not exist.");
  layer.blendMode = blendMode;
  session.replaceDocumentSnapshot(snapshot, "Set Blend Mode", "layer.setBlendMode");
}

export function deleteLayerTree(session: EditorSession, layerId: LayerId): void {
  const snapshot = mutableSnapshot(session.snapshot()), layer = snapshot.model.layers[layerId];
  if (layer === undefined) return;
  const ids = new Set([layerId, ...descendantLayerIds(snapshot.model, layerId)]);
  if (ids.size === Object.keys(snapshot.model.layers).length)
    throw new Error("A document must retain at least one layer.");
  const parent = layer.parentId === null ? null : snapshot.model.layers[layer.parentId],
    siblings = layer.parentId === null
      ? snapshot.model.rootLayerIds
      : parent?.kind === "group" ? parent.childIds : null;
  if (siblings === null) throw new Error("Layer parent is invalid.");
  siblings.splice(siblings.indexOf(layerId), 1);
  for (const [celId, cel] of Object.entries(snapshot.model.cels)) if (ids.has(cel.layerId)) {
    Reflect.deleteProperty(snapshot.model.celByLayerAndFrame, `${cel.layerId.length}:${cel.layerId}${cel.frameId}`);
    Reflect.deleteProperty(snapshot.model.cels, celId);
  }
  for (const id of ids) Reflect.deleteProperty(snapshot.model.layers, id);
  recountImageReferences(snapshot.model);
  for (const [id, image] of Object.entries(snapshot.model.images)) if (image.refCount === 0 && !Object.values(snapshot.model.tileSets).some((set) => set.atlasImageId === id)) {
    Reflect.deleteProperty(snapshot.model.images, id); snapshot.images.delete(id);
  }
  for (const [id, tilemap] of Object.entries(snapshot.model.tilemaps)) if (tilemap.refCount === 0) {
    Reflect.deleteProperty(snapshot.model.tilemaps, id); snapshot.tilemaps.delete(id);
  }
  snapshot.model.layerOrder = flattenLayerTree(snapshot.model);
  session.replaceDocumentSnapshot(snapshot, "Delete Layer", "layer.delete");
}

export function duplicateLayerTree(session: EditorSession, layerId: LayerId, name?: string): LayerId {
  const snapshot = mutableSnapshot(session.snapshot()), source = snapshot.model.layers[layerId];
  if (source === undefined) throw new Error("Layer does not exist.");
  const imageIds = new Map<string, string>(), tilemapIds = new Map<string, string>();
  const cloneLayer = (sourceId: LayerId, parentId: LayerId | null): LayerId => {
    const original = snapshot.model.layers[sourceId];
    if (original === undefined) throw new Error("Layer tree is incomplete.");
    const id = makeId(`${original.kind}-layer`);
    snapshot.model.layers[id] = original.kind === "group"
      ? { ...original, id, parentId, childIds: [] }
      : { ...original, id, parentId };
    for (const cel of Object.values(snapshot.model.cels).filter((entry) => entry.layerId === sourceId)) {
      const celId = makeId(`${cel.kind}-cel`);
      if (cel.kind === "pixel") {
        let imageId = imageIds.get(cel.imageId);
        if (imageId === undefined) {
          const meta = snapshot.model.images[cel.imageId], bytes = snapshot.images.get(cel.imageId);
          if (meta === undefined || bytes === undefined) throw new Error("Layer image is missing.");
          imageId = makeId("image"); imageIds.set(cel.imageId, imageId);
          snapshot.model.images[imageId] = { ...meta, id: imageId, refCount: 0 };
          snapshot.images.set(imageId, bytes.slice());
        }
        snapshot.model.cels[celId] = { ...cel, id: celId, layerId: id, imageId };
      } else {
        let tilemapImageId = tilemapIds.get(cel.tilemapImageId);
        if (tilemapImageId === undefined) {
          const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps.get(cel.tilemapImageId);
          if (meta === undefined || cells === undefined) throw new Error("Layer tilemap is missing.");
          tilemapImageId = makeId("tilemap-image"); tilemapIds.set(cel.tilemapImageId, tilemapImageId);
          snapshot.model.tilemaps[tilemapImageId] = { ...meta, id: tilemapImageId, refCount: 0 };
          snapshot.tilemaps.set(tilemapImageId, cells.slice());
        }
        snapshot.model.cels[celId] = { ...cel, id: celId, layerId: id, tilemapImageId };
      }
      snapshot.model.celByLayerAndFrame[`${id.length}:${id}${cel.frameId}`] = celId;
    }
    if (original.kind === "group") {
      const group = snapshot.model.layers[id];
      if (group.kind !== "group") throw new Error("Duplicated group is invalid.");
      group.childIds = original.childIds.map((childId) => cloneLayer(childId, id));
    }
    return id;
  };
  const id = cloneLayer(layerId, source.parentId);
  const duplicate = snapshot.model.layers[id];
  if (duplicate === undefined) throw new Error("Duplicated layer is missing.");
  const requestedName = name?.trim();
  duplicate.name = requestedName !== undefined && requestedName !== "" ? requestedName : `${source.name} Copy`;
  const siblings = source.parentId === null ? snapshot.model.rootLayerIds : (snapshot.model.layers[source.parentId] as { childIds: LayerId[] }).childIds;
  siblings.splice(siblings.indexOf(layerId) + 1, 0, id);
  snapshot.model.layerOrder = flattenLayerTree(snapshot.model);
  recountImageReferences(snapshot.model);
  session.replaceDocumentSnapshot(snapshot, "Duplicate Layer", "layer.duplicate");
  return id;
}

export function addDocumentSlice(session: EditorSession, slice: SliceDefinition): void {
  const snapshot = mutableSnapshot(session.snapshot()), normalized = normalizeSlice(slice, snapshot.model.canvas.width, snapshot.model.canvas.height);
  if (snapshot.model.slices[normalized.id] !== undefined) throw new Error("Slice id already exists.");
  snapshot.model.slices[normalized.id] = normalized;
  session.replaceDocumentSnapshot(snapshot, "Add Slice", "slice.add");
}
export function updateDocumentSlice(session: EditorSession, slice: SliceDefinition): void {
  const snapshot = mutableSnapshot(session.snapshot());
  if (snapshot.model.slices[slice.id] === undefined) throw new Error("Slice does not exist.");
  snapshot.model.slices[slice.id] = normalizeSlice(slice, snapshot.model.canvas.width, snapshot.model.canvas.height);
  session.replaceDocumentSnapshot(snapshot, "Edit Slice", "slice.edit");
}
export function deleteDocumentSlice(session: EditorSession, sliceId: string): void {
  const snapshot = mutableSnapshot(session.snapshot());
  if (!Reflect.deleteProperty(snapshot.model.slices, sliceId)) return;
  session.replaceDocumentSnapshot(snapshot, "Delete Slice", "slice.delete");
}

export function deleteTileSet(session: EditorSession, tileSetId: TileSetId): void {
  if (Object.values(session.model.layers).some((layer) => layer.kind === "tilemap" && layer.tileSetId === tileSetId))
    throw new Error("Tile set is referenced by a Tilemap Layer.");
  const snapshot = mutableSnapshot(session.snapshot()), tileSet = snapshot.model.tileSets[tileSetId];
  if (tileSet === undefined) return;
  Reflect.deleteProperty(snapshot.model.tileSets, tileSetId);
  if (!Object.values(snapshot.model.tileSets).some((entry) => entry.atlasImageId === tileSet.atlasImageId)) {
    Reflect.deleteProperty(snapshot.model.images, tileSet.atlasImageId);
    snapshot.images.delete(tileSet.atlasImageId);
  }
  session.replaceDocumentSnapshot(snapshot, "Delete Tile Set", "tileset.delete");
}

export function createTileSet(
  session: EditorSession,
  input: Readonly<{ name: string; tileWidth: number; tileHeight: number; columns: number; tileCount: number; atlasWidth: number; atlasHeight: number; atlasBytes: Uint8Array; spacing?: number; margin?: number }>,
): TileSetId {
  const snapshot = mutableSnapshot(session.snapshot()), expected = input.atlasWidth * input.atlasHeight * (snapshot.model.canvas.colorMode === "indexed" ? 1 : 4);
  if (input.atlasBytes.byteLength !== expected) throw new RangeError("Tile atlas byte length is invalid.");
  const imageId = makeId("tileset-image"), id = makeId("tileset"), tileSet: TileSet = { id, name: input.name.trim() || "Tile Set", tileWidth: input.tileWidth, tileHeight: input.tileHeight, columns: input.columns, tileCount: input.tileCount, atlasImageId: imageId, emptyTileId: 0, ...(input.spacing === undefined ? {} : { spacing: input.spacing }), ...(input.margin === undefined ? {} : { margin: input.margin }) };
  validateTileSet(tileSet, input.atlasWidth, input.atlasHeight);
  snapshot.model.images[imageId] = { id: imageId, width: input.atlasWidth, height: input.atlasHeight, format: snapshot.model.canvas.colorMode === "indexed" ? "indexed8" : "rgba8", refCount: 0 };
  snapshot.images.set(imageId, input.atlasBytes.slice());
  snapshot.model.tileSets[id] = tileSet;
  session.replaceDocumentSnapshot(snapshot, "Create Tile Set", "tileset.create");
  return id;
}

export function addTilemapLayer(session: EditorSession, tileSetId: TileSetId, widthInTiles: number, heightInTiles: number, name = "Tilemap"): LayerId {
  const snapshot = mutableSnapshot(session.snapshot()), tileSet = snapshot.model.tileSets[tileSetId];
  if (tileSet === undefined) throw new Error("Tile set does not exist.");
  if (!Number.isInteger(widthInTiles) || !Number.isInteger(heightInTiles) || widthInTiles < 1 || heightInTiles < 1 || widthInTiles * heightInTiles * 4 > 256 * 1024 * 1024) throw new RangeError("Tilemap dimensions are invalid.");
  const layerId = makeId("tilemap-layer"), tilemapImageId = makeId("tilemap-image"), celId = makeId("tilemap-cel"), frameId = snapshot.model.frameOrder[0];
  if (frameId === undefined) throw new Error("Document has no frame.");
  snapshot.model.layers[layerId] = { id: layerId, kind: "tilemap", name, parentId: null, tileSetId, visible: true, locked: false, opacity: 1, blendMode: "normal" };
  snapshot.model.rootLayerIds.push(layerId);
  snapshot.model.layerOrder = flattenLayerTree(snapshot.model);
  snapshot.model.tilemaps[tilemapImageId] = { id: tilemapImageId, widthInTiles, heightInTiles, format: "tile32", refCount: 1 };
  snapshot.tilemaps.set(tilemapImageId, new Uint32Array(widthInTiles * heightInTiles));
  snapshot.model.cels[celId] = { kind: "tilemap", id: celId, layerId, frameId, tilemapImageId, x: 0, y: 0, opacity: 1 };
  snapshot.model.celByLayerAndFrame[`${layerId.length}:${layerId}${frameId}`] = celId;
  session.replaceDocumentSnapshot(snapshot, "Add Tilemap Layer", "layer.addTilemap");
  return layerId;
}

export function paintTile(session: EditorSession, layerId: LayerId, x: number, y: number, cell: TileCell): void {
  const snapshot = mutableSnapshot(session.snapshot()), frameId = session.activeFrameId, cel = getAnyCel(snapshot.model, layerId, frameId);
  if (cel?.kind !== "tilemap") throw new Error("Active tilemap cel does not exist.");
  const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps.get(cel.tilemapImageId), layer = snapshot.model.layers[layerId];
  if (meta === undefined || cells === undefined || layer?.kind !== "tilemap") throw new Error("Tilemap data is missing.");
  const tileSet = snapshot.model.tileSets[layer.tileSetId];
  if (tileSet === undefined || cell.tileId !== null && cell.tileId >= tileSet.tileCount) throw new RangeError("Tile id is invalid.");
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= meta.widthInTiles || y >= meta.heightInTiles) throw new RangeError("Tile coordinate is outside the map.");
  cells[y * meta.widthInTiles + x] = encodeTileCell(cell);
  session.replaceDocumentSnapshot(snapshot, "Paint Tile", "tool.tilePencil");
}

export function readTile(session: EditorSession, layerId: LayerId, x: number, y: number): TileCell | null {
  const snapshot = session.snapshot(), cel = getAnyCel(snapshot.model, layerId, session.activeFrameId);
  if (cel?.kind !== "tilemap") return null;
  const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps?.get(cel.tilemapImageId);
  if (meta === undefined || cells === undefined || x < 0 || y < 0 || x >= meta.widthInTiles || y >= meta.heightInTiles) return null;
  return decodeTileCell(cells[y * meta.widthInTiles + x] ?? 0);
}

export function fillTile(session: EditorSession, layerId: LayerId, x: number, y: number, cell: TileCell): boolean {
  const snapshot = mutableSnapshot(session.snapshot()), cel = getAnyCel(snapshot.model, layerId, session.activeFrameId);
  if (cel?.kind !== "tilemap") throw new Error("Active tilemap cel does not exist.");
  const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps.get(cel.tilemapImageId);
  if (meta === undefined || cells === undefined) throw new Error("Tilemap data is missing.");
  const surface = new TilemapSurface(meta.widthInTiles, meta.heightInTiles, cells), patch = surface.floodFill({ x, y }, encodeTileCell(cell));
  if (patch === null) return false;
  snapshot.tilemaps.set(cel.tilemapImageId, surface.getCells());
  session.replaceDocumentSnapshot(snapshot, "Fill Tiles", "tool.tileFill");
  return true;
}

export function createTilemapCel(session: EditorSession, layerId: LayerId, frameId = session.activeFrameId): string {
  const snapshot = mutableSnapshot(session.snapshot()), layer = snapshot.model.layers[layerId];
  if (layer?.kind !== "tilemap" || snapshot.model.frames[frameId] === undefined) throw new Error("Tilemap layer or frame does not exist.");
  const existing = getAnyCel(snapshot.model, layerId, frameId);
  if (existing !== null) return existing.id;
  const tileSet = snapshot.model.tileSets[layer.tileSetId];
  if (tileSet === undefined) throw new Error("Tile set does not exist.");
  const source = Object.values(snapshot.model.cels).find((cel) => cel.kind === "tilemap" && cel.layerId === layerId);
  const sourceMeta = source?.kind === "tilemap" ? snapshot.model.tilemaps[source.tilemapImageId] : undefined;
  const widthInTiles = sourceMeta?.widthInTiles ?? Math.max(1, Math.ceil(snapshot.model.canvas.width / tileSet.tileWidth)),
    heightInTiles = sourceMeta?.heightInTiles ?? Math.max(1, Math.ceil(snapshot.model.canvas.height / tileSet.tileHeight)),
    tilemapImageId = makeId("tilemap-image"), celId = makeId("tilemap-cel");
  snapshot.model.tilemaps[tilemapImageId] = { id: tilemapImageId, widthInTiles, heightInTiles, format: "tile32", refCount: 1 };
  snapshot.tilemaps.set(tilemapImageId, new Uint32Array(widthInTiles * heightInTiles));
  snapshot.model.cels[celId] = { kind: "tilemap", id: celId, layerId, frameId, tilemapImageId, x: 0, y: 0, opacity: 1 };
  snapshot.model.celByLayerAndFrame[`${layerId.length}:${layerId}${frameId}`] = celId;
  session.replaceDocumentSnapshot(snapshot, "Create Tilemap Cel", "cel.create");
  return celId;
}

export function deleteTilemapCel(session: EditorSession, layerId: LayerId, frameId = session.activeFrameId): boolean {
  const snapshot = mutableSnapshot(session.snapshot()), cel = getAnyCel(snapshot.model, layerId, frameId);
  if (cel?.kind !== "tilemap") return false;
  Reflect.deleteProperty(snapshot.model.cels, cel.id);
  Reflect.deleteProperty(snapshot.model.celByLayerAndFrame, `${layerId.length}:${layerId}${frameId}`);
  recountImageReferences(snapshot.model);
  const meta = snapshot.model.tilemaps[cel.tilemapImageId];
  if (meta?.refCount === 0) { Reflect.deleteProperty(snapshot.model.tilemaps, cel.tilemapImageId); snapshot.tilemaps.delete(cel.tilemapImageId); }
  session.replaceDocumentSnapshot(snapshot, "Delete Tilemap Cel", "cel.delete");
  return true;
}

export function linkTilemapCelToPrevious(session: EditorSession, layerId: LayerId, frameId = session.activeFrameId): string {
  const snapshot = mutableSnapshot(session.snapshot()), index = snapshot.model.frameOrder.indexOf(frameId), previousFrameId = snapshot.model.frameOrder[index - 1];
  if (previousFrameId === undefined || getAnyCel(snapshot.model, layerId, frameId) !== null) throw new Error("Tilemap Cel cannot be linked here.");
  const source = getAnyCel(snapshot.model, layerId, previousFrameId);
  if (source?.kind !== "tilemap") throw new Error("Previous Tilemap Cel does not exist.");
  const id = makeId("tilemap-cel");
  snapshot.model.cels[id] = { ...source, id, frameId };
  snapshot.model.celByLayerAndFrame[`${layerId.length}:${layerId}${frameId}`] = id;
  recountImageReferences(snapshot.model);
  session.replaceDocumentSnapshot(snapshot, "Link Tilemap Cel", "cel.link");
  return id;
}

export function unlinkTilemapCel(session: EditorSession, layerId: LayerId, frameId = session.activeFrameId): boolean {
  const snapshot = mutableSnapshot(session.snapshot()), cel = getAnyCel(snapshot.model, layerId, frameId);
  if (cel?.kind !== "tilemap") return false;
  const references = Object.values(snapshot.model.cels).filter((item) => item.kind === "tilemap" && item.tilemapImageId === cel.tilemapImageId).length;
  if (references < 2) return false;
  const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps.get(cel.tilemapImageId);
  if (meta === undefined || cells === undefined) throw new Error("Tilemap image is missing.");
  const tilemapImageId = makeId("tilemap-image");
  snapshot.model.tilemaps[tilemapImageId] = { ...meta, id: tilemapImageId, refCount: 1 };
  snapshot.tilemaps.set(tilemapImageId, cells.slice()); cel.tilemapImageId = tilemapImageId;
  recountImageReferences(snapshot.model);
  session.replaceDocumentSnapshot(snapshot, "Unlink Tilemap Cel", "cel.unlink");
  return true;
}

export function flattenDocument(session: EditorSession): void {
  const before = session.snapshot(), model = cloneDocumentModel(before.model), images = new Map<ImageId, Uint8Array>(), layerId = makeId("flattened-layer"), cels: PixelDocumentCels = {}, lookup: Record<string, string> = {};
  model.layers = { [layerId]: { id: layerId, kind: "pixel", name: "Flattened", parentId: null, visible: true, locked: false, opacity: 1, blendMode: "normal" } };
  model.rootLayerIds = [layerId]; model.layerOrder = [layerId]; model.cels = cels; model.celByLayerAndFrame = lookup; model.images = {};
  for (const frameId of model.frameOrder) {
    const rgba = compositeFrame(snapshotSource(before, frameId), frameId), imageId = makeId("flattened-image"), celId = makeId("flattened-cel");
    if (model.canvas.colorMode === "indexed") {
      const entries = model.palette.entries, transparent = model.palette.transparentIndex ?? 0, indices = new Uint8Array(rgba.length / 4);
      for (let index = 0; index < indices.length; index += 1) indices[index] = closestIndex([rgba[index * 4] ?? 0, rgba[index * 4 + 1] ?? 0, rgba[index * 4 + 2] ?? 0, rgba[index * 4 + 3] ?? 0], entries, transparent);
      images.set(imageId, indices); model.images[imageId] = { id: imageId, width: model.canvas.width, height: model.canvas.height, format: "indexed8", refCount: 1 };
    } else { images.set(imageId, rgba); model.images[imageId] = { id: imageId, width: model.canvas.width, height: model.canvas.height, format: "rgba8", refCount: 1 }; }
    cels[celId] = { kind: "pixel", id: celId, layerId, frameId, imageId, x: 0, y: 0, opacity: 1 }; lookup[`${layerId.length}:${layerId}${frameId}`] = celId;
  }
  model.tilemaps = {}; model.tileSets = {}; recountImageReferences(model);
  session.replaceDocumentSnapshot({ model, images, tilemaps: new Map() }, "Flatten Document", "layer.flattenDocument");
}

export function mergeLayerDown(session: EditorSession, layerId: LayerId): LayerId {
  const layer = session.model.layers[layerId];
  if (layer === undefined) throw new Error("Layer does not exist.");
  const parent = layer.parentId === null ? null : session.model.layers[layer.parentId],
    siblings = layer.parentId === null ? session.model.rootLayerIds : parent?.kind === "group" ? parent.childIds : [];
  const index = siblings.indexOf(layerId), below = siblings[index - 1];
  if (index < 1 || below === undefined) throw new Error("There is no layer below the active layer.");
  return rasterizeLayerSet(session, [below, layerId], layer.parentId, index - 1, layer.name, "Merge Down", "layer.mergeDown", {
    visible: true, locked: false, opacity: 1, blendMode: "normal",
  });
}

export function mergeVisibleLayers(session: EditorSession): LayerId {
  const visible = session.model.rootLayerIds.filter((id) => session.model.layers[id]?.visible === true);
  if (visible.length === 0) throw new Error("There are no visible layers to merge.");
  const insertion = Math.min(...visible.map((id) => session.model.rootLayerIds.indexOf(id)));
  return rasterizeLayerSet(session, visible, null, insertion, "Merged Visible", "Merge Visible", "layer.mergeVisible", {
    visible: true, locked: false, opacity: 1, blendMode: "normal",
  });
}

export function flattenGroupLayer(session: EditorSession, groupId: LayerId): LayerId {
  const group = session.model.layers[groupId];
  if (group?.kind !== "group") throw new Error("Active layer is not a Group.");
  const parent = group.parentId === null ? null : session.model.layers[group.parentId],
    siblings = group.parentId === null ? session.model.rootLayerIds : parent?.kind === "group" ? parent.childIds : [];
  const index = siblings.indexOf(groupId);
  if (index < 0) throw new Error("Group parent is inconsistent.");
  if (group.childIds.length === 0) throw new Error("An empty Group cannot be flattened.");
  return rasterizeLayerSet(session, [groupId], group.parentId, index, group.name, "Flatten Group", "layer.flattenGroup", {
    visible: group.visible, locked: group.locked, opacity: 1, blendMode: "normal",
  });
}

function rasterizeLayerSet(
  session: EditorSession,
  layerIds: readonly LayerId[],
  parentId: LayerId | null,
  insertionIndex: number,
  name: string,
  label: string,
  commandId: string,
  properties: Readonly<{ visible: boolean; locked: boolean; opacity: number; blendMode: BlendMode }>,
): LayerId {
  const before = session.snapshot(), render = mutableSnapshot(before), keep = new Set<LayerId>();
  for (const id of layerIds) { keep.add(id); for (const descendant of descendantLayerIds(render.model, id)) keep.add(descendant); }
  for (const [id, layer] of Object.entries(render.model.layers)) if (!keep.has(id)) Reflect.deleteProperty(render.model.layers, id); else if (layerIds.includes(id)) layer.parentId = null;
  for (const [id, cel] of Object.entries(render.model.cels)) if (!keep.has(cel.layerId)) { Reflect.deleteProperty(render.model.cels, id); Reflect.deleteProperty(render.model.celByLayerAndFrame, `${cel.layerId.length}:${cel.layerId}${cel.frameId}`); }
  render.model.rootLayerIds = [...layerIds]; render.model.layerOrder = flattenLayerTree(render.model);
  const outputByFrame = new Map<string, Uint8Array>();
  for (const frameId of render.model.frameOrder) outputByFrame.set(frameId, compositeFrame(snapshotSource(render, frameId), frameId));

  const snapshot = mutableSnapshot(before), removed = new Set<LayerId>();
  for (const id of layerIds) { removed.add(id); for (const descendant of descendantLayerIds(snapshot.model, id)) removed.add(descendant); }
  const destination = parentId === null ? snapshot.model.rootLayerIds : snapshot.model.layers[parentId]?.kind === "group" ? snapshot.model.layers[parentId].childIds : null;
  if (destination === null) throw new Error("Rasterized layer parent is invalid.");
  for (const id of layerIds) { const index = destination.indexOf(id); if (index >= 0) destination.splice(index, 1); }
  for (const [celId, cel] of Object.entries(snapshot.model.cels)) if (removed.has(cel.layerId)) { Reflect.deleteProperty(snapshot.model.cels, celId); Reflect.deleteProperty(snapshot.model.celByLayerAndFrame, `${cel.layerId.length}:${cel.layerId}${cel.frameId}`); }
  for (const id of removed) Reflect.deleteProperty(snapshot.model.layers, id);
  const outputLayerId = makeId("raster-layer");
  snapshot.model.layers[outputLayerId] = { id: outputLayerId, kind: "pixel", name, parentId, ...properties };
  destination.splice(Math.max(0, Math.min(destination.length, insertionIndex)), 0, outputLayerId);
  for (const frameId of snapshot.model.frameOrder) {
    const rgba = outputByFrame.get(frameId);
    if (rgba === undefined) throw new Error("Rasterized frame is missing.");
    const imageId = makeId("raster-image"), celId = makeId("raster-cel"), bytes = snapshot.model.canvas.colorMode === "indexed"
      ? rgbaToCurrentPalette(rgba, snapshot.model.palette.entries, snapshot.model.palette.transparentIndex ?? 0)
      : rgba;
    snapshot.images.set(imageId, bytes); snapshot.model.images[imageId] = { id: imageId, width: snapshot.model.canvas.width, height: snapshot.model.canvas.height, format: snapshot.model.canvas.colorMode === "indexed" ? "indexed8" : "rgba8", refCount: 1 };
    snapshot.model.cels[celId] = { kind: "pixel", id: celId, layerId: outputLayerId, frameId, imageId, x: 0, y: 0, opacity: 1 };
    snapshot.model.celByLayerAndFrame[`${outputLayerId.length}:${outputLayerId}${frameId}`] = celId;
  }
  recountImageReferences(snapshot.model);
  for (const [id, image] of Object.entries(snapshot.model.images)) if (image.refCount === 0 && !Object.values(snapshot.model.tileSets).some((set) => set.atlasImageId === id)) { Reflect.deleteProperty(snapshot.model.images, id); snapshot.images.delete(id); }
  for (const [id, tilemap] of Object.entries(snapshot.model.tilemaps)) if (tilemap.refCount === 0) { Reflect.deleteProperty(snapshot.model.tilemaps, id); snapshot.tilemaps.delete(id); }
  snapshot.model.layerOrder = flattenLayerTree(snapshot.model);
  session.replaceDocumentSnapshot(snapshot, label, commandId);
  return outputLayerId;
}

function rgbaToCurrentPalette(rgba: Uint8Array, entries: readonly PaletteEntry[], transparent: number): Uint8Array {
  const indices = new Uint8Array(rgba.length / 4);
  for (let index = 0; index < indices.length; index += 1)
    indices[index] = closestIndex([rgba[index * 4] ?? 0, rgba[index * 4 + 1] ?? 0, rgba[index * 4 + 2] ?? 0, rgba[index * 4 + 3] ?? 0], entries, transparent);
  return indices;
}

interface MutableSnapshot { model: ReturnType<typeof cloneDocumentModel>; images: Map<ImageId, Uint8Array>; tilemaps: Map<string, Uint32Array> }
type PixelDocumentCels = PixelDocument["cels"];
function mutableSnapshot(snapshot: DocumentSnapshot): MutableSnapshot { return { model: cloneDocumentModel(snapshot.model), images: new Map([...snapshot.images].map(([id, bytes]) => [id, bytes.slice()])), tilemaps: cloneTilemaps(snapshot) }; }
function cloneTilemaps(snapshot: DocumentSnapshot): Map<string, Uint32Array> { return new Map([...(snapshot.tilemaps ?? [])].map(([id, cells]) => [id, cells.slice()])); }
function validateTileSet(tileSet: TileSet, atlasWidth: number, atlasHeight: number): void { if (![tileSet.tileWidth, tileSet.tileHeight, tileSet.columns, tileSet.tileCount].every((value) => Number.isInteger(value) && value > 0)) throw new RangeError("Tile set dimensions are invalid."); const spacing = tileSet.spacing ?? 0, margin = tileSet.margin ?? 0, rows = Math.ceil(tileSet.tileCount / tileSet.columns); if (margin * 2 + tileSet.columns * tileSet.tileWidth + Math.max(0, tileSet.columns - 1) * spacing > atlasWidth || margin * 2 + rows * tileSet.tileHeight + Math.max(0, rows - 1) * spacing > atlasHeight) throw new RangeError("Tile atlas is too small for the declared tile set."); }
function snapshotSource(snapshot: DocumentSnapshot, frameId: string) { return { model: snapshot.model, activeFrameId: frameId, getSurface(imageId: ImageId) { const meta = snapshot.model.images[imageId], bytes = snapshot.images.get(imageId); if (meta === undefined || bytes === undefined) throw new Error("Image is missing."); const palette = snapshot.model.palette.entries.map((entry) => entry.rgba); return meta.format === "indexed8" ? new (requireIndexedSurface())(meta.width, meta.height, bytes, palette, snapshot.model.palette.transparentIndex ?? 0) : new (requireRgbaSurface())(meta.width, meta.height, bytes); }, getTilemapCells(id: string) { const cells = snapshot.tilemaps?.get(id); if (cells === undefined) throw new Error("Tilemap is missing."); return cells; } }; }
function closestIndex(color: Rgba, entries: readonly PaletteEntry[], transparent: number): number { if (color[3] === 0) return transparent; let best = entries.find((entry) => entry.index !== transparent)?.index ?? transparent, distance = Number.POSITIVE_INFINITY; for (const entry of entries) { if (entry.index === transparent) continue; const dr = color[0] - entry.rgba[0], dg = color[1] - entry.rgba[1], db = color[2] - entry.rgba[2], da = color[3] - entry.rgba[3], next = dr * dr * 2 + dg * dg * 4 + db * db * 3 + da * da; if (next < distance) { best = entry.index; distance = next; } } return best; }

// These local wrappers avoid a renderer dependency and keep the snapshot compositor synchronous.
import { IndexedPixelSurface, RgbaPixelSurface } from "./surface";
function requireIndexedSurface(): typeof IndexedPixelSurface { return IndexedPixelSurface; }
function requireRgbaSurface(): typeof RgbaPixelSurface { return RgbaPixelSurface; }
import type { PixelDocument } from "./types";
