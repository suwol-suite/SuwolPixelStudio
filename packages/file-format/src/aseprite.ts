import { Unzlib } from "fflate";
import {
  celKey,
  flattenLayerTree,
  makeId,
  recountImageReferences,
  type BlendMode,
  type DocumentSnapshot,
  type FrameTag,
  type GroupLayer,
  type Layer,
  type PaletteEntry,
  type PixelDocument,
  type Rgba,
  type SliceDefinition,
} from "@suwol/editor-core";

const FILE_MAGIC = 0xa5e0, FRAME_MAGIC = 0xf1fa, MAX_FILE_BYTES = 100 * 1024 * 1024, MAX_FRAMES = 10_000, MAX_LAYERS = 10_000, MAX_PIXELS = 64 * 1024 * 1024;
const CHUNK_LAYER = 0x2004, CHUNK_CEL = 0x2005, CHUNK_TAGS = 0x2018, CHUNK_PALETTE = 0x2019, CHUNK_USER_DATA = 0x2020, CHUNK_SLICE = 0x2022, CHUNK_TILESET = 0x2023;

export interface CompatibilityReport {
  readonly imported: readonly string[];
  readonly converted: readonly string[];
  readonly approximated: readonly string[];
  readonly ignoredChunks: readonly string[];
  readonly unsupported: readonly string[];
  readonly lossWarnings: readonly string[];
  readonly original: Readonly<{ frames: number; layers: number; tags: number }>;
  readonly result: Readonly<{ frames: number; layers: number; tags: number }>;
}
export interface AsepriteImportResult { readonly snapshot: DocumentSnapshot; readonly report: CompatibilityReport; }
export interface AsepriteImportOptions { readonly name?: string; readonly signal?: AbortSignal; readonly onProgress?: (completed: number, total: number) => void; }

interface ParsedLayer { id: string; name: string; type: 0 | 1 | 2; childLevel: number; visible: boolean; opacity: number; blendMode: BlendMode; approximatedBlend: boolean; }
interface ParsedCel { layerIndex: number; frameIndex: number; x: number; y: number; opacity: number; type: number; width?: number; height?: number; pixels?: Uint8Array; linkedFrame?: number; }
interface ParsedFrame { durationMs: number; }

