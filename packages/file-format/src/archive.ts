import { strFromU8, strToU8, unzipSync, zip, zipSync, type UnzipFileInfo, type Zippable } from "fflate";
import { z } from "zod";
import {
  assertDocumentIntegrity,
  celKey,
  cloneDocumentModel,
  compositeSnapshot,
  flattenLayerTree,
  recountImageReferences,
  tilemapFromLittleEndian,
  tilemapToLittleEndian,
  type DocumentSnapshot,
  type PaletteEntry,
  type PixelDocument,
} from "@suwol/editor-core";
import { encodePng } from "./png";

export const SUWOL_PIXEL_MIME = "application/x-suwol-pixel-studio";
const MAX_ARCHIVE_BYTES = 320 * 1024 * 1024, MAX_ENTRY_COUNT = 8_192;
const rgbaSchema = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
const id = z.string().min(1).max(256);
const legacyLayerSchema = z.object({ id, kind: z.literal("pixel"), name: z.string().max(256), visible: z.boolean(), locked: z.boolean(), opacity: z.number().min(0).max(1), imageId: id }).strict();
const legacyStoredImageSchema = z.object({ id, width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), format: z.literal("rgba8") }).strict();
const legacyPaletteColorSchema = z.object({ id, name: z.string().min(1).max(256).optional(), rgba: rgbaSchema }).strict();
const legacyCanvasSchema = z.object({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), colorMode: z.literal("rgba"), colorSpace: z.literal("srgb") }).strict();
const legacyPaletteSchema = z.object({ colors: z.array(legacyPaletteColorSchema).max(256) }).strict();
const legacyBase = { id, name: z.string().min(1).max(256), canvas: legacyCanvasSchema, layerOrder: z.array(id).min(1).max(256), layers: z.record(z.string(), legacyLayerSchema), images: z.record(z.string(), legacyStoredImageSchema), revision: z.number().int().min(0) };
export const documentV1Schema = z.object({ schemaVersion: z.literal(1), ...legacyBase }).strict();
export const documentV2Schema = z.object({ schemaVersion: z.literal(2), ...legacyBase, palette: legacyPaletteSchema }).strict();
const frameSchema = z.object({ id, durationMs: z.number().int().min(10).max(60_000) }).strict();
const legacyCelSchema = z.object({ id, layerId: id, frameId: id, imageId: id, x: z.number().int(), y: z.number().int(), opacity: z.number().min(0).max(1) }).strict();
const tagSchema = z.object({ id, name: z.string().min(1).max(256), fromFrameId: id, toFrameId: id, playback: z.enum(["forward", "reverse", "pingpong"]), color: rgbaSchema }).strict();
export const documentV3Schema = z.object({ schemaVersion: z.literal(3), id, name: z.string().min(1).max(256), canvas: legacyCanvasSchema, layerOrder: z.array(id).min(1).max(256), layers: z.record(z.string(), legacyLayerSchema.omit({ imageId: true })), frameOrder: z.array(id).min(1).max(10_000), frames: z.record(z.string(), frameSchema), cels: z.record(z.string(), legacyCelSchema), celByLayerAndFrame: z.record(z.string(), id), images: z.record(z.string(), legacyStoredImageSchema), palette: legacyPaletteSchema, tags: z.record(z.string(), tagSchema), pluginData: z.record(z.string(), z.unknown()).optional(), revision: z.number().int().min(0) }).strict();

