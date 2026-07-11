import { describe, expect, it } from "vitest";
import { EditorSession } from "./session";
import { applyRasterPoints } from "./operations";
import { hashSnapshot } from "./composite";

describe("document transforms and palette", () => {
  it("crops every layer and restores structure with one undo", () => {
    const current = EditorSession.create({
      name: "T",
      width: 4,
      height: 4,
      layerName: "L",
    });
    const bottom = current.model.layerOrder[0] ?? "";
    applyRasterPoints(
      current,
      bottom,
      [{ x: 2, y: 2 }],
      [1, 2, 3, 255],
      null,
      "draw",
    );
    const top = current.addLayer("Top");
    applyRasterPoints(
      current,
      top,
      [{ x: 3, y: 3 }],
      [4, 5, 6, 255],
      null,
      "draw",
    );
    const before = hashSnapshot(current.snapshot()),
      history = current.history.undoCount;
    current.cropToRect({ x: 2, y: 2, width: 2, height: 2 });
    expect(current.model.canvas).toMatchObject({ width: 2, height: 2 });
    expect(current.history.undoCount).toBe(history + 1);
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(before);
  });
  it("resizes multiple layers and round-trips undo redo", () => {
    const current = EditorSession.create({
      name: "T",
      width: 2,
      height: 2,
      layerName: "L",
    });
    current.addLayer("Top");
    const before = hashSnapshot(current.snapshot());
    current.resizeCanvas(4, 4, "center", [0, 0, 0, 0]);
    const after = hashSnapshot(current.snapshot());
    for (const image of Object.values(current.model.images))
      expect(image).toMatchObject({ width: 4, height: 4 });
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(before);
    current.redo();
    expect(hashSnapshot(current.snapshot())).toBe(after);
    current.resizeSprite(3, 5);
    expect(current.model.canvas).toMatchObject({ width: 3, height: 5 });
  });
  it("adds, renames, reorders and deletes stable palette colors with undo", () => {
    const current = EditorSession.create({
      name: "P",
      width: 1,
      height: 1,
      layerName: "L",
    });
    const red = current.addPaletteColor([255, 0, 0, 255], "Red"),
      blue = current.addPaletteColor([0, 0, 255, 255]);
    current.movePaletteColor(blue, 0);
    current.renamePaletteColor(blue, "Blue");
    expect(current.model.palette.colors.map((color) => color.id)).toEqual([
      blue,
      red,
    ]);
    current.deletePaletteColor(red);
    expect(current.model.palette.colors).toHaveLength(1);
    current.undo();
    expect(current.model.palette.colors).toHaveLength(2);
  });
  it("loads a default palette in one undo step", () => {
    const current = EditorSession.create({
        name: "P",
        width: 1,
        height: 1,
        layerName: "L",
      }),
      before = current.history.undoCount;
    current.loadDefaultPalette([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    ]);
    expect(current.model.palette.colors).toHaveLength(3);
    expect(current.history.undoCount).toBe(before + 1);
    current.undo();
    expect(current.model.palette.colors).toEqual([]);
  });
});
