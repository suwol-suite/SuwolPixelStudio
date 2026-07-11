import { normalizeRgba, type Rgba } from "./types";

export type QuantizationMethod = "exact" | "median-cut" | "k-means";
export type DitheringMethod = "none" | "floyd-steinberg" | "ordered-bayer-4x4";
export interface IndexedConversionOptions {
  readonly maxColors: number;
  readonly transparentIndex: number;
  readonly alphaThreshold: number;
  readonly quantization: QuantizationMethod;
  readonly dithering: DitheringMethod;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completed: number, total: number) => void;
}
export interface IndexedConversionResult {
  readonly palette: readonly Rgba[];
  readonly indices: Uint8Array;
  readonly transparentIndex: number;
}

interface HistogramColor {
  readonly rgba: Rgba;
  readonly count: number;
  readonly key: number;
}

export function convertRgbaToIndexed(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: IndexedConversionOptions,
): IndexedConversionResult {
  validateInput(rgba, width, height, options);
  throwIfAborted(options.signal);
  const transparentIndex = options.transparentIndex,
    opaqueBudget = options.maxColors - 1,
    histogram = createHistogram(rgba, options.alphaThreshold),
    colors = histogram.length <= opaqueBudget
      ? histogram.map((entry) => entry.rgba)
      : options.quantization === "k-means"
        ? deterministicKMeans(histogram, opaqueBudget, options.signal)
        : medianCut(histogram, opaqueBudget, options.signal),
    palette = insertTransparent(colors, transparentIndex),
    indices = mapPixels(rgba, width, height, palette, options);
  options.onProgress?.(height, height);
  return { palette, indices, transparentIndex };
}

export function indexedToRgba(
  indices: Uint8Array,
  palette: readonly Rgba[],
  transparentIndex: number,
): Uint8Array {
  if (palette.length < 1 || palette.length > 256 || transparentIndex < 0 || transparentIndex >= palette.length)
    throw new RangeError("Indexed palette is invalid.");
  const result = new Uint8Array(indices.length * 4);
  for (let offset = 0; offset < indices.length; offset += 1) {
    const index = indices[offset] ?? transparentIndex;
    if (index >= palette.length) throw new RangeError("Pixel references an undefined palette slot.");
    result.set(index === transparentIndex ? [0, 0, 0, 0] : (palette[index] ?? [0, 0, 0, 0]), offset * 4);
  }
  return result;
}

export function medianCut(
  histogram: readonly HistogramColor[],
  count: number,
  signal?: AbortSignal,
): Rgba[] {
  if (!Number.isInteger(count) || count < 1 || count > 255) throw new RangeError("Quantized color count is invalid.");
  type Box = HistogramColor[];
  const boxes: Box[] = [[...histogram]];
  while (boxes.length < count) {
    throwIfAborted(signal);
    let chosen = -1, chosenRange = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box === undefined || box.length < 2) continue;
      const range = channelRange(box).range;
      if (range > chosenRange) { chosen = index; chosenRange = range; }
    }
    if (chosen < 0) break;
    const box = boxes.splice(chosen, 1)[0];
    if (box === undefined) break;
    const { channel } = channelRange(box);
    box.sort((a, b) => a.rgba[channel] - b.rgba[channel] || a.key - b.key);
    const total = box.reduce((sum, entry) => sum + entry.count, 0);
    let cumulative = 0, split = 1;
    for (; split < box.length; split += 1) {
      cumulative += box[split - 1]?.count ?? 0;
      if (cumulative * 2 >= total) break;
    }
    boxes.push(box.slice(0, split), box.slice(split));
  }
  return boxes.map(weightedAverage).sort(compareRgba);
}

export function deterministicKMeans(
  histogram: readonly HistogramColor[],
  count: number,
  signal?: AbortSignal,
): Rgba[] {
  const seeds = medianCut(histogram, count, signal).map((color) => [...color] as number[]);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    throwIfAborted(signal);
    const sums = seeds.map(() => [0, 0, 0, 0, 0]);
    for (const entry of histogram) {
      const cluster = nearestColor(entry.rgba, seeds as unknown as readonly Rgba[]);
      const sum = sums[cluster];
      if (sum === undefined) continue;
      for (let channel = 0; channel < 4; channel += 1)
        sum[channel] = (sum[channel] ?? 0) + (entry.rgba[channel] ?? 0) * entry.count;
      sum[4] = (sum[4] ?? 0) + entry.count;
    }
    for (let index = 0; index < seeds.length; index += 1) {
      const sum = sums[index], seed = seeds[index];
      if (sum === undefined || seed === undefined || (sum[4] ?? 0) === 0) continue;
      for (let channel = 0; channel < 4; channel += 1)
        seed[channel] = Math.round((sum[channel] ?? 0) / (sum[4] ?? 1));
    }
  }
  return seeds.map((seed) => normalizeRgba(seed as unknown as Rgba)).sort(compareRgba);
}

function createHistogram(rgba: Uint8Array, alphaThreshold: number): HistogramColor[] {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] ?? 0;
    if (alpha < alphaThreshold) continue;
    const key = ((rgba[offset] ?? 0) << 24) | ((rgba[offset + 1] ?? 0) << 16) | ((rgba[offset + 2] ?? 0) << 8) | alpha;
    counts.set(key >>> 0, (counts.get(key >>> 0) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([key, count]) => ({
    key,
    count,
    rgba: [(key >>> 24) & 255, (key >>> 16) & 255, (key >>> 8) & 255, key & 255],
  }));
}

