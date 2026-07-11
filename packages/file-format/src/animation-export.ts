import { zlibSync } from "fflate";
import {
  IndexedPixelSurface,
  RgbaPixelSurface,
  compositeFrame,
  type DocumentSnapshot,
  type FrameId,
  type PixelSource,
  type Rgba,
} from "@suwol/editor-core";
import { encodePng } from "./png";

export interface AnimationFramePixels {
  readonly frameId: FrameId;
  readonly durationMs: number;
  readonly rgba: Uint8Array;
}
export interface ExportFileEntry {
  readonly relativePath: string;
  readonly data: Uint8Array;
}
export interface PngSequenceOptions {
  readonly prefix: string;
  readonly digits: number;
  readonly startNumber: 0 | 1;
  readonly frameIds?: readonly FrameId[];
}
export type SpriteSheetLayout = "horizontal" | "vertical" | "grid";
export interface SpriteSheetOptions {
  readonly layout: SpriteSheetLayout;
  readonly columns: number;
  readonly spacing: number;
  readonly padding: number;
  readonly imageName: string;
  readonly includeJson: boolean;
  readonly frameIds?: readonly FrameId[];
}
export interface GifExportOptions {
  readonly loopCount: number;
  readonly scale: 1 | 2 | 4;
  readonly transparentThreshold: number;
  readonly background: Rgba;
}
export interface ApngExportOptions {
  readonly loopCount: number;
  readonly scale: 1 | 2 | 4;
}

export function renderAnimationFrames(
  snapshot: DocumentSnapshot,
  frameIds: readonly FrameId[] = snapshot.model.frameOrder,
): readonly AnimationFramePixels[] {
  const source = snapshotSource(snapshot);
  return frameIds.map((frameId) => {
    const frame = snapshot.model.frames[frameId];
    if (frame === undefined) throw new Error("Export frame does not exist.");
    return { frameId, durationMs: frame.durationMs, rgba: compositeFrame(source, frameId) };
  });
}

export function pngSequenceFileName(
  prefix: string,
  index: number,
  digits: number,
): string {
  const safe = animationFileStem(prefix),
    width = Math.min(12, Math.max(1, Math.round(digits)));
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Sequence index is invalid.");
  return `${safe}_${String(index).padStart(width, "0")}.png`;
}

export function exportPngSequence(
  snapshot: DocumentSnapshot,
  options: PngSequenceOptions,
): readonly ExportFileEntry[] {
  return renderAnimationFrames(snapshot, options.frameIds).map((frame, index) => ({
    relativePath: pngSequenceFileName(options.prefix, index + options.startNumber, options.digits),
    data: encodePng(snapshot.model.canvas.width, snapshot.model.canvas.height, frame.rgba),
  }));
}

export interface SpriteSheetResult {
  readonly png: Uint8Array;
  readonly json: Uint8Array | null;
  readonly width: number;
  readonly height: number;
}

