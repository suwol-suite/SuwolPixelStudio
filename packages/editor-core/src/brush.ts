import { pixelPerfectStrokePoints } from "./stroke";
import type { SelectionMask } from "./selection";
import type { IntPoint, IntRect } from "./types";

export type BrushKind = "square" | "circle" | "custom";
export type SymmetryMode = "off" | "horizontal" | "vertical" | "both";
export interface BrushPreset {
  readonly id: string;
  readonly name: string;
  readonly kind: BrushKind;
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly spacing: number;
  readonly angle: 0 | 90 | 180 | 270;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly center: IntPoint;
  /** Bit-packed row-major opacity mask, base64 encoded. */
  readonly mask?: string;
}

export interface SymmetrySettings {
  readonly mode: SymmetryMode;
  readonly axisX: number;
  readonly axisY: number;
}

export interface BrushFootprint {
  readonly points: readonly IntPoint[];
  readonly bounds: IntRect;
}

export interface BrushStampOptions {
  readonly documentBounds?: IntRect;
  readonly selection?: Pick<SelectionMask, "bounds" | "contains"> | null;
  readonly symmetry?: SymmetrySettings;
}

export function pixelPerfectPoints(input: readonly IntPoint[]): IntPoint[] {
  return deduplicatePoints(pixelPerfectStrokePoints(input));
}

export function symmetryPoints(point: IntPoint, settings: SymmetrySettings): IntPoint[] {
  const x = Math.round(point.x), y = Math.round(point.y), result: IntPoint[] = [{ x, y }];
  if (settings.mode === "vertical" || settings.mode === "both") result.push({ x: Math.round(settings.axisX * 2 - x), y });
  if (settings.mode === "horizontal" || settings.mode === "both") result.push({ x, y: Math.round(settings.axisY * 2 - y) });
  if (settings.mode === "both") result.push({ x: Math.round(settings.axisX * 2 - x), y: Math.round(settings.axisY * 2 - y) });
  return deduplicatePoints(result);
}

export function applySymmetry(points: readonly IntPoint[], settings: SymmetrySettings): IntPoint[] {
  return deduplicatePoints(points.flatMap((point) => symmetryPoints(point, settings)));
}

export function brushMask(preset: BrushPreset): Uint8Array {
  validateBrushPreset(preset);
  if (preset.kind === "custom") {
    if (preset.mask === undefined) throw new Error("Custom brush mask is missing.");
    return unpackMask(preset.mask, preset.width * preset.height);
  }
  const mask = new Uint8Array(preset.width * preset.height);
  for (let y = 0; y < preset.height; y += 1)
    for (let x = 0; x < preset.width; x += 1) {
      const inside = preset.kind === "square" || ellipseContains(x, y, preset.width, preset.height);
      if (inside) mask[y * preset.width + x] = 1;
    }
  return mask;
}

export function stampBrush(preset: BrushPreset, position: IntPoint): IntPoint[] {
  const transformed = transformMask(brushMask(preset), preset.width, preset.height, preset.angle, preset.flipX, preset.flipY),
    anchor = transformPoint(
      {
        x: Math.min(preset.width - 1, Math.max(0, Math.round(preset.center.x))),
        y: Math.min(preset.height - 1, Math.max(0, Math.round(preset.center.y))),
      },
      preset.width,
      preset.height,
      preset.angle,
      preset.flipX,
      preset.flipY,
    ),
    result: IntPoint[] = [];
  for (let y = 0; y < transformed.height; y += 1)
    for (let x = 0; x < transformed.width; x += 1)
      if ((transformed.mask[y * transformed.width + x] ?? 0) !== 0)
        result.push({ x: Math.round(position.x) + x - anchor.x, y: Math.round(position.y) + y - anchor.y });
  return result;
}

