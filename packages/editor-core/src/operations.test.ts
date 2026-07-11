import { describe, expect, it } from "vitest";
import { EditorSession } from "./session";
import { BitSelectionMask } from "./selection";
import {
  applyRasterPoints,
  anchorOffset,
  canvasResizeRgba,
  commitFloatingSelection,
  computeFloodFillBytes,
  copyPixels,
  deleteSelectedPixels,
  floodFill,
  movePixels,
  resizeNearestRgba,
  validateFloatingSelection,
} from "./operations";
import { hashSnapshot } from "./composite";

function session(width = 4, height = 4) {
  return EditorSession.create({
    name: "M2",
    width,
    height,
    layerName: "Layer",
  });
}
function layerId(current: EditorSession) {
  return current.model.layerOrder[0] ?? "";
}
function surface(current: EditorSession) {
  return current.getActiveSurfaceForRead(layerId(current));
}

describe("M2 pixel operations", () => {
  it("scanline fills a four-connected region as one undo step", () => {
    const current = session();
    applyRasterPoints(
      current,
      layerId(current),
      [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ],
      [1, 1, 1, 255],
      null,
      "barrier",
    );
    const before = hashSnapshot(current.snapshot());
    expect(
      floodFill(
        current,
        layerId(current),
        { x: 0, y: 0 },
        [9, 8, 7, 255],
        null,
      ),
    ).toEqual({ x: 0, y: 0, width: 1, height: 4 });
    expect(surface(current).getPixel(0, 3)).toEqual([9, 8, 7, 255]);
    expect(surface(current).getPixel(2, 3)).toEqual([0, 0, 0, 0]);
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(before);
  });
  it("clips fill to a selection and no-ops for the same color", () => {
    const current = session(),
      selection = new BitSelectionMask(4, 4);
    selection.setRect({ x: 1, y: 1, width: 2, height: 2 }, "replace");
    expect(
      floodFill(
        current,
        layerId(current),
        { x: 1, y: 1 },
        [2, 3, 4, 255],
        selection,
      ),
    ).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    const revision = current.model.revision;
    expect(
      floodFill(
        current,
        layerId(current),
        { x: 1, y: 1 },
        [2, 3, 4, 255],
        selection,
      ),
    ).toBeNull();
    expect(current.model.revision).toBe(revision);
  });
  it("copies only selected pixels and deletes them exactly", () => {
    const current = session();
    applyRasterPoints(
      current,
      layerId(current),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [255, 0, 0, 255],
      null,
      "draw",
    );
    const selection = new BitSelectionMask(4, 4);
    selection.setRect({ x: 0, y: 0, width: 1, height: 1 }, "replace");
    const copied = copyPixels(current, layerId(current), selection);
    expect(copied).toMatchObject({
      sourceWidth: 1,
      sourceHeight: 1,
      x: 0,
      y: 0,
    });
    expect(copied.pixels).toEqual(Uint8Array.from([255, 0, 0, 255]));
    expect(deleteSelectedPixels(current, layerId(current), selection)).toBe(
      true,
    );
    expect(surface(current).getPixel(0, 0)).toEqual([0, 0, 0, 0]);
    expect(surface(current).getPixel(1, 0)).toEqual([255, 0, 0, 255]);
    current.undo();
    expect(surface(current).getPixel(0, 0)).toEqual([255, 0, 0, 255]);
  });
  it("moves overlapping pixels without source corruption and clips boundaries", () => {
    const current = session();
    applyRasterPoints(
      current,
      layerId(current),
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      [7, 8, 9, 255],
      null,
      "draw",
    );
    const selection = new BitSelectionMask(4, 4);
    selection.setRect({ x: 0, y: 0, width: 3, height: 1 }, "replace");
    expect(movePixels(current, layerId(current), selection, 1, 0)).toBe(true);
    expect([0, 1, 2, 3].map((x) => surface(current).getPixel(x, 0)[3])).toEqual(
      [0, 255, 255, 255],
    );
    current.undo();
    expect([0, 1, 2, 3].map((x) => surface(current).getPixel(x, 0)[3])).toEqual(
      [255, 255, 255, 0],
    );
    expect(movePixels(current, layerId(current), selection, -2, 0)).toBe(true);
    expect(surface(current).getPixel(0, 0)[3]).toBe(255);
  });
  it("previews floating selection without history and commits paste once", () => {
    const current = session();
    const floating = {
      sourceWidth: 2,
      sourceHeight: 1,
      pixels: Uint8Array.from([1, 2, 3, 255, 0, 0, 0, 0]),
      x: 1,
      y: 2,
      source: "internal" as const,
    };
    const before = current.history.undoCount;
    expect(current.history.undoCount).toBe(before);
    expect(commitFloatingSelection(current, layerId(current), floating)).toBe(
      true,
    );
    expect(current.history.undoCount).toBe(before + 1);
    expect(surface(current).getPixel(1, 2)).toEqual([1, 2, 3, 255]);
    expect(surface(current).getPixel(2, 2)).toEqual([0, 0, 0, 0]);
  });
  it("computes a transferable fill patch without touching a document", () => {
    const snapshot = new Uint8Array(3 * 3 * 4);
    const result = computeFloodFillBytes(
      snapshot,
      3,
      3,
      { x: 1, y: 1 },
      [4, 5, 6, 255],
    );
    expect(result?.rect).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(result?.pixels.byteLength).toBe(36);
    expect(snapshot[3]).toBe(255);
  });
  it("moves selection state in the same undo transaction", () => {
    const current = session();
    let selection = new BitSelectionMask(4, 4);
    applyRasterPoints(
      current,
      layerId(current),
      [{ x: 0, y: 0 }],
      [1, 2, 3, 255],
      null,
      "draw",
    );
    selection.setRect({ x: 0, y: 0, width: 1, height: 1 }, "replace");
    movePixels(current, layerId(current), selection, 2, 1, "move", (dx, dy) => {
      selection = selection.translated(dx, dy);
    });
    expect(selection.bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 });
    current.undo();
    expect(selection.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    current.redo();
    expect(selection.bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 });
  });
  it("rejects malformed clipboard RGBA lengths", () => {
    expect(() =>
      validateFloatingSelection({
        sourceWidth: 2,
        sourceHeight: 2,
        pixels: new Uint8Array(3),
        x: 0,
        y: 0,
        source: "clipboard",
      }),
    ).toThrow("length");
  });
});

