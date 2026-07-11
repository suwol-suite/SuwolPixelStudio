import type { IntPoint, IntRect } from "./types";
import { bresenhamLine } from "./stroke";

export type ShapeFillMode = "outline" | "filled";

export function constrainLine45(start: IntPoint, end: IntPoint): IntPoint {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    adx = Math.abs(dx),
    ady = Math.abs(dy);
  if (adx > ady * 2) return { x: end.x, y: start.y };
  if (ady > adx * 2) return { x: start.x, y: end.y };
  const distance = Math.max(adx, ady);
  return {
    x: start.x + Math.sign(dx) * distance,
    y: start.y + Math.sign(dy) * distance,
  };
}

export function inclusiveRect(
  start: IntPoint,
  end: IntPoint,
  constrainSquare = false,
): IntRect {
  let target = end;
  if (constrainSquare) {
    const dx = end.x - start.x,
      dy = end.y - start.y,
      size = Math.max(Math.abs(dx), Math.abs(dy));
    target = {
      x: start.x + Math.sign(dx || 1) * size,
      y: start.y + Math.sign(dy || 1) * size,
    };
  }
  const left = Math.min(Math.round(start.x), Math.round(target.x)),
    top = Math.min(Math.round(start.y), Math.round(target.y));
  return {
    x: left,
    y: top,
    width: Math.abs(Math.round(target.x) - Math.round(start.x)) + 1,
    height: Math.abs(Math.round(target.y) - Math.round(start.y)) + 1,
  };
}

export function rasterizeLine(
  start: IntPoint,
  end: IntPoint,
  constrain = false,
): IntPoint[] {
  return bresenhamLine(start, constrain ? constrainLine45(start, end) : end);
}

export function rasterizeRectangle(
  rect: IntRect,
  mode: ShapeFillMode,
): IntPoint[] {
  const points: IntPoint[] = [];
  if (rect.width <= 0 || rect.height <= 0) return points;
  for (let y = 0; y < rect.height; y += 1)
    for (let x = 0; x < rect.width; x += 1)
      if (
        mode === "filled" ||
        x === 0 ||
        y === 0 ||
        x === rect.width - 1 ||
        y === rect.height - 1
      )
        points.push({ x: rect.x + x, y: rect.y + y });
  return points;
}

export function rasterizeEllipse(
  rect: IntRect,
  mode: ShapeFillMode,
): IntPoint[] {
  const points: IntPoint[] = [];
  if (rect.width <= 0 || rect.height <= 0) return points;
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return false;
    const dx = 2 * x + 1 - rect.width,
      dy = 2 * y + 1 - rect.height;
    return (
      dx * dx * rect.height * rect.height + dy * dy * rect.width * rect.width <=
      rect.width * rect.width * rect.height * rect.height
    );
  };
  for (let y = 0; y < rect.height; y += 1)
    for (let x = 0; x < rect.width; x += 1)
      if (
        inside(x, y) &&
        (mode === "filled" ||
          !inside(x - 1, y) ||
          !inside(x + 1, y) ||
          !inside(x, y - 1) ||
          !inside(x, y + 1))
      )
        points.push({ x: rect.x + x, y: rect.y + y });
  return points;
}

export function pointsBounds(points: readonly IntPoint[]): IntRect | null {
  if (points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
