import { describe, expect, it } from "vitest";
import { RgbaPixelSurface } from "./surface";

describe("RgbaPixelSurface", () => {
  it("creates a transparent contiguous RGBA surface", () => {
    const surface = new RgbaPixelSurface(2, 2);
    expect(surface.getBytes()).toEqual(new Uint8Array(16));
    expect(surface.getPixel(1, 1)).toEqual([0, 0, 0, 0]);
  });
  it("writes and reads exact pixel bytes", () => {
    const surface = new RgbaPixelSurface(2, 1);
    expect(surface.setPixel(1, 0, [1, 2, 3, 4])).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(surface.getBytes()).toEqual(
      Uint8Array.from([0, 0, 0, 0, 1, 2, 3, 4]),
    );
  });
  it("normalizes fully transparent colors", () => {
    const surface = new RgbaPixelSurface(1, 1);
    surface.setPixel(0, 0, [100, 80, 60, 0]);
    expect(surface.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("clips reads to the surface", () => {
    const surface = new RgbaPixelSurface(2, 2);
    surface.setPixel(0, 0, [1, 2, 3, 255]);
    expect(surface.readRegion({ x: -1, y: -1, width: 2, height: 2 })).toEqual(
      Uint8Array.from([1, 2, 3, 255]),
    );
  });
  it("clips writes while preserving source offsets", () => {
    const surface = new RgbaPixelSurface(2, 1);
    surface.writeRegion(
      { x: -1, y: 0, width: 3, height: 1 },
      Uint8Array.from([9, 9, 9, 255, 1, 2, 3, 255, 4, 5, 6, 255]),
    );
    expect(surface.getBytes()).toEqual(
      Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]),
    );
  });
  it("rejects invalid region lengths", () => {
    const surface = new RgbaPixelSurface(2, 2);
    expect(() =>
      surface.writeRegion(
        { x: 0, y: 0, width: 2, height: 2 },
        new Uint8Array(4),
      ),
    ).toThrow("byte length");
  });
  it("does not expose its mutable buffer", () => {
    const surface = new RgbaPixelSurface(1, 1);
    const bytes = surface.getBytes();
    bytes[3] = 255;
    expect(surface.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("returns null for clipped point writes", () => {
    expect(new RgbaPixelSurface(1, 1).setPixel(-1, 0, [1, 2, 3, 4])).toBeNull();
  });
  it("validates allocation size and input length", () => {
    expect(() => new RgbaPixelSurface(0, 1)).toThrow();
    expect(() => new RgbaPixelSurface(2, 2, new Uint8Array(3))).toThrow();
  });
  it("clones independently", () => {
    const source = new RgbaPixelSurface(1, 1);
    source.setPixel(0, 0, [1, 2, 3, 255]);
    const clone = source.clone();
    clone.setPixel(0, 0, [9, 9, 9, 255]);
    expect(source.getPixel(0, 0)).toEqual([1, 2, 3, 255]);
  });
});