describe("resize algorithms", () => {
  it("maps nearest-neighbor 2x2 to 4x4 and preserves alpha normalization", () => {
    const source = Uint8Array.from([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 9, 9, 9, 0,
    ]);
    const result = resizeNearestRgba(source, 2, 2, 4, 4);
    expect([result[0], result[4], result[8], result[12]]).toEqual([1, 1, 2, 2]);
    expect(result.slice(60, 64)).toEqual(Uint8Array.from([0, 0, 0, 0]));
  });
  it("maps non-integer scale 3x2 to 5x3 deterministically", () => {
    const source = new Uint8Array(3 * 2 * 4);
    for (let i = 0; i < 6; i += 1) {
      source[i * 4] = i + 1;
      source[i * 4 + 3] = 255;
    }
    const result = resizeNearestRgba(source, 3, 2, 5, 3);
    expect([0, 1, 2, 3, 4].map((x) => result[x * 4])).toEqual([1, 1, 2, 2, 3]);
    expect([0, 1, 2].map((y) => result[y * 5 * 4])).toEqual([1, 1, 4]);
  });
  it("computes all nine canvas anchors", () => {
    const anchors = [
      "top-left",
      "top-center",
      "top-right",
      "middle-left",
      "center",
      "middle-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ] as const;
    expect(anchors.map((anchor) => anchorOffset(anchor, 2, 2, 4, 6))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 0, y: 4 },
      { x: 1, y: 4 },
      { x: 2, y: 4 },
    ]);
  });
  it("canvas resize fills new pixels and positions the source", () => {
    const result = canvasResizeRgba(
      Uint8Array.from([8, 7, 6, 255]),
      1,
      1,
      3,
      3,
      1,
      1,
      [2, 3, 4, 255],
    );
    expect(result.slice(0, 4)).toEqual(Uint8Array.from([2, 3, 4, 255]));
    expect(result.slice(16, 20)).toEqual(Uint8Array.from([8, 7, 6, 255]));
  });
});
