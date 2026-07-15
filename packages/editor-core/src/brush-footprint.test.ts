import { describe, expect, it } from "vitest";
import {
  BitSelectionMask,
  EditorSession,
  createBrushFootprint,
  createCustomBrushPreset,
  type BrushPreset,
  type IntPoint,
} from "./index";

function square(size: number): BrushPreset {
  return {
    id: `square-${size}`,
    name: `${size}px Square`,
    kind: "square",
    width: size,
    height: size,
    opacity: 1,
    spacing: 1,
    angle: 0,
    flipX: false,
    flipY: false,
    center: { x: Math.floor(size / 2), y: Math.floor(size / 2) },
  };
}

describe("brush footprint", () => {
  it.each([1, 3, 5, 8, 16, 32, 64])("matches a %ipx square stamp", (size) => {
    const footprint = createBrushFootprint(square(size), { x: 80, y: 80 });
    expect(footprint.points).toHaveLength(size * size);
    expect(footprint.bounds).toEqual({
      x: 80 - Math.floor(size / 2),
      y: 80 - Math.floor(size / 2),
      width: size,
      height: size,
    });
  });

  it("uses the circle mask and a custom brush anchor", () => {
    expect(createBrushFootprint({ ...square(4), kind: "circle" }, { x: 5, y: 5 }).points).toHaveLength(12);
    const custom = createCustomBrushPreset(
      "Offset",
      3,
      2,
      Uint8Array.from([1, 0, 0, 0, 1, 0]),
      { x: 0, y: 0 },
    );
    expect(createBrushFootprint(custom, { x: 5, y: 5 }).points).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ]);
  });

  it("clips once to document and selection while deduplicating symmetry axes", () => {
    const selection = new BitSelectionMask(8, 8);
    selection.setRect({ x: 0, y: 0, width: 3, height: 3 }, "replace");
    const footprint = createBrushFootprint(square(3), { x: 1, y: 1 }, {
      documentBounds: { x: 0, y: 0, width: 8, height: 8 },
      selection,
      symmetry: { mode: "both", axisX: 1, axisY: 1 },
    });
    expect(footprint.points).toHaveLength(9);
    expect(new Set(footprint.points.map(({ x, y }) => `${x},${y}`)).size).toBe(9);
  });

  it.each(["rgba", "indexed"] as const)("commits the exact preview pixels in %s mode", (colorMode) => {
    const session = EditorSession.create({
        name: "Footprint",
        layerName: "Layer",
        width: 12,
        height: 12,
        colorMode,
      }),
      layerId = session.model.layerOrder[0] ?? "",
      brush = square(5),
      selection = new BitSelectionMask(12, 12);
    selection.setRect({ x: 3, y: 3, width: 5, height: 5 }, "replace");
    const options = {
        documentBounds: { x: 0, y: 0, width: 12, height: 12 },
        selection,
        symmetry: { mode: "vertical" as const, axisX: 5.5, axisY: 5.5 },
      },
      point: IntPoint = { x: 4, y: 5 },
      preview = createBrushFootprint(brush, point, options),
      stroke = session.beginStroke(layerId, [255, 0, 0, 255], "Draw", {
        footprint: (center) => createBrushFootprint(brush, center, options).points,
      });
    stroke.addPoint(point);
    expect(session.commitStroke(stroke)).toBe(true);
    const surface = session.getActiveSurfaceForRead(layerId),
      changed: string[] = [];
    for (let y = 0; y < 12; y += 1)
      for (let x = 0; x < 12; x += 1)
        if (surface.getPixel(x, y)[3] !== 0) changed.push(`${x},${y}`);
    expect(changed.sort()).toEqual(preview.points.map(({ x, y }) => `${x},${y}`).sort());
  });
});
