import { describe, expect, it } from "vitest";
import {
  inclusiveRect,
  rasterizeEllipse,
  rasterizeLine,
  rasterizeRectangle,
} from "./raster";
import type { IntPoint, IntRect } from "./types";

function grid(rect: IntRect, points: readonly IntPoint[]): string[] {
  const set = new Set(points.map((point) => `${point.x},${point.y}`));
  return Array.from({ length: rect.height }, (_, y) =>
    Array.from({ length: rect.width }, (_, x) =>
      set.has(`${rect.x + x},${rect.y + y}`) ? "#" : ".",
    ).join(""),
  );
}

describe("deterministic raster tools", () => {
  it("rasterizes Bresenham lines and 45-degree constraints", () => {
    expect(rasterizeLine({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(rasterizeLine({ x: 0, y: 0 }, { x: 4, y: 2 }, true).at(-1)).toEqual({
      x: 4,
      y: 4,
    });
    expect(rasterizeLine({ x: 2, y: 2 }, { x: 3, y: 8 }, true).at(-1)).toEqual({
      x: 2,
      y: 8,
    });
  });
  it("normalizes reverse rectangle drags and square constraints", () => {
    expect(inclusiveRect({ x: 4, y: 3 }, { x: 1, y: 1 })).toEqual({
      x: 1,
      y: 1,
      width: 4,
      height: 3,
    });
    expect(inclusiveRect({ x: 1, y: 1 }, { x: 4, y: 2 }, true)).toEqual({
      x: 1,
      y: 1,
      width: 4,
      height: 4,
    });
  });
  it("rasterizes rectangle outline and fill byte-exact", () => {
    const rect = { x: 0, y: 0, width: 4, height: 3 };
    expect(grid(rect, rasterizeRectangle(rect, "outline"))).toEqual([
      "####",
      "#..#",
      "####",
    ]);
    expect(grid(rect, rasterizeRectangle(rect, "filled"))).toEqual([
      "####",
      "####",
      "####",
    ]);
  });
  it("rasterizes symmetric ellipse goldens from 1x1 through 8x6", () => {
    const cases: [number, number, string[]][] = [
      [1, 1, ["#"]],
      [2, 2, ["##", "##"]],
      [3, 3, ["###", "#.#", "###"]],
      [4, 3, [".##.", "#..#", ".##."]],
      [5, 5, [".###.", "#...#", "#...#", "#...#", ".###."]],
      [
        8,
        6,
        [
          "..####..",
          ".#....#.",
          "#......#",
          "#......#",
          ".#....#.",
          "..####..",
        ],
      ],
    ];
    for (const [width, height, expected] of cases) {
      const rect = { x: 0, y: 0, width, height };
      expect(grid(rect, rasterizeEllipse(rect, "outline"))).toEqual(expected);
      const reverse = inclusiveRect(
        { x: width - 1, y: height - 1 },
        { x: 0, y: 0 },
      );
      expect(grid(rect, rasterizeEllipse(reverse, "outline"))).toEqual(
        expected,
      );
    }
  });
  it("fills ellipse interiors without anti-aliasing", () => {
    const rect = { x: 0, y: 0, width: 5, height: 5 };
    expect(grid(rect, rasterizeEllipse(rect, "filled"))).toEqual([
      ".###.",
      "#####",
      "#####",
      "#####",
      ".###.",
    ]);
  });
});