export function exportSpriteSheet(
  snapshot: DocumentSnapshot,
  options: SpriteSheetOptions,
): SpriteSheetResult {
  const frames = renderAnimationFrames(snapshot, options.frameIds),
    count = frames.length;
  if (count < 1) throw new Error("Sprite sheet requires at least one frame.");
  const columns =
      options.layout === "vertical"
        ? 1
        : options.layout === "horizontal"
          ? count
          : Math.min(count, Math.max(1, Math.round(options.columns))),
    rows = Math.ceil(count / columns),
    spacing = checkedNonNegative(options.spacing, 1024, "Spacing"),
    padding = checkedNonNegative(options.padding, 1024, "Padding"),
    cellWidth = snapshot.model.canvas.width,
    cellHeight = snapshot.model.canvas.height,
    width = padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * spacing,
    height = padding * 2 + rows * cellHeight + Math.max(0, rows - 1) * spacing;
  validateOutputDimensions(width, height);
  const rgba = new Uint8Array(width * height * 4),
    placements = frames.map((frame, index) => {
      const column = index % columns,
        row = Math.floor(index / columns),
        x = padding + column * (cellWidth + spacing),
        y = padding + row * (cellHeight + spacing);
      blit(rgba, width, frame.rgba, cellWidth, cellHeight, x, y);
      return {
        index,
        frameId: frame.frameId,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        durationMs: frame.durationMs,
      };
    }),
    imageName = `${animationFileStem(options.imageName)}.png`,
    exportedIds = frames.map((frame) => frame.frameId),
    tags = Object.values(snapshot.model.tags)
      .map((tag) => ({
        name: tag.name,
        from: exportedIds.indexOf(tag.fromFrameId),
        to: exportedIds.indexOf(tag.toFrameId),
        playback: tag.playback,
      }))
      .filter((tag) => tag.from >= 0 && tag.to >= 0),
    metadata = {
      format: "suwol-pixel-studio-spritesheet",
      version: 1,
      image: imageName,
      size: { width, height },
      frames: placements,
      tags,
    };
  return {
    png: encodePng(width, height, rgba),
    json: options.includeJson ? new TextEncoder().encode(JSON.stringify(metadata, null, 2)) : null,
    width,
    height,
  };
}

export function gifDelayCentiseconds(durationMs: number): number {
  return Math.min(65_535, Math.max(2, Math.round(durationMs / 10)));
}

export interface InspectedGifFrame {
  readonly delayCentiseconds: number;
  readonly transparentIndex: number | null;
  readonly indices: Uint8Array;
}

export function inspectGif(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly palette: readonly (readonly [number, number, number])[];
  readonly frames: readonly InspectedGifFrame[];
} {
  if (new TextDecoder().decode(bytes.subarray(0, 6)) !== "GIF89a")
    throw new Error("GIF signature is invalid.");
  const readWord = (offset: number) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8),
    width = readWord(6),
    height = readWord(8),
    packed = bytes[10] ?? 0,
    globalColors = (packed & 0x80) === 0 ? 0 : 2 << (packed & 0x07);
  let offset = 13;
  const palette = Array.from({ length: globalColors }, () => {
    const color = [bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0] as const;
    offset += 3;
    return color;
  });
  let delay = 0,
    transparentIndex: number | null = null;
  const frames: InspectedGifFrame[] = [];
  const subBlocks = () => {
    const parts: Uint8Array[] = [];
    while (offset < bytes.length) {
      const length = bytes[offset] ?? 0;
      offset += 1;
      if (length === 0) break;
      parts.push(bytes.subarray(offset, offset + length));
      offset += length;
    }
    return concatBytes(...parts);
  };
  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[offset];
      offset += 1;
      if (label === 0xf9) {
        const length = bytes[offset] ?? 0;
        offset += 1;
        if (length !== 4) throw new Error("GIF graphic control block is invalid.");
        const flags = bytes[offset] ?? 0;
        delay = readWord(offset + 1);
        transparentIndex = (flags & 1) === 1 ? (bytes[offset + 3] ?? 0) : null;
        offset += length + 1;
      } else subBlocks();
      continue;
    }
    if (marker !== 0x2c) throw new Error("GIF block marker is invalid.");
    const frameWidth = readWord(offset + 4),
      frameHeight = readWord(offset + 6),
      imagePacked = bytes[offset + 8] ?? 0;
    offset += 9;
    if ((imagePacked & 0x80) !== 0) offset += (2 << (imagePacked & 0x07)) * 3;
    const minimumCodeSize = bytes[offset] ?? 0;
    offset += 1;
    const indices = decodeGifLzw(subBlocks(), minimumCodeSize, frameWidth * frameHeight);
    frames.push({ delayCentiseconds: delay, transparentIndex, indices });
    delay = 0;
    transparentIndex = null;
  }
  return { width, height, palette, frames };
}

