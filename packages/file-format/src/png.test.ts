import { describe, expect, it } from "vitest";
import { EditorSession, compositeDocument } from "@suwol/editor-core";
import { deserializeSuwolPixel, serializeSuwolPixel } from "./archive";
import { decodePng, encodePng, exportPng, importPng } from "./png";

function asymmetricFixture(width = 16, height = 16): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba.set([x * 13, y * 11, (x * 17 + y * 7) % 256, 255], offset);
    }
  const mark = (x: number, y: number): void => rgba.set([0, 0, 0, 255], (y * width + x) * 4);
  for (let x = 5; x <= 9; x += 1) mark(x, 1);
  for (let y = 1; y <= 4; y += 1) mark(7, y);
  for (let y = 5; y <= 10; y += 1) mark(1, y);
  for (let x = 1; x <= 4; x += 1) mark(x, 10);
  mark(12, 6);
  // Unique corners plus T/L and off-center markers catch flips and row shifts.
  rgba.set([255, 0, 0, 255], 0);
  rgba.set([0, 255, 0, 255], (width - 1) * 4);
  rgba.set([0, 0, 255, 255], (height - 1) * width * 4);
  rgba.set([255, 255, 0, 255], (width * height - 1) * 4);
  return rgba;
}

describe("PNG adapter", () => {
  it("round trips exact RGBA8 bytes", () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 4, 5, 6, 255,
    ]);
    const decoded = decodePng(encodePng(2, 2, rgba));
    expect(decoded).toMatchObject({ width: 2, height: 2 });
    expect(decoded.rgba).toEqual(rgba);
  });
  it("imports a PNG as one RGBA pixel layer", () => {
    const bytes = encodePng(1, 1, Uint8Array.from([4, 5, 6, 255]));
    const session = importPng("image", bytes, "Layer 1");
    expect(session.model.canvas).toMatchObject({
      width: 1,
      height: 1,
      colorMode: "rgba",
    });
    expect(compositeDocument(session)).toEqual(Uint8Array.from([4, 5, 6, 255]));
  });
  it("exports visible composited layers without changing the document", () => {
    const session = EditorSession.create({
      name: "P",
      width: 1,
      height: 1,
      layerName: "L",
    });
    const layer = session.model.layerOrder[0] ?? "";
    const stroke = session.beginStroke(layer, [10, 20, 30, 255], "Draw");
    stroke.addPoint({ x: 0, y: 0 });
    session.commitStroke(stroke);
    const revision = session.model.revision;
    expect(decodePng(exportPng(session.snapshot())).rgba).toEqual(
      Uint8Array.from([10, 20, 30, 255]),
    );
    expect(session.model.revision).toBe(revision);
  });
  it("preserves an asymmetric top-left row-major image through import, archive, and export", () => {
    const expected = asymmetricFixture(),
      imported = importPng("orientation", encodePng(16, 16, expected), "Layer 1"),
      archived = EditorSession.fromSnapshot(
        deserializeSuwolPixel(
          serializeSuwolPixel(imported.snapshot(), "1.0.1-rc.2"),
        ),
      ),
      exported = decodePng(exportPng(archived.snapshot()));
    expect(compositeDocument(imported)).toEqual(expected);
    expect(compositeDocument(archived)).toEqual(expected);
    expect(exported).toMatchObject({ width: 16, height: 16 });
    expect(exported.rgba).toEqual(expected);
  });
  it("rejects mismatched encoder data length", () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow("length");
  });
});
