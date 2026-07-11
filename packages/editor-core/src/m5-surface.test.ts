import { describe, expect, it } from "vitest";
import { IndexedPixelSurface, PixelPatchCommand, RgbaPixelSurface } from "./index";
import { createDocument } from "./document";

describe("M5 pixel surfaces", () => {
  it("stores indexed pixels as one byte and resolves display RGBA through the palette", () => {
    const surface = new IndexedPixelSurface(2, 2, Uint8Array.from([0, 1, 1, 0]), [[0, 0, 0, 0], [12, 34, 56, 255]], 0);
    expect(surface.getBytes()).toEqual(Uint8Array.from([0, 1, 1, 0]));
    expect(surface.getPixel(1, 0)).toEqual([12, 34, 56, 255]);
    expect(surface.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("rejects undefined indices and format-sized region mismatches", () => {
    const surface = new IndexedPixelSurface(2, 2, undefined, [[0, 0, 0, 0], [255, 0, 0, 255]], 0);
    expect(() => surface.setIndex(0, 0, 2)).toThrow("not defined");
    expect(() => surface.writeRegion({ x: 0, y: 0, width: 2, height: 2 }, new Uint8Array(16))).toThrow("length");
  });
  it("prevents an rgba patch from applying to an indexed surface", () => {
    const state = createDocument({ name: "Indexed", layerName: "Layer", width: 1, height: 1, colorMode: "indexed" });
    const imageId = Object.keys(state.model.images)[0] ?? "";
    const command = new PixelPatchCommand("wrong", { imageId, format: "rgba8", rect: { x: 0, y: 0, width: 1, height: 1 }, before: new Uint8Array(4), after: new Uint8Array(4) });
    expect(() => command.execute(state)).toThrow("format");
  });
  it("keeps RGBA transparent pixels canonical", () => {
    const surface = new RgbaPixelSurface(1, 1, Uint8Array.from([90, 80, 70, 0]));
    expect(surface.getBytes()).toEqual(new Uint8Array(4));
  });
});