function insertTransparent(colors: readonly Rgba[], index: number): Rgba[] {
  const result = colors.slice(0, 255).map(normalizeRgba);
  result.splice(index, 0, [0, 0, 0, 0]);
  return result;
}

function mapPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: readonly Rgba[],
  options: IndexedConversionOptions,
): Uint8Array {
  const output = new Uint8Array(width * height), cache = new Map<number, number>();
  if (options.dithering === "floyd-steinberg") {
    const work = new Float32Array(rgba.length);
    for (let index = 0; index < rgba.length; index += 1) work[index] = rgba[index] ?? 0;
    for (let y = 0; y < height; y += 1) {
      throwIfAborted(options.signal);
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if ((rgba[offset + 3] ?? 0) < options.alphaThreshold) {
          output[y * width + x] = options.transparentIndex;
          continue;
        }
        const color: Rgba = [clampByte(work[offset] ?? 0), clampByte(work[offset + 1] ?? 0), clampByte(work[offset + 2] ?? 0), clampByte(work[offset + 3] ?? 0)],
          index = nearestColor(color, palette, options.transparentIndex),
          selected = palette[index] ?? [0, 0, 0, 0];
        output[y * width + x] = index;
        diffuse(work, width, height, x + 1, y, color, selected, 7 / 16);
        diffuse(work, width, height, x - 1, y + 1, color, selected, 3 / 16);
        diffuse(work, width, height, x, y + 1, color, selected, 5 / 16);
        diffuse(work, width, height, x + 1, y + 1, color, selected, 1 / 16);
      }
      options.onProgress?.(y + 1, height);
    }
    return output;
  }
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < height; y += 1) {
    throwIfAborted(options.signal);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4, alpha = rgba[offset + 3] ?? 0;
      if (alpha < options.alphaThreshold) { output[y * width + x] = options.transparentIndex; continue; }
      const adjustment = options.dithering === "ordered-bayer-4x4" ? ((bayer[(y % 4) * 4 + (x % 4)] ?? 8) - 7.5) * 4 : 0,
        color: Rgba = [clampByte((rgba[offset] ?? 0) + adjustment), clampByte((rgba[offset + 1] ?? 0) + adjustment), clampByte((rgba[offset + 2] ?? 0) + adjustment), alpha],
        key = options.dithering === "none" ? (((color[0] << 24) | (color[1] << 16) | (color[2] << 8) | color[3]) >>> 0) : -1,
        cached = cache.get(key),
        index = cached ?? nearestColor(color, palette, options.transparentIndex);
      if (key >= 0) cache.set(key, index);
      output[y * width + x] = index;
    }
    options.onProgress?.(y + 1, height);
  }
  return output;
}

function nearestColor(color: Rgba, palette: readonly Rgba[], skip = -1): number {
  let best = 0, distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    if (index === skip) continue;
    const candidate = palette[index] ?? [0, 0, 0, 0], dr = color[0] - candidate[0], dg = color[1] - candidate[1], db = color[2] - candidate[2], da = color[3] - candidate[3], next = 2 * dr * dr + 4 * dg * dg + 3 * db * db + da * da;
    if (next < distance) { distance = next; best = index; }
  }
  return best;
}
function channelRange(colors: readonly HistogramColor[]): Readonly<{ channel: 0 | 1 | 2 | 3; range: number }> {
  let best: 0 | 1 | 2 | 3 = 0, bestRange = -1;
  for (const channel of [0, 1, 2, 3] as const) {
    let min = 255, max = 0;
    for (const color of colors) { min = Math.min(min, color.rgba[channel]); max = Math.max(max, color.rgba[channel]); }
    if (max - min > bestRange) { best = channel; bestRange = max - min; }
  }
  return { channel: best, range: bestRange };
}
function weightedAverage(colors: readonly HistogramColor[]): Rgba {
  const sums = [0, 0, 0, 0], total = colors.reduce((sum, color) => sum + color.count, 0);
  for (const color of colors) for (let channel = 0; channel < 4; channel += 1) sums[channel] = (sums[channel] ?? 0) + (color.rgba[channel] ?? 0) * color.count;
  return normalizeRgba(sums.map((sum) => Math.round(sum / Math.max(1, total))) as unknown as Rgba);
}
function diffuse(work: Float32Array, width: number, height: number, x: number, y: number, source: Rgba, selected: Rgba, factor: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  for (let channel = 0; channel < 3; channel += 1) work[offset + channel] = (work[offset + channel] ?? 0) + ((source[channel] ?? 0) - (selected[channel] ?? 0)) * factor;
}
function compareRgba(a: Rgba, b: Rgba): number { for (let i = 0; i < 4; i += 1) { const delta = (a[i] ?? 0) - (b[i] ?? 0); if (delta !== 0) return delta; } return 0; }
function clampByte(value: number): number { return Math.round(Math.min(255, Math.max(0, value))); }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Conversion cancelled.", "AbortError"); }
function validateInput(rgba: Uint8Array, width: number, height: number, options: IndexedConversionOptions): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new RangeError("RGBA dimensions are invalid.");
  if (!Number.isInteger(options.maxColors) || options.maxColors < 2 || options.maxColors > 256 || !Number.isInteger(options.transparentIndex) || options.transparentIndex < 0 || options.transparentIndex >= options.maxColors || !Number.isInteger(options.alphaThreshold) || options.alphaThreshold < 0 || options.alphaThreshold > 255) throw new RangeError("Indexed conversion options are invalid.");
  if (rgba.byteLength * 5 > 512 * 1024 * 1024) throw new RangeError("Conversion exceeds the memory budget.");
}
