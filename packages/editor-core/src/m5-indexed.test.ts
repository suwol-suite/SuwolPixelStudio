import { describe, expect, it } from "vitest";
import { convertRgbaToIndexed, indexedToRgba, mergeDuplicatePaletteEntries, remapIndices, reorderPalettePreservingAppearance, type PaletteEntry } from "./index";

const palette: PaletteEntry[] = [
  { id: "transparent", index: 0, rgba: [0, 0, 0, 0] },
  { id: "red", index: 1, rgba: [255, 0, 0, 255] },
  { id: "blue", index: 2, rgba: [0, 0, 255, 255] },
];
describe("M5 indexed conversion and palette remap", () => {
  it("produces deterministic exact/median-cut indices", () => {
    const rgba = Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]);
    const first = convertRgbaToIndexed(rgba, 4, 1, { maxColors: 4, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "none" });
    const second = convertRgbaToIndexed(rgba, 4, 1, { maxColors: 4, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "none" });
    expect(first).toEqual(second);
    expect(first.indices[0]).toBe(0);
    expect(indexedToRgba(first.indices, first.palette, 0)).toEqual(rgba);
  });
  it("has deterministic Floyd–Steinberg and Bayer golden output", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) rgba.set([index * 17, index * 17, index * 17, 255], index * 4);
    const options = { maxColors: 3, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut" as const };
    expect([...convertRgbaToIndexed(rgba, 4, 4, { ...options, dithering: "floyd-steinberg" }).indices]).toEqual([1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2]);
    expect([...convertRgbaToIndexed(rgba, 4, 4, { ...options, dithering: "ordered-bayer-4x4" }).indices]).toEqual([1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2]);
  });
  it("reorders slots while preserving appearance", () => {
    const result = reorderPalettePreservingAppearance(palette, ["transparent", "blue", "red"]), before = Uint8Array.from([1, 2, 1, 0]), after = remapIndices(before, result.mapping);
    expect([...after]).toEqual([2, 1, 2, 0]);
    expect(indexedToRgba(after, result.entries.map((entry) => entry.rgba), 0)).toEqual(indexedToRgba(before, palette.map((entry) => entry.rgba), 0));
  });
  it("merges duplicate slots with a complete remap", () => {
    const result = mergeDuplicatePaletteEntries([...palette, { id: "red2", index: 3, rgba: [255, 0, 0, 255] }]);
    expect(result.entries).toHaveLength(3);
    expect(result.mapping.get(3)).toBe(1);
  });
  it("cancels without returning partial output", () => {
    const controller = new AbortController(); controller.abort();
    expect(() => convertRgbaToIndexed(new Uint8Array(16), 2, 2, { maxColors: 2, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "none", signal: controller.signal })).toThrow("cancelled");
  });
});