export function importAseprite(bytes: Uint8Array, options: AsepriteImportOptions = {}): AsepriteImportResult {
  if (bytes.byteLength < 128 || bytes.byteLength > MAX_FILE_BYTES) throw new Error("Aseprite file size is outside the supported limit.");
  const reader = new BinaryReader(bytes);
  const declaredSize = reader.u32(), magic = reader.u16(), frameCount = reader.u16(), width = reader.u16(), height = reader.u16(), depth = reader.u16();
  if (declaredSize !== bytes.byteLength || magic !== FILE_MAGIC) throw new Error("Aseprite header is invalid.");
  if (frameCount < 1 || frameCount > MAX_FRAMES || width < 1 || height < 1 || width * height > MAX_PIXELS || ![8, 32].includes(depth)) throw new Error("Aseprite dimensions, frame count, or color depth is unsupported.");
  reader.skip(14);
  const transparentIndex = reader.u8();
  reader.skip(3);
  const declaredColors = reader.u16();
  reader.seek(128);
  const frames: ParsedFrame[] = [], layers: ParsedLayer[] = [], cels: ParsedCel[] = [], tags: FrameTag[] = [], slices: SliceDefinition[] = [], palette = new Map<number, Rgba>(), ignored = new Set<string>(), unsupported = new Set<string>(), approximated: string[] = [];
  let totalChunks = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    abort(options.signal);
    const frameStart = reader.offset, frameBytes = reader.u32();
    if (frameBytes < 16 || frameStart + frameBytes > bytes.byteLength || reader.u16() !== FRAME_MAGIC) throw new Error("Aseprite frame header is invalid or truncated.");
    const oldChunkCount = reader.u16(), durationMs = reader.u16();
    reader.skip(2);
    const newChunkCount = reader.u32(), chunkCount = newChunkCount === 0 ? oldChunkCount : newChunkCount;
    if (chunkCount > 1_000_000 || totalChunks + chunkCount > 2_000_000) throw new Error("Aseprite chunk count exceeds the supported limit.");
    totalChunks += chunkCount;
    frames.push({ durationMs: Math.max(10, Math.min(60_000, durationMs)) });
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      abort(options.signal);
      const chunkStart = reader.offset, chunkBytes = reader.u32(), type = reader.u16(), chunkEnd = chunkStart + chunkBytes;
      if (chunkBytes < 6 || chunkEnd > frameStart + frameBytes || chunkEnd > bytes.byteLength) throw new Error("Aseprite chunk is truncated or has an invalid length.");
      if (type === CHUNK_LAYER) {
        if (layers.length >= MAX_LAYERS) throw new Error("Aseprite layer count exceeds the supported limit.");
        const flags = reader.u16(), layerType = reader.u16(), childLevel = reader.u16();
        reader.skip(4);
        const blendCode = reader.u16(), opacity = reader.u8();
        reader.skip(3);
        const name = reader.string(), mapped = mapBlendMode(blendCode);
        if (layerType === 2) unsupported.add("Tilemap layer content was skipped; the rest of the file was imported.");
        if (mapped.approximated) approximated.push(`${name}: blend mode ${blendCode} → normal`);
        layers.push({ id: makeId(layerType === 1 ? "ase-group" : "ase-layer"), name, type: layerType === 1 ? 1 : layerType === 2 ? 2 : 0, childLevel, visible: (flags & 1) !== 0, opacity: opacity / 255, blendMode: mapped.mode, approximatedBlend: mapped.approximated });
      } else if (type === CHUNK_CEL) {
        const layerIndex = reader.u16(), x = reader.i16(), y = reader.i16(), opacity = reader.u8(), celType = reader.u16();
        reader.skip(7);
        if (layerIndex >= layers.length) throw new Error("Aseprite cel references an invalid layer.");
        const base = { layerIndex, frameIndex, x, y, opacity: opacity / 255, type: celType };
        if (celType === 1) {
          const linkedFrame = reader.u16();
          if (linkedFrame >= frameIndex) throw new Error("Aseprite linked cel references an invalid frame.");
          cels.push({ ...base, linkedFrame });
        } else if (celType === 0 || celType === 2) {
          const celWidth = reader.u16(), celHeight = reader.u16(), expected = checkedPixelBytes(celWidth, celHeight, depth), payload = reader.bytes(chunkEnd - reader.offset), pixels = celType === 0 ? payload.slice() : inflateBounded(payload, expected);
          if (pixels.byteLength !== expected) throw new Error("Aseprite cel pixel length is invalid.");
          cels.push({ ...base, width: celWidth, height: celHeight, pixels });
        } else {
          unsupported.add(`Cel type ${celType} was skipped.`);
        }
      } else if (type === CHUNK_PALETTE) {
        const size = reader.u32(), first = reader.u32(), last = reader.u32();
        reader.skip(8);
        if (size > 256 || first > last || last >= 256) throw new Error("Aseprite palette bounds are invalid.");
        for (let index = first; index <= last; index += 1) {
          const flags = reader.u16(), rgba: Rgba = [reader.u8(), reader.u8(), reader.u8(), reader.u8()];
          if ((flags & 1) !== 0) reader.string();
          palette.set(index, rgba);
        }
      } else if (type === CHUNK_TAGS) {
        const count = reader.u16(); reader.skip(8);
        if (count > frameCount) throw new Error("Aseprite tag count is invalid.");
        for (let index = 0; index < count; index += 1) {
          const from = reader.u16(), to = reader.u16(), direction = reader.u8(); reader.u16(); reader.skip(6); const color: Rgba = [reader.u8(), reader.u8(), reader.u8(), 255]; reader.skip(1); const name = reader.string();
          if (from >= frameCount || to >= frameCount) throw new Error("Aseprite tag frame range is invalid.");
          tags.push({ id: makeId("tag"), name, fromFrameId: String(from), toFrameId: String(to), playback: direction === 1 ? "reverse" : direction === 2 || direction === 3 ? "pingpong" : "forward", color });
        }
      } else if (type === CHUNK_SLICE) {
        const keys = reader.u32(), flags = reader.u32(); reader.skip(4); const name = reader.string();
        if (keys > frameCount * 4) throw new Error("Aseprite slice key count is invalid.");
        for (let key = 0; key < keys; key += 1) {
          const frame = reader.u32(), x = reader.i32(), y = reader.i32(), sliceWidth = reader.u32(), sliceHeight = reader.u32();
          if (frame >= frameCount || sliceWidth < 1 || sliceHeight < 1 || x < 0 || y < 0 || x + sliceWidth > width || y + sliceHeight > height) throw new Error("Aseprite slice bounds are invalid.");
          let center: SliceDefinition["center"], pivot: SliceDefinition["pivot"];
          if ((flags & 1) !== 0) center = { x: reader.i32(), y: reader.i32(), width: reader.u32(), height: reader.u32() };
          if ((flags & 2) !== 0) pivot = { x: reader.i32(), y: reader.i32() };
          if (key === 0) slices.push({ id: makeId("slice"), name, bounds: { x, y, width: sliceWidth, height: sliceHeight }, ...(center === undefined ? {} : { center: { x: x + center.x, y: y + center.y, width: center.width, height: center.height } }), ...(pivot === undefined ? {} : { pivot: { x: x + pivot.x, y: y + pivot.y } }) });
          else ignored.add("Additional frame-specific slice keys");
        }
      } else if (type === CHUNK_TILESET) unsupported.add("Aseprite TileSet chunks are reported but not imported in M5 alpha.");
      else if (type === CHUNK_USER_DATA) ignored.add("User Data not attached to a supported object");
      else ignored.add(`0x${type.toString(16).padStart(4, "0")}`);
      reader.seek(chunkEnd);
    }
    if (reader.offset !== frameStart + frameBytes) reader.seek(frameStart + frameBytes);
    options.onProgress?.(frameIndex + 1, frameCount);
  }
  if (reader.offset !== bytes.byteLength) ignored.add("Trailing bytes");
  if (depth === 8 && palette.size === 0) {
    const count = declaredColors === 0 ? 256 : Math.min(256, declaredColors);
    for (let index = 0; index < count; index += 1) palette.set(index, [index, index, index, 255]);
  }
  return buildSnapshot({ name: options.name ?? "Imported Aseprite", width, height, depth, transparentIndex, frames, layers, cels, palette, tags, slices, ignored, unsupported, approximated });
}