const blendModeSchema = z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "addition", "subtract", "difference"]);
const layerBaseSchema = z.object({ id, name: z.string().max(256), parentId: id.nullable(), visible: z.boolean(), locked: z.boolean(), opacity: z.number().min(0).max(1), blendMode: blendModeSchema });
const layerV4Schema = z.discriminatedUnion("kind", [
  layerBaseSchema.extend({ kind: z.literal("pixel") }).strict(),
  layerBaseSchema.extend({ kind: z.literal("group"), childIds: z.array(id).max(10_000) }).strict(),
  layerBaseSchema.extend({ kind: z.literal("tilemap"), tileSetId: id }).strict(),
]);
const celV4Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pixel"), id, layerId: id, frameId: id, imageId: id, x: z.number().int(), y: z.number().int(), opacity: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal("tilemap"), id, layerId: id, frameId: id, tilemapImageId: id, x: z.number().int(), y: z.number().int(), opacity: z.number().min(0).max(1) }).strict(),
]);
const storedImageV4Schema = z.object({ id, width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), format: z.enum(["rgba8", "indexed8"]) }).strict();
const paletteEntrySchema = z.object({ id, index: z.number().int().min(0).max(255), name: z.string().min(1).max(256).optional(), rgba: rgbaSchema, locked: z.boolean().optional() }).strict();
const paletteV4Schema = z.object({ entries: z.array(paletteEntrySchema).max(256), transparentIndex: z.number().int().min(0).max(255).nullable(), maxSize: z.number().int().min(1).max(256) }).strict();
const tilemapMetaSchema = z.object({ id, widthInTiles: z.number().int().min(1).max(16384), heightInTiles: z.number().int().min(1).max(16384), format: z.literal("tile32") }).strict();
const tileSetSchema = z.object({ id, name: z.string().min(1).max(256), tileWidth: z.number().int().min(1).max(8192), tileHeight: z.number().int().min(1).max(8192), columns: z.number().int().min(1), tileCount: z.number().int().min(1), atlasImageId: id, emptyTileId: z.number().int().min(0), spacing: z.number().int().min(0).optional(), margin: z.number().int().min(0).optional(), tileMetadata: z.record(z.string(), z.object({ name: z.string().max(256).optional(), metadata: z.unknown().optional() }).strict()).optional() }).strict();
const rectSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }).strict();
const pointSchema = z.object({ x: z.number().int(), y: z.number().int() }).strict();
const sliceSchema = z.object({ id, name: z.string().min(1).max(256), bounds: rectSchema, center: rectSchema.optional(), pivot: pointSchema.optional() }).strict();
const canvasV4Schema = z.object({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), colorMode: z.enum(["rgba", "indexed"]), colorSpace: z.literal("srgb"), transparentIndex: z.number().int().min(0).max(255).optional() }).strict();
export const documentV4Schema = z.object({ schemaVersion: z.literal(4), id, name: z.string().min(1).max(256), canvas: canvasV4Schema, rootLayerIds: z.array(id).min(1).max(10_000), layers: z.record(z.string(), layerV4Schema), frameOrder: z.array(id).min(1).max(10_000), frames: z.record(z.string(), frameSchema), cels: z.record(z.string(), celV4Schema), celByLayerAndFrame: z.record(z.string(), id), images: z.record(z.string(), storedImageV4Schema), tilemaps: z.record(z.string(), tilemapMetaSchema), tileSets: z.record(z.string(), tileSetSchema), palette: paletteV4Schema, tags: z.record(z.string(), tagSchema), slices: z.record(z.string(), sliceSchema), metadata: z.record(z.string(), z.unknown()), revision: z.number().int().min(0) }).strict();
export const documentSchema = documentV4Schema;
const storedDocumentSchema = z.union([documentV1Schema, documentV2Schema, documentV3Schema, documentV4Schema]);

export const manifestSchema = z.object({ format: z.literal("suwol-pixel-studio"), schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), createdWith: z.string().min(1), documentId: id, mimeType: z.literal(SUWOL_PIXEL_MIME) }).strict();
export type SuwolPixelManifest = z.infer<typeof manifestSchema>;

export function serializeSuwolPixel(snapshot: DocumentSnapshot, appVersion: string): Uint8Array { return zipSync(createArchiveFiles(snapshot, appVersion), { level: 6 }); }
export function serializeSuwolPixelAsync(snapshot: DocumentSnapshot, appVersion: string): Promise<Uint8Array> { return new Promise((resolve, reject) => zip(createArchiveFiles(snapshot, appVersion), { level: 6 }, (error, data) => error === null ? resolve(data) : reject(error))); }