export function encodeGifAnimation(
  frames: readonly AnimationFramePixels[],
  width: number,
  height: number,
  options: GifExportOptions,
): Uint8Array {
  if (frames.length < 1 || frames.length > 10_000) throw new Error("GIF frame count is invalid.");
  const scale = options.scale,
    outputWidth = width * scale,
    outputHeight = height * scale;
  if (outputWidth > 65_535 || outputHeight > 65_535)
    throw new RangeError("GIF dimensions exceed the format limit.");
  const bytes: number[] = [],
    push = (...values: number[]) => bytes.push(...values.map((value) => value & 0xff)),
    word = (value: number) => push(value, value >>> 8);
  push(...new TextEncoder().encode("GIF89a"));
  word(outputWidth);
  word(outputHeight);
  push(0xf7, 0, 0);
  for (let index = 0; index < 256; index += 1) {
    const color = gifPaletteColor(index);
    push(color[0], color[1], color[2]);
  }
  push(0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 0x03, 0x01);
  word(Math.min(65_535, Math.max(0, Math.round(options.loopCount))));
  push(0x00);
  for (const frame of frames) {
    const rgba = scale === 1 ? frame.rgba : scaleNearest(frame.rgba, width, height, scale),
      indexed = quantizeGif(rgba, options.transparentThreshold, options.background);
    push(0x21, 0xf9, 0x04, 0x05);
    word(gifDelayCentiseconds(frame.durationMs));
    push(0x00, 0x00);
    push(0x2c);
    word(0);
    word(0);
    word(outputWidth);
    word(outputHeight);
    push(0x00, 0x08);
    const compressed = gifLzw(indexed);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.subarray(offset, offset + 255);
      push(block.length, ...block);
    }
    push(0x00);
  }
  push(0x3b);
  return Uint8Array.from(bytes);
}

export function encodeApngAnimation(
  frames: readonly AnimationFramePixels[],
  width: number,
  height: number,
  options: ApngExportOptions,
): Uint8Array {
  if (frames.length < 1 || frames.length > 10_000) throw new Error("APNG frame count is invalid.");
  const outputWidth = width * options.scale,
    outputHeight = height * options.scale;
  validateOutputDimensions(outputWidth, outputHeight);
  const chunks: Uint8Array[] = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", concatBytes(u32(outputWidth), u32(outputHeight), Uint8Array.from([8, 6, 0, 0, 0]))),
    pngChunk("acTL", concatBytes(u32(frames.length), u32(Math.max(0, Math.round(options.loopCount))))),
  ];
  let sequence = 0;
  frames.forEach((frame, index) => {
    const rgba = options.scale === 1 ? frame.rgba : scaleNearest(frame.rgba, width, height, options.scale),
      scanlines = pngScanlines(rgba, outputWidth, outputHeight),
      compressed = zlibSync(scanlines, { level: 9 }),
      duration = Math.min(65_535, Math.max(1, Math.round(frame.durationMs)));
    chunks.push(
      pngChunk(
        "fcTL",
        concatBytes(
          u32(sequence++),
          u32(outputWidth),
          u32(outputHeight),
          u32(0),
          u32(0),
          u16(duration),
          u16(1000),
          Uint8Array.from([0, 0]),
        ),
      ),
    );
    if (index === 0) chunks.push(pngChunk("IDAT", compressed));
    else chunks.push(pngChunk("fdAT", concatBytes(u32(sequence++), compressed)));
  });
  chunks.push(pngChunk("IEND", new Uint8Array()));
  return concatBytes(...chunks);
}

