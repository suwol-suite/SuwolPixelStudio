import { describe, expect, it } from "vitest";
import { EditorSession, compositeDocument } from "@suwol/editor-core";
import { decodePng, encodePng, exportPng, importPng } from "./png";

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
  it("rejects mismatched encoder data length", () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow("length");
  });
});