function createArchiveFiles(snapshot: DocumentSnapshot, appVersion: string): Zippable {
  const model = cloneDocumentModel(snapshot.model);
  model.layerOrder = flattenLayerTree(model);
  model.palette.entries = model.palette.entries.map((entry, index) => ({ ...entry, index }));
  model.palette.colors = model.palette.entries;
  recountImageReferences(model);
  validateSnapshotBuffers({ ...snapshot, model });
  assertDocumentIntegrity(model);
  const manifest: SuwolPixelManifest = { format: "suwol-pixel-studio", schemaVersion: 4, createdWith: appVersion, documentId: model.id, mimeType: SUWOL_PIXEL_MIME };
  const stored = toStoredV4(model), files: Zippable = { mimetype: [strToU8(SUWOL_PIXEL_MIME), { level: 0 }], "manifest.json": strToU8(JSON.stringify(manifest)), "document.json": strToU8(JSON.stringify(stored)) };
  for (const [imageId, bytes] of snapshot.images) {
    const meta = model.images[imageId];
    if (meta === undefined) throw new Error("Snapshot contains an orphan image blob.");
    files[`images/${imageId}.${meta.format === "rgba8" ? "rgba" : "idx"}`] = bytes;
  }
  for (const [tilemapId, cells] of snapshot.tilemaps ?? []) {
    if (model.tilemaps[tilemapId] === undefined) throw new Error("Snapshot contains an orphan tilemap blob.");
    files[`tilemaps/${tilemapId}.tile32`] = tilemapToLittleEndian(cells);
  }
  const pluginData = model.pluginData ?? {};
  let pluginBytes = 0;
  for (const [pluginId, value] of Object.entries(pluginData)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId)) throw new Error("Plugin data namespace is invalid.");
    const bytes = strToU8(JSON.stringify(value));
    pluginBytes += bytes.byteLength;
    if (bytes.byteLength > 1024 * 1024 || pluginBytes > 5 * 1024 * 1024) throw new Error("Plugin document data exceeds the size limit.");
    files[`plugin-data/${pluginId}.json`] = bytes;
  }
  files["thumbnail.png"] = createThumbnailPng({ ...snapshot, model });
  return files;
}

function toStoredV4(model: PixelDocument): z.infer<typeof documentV4Schema> {
  return documentV4Schema.parse({
    schemaVersion: 4, id: model.id, name: model.name, canvas: model.canvas,
    rootLayerIds: model.rootLayerIds, layers: model.layers, frameOrder: model.frameOrder,
    frames: model.frames, cels: model.cels, celByLayerAndFrame: model.celByLayerAndFrame,
    images: Object.fromEntries(Object.entries(model.images).map(([imageId, image]) => [imageId, { id: image.id, width: image.width, height: image.height, format: image.format }])),
    tilemaps: Object.fromEntries(Object.entries(model.tilemaps).map(([tilemapId, tilemap]) => [tilemapId, { id: tilemap.id, widthInTiles: tilemap.widthInTiles, heightInTiles: tilemap.heightInTiles, format: tilemap.format }])),
    tileSets: model.tileSets, palette: { entries: model.palette.entries, transparentIndex: model.palette.transparentIndex, maxSize: model.palette.maxSize }, tags: model.tags, slices: model.slices, metadata: model.metadata, revision: model.revision,
  });
}

