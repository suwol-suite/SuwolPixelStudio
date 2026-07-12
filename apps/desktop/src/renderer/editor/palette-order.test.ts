import { describe, expect, it } from "vitest";
import { EditorSession, compositeDocument } from "@suwol/editor-core";
import { moveDocumentPaletteColor } from "./palette-order";

describe("document palette ordering", () => {
  it("moves RGBA slots only on an explicit reorder", () => {
    const session = EditorSession.create({ name: "RGBA", layerName: "Layer", width: 1, height: 1 }),
      red = session.addPaletteColor([255, 0, 0, 255]),
      blue = session.addPaletteColor([0, 0, 255, 255]);
    moveDocumentPaletteColor(session, blue, 0);
    expect(session.model.palette.colors.map(({ id }) => id)).toEqual([blue, red]);
  });

  it("remaps indexed pixels so a drag never changes appearance", () => {
    const session = EditorSession.create({ name: "Indexed", layerName: "Layer", width: 1, height: 1, colorMode: "indexed" }),
      red = session.addPaletteColor([255, 0, 0, 255]),
      layer = session.model.layerOrder[0] ?? "",
      stroke = session.beginStroke(layer, [255, 0, 0, 255], "Red");
    stroke.addPoint({ x: 0, y: 0 });
    session.commitStroke(stroke);
    const before = compositeDocument(session);
    moveDocumentPaletteColor(session, red, 0);
    expect(compositeDocument(session)).toEqual(before);
    expect(session.model.palette.colors[0]?.id).toBe(red);
  });
});
