import { describe, expect, it } from "vitest";
import { BitSelectionMask } from "./selection";

describe("BitSelectionMask", () => {
  it("supports replace, add, subtract and intersect with exact bounds", () => {
    const mask = new BitSelectionMask(8, 8);
    mask.setRect({ x: 1, y: 1, width: 3, height: 3 }, "replace");
    expect(mask.selectedCount).toBe(9);
    mask.setRect({ x: 4, y: 1, width: 2, height: 2 }, "add");
    expect(mask.bounds).toEqual({ x: 1, y: 1, width: 5, height: 3 });
    mask.setRect({ x: 2, y: 2, width: 3, height: 1 }, "subtract");
    expect(mask.contains(2, 2)).toBe(false);
    expect(mask.contains(1, 2)).toBe(true);
    mask.setRect({ x: 0, y: 0, width: 3, height: 8 }, "intersect");
    expect(mask.bounds).toEqual({ x: 1, y: 1, width: 2, height: 3 });
    expect(mask.selectedCount).toBe(5);
  });
  it("clips selection rectangles and treats zero area as none", () => {
    const mask = new BitSelectionMask(4, 4);
    mask.setRect({ x: -2, y: -2, width: 4, height: 4 }, "replace");
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    mask.setRect({ x: 1, y: 1, width: 0, height: 2 }, "replace");
    expect(mask.bounds).toBeNull();
  });
  it("translates and resizes without allocating object-per-pixel state", () => {
    const mask = new BitSelectionMask(4, 4);
    mask.setRect({ x: 1, y: 1, width: 2, height: 2 }, "replace");
    const moved = mask.translated(2, 1);
    expect(moved.bounds).toEqual({ x: 3, y: 2, width: 1, height: 2 });
    const resized = mask.resized(8, 8);
    expect(resized.bounds).toEqual({ x: 2, y: 2, width: 3, height: 3 });
  });
  it("keeps cached bounds equal to a brute-force scan", () => {
    let seed = 17;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    const mask = new BitSelectionMask(16, 12);
    for (let step = 0; step < 100; step += 1) {
      const operations = ["replace", "add", "subtract", "intersect"] as const;
      mask.setRect(
        {
          x: (random() % 22) - 3,
          y: (random() % 18) - 3,
          width: random() % 8,
          height: random() % 8,
        },
        operations[random() % 4] ?? "replace",
      );
      let minX = 16,
        minY = 12,
        maxX = -1,
        maxY = -1,
        count = 0;
      for (let y = 0; y < 12; y += 1)
        for (let x = 0; x < 16; x += 1)
          if (mask.contains(x, y)) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            count += 1;
          }
      expect(mask.selectedCount).toBe(count);
      expect(mask.bounds).toEqual(
        count === 0
          ? null
          : {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            },
      );
    }
  });
});
