import { PixelPatchCommand, type EditorCommand } from "./history";
import { IndexedPixelSurface, type PixelSurface } from "./surface";
import {
  normalizeRgba,
  unionRect,
  type DirtyRegion,
  type ImageId,
  type IntPoint,
  type Rgba,
} from "./types";

export function bresenhamLine(start: IntPoint, end: IntPoint): IntPoint[] {
  const points: IntPoint[] = [];
  let x = Math.round(start.x);
  let y = Math.round(start.y);
  const targetX = Math.round(end.x);
  const targetY = Math.round(end.y);
  const dx = Math.abs(targetX - x);
  const sx = x < targetX ? 1 : -1;
  const dy = -Math.abs(targetY - y);
  const sy = y < targetY ? 1 : -1;
  let error = dx + dy;
  let complete = false;
  while (!complete) {
    points.push({ x, y });
    if (x === targetX && y === targetY) {
      complete = true;
      continue;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

export interface StrokeTransformOptions {
  readonly pixelPerfect?: boolean;
  readonly symmetry?: Readonly<{ mode: "off" | "horizontal" | "vertical" | "both"; axisX: number; axisY: number }>;
  readonly stampOffsets?: readonly IntPoint[];
}

export function pixelPerfectStrokePoints(input: readonly IntPoint[]): IntPoint[] {
  const result: IntPoint[] = [];
  for (const point of input) {
    const last = result.at(-1), segment = last === undefined ? [{ x: Math.round(point.x), y: Math.round(point.y) }] : bresenhamLine(last, point).slice(1);
    for (const candidate of segment) {
      result.push(candidate);
      const a = result.at(-3), b = result.at(-2), c = result.at(-1);
      if (a === undefined || b === undefined || c === undefined) continue;
      if (Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 && ((a.x === b.x) !== (a.y === b.y)) && ((b.x === c.x) !== (b.y === c.y)))
        result.splice(result.length - 2, 1);
    }
  }
  return result;
}

export class StrokeTransaction {
  readonly #before = new Map<number, Rgba | number>();
  #lastPoint: IntPoint | null = null;
  #dirty: DirtyRegion | null = null;
  #closed = false;
  readonly #rawPoints: IntPoint[] = [];

  constructor(
    readonly imageId: ImageId,
    readonly surface: PixelSurface,
    readonly color: Rgba,
    readonly label: string,
    readonly options: StrokeTransformOptions = {},
  ) {}

  get dirtyRegion(): DirtyRegion | null {
    return this.#dirty;
  }
  get changedPixelCount(): number {
    return this.#before.size;
  }

  addPoint(point: IntPoint): DirtyRegion | null {
    this.#assertOpen();
    if (this.options.pixelPerfect === true || this.options.symmetry?.mode !== undefined && this.options.symmetry.mode !== "off" || this.options.stampOffsets !== undefined)
      return this.#addTransformed(point);
    const points =
      this.#lastPoint === null
        ? [point]
        : bresenhamLine(this.#lastPoint, point);
    let changed: DirtyRegion | null = null;
    for (const current of points)
      changed = unionRect(changed, this.#apply(current));
    this.#lastPoint = { x: Math.round(point.x), y: Math.round(point.y) };
    this.#dirty = unionRect(this.#dirty, changed);
    return changed;
  }

  #addTransformed(point: IntPoint): DirtyRegion | null {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) }, last = this.#rawPoints.at(-1);
    if (last?.x === rounded.x && last.y === rounded.y) return null;
    this.#rawPoints.push(rounded);
    for (const [index, color] of this.#before)
      if (typeof color === "number" && this.surface instanceof IndexedPixelSurface)
        this.surface.setIndex(index % this.surface.width, Math.floor(index / this.surface.width), color);
      else if (typeof color !== "number")
        this.surface.setPixel(index % this.surface.width, Math.floor(index / this.surface.width), color);
    const path = this.options.pixelPerfect === true
      ? pixelPerfectStrokePoints(this.#rawPoints)
      : this.#rawPoints.flatMap((current, index, all) => index === 0 ? [current] : bresenhamLine(all[index - 1] ?? current, current).slice(1));
    const symmetry = this.options.symmetry;
    const symmetric = symmetry === undefined || symmetry.mode === "off" ? path : path.flatMap((current) => symmetryCopies(current, symmetry)),
      points = this.options.stampOffsets === undefined ? symmetric : symmetric.flatMap((current) => this.options.stampOffsets?.map((offset) => ({ x: current.x + offset.x, y: current.y + offset.y })) ?? []);
    let changed: DirtyRegion | null = null;
    for (const current of deduplicate(points)) changed = unionRect(changed, this.#apply(current));
    this.#lastPoint = rounded;
    this.#dirty = unionRect(this.#dirty, changed);
    return changed;
  }

  commit(): EditorCommand | null {
    this.#assertOpen();
    this.#closed = true;
    if (this.#dirty === null || this.#before.size === 0) return null;
    const rect = this.#dirty;
    const after = this.surface.readRegion(rect);
    const before = after.slice();
    for (const [index, color] of this.#before) {
      const x = index % this.surface.width;
      const y = Math.floor(index / this.surface.width);
      const offset = ((y - rect.y) * rect.width + (x - rect.x)) * (this.surface.format === "rgba8" ? 4 : 1);
      if (typeof color === "number") before[offset] = color;
      else before.set(color, offset);
    }
    return new PixelPatchCommand(this.label, {
      imageId: this.imageId,
      format: this.surface.format,
      rect,
      before,
      after,
    });
  }

  rollback(): void {
    this.#assertOpen();
    for (const [index, color] of this.#before)
      if (typeof color === "number" && this.surface instanceof IndexedPixelSurface)
        this.surface.setIndex(index % this.surface.width, Math.floor(index / this.surface.width), color);
      else if (typeof color !== "number")
        this.surface.setPixel(index % this.surface.width, Math.floor(index / this.surface.width), color);
    this.#closed = true;
  }

  #apply(point: IntPoint): DirtyRegion | null {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || y < 0 || x >= this.surface.width || y >= this.surface.height)
      return null;
    const index = y * this.surface.width + x;
    if (!this.#before.has(index))
      this.#before.set(index, this.surface instanceof IndexedPixelSurface ? this.surface.getIndex(x, y) : this.surface.getPixel(x, y));
    return this.surface.setPixel(x, y, normalizeRgba(this.color));
  }
  #assertOpen(): void {
    if (this.#closed) throw new Error("Stroke transaction is already closed.");
  }
}

function symmetryCopies(point: IntPoint, symmetry: NonNullable<StrokeTransformOptions["symmetry"]>): IntPoint[] {
  const result = [{ x: point.x, y: point.y }];
  if (symmetry.mode === "vertical" || symmetry.mode === "both") result.push({ x: Math.round(2 * symmetry.axisX - point.x), y: point.y });
  if (symmetry.mode === "horizontal" || symmetry.mode === "both") result.push({ x: point.x, y: Math.round(2 * symmetry.axisY - point.y) });
  if (symmetry.mode === "both") result.push({ x: Math.round(2 * symmetry.axisX - point.x), y: Math.round(2 * symmetry.axisY - point.y) });
  return result;
}
function deduplicate(points: readonly IntPoint[]): IntPoint[] { const seen = new Set<string>(); return points.filter((point) => { const key = `${point.x},${point.y}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