export function createThumbnailPng(snapshot: DocumentSnapshot): Uint8Array {
  const composite = compositeSnapshot(snapshot), scale = Math.min(1, 128 / Math.max(snapshot.model.canvas.width, snapshot.model.canvas.height)), width = Math.max(1, Math.round(snapshot.model.canvas.width * scale)), height = Math.max(1, Math.round(snapshot.model.canvas.height * scale)), thumbnail = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const sx = Math.min(snapshot.model.canvas.width - 1, Math.floor(x / scale)), sy = Math.min(snapshot.model.canvas.height - 1, Math.floor(y / scale)), offset = (sy * snapshot.model.canvas.width + sx) * 4; thumbnail.set(composite.subarray(offset, offset + 4), (y * width + x) * 4); }
  return encodePng(width, height, thumbnail);
}

export function deserializeSuwolPixel(archive: Uint8Array): DocumentSnapshot {
  if (archive.byteLength < 22 || archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Archive size is invalid.");
  const entries = inspectZip(archive), allowed = new Set(["mimetype", "manifest.json", "document.json", "thumbnail.png"]), files = unzipSync(archive, { filter(file: UnzipFileInfo) { validateEntryName(file.name); if (!allowed.has(file.name) && !/^images\/[a-zA-Z0-9._-]+\.(?:rgba|idx)$/.test(file.name) && !/^tilemaps\/[a-zA-Z0-9._-]+\.tile32$/.test(file.name) && !/^plugin-data\/[a-z0-9]+(?:[.-][a-z0-9]+)+\.json$/.test(file.name)) throw new Error("Archive contains an unsupported entry."); return true; } });
  if (entries.length !== Object.keys(files).length) throw new Error("Archive entry count is inconsistent.");
  const mimetype = files.mimetype, manifestBytes = files["manifest.json"], documentBytes = files["document.json"];
  if (mimetype === undefined || manifestBytes === undefined || documentBytes === undefined) throw new Error("Archive is missing required entries.");
  if (strFromU8(mimetype) !== SUWOL_PIXEL_MIME) throw new Error("Archive mimetype is invalid.");
  const manifest = manifestSchema.parse(parseJson(manifestBytes)), stored = storedDocumentSchema.parse(parseJson(documentBytes));
  if (manifest.schemaVersion !== stored.schemaVersion) throw new Error("Manifest and document schema versions do not match.");
  const model = migrateStoredDocument(stored), pluginData: Record<string, unknown> = {};
  let pluginBytes = 0;
  for (const [name, bytes] of Object.entries(files)) { const match = /^plugin-data\/(.+)\.json$/.exec(name); if (match?.[1] === undefined) continue; pluginBytes += bytes.byteLength; if (bytes.byteLength > 1024 * 1024 || pluginBytes > 5 * 1024 * 1024) throw new Error("Plugin document data exceeds the size limit."); pluginData[match[1]] = parseJson(bytes); }
  model.pluginData = { ...(model.pluginData ?? {}), ...pluginData };
  if (manifest.documentId !== model.id) throw new Error("Manifest document id does not match document data.");
  const images = new Map<string, Uint8Array>();
  for (const [imageId, meta] of Object.entries(model.images)) {
    const extension = meta.format === "rgba8" ? "rgba" : "idx", bytes = files[`images/${imageId}.${extension}`], expected = meta.width * meta.height * (meta.format === "rgba8" ? 4 : 1);
    if (bytes?.byteLength !== expected) throw new Error("Image blob length is invalid.");
    if (meta.format === "indexed8") for (const index of bytes) if (!model.palette.entries.some((entry) => entry.index === index)) throw new Error("Indexed image references an undefined palette slot.");
    images.set(imageId, bytes.slice());
  }
  const tilemaps = new Map<string, Uint32Array>();
  for (const [tilemapId, meta] of Object.entries(model.tilemaps)) { const bytes = files[`tilemaps/${tilemapId}.tile32`]; if (bytes?.byteLength !== meta.widthInTiles * meta.heightInTiles * 4) throw new Error("Tilemap blob length is invalid."); tilemaps.set(tilemapId, tilemapFromLittleEndian(bytes)); }
  recountImageReferences(model);
  model.layerOrder = flattenLayerTree(model);
  assertDocumentIntegrity(model);
  for (const image of Object.values(model.images)) if (image.refCount === 0 && !Object.values(model.tileSets).some((tileSet) => tileSet.atlasImageId === image.id)) throw new Error("Document contains an orphan image.");
  const snapshot = { model: cloneDocumentModel(model), images, tilemaps };
  validateSnapshotBuffers(snapshot);
  return snapshot;
}

type StoredDocument = z.infer<typeof storedDocumentSchema>;
function migrateStoredDocument(stored: StoredDocument): PixelDocument {
  if (stored.schemaVersion === 4) return inflateV4(stored);
  const v2 = stored.schemaVersion === 1 ? { ...stored, schemaVersion: 2 as const, palette: { colors: [] } } : stored;
  let v3: z.infer<typeof documentV3Schema>;
  if (v2.schemaVersion === 3) v3 = v2;
  else {
    const frameId = "frame-migrated-1", cels: Record<string, z.infer<typeof legacyCelSchema>> = {}, lookup: Record<string, string> = {}, layers: Record<string, z.infer<typeof documentV3Schema>["layers"][string]> = {};
    for (const layerId of v2.layerOrder) { const legacy = v2.layers[layerId]; if (legacy === undefined) throw new Error("Legacy layer is missing."); const { imageId, ...layer } = legacy, celId = `cel-migrated-${layerId}`; layers[layerId] = layer; cels[celId] = { id: celId, layerId, frameId, imageId, x: 0, y: 0, opacity: 1 }; lookup[celKey(layerId, frameId)] = celId; }
    v3 = { schemaVersion: 3, id: v2.id, name: v2.name, canvas: v2.canvas, layerOrder: [...v2.layerOrder], layers, frameOrder: [frameId], frames: { [frameId]: { id: frameId, durationMs: 100 } }, cels, celByLayerAndFrame: lookup, images: v2.images, palette: v2.palette, tags: {}, pluginData: {}, revision: v2.revision };
  }
  const paletteEntries = v3.palette.colors.map((color, index) => paletteEntryFromLegacy(color, index)), layers = Object.fromEntries(Object.entries(v3.layers).map(([layerId, layer]) => [layerId, { ...layer, kind: "pixel" as const, parentId: null, blendMode: "normal" as const }])), cels = Object.fromEntries(Object.entries(v3.cels).map(([celId, cel]) => [celId, { ...cel, kind: "pixel" as const }]));
  const model: PixelDocument = { schemaVersion: 4, id: v3.id, name: v3.name, canvas: { ...v3.canvas, colorMode: "rgba" }, rootLayerIds: [...v3.layerOrder], layerOrder: [...v3.layerOrder], layers, frameOrder: [...v3.frameOrder], frames: structuredClone(v3.frames), cels, celByLayerAndFrame: { ...v3.celByLayerAndFrame }, images: Object.fromEntries(Object.entries(v3.images).map(([imageId, image]) => [imageId, { ...image, format: "rgba8" as const, refCount: 0 }])), tilemaps: {}, tileSets: {}, palette: { entries: paletteEntries, colors: paletteEntries, transparentIndex: null, maxSize: 256 }, tags: structuredClone(v3.tags), slices: {}, metadata: {}, pluginData: structuredClone(v3.pluginData ?? {}), revision: v3.revision };
  recountImageReferences(model);
  return model;
}

function inflateV4(stored: z.infer<typeof documentV4Schema>): PixelDocument {
  const entries: PaletteEntry[] = stored.palette.entries.map((entry) => ({ id: entry.id, index: entry.index, rgba: entry.rgba, ...(entry.name === undefined ? {} : { name: entry.name }), ...(entry.locked === undefined ? {} : { locked: entry.locked }) }));
  const cloned = structuredClone(stored),
    canvas: PixelDocument["canvas"] = {
      width: cloned.canvas.width,
      height: cloned.canvas.height,
      colorMode: cloned.canvas.colorMode,
      colorSpace: "srgb",
      ...(cloned.canvas.transparentIndex === undefined
        ? {}
        : { transparentIndex: cloned.canvas.transparentIndex }),
    },
    model: PixelDocument = {
      ...cloned,
      canvas,
      schemaVersion: 4,
      layerOrder: [],
      images: Object.fromEntries(Object.entries(stored.images).map(([imageId, image]) => [imageId, { ...image, refCount: 0 }])),
      tilemaps: Object.fromEntries(Object.entries(stored.tilemaps).map(([tilemapId, tilemap]) => [tilemapId, { ...tilemap, refCount: 0 }])),
      tileSets: cloned.tileSets as unknown as PixelDocument["tileSets"],
      slices: cloned.slices as unknown as PixelDocument["slices"],
      palette: { entries, colors: entries, transparentIndex: stored.palette.transparentIndex, maxSize: stored.palette.maxSize },
      pluginData: {},
    };
  model.layerOrder = flattenLayerTree(model);
  recountImageReferences(model);
  return model;
}

function paletteEntryFromLegacy(color: z.infer<typeof legacyPaletteColorSchema>, index: number): PaletteEntry { return { id: color.id, index, rgba: color.rgba, ...(color.name === undefined ? {} : { name: color.name }) }; }
function validateSnapshotBuffers(snapshot: DocumentSnapshot): void { for (const [imageId, meta] of Object.entries(snapshot.model.images)) { const bytes = snapshot.images.get(imageId), expected = meta.width * meta.height * (meta.format === "rgba8" ? 4 : 1); if (bytes?.byteLength !== expected) throw new Error(`Image ${imageId} blob length is invalid.`); } for (const [tilemapId, meta] of Object.entries(snapshot.model.tilemaps)) if (snapshot.tilemaps?.get(tilemapId)?.length !== meta.widthInTiles * meta.heightInTiles) throw new Error(`Tilemap ${tilemapId} blob length is invalid.`); }
function parseJson(bytes: Uint8Array): unknown { try { return JSON.parse(strFromU8(bytes)) as unknown; } catch { throw new Error("Archive JSON is malformed."); } }
function validateEntryName(name: string): void { if (name === "" || name.startsWith("/") || name.includes("\\") || name.includes(":") || name.split("/").includes("..")) throw new Error("Archive entry path is unsafe."); }
function inspectZip(data: Uint8Array): readonly string[] { const view = new DataView(data.buffer, data.byteOffset, data.byteLength); let eocd = -1; for (let offset = data.byteLength - 22; offset >= Math.max(0, data.byteLength - 65_557); offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; } if (eocd < 0) throw new Error("ZIP end record is missing."); const count = view.getUint16(eocd + 10, true), centralOffset = view.getUint32(eocd + 16, true); if (count < 1 || count > MAX_ENTRY_COUNT) throw new Error("Archive entry count exceeds the limit."); let offset = centralOffset, expandedBytes = 0; const names: string[] = []; for (let index = 0; index < count; index += 1) { if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP central directory is malformed."); const compressedSize = view.getUint32(offset + 20, true), originalSize = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), externalAttributes = view.getUint32(offset + 38, true), nameStart = offset + 46, nameEnd = nameStart + nameLength; if (nameEnd > data.byteLength) throw new Error("ZIP entry name is malformed."); const name = new TextDecoder().decode(data.subarray(nameStart, nameEnd)); validateEntryName(name); if (((externalAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("Archive symlinks are not allowed."); expandedBytes += originalSize; if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error("Archive expands beyond the supported limit."); if (originalSize > 1024 * 1024 && compressedSize > 0 && originalSize / compressedSize > 1_000) throw new Error("Archive compression ratio is unsafe."); names.push(name); offset = nameEnd + extraLength + commentLength; } if (new Set(names).size !== names.length) throw new Error("Archive contains duplicate entries."); return names; }