function buildSnapshot(input: Readonly<{ name: string; width: number; height: number; depth: number; transparentIndex: number; frames: ParsedFrame[]; layers: ParsedLayer[]; cels: ParsedCel[]; palette: Map<number, Rgba>; tags: FrameTag[]; slices: SliceDefinition[]; ignored: Set<string>; unsupported: Set<string>; approximated: string[] }>): AsepriteImportResult {
  const frameIds = input.frames.map(() => makeId("frame")), frameByIndex = new Map(frameIds.map((id, index) => [index, id])), layerMap: Record<string, Layer> = {}, rootLayerIds: string[] = [], stack: GroupLayer[] = [];
  for (const layer of input.layers) {
    while (stack.length > layer.childLevel) stack.pop();
    const parent = layer.childLevel === 0 ? null : stack[layer.childLevel - 1];
    if (layer.childLevel > 0 && parent === undefined) throw new Error("Aseprite layer hierarchy is malformed.");
    const common = { id: layer.id, name: layer.name, parentId: parent?.id ?? null, visible: layer.visible, locked: false, opacity: layer.opacity, blendMode: layer.blendMode };
    const modelLayer: Layer = layer.type === 1 ? { ...common, kind: "group", childIds: [] } : { ...common, kind: "pixel" };
    layerMap[layer.id] = modelLayer;
    if (parent === null) rootLayerIds.push(layer.id);
    else if (parent !== undefined) parent.childIds.push(layer.id);
    if (modelLayer.kind === "group") stack[layer.childLevel] = modelLayer;
  }
  if (rootLayerIds.length === 0) {
    const id = makeId("ase-layer"); rootLayerIds.push(id); layerMap[id] = { id, kind: "pixel", name: "Layer 1", parentId: null, visible: true, locked: false, opacity: 1, blendMode: "normal" };
  }
  const paletteEntries: PaletteEntry[] = [...input.palette.entries()].sort(([a], [b]) => a - b).map(([index, rgba]) => ({ id: makeId("palette"), index, rgba })), images = new Map<string, Uint8Array>(), imageMeta: PixelDocument["images"] = {}, cels: PixelDocument["cels"] = {}, lookup: Record<string, string> = {}, sourceImages = new Map<string, string>();
  for (const cel of input.cels) {
    const layer = input.layers[cel.layerIndex], frameId = frameByIndex.get(cel.frameIndex);
    if (layer === undefined || frameId === undefined || layer.type !== 0) continue;
    let imageId: string;
    if (cel.linkedFrame !== undefined) {
      const linked = sourceImages.get(`${cel.layerIndex}:${cel.linkedFrame}`);
      if (linked === undefined) throw new Error("Aseprite linked cel source is missing.");
      imageId = linked;
    } else {
      if (cel.pixels === undefined || cel.width === undefined || cel.height === undefined) continue;
      imageId = makeId("ase-image");
      images.set(imageId, normalizeAsePixels(cel.pixels, input.depth));
      imageMeta[imageId] = { id: imageId, width: cel.width, height: cel.height, format: input.depth === 8 ? "indexed8" : "rgba8", refCount: 0 };
    }
    sourceImages.set(`${cel.layerIndex}:${cel.frameIndex}`, imageId);
    const id = makeId("ase-cel");
    cels[id] = { kind: "pixel", id, layerId: layer.id, frameId, imageId, x: cel.x, y: cel.y, opacity: cel.opacity };
    lookup[celKey(layer.id, frameId)] = id;
  }
  const tags: Record<string, FrameTag> = {};
  for (const tag of input.tags) {
    const from = frameByIndex.get(Number(tag.fromFrameId)), to = frameByIndex.get(Number(tag.toFrameId));
    if (from === undefined || to === undefined) throw new Error("Aseprite tag range is invalid.");
    tags[tag.id] = { ...tag, fromFrameId: from, toFrameId: to };
  }
  const entries = input.depth === 8 ? paletteEntries : [],
    frames: PixelDocument["frames"] = {}, slices: PixelDocument["slices"] = {};
  input.frames.forEach((frame, index) => {
    const id = frameIds[index];
    if (id === undefined) throw new Error("Aseprite frame id is missing.");
    frames[id] = { id, durationMs: frame.durationMs };
  });
  for (const slice of input.slices) slices[slice.id] = slice;
  const model: PixelDocument = { schemaVersion: 4, id: makeId("document"), name: input.name, canvas: { width: input.width, height: input.height, colorMode: input.depth === 8 ? "indexed" : "rgba", colorSpace: "srgb", ...(input.depth === 8 ? { transparentIndex: input.transparentIndex } : {}) }, rootLayerIds, layerOrder: [], layers: layerMap, frameOrder: frameIds, frames, cels, celByLayerAndFrame: lookup, images: imageMeta, tilemaps: {}, tileSets: {}, palette: { entries, colors: entries, transparentIndex: input.depth === 8 ? input.transparentIndex : null, maxSize: 256 }, tags, slices, metadata: {}, pluginData: {}, revision: 0 };
  model.layerOrder = flattenLayerTree(model); recountImageReferences(model);
  const report: CompatibilityReport = { imported: ["Frames and durations", input.depth === 8 ? "Indexed pixels and palette" : "RGBA pixels", "Pixel and Group layers", "Raw, compressed, and linked Cels", ...(input.tags.length > 0 ? ["Frame Tags"] : []), ...(input.slices.length > 0 ? ["Slices and 9-slice metadata"] : [])], converted: ["Aseprite layer hierarchy → Suwol isolated groups"], approximated: input.approximated, ignoredChunks: [...input.ignored], unsupported: [...input.unsupported], lossWarnings: input.approximated.length + input.unsupported.size > 0 ? ["Review approximated or unsupported items before production use."] : [], original: { frames: input.frames.length, layers: input.layers.length, tags: input.tags.length }, result: { frames: frameIds.length, layers: Object.keys(layerMap).length, tags: Object.keys(tags).length } };
  model.metadata.asepriteCompatibilityReport = report;
  return { snapshot: { model, images, tilemaps: new Map() }, report };
}