export function inspectApng(bytes: Uint8Array): { readonly frames: number; readonly delays: readonly number[] } {
  const signature = bytes.subarray(0, 8);
  if (!signature.every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]))
    throw new Error("APNG signature is invalid.");
  let offset = 8,
    frames = 0;
  const delays: number[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset),
      type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)),
      data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "acTL") frames = readU32(data, 0);
    if (type === "fcTL") {
      const numerator = ((data[20] ?? 0) << 8) | (data[21] ?? 0),
        denominator = ((data[22] ?? 0) << 8) | (data[23] ?? 0);
      delays.push((numerator * 1000) / (denominator || 100));
    }
    offset += 12 + length;
  }
  return { frames, delays };
}

function snapshotSource(snapshot: DocumentSnapshot): PixelSource {
  const palette = snapshot.model.palette.entries.map((entry) => entry.rgba),
    transparentIndex = snapshot.model.palette.transparentIndex ?? 0;
  const surfaces = new Map(
    Object.entries(snapshot.model.images).map(([imageId, meta]) => {
      const bytes = snapshot.images.get(imageId);
      if (bytes === undefined) throw new Error("Snapshot image is missing.");
      return [
        imageId,
        meta.format === "indexed8"
          ? new IndexedPixelSurface(meta.width, meta.height, bytes, palette, transparentIndex)
          : new RgbaPixelSurface(meta.width, meta.height, bytes),
      ] as const;
    }),
  );
  return {
    model: snapshot.model,
    getSurface(imageId) {
      const surface = surfaces.get(imageId);
      if (surface === undefined) throw new Error("Snapshot image is missing.");
      return surface;
    },
    getTilemapCells(tilemapImageId) {
      const cells = snapshot.tilemaps?.get(tilemapImageId);
      if (cells === undefined) throw new Error("Snapshot tilemap is missing.");
      return cells;
    },
  };
}
export function animationFileStem(input: string): string {
  const normalized = input
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replaceAll("\u0000", "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[^a-zA-Z0-9]+/g, "")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return normalized || "animation";
}
function checkedNonNegative(value: number, maximum: number, label: string): number {
  const integer = Math.round(value);
  if (!Number.isFinite(value) || integer < 0 || integer > maximum)
    throw new RangeError(`${label} is outside the supported range.`);
  return integer;
}
function validateOutputDimensions(width: number, height: number): void {
  const bytes = width * height * 4;
  if (
    !Number.isSafeInteger(bytes) ||
    width < 1 ||
    height < 1 ||
    width > 16_384 ||
    height > 16_384 ||
    bytes > 512 * 1024 * 1024
  )
    throw new RangeError("Animation output exceeds the safe memory budget.");
}
function blit(
  target: Uint8Array,
  targetWidth: number,
  source: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): void {
  for (let row = 0; row < height; row += 1)
    target.set(
      source.subarray(row * width * 4, (row + 1) * width * 4),
      ((y + row) * targetWidth + x) * 4,
    );
}
function scaleNearest(
  source: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Uint8Array {
  const result = new Uint8Array(width * scale * height * scale * 4),
    outputWidth = width * scale;
  for (let y = 0; y < height * scale; y += 1)
    for (let x = 0; x < width * scale; x += 1) {
      const sourceOffset = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      result.set(source.subarray(sourceOffset, sourceOffset + 4), (y * outputWidth + x) * 4);
    }
  return result;
}
function gifPaletteColor(index: number): readonly [number, number, number] {
  if (index === 0) return [0, 0, 0];
  const code = Math.round(((index - 1) * 255) / 254),
    red = Math.round((((code >>> 5) & 7) * 255) / 7),
    green = Math.round((((code >>> 2) & 7) * 255) / 7),
    blue = Math.round(((code & 3) * 255) / 3);
  return [red, green, blue];
}
function quantizeGif(rgba: Uint8Array, threshold: number, background: Rgba): Uint8Array {
  const result = new Uint8Array(rgba.length / 4),
    alphaThreshold = Math.min(255, Math.max(0, Math.round(threshold)));
  for (let pixel = 0; pixel < result.length; pixel += 1) {
    const offset = pixel * 4,
      alpha = rgba[offset + 3] ?? 0;
    if (alpha <= alphaThreshold) {
      result[pixel] = 0;
      continue;
    }
    const blend = (value: number, backgroundValue: number) =>
        Math.round((value * alpha + backgroundValue * (255 - alpha)) / 255),
      red = blend(rgba[offset] ?? 0, background[0]),
      green = blend(rgba[offset + 1] ?? 0, background[1]),
      blue = blend(rgba[offset + 2] ?? 0, background[2]),
      code = ((red >>> 5) << 5) | ((green >>> 5) << 2) | (blue >>> 6);
    result[pixel] = 1 + Math.round((code * 254) / 255);
  }
  return result;
}
function gifLzw(indices: Uint8Array): Uint8Array {
  const clear = 256,
    end = 257;
  let codeSize = 9,
    nextCode = 258,
    bitBuffer = 0,
    bitCount = 0;
  const output: number[] = [],
    dictionary = new Map<string, number>();
  const write = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  const reset = () => {
    dictionary.clear();
    codeSize = 9;
    nextCode = 258;
  };
  write(clear);
  let prefix = String(indices[0] ?? 0);
  for (let index = 1; index < indices.length; index += 1) {
    const symbol = indices[index] ?? 0,
      key = `${prefix},${symbol}`,
      known = dictionary.get(key);
    if (known !== undefined) prefix = String(known);
    else {
      write(Number(prefix));
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
      } else {
        write(clear);
        reset();
      }
      prefix = String(symbol);
    }
  }
  write(Number(prefix));
  write(end);
  if (bitCount > 0) output.push(bitBuffer & 0xff);
  return Uint8Array.from(output);
}
function decodeGifLzw(bytes: Uint8Array, minimumCodeSize: number, expected: number): Uint8Array {
  const clear = 1 << minimumCodeSize,
    end = clear + 1,
    initialSize = end + 1;
  let codeSize = minimumCodeSize + 1,
    bitOffset = 0,
    dictionary: number[][] = [];
  const reset = () => {
      dictionary = Array.from({ length: initialSize }, (_, index) =>
        index < clear ? [index] : [],
      );
      codeSize = minimumCodeSize + 1;
    },
    readCode = () => {
      let value = 0;
      for (let bit = 0; bit < codeSize; bit += 1) {
        const absolute = bitOffset + bit,
          byte = bytes[Math.floor(absolute / 8)] ?? 0;
        value |= ((byte >>> (absolute % 8)) & 1) << bit;
      }
      bitOffset += codeSize;
      return value;
    },
    output: number[] = [];
  reset();
  let previous: number[] | null = null;
  while (bitOffset + codeSize <= bytes.length * 8) {
    const code = readCode();
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === end) break;
    const known = dictionary[code],
      prior: number[] | null = previous;
    let entry: number[] | null = null;
    if (known !== undefined && known.length > 0) entry = known;
    else if (code === dictionary.length && prior !== null)
      entry = [...prior, prior[0] ?? 0];
    if (entry === null) throw new Error("GIF LZW stream is invalid.");
    output.push(...entry);
    if (prior !== null && dictionary.length < 4096) {
      dictionary.push([...prior, entry[0] ?? 0]);
      if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
    if (output.length >= expected) break;
  }
  if (output.length < expected) throw new Error("GIF frame is truncated.");
  return Uint8Array.from(output.slice(0, expected));
}
function pngScanlines(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1)
    result.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return result;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type),
    body = concatBytes(typeBytes, data),
    result = new Uint8Array(12 + data.length);
  result.set(u32(data.length), 0);
  result.set(body, 4);
  result.set(u32(crc32(body)), 8 + data.length);
  return result;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u32(value: number): Uint8Array {
  return Uint8Array.from([value >>> 24, value >>> 16, value >>> 8, value]);
}
function u16(value: number): Uint8Array {
  return Uint8Array.from([value >>> 8, value]);
}
function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}
function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