/** Generates the exact pixels used by both the brush overlay and a committed stamp. */
export function createBrushFootprint(
  brush: BrushPreset,
  documentPoint: IntPoint,
  options: BrushStampOptions = {},
): BrushFootprint {
  const centers = options.symmetry === undefined
      ? [{ x: Math.round(documentPoint.x), y: Math.round(documentPoint.y) }]
      : symmetryPoints(documentPoint, options.symmetry),
    points = deduplicatePoints(centers.flatMap((center) => stampBrush(brush, center))).filter((point) => {
      const bounds = options.documentBounds;
      if (bounds !== undefined && (
        point.x < bounds.x || point.y < bounds.y ||
        point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height
      )) return false;
      const selection = options.selection;
      return selection?.bounds === null || selection === undefined || selection === null
        ? true
        : selection.contains(point.x, point.y);
    });
  if (points.length === 0)
    return { points, bounds: { x: Math.round(documentPoint.x), y: Math.round(documentPoint.y), width: 0, height: 0 } };
  let minX = points[0]?.x ?? 0,
    minY = points[0]?.y ?? 0,
    maxX = minX,
    maxY = minY;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { points, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}

export function spacedBrushStroke(preset: BrushPreset, points: readonly IntPoint[]): IntPoint[] {
  if (points.length === 0) return [];
  const line = pixelPerfectPoints(points), spacing = Math.max(1, Math.round(preset.spacing)), output: IntPoint[] = [];
  for (let index = 0; index < line.length; index += spacing) {
    const point = line[index];
    if (point !== undefined) output.push(...stampBrush(preset, point));
  }
  const last = line.at(-1);
  if (last !== undefined && (line.length - 1) % spacing !== 0) output.push(...stampBrush(preset, last));
  return deduplicatePoints(output);
}

export function createCustomBrushPreset(
  name: string,
  width: number,
  height: number,
  mask: Uint8Array,
  center: IntPoint = { x: Math.floor(width / 2), y: Math.floor(height / 2) },
): BrushPreset {
  if (mask.length !== width * height) throw new RangeError("Brush mask dimensions are invalid.");
  if (width < 1 || height < 1 || width > 64 || height > 64) throw new RangeError("Custom brush dimensions must be 1 to 64 pixels.");
  return { id: crypto.randomUUID(), name: name.trim() || "Custom Brush", kind: "custom", width, height, opacity: 1, spacing: 1, angle: 0, flipX: false, flipY: false, center, mask: packMask(mask) };
}

export function transformMask(mask: Uint8Array, width: number, height: number, angle: 0 | 90 | 180 | 270, flipX: boolean, flipY: boolean): Readonly<{ mask: Uint8Array; width: number; height: number }> {
  if (mask.length !== width * height) throw new RangeError("Brush mask dimensions are invalid.");
  const rotatedWidth = angle === 90 || angle === 270 ? height : width, rotatedHeight = angle === 90 || angle === 270 ? width : height, result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let tx = x, ty = y;
    if (angle === 90) { tx = height - 1 - y; ty = x; }
    else if (angle === 180) { tx = width - 1 - x; ty = height - 1 - y; }
    else if (angle === 270) { tx = y; ty = width - 1 - x; }
    if (flipX) tx = rotatedWidth - 1 - tx;
    if (flipY) ty = rotatedHeight - 1 - ty;
    result[ty * rotatedWidth + tx] = mask[y * width + x] ?? 0;
  }
  return { mask: result, width: rotatedWidth, height: rotatedHeight };
}

function transformPoint(point: IntPoint, width: number, height: number, angle: 0 | 90 | 180 | 270, flipX: boolean, flipY: boolean): IntPoint {
  const rotatedWidth = angle === 90 || angle === 270 ? height : width,
    rotatedHeight = angle === 90 || angle === 270 ? width : height;
  let x = point.x, y = point.y;
  if (angle === 90) { x = height - 1 - point.y; y = point.x; }
  else if (angle === 180) { x = width - 1 - point.x; y = height - 1 - point.y; }
  else if (angle === 270) { x = point.y; y = width - 1 - point.x; }
  if (flipX) x = rotatedWidth - 1 - x;
  if (flipY) y = rotatedHeight - 1 - y;
  return { x, y };
}

export function packMask(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let index = 0; index < mask.length; index += 1) if ((mask[index] ?? 0) !== 0) bytes[Math.floor(index / 8)] = (bytes[Math.floor(index / 8)] ?? 0) | (1 << (index % 8));
  return encodeBase64(bytes);
}
export function unpackMask(encoded: string, length: number): Uint8Array {
  const bytes = decodeBase64(encoded);
  if (bytes.length !== Math.ceil(length / 8)) throw new Error("Brush mask encoding length is invalid.");
  const mask = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) mask[index] = ((bytes[Math.floor(index / 8)] ?? 0) & (1 << (index % 8))) === 0 ? 0 : 1;
  return mask;
}

export function validateBrushPreset(preset: BrushPreset): void {
  if (preset.width < 1 || preset.height < 1 || preset.width > 64 || preset.height > 64 || !Number.isInteger(preset.width) || !Number.isInteger(preset.height)) throw new RangeError("Brush dimensions are invalid.");
  if (preset.opacity < 0 || preset.opacity > 1 || preset.spacing < 1 || preset.spacing > 256) throw new RangeError("Brush settings are invalid.");
}
function deduplicatePoints(points: readonly IntPoint[]): IntPoint[] { const seen = new Set<string>(); return points.filter((point) => { const key = `${Math.round(point.x)},${Math.round(point.y)}`; if (seen.has(key)) return false; seen.add(key); return true; }).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })); }
function ellipseContains(x: number, y: number, width: number, height: number): boolean { const nx = (x + 0.5 - width / 2) / (width / 2), ny = (y + 0.5 - height / 2) / (height / 2); return nx * nx + ny * ny <= 1; }
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64(bytes: Uint8Array): string { let output = ""; for (let i = 0; i < bytes.length; i += 3) { const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2], value = (a << 16) | ((b ?? 0) << 8) | (c ?? 0); output += BASE64[(value >>> 18) & 63] ?? ""; output += BASE64[(value >>> 12) & 63] ?? ""; output += b === undefined ? "=" : BASE64[(value >>> 6) & 63] ?? ""; output += c === undefined ? "=" : BASE64[value & 63] ?? ""; } return output; }
function decodeBase64(value: string): Uint8Array { if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Brush mask base64 is invalid."); const clean = value.replace(/=+$/, ""), bytes = new Uint8Array(Math.floor(clean.length * 6 / 8)); let accumulator = 0, bits = 0, offset = 0; for (const char of clean) { const index = BASE64.indexOf(char); accumulator = (accumulator << 6) | index; bits += 6; if (bits >= 8) { bits -= 8; bytes[offset] = (accumulator >>> bits) & 255; offset += 1; } } return bytes; }