class BinaryReader {
  readonly #view: DataView; readonly #bytes: Uint8Array; offset = 0;
  constructor(bytes: Uint8Array) { this.#bytes = bytes; this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  seek(offset: number): void { if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.#bytes.length) throw new Error("Aseprite parser attempted an out-of-bounds seek."); this.offset = offset; }
  skip(length: number): void { this.seek(this.offset + length); }
  u8(): number { this.ensure(1); return this.#view.getUint8(this.offset++); }
  u16(): number { this.ensure(2); const value = this.#view.getUint16(this.offset, true); this.offset += 2; return value; }
  i16(): number { this.ensure(2); const value = this.#view.getInt16(this.offset, true); this.offset += 2; return value; }
  u32(): number { this.ensure(4); const value = this.#view.getUint32(this.offset, true); this.offset += 4; return value; }
  i32(): number { this.ensure(4); const value = this.#view.getInt32(this.offset, true); this.offset += 4; return value; }
  bytes(length: number): Uint8Array { this.ensure(length); const result = this.#bytes.subarray(this.offset, this.offset + length); this.offset += length; return result; }
  string(): string { const length = this.u16(); if (length > 4096) throw new Error("Aseprite string exceeds the supported limit."); return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(length)); }
  ensure(length: number): void { if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.#bytes.length) throw new Error("Aseprite file is truncated."); }
}
function checkedPixelBytes(width: number, height: number, depth: number): number { const bytes = width * height * (depth === 32 ? 4 : 1); if (width < 1 || height < 1 || !Number.isSafeInteger(bytes) || width * height > MAX_PIXELS || bytes > MAX_FILE_BYTES * 4) throw new Error("Aseprite Cel allocation exceeds the supported limit."); return bytes; }
function inflateBounded(compressed: Uint8Array, expected: number): Uint8Array {
  try {
    const output = new Uint8Array(expected);
    let offset = 0;
    const failures: Error[] = [];
    const inflater = new Unzlib((chunk, final) => {
      if (failures.length > 0) return;
      if (offset + chunk.byteLength > expected) {
        failures.push(new Error("Decoded Cel exceeds its declared size."));
        return;
      }
      output.set(chunk, offset);
      offset += chunk.byteLength;
      if (final && offset !== expected) failures.push(new Error("Decoded Cel is truncated."));
    });
    inflater.push(compressed, true);
    const failure = failures[0];
    if (failure !== undefined) throw failure;
    if (offset !== expected) throw new Error("Decoded Cel is truncated.");
    return output;
  } catch {
    throw new Error("Aseprite compressed Cel is invalid or exceeds its declared size.");
  }
}
function normalizeAsePixels(pixels: Uint8Array, depth: number): Uint8Array { if (depth === 8) return pixels.slice(); const result = pixels.slice(); for (let offset = 0; offset < result.length; offset += 4) if ((result[offset + 3] ?? 0) === 0) result.fill(0, offset, offset + 4); return result; }
function mapBlendMode(code: number): Readonly<{ mode: BlendMode; approximated: boolean }> { const modes: Partial<Record<number, BlendMode>> = { 0: "normal", 1: "multiply", 2: "screen", 3: "overlay", 4: "darken", 5: "lighten", 6: "color-dodge", 7: "color-burn", 10: "difference", 16: "addition", 17: "subtract" }; const mode = modes[code]; return mode === undefined ? { mode: "normal", approximated: true } : { mode, approximated: false }; }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Aseprite import cancelled.", "AbortError"); }
