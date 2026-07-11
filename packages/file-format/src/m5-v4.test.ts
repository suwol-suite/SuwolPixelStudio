import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { EditorSession, addGroup, addTilemapLayer, convertSessionToIndexed, createTileSet, hashSnapshot, paintTile } from "@suwol/editor-core";
import { deserializeSuwolPixel, serializeSuwolPixel } from "./archive";
import { importAseprite } from "./aseprite";

describe(".suwolpixel v4 professional round trip", () => {
  it("round-trips indexed, group, tilemap and linked animation data", () => {
    const session = EditorSession.create({ name: "v4", layerName: "Pixel", width: 8, height: 8 });
    const layer = session.model.layerOrder[0] ?? "", stroke = session.beginStroke(layer, [255, 0, 0, 255], "red"); stroke.addPoint({ x: 1, y: 1 }); session.commitStroke(stroke);
    addGroup(session, "Group");
    const tileSet = createTileSet(session, { name: "Tiles", tileWidth: 1, tileHeight: 1, columns: 2, tileCount: 2, atlasWidth: 2, atlasHeight: 1, atlasBytes: Uint8Array.from([0,0,0,0,255,255,255,255]) }), tileLayer = addTilemapLayer(session, tileSet, 2, 2);
    paintTile(session, tileLayer, 1, 1, { tileId: 1, flipX: true, flipY: false, rotation: 1 });
    convertSessionToIndexed(session, { maxColors: 8, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "none" });
    const before = session.snapshot(), restored = deserializeSuwolPixel(serializeSuwolPixel(before, "0.5.0"));
    expect(restored.model.schemaVersion).toBe(4);
    expect(restored.model.canvas.colorMode).toBe("indexed");
    expect(hashSnapshot(restored)).toBe(hashSnapshot(before));
    expect(restored.tilemaps?.size).toBe(1);
  });
});

describe("independent Aseprite parser", () => {
  it("imports RGBA raw, compressed and linked Cels", () => {
    const fixture = asepriteFixture(32, [
      [{ type: "layer" }, { type: "raw", pixel: [12, 34, 56, 255] }],
      [{ type: "compressed", pixel: [90, 80, 70, 255] }],
      [{ type: "linked", frame: 0 }],
    ]), imported = importAseprite(fixture, { name: "Fixture" });
    expect(imported.snapshot.model.frameOrder).toHaveLength(3);
    expect(Object.keys(imported.snapshot.model.cels)).toHaveLength(3);
    expect(imported.report.imported).toContain("Raw, compressed, and linked Cels");
    const cels = Object.values(imported.snapshot.model.cels);
    expect(cels[0]?.kind === "pixel" && cels[2]?.kind === "pixel" && cels[0].imageId === cels[2].imageId).toBe(true);
  });
  it("imports indexed pixels, transparent index and palette", () => {
    const imported = importAseprite(asepriteFixture(8, [[{ type: "layer" }, { type: "palette" }, { type: "raw", pixel: [1] }]]));
    expect(imported.snapshot.model.canvas.colorMode).toBe("indexed");
    expect(imported.snapshot.model.palette.transparentIndex).toBe(0);
    expect([...imported.snapshot.images.values()][0]).toEqual(Uint8Array.from([1]));
  });
  it("rejects malformed and truncated binaries without reading past bounds", () => {
    const fixture = asepriteFixture(32, [[{ type: "layer" }, { type: "raw", pixel: [1,2,3,255] }]]);
    for (let length = 1; length < fixture.length; length += 17) expect(() => importAseprite(fixture.slice(0, length))).toThrow();
    const corrupted = fixture.slice(); corrupted[4] = 0; corrupted[5] = 0;
    expect(() => importAseprite(corrupted)).toThrow("header");
  });
  it("honors cancellation before parsing frames", () => { const controller = new AbortController(); controller.abort(); expect(() => importAseprite(asepriteFixture(32, [[{ type: "layer" }]]), { signal: controller.signal })).toThrow("cancelled"); });
});

type ChunkSpec = { type: "layer" } | { type: "raw" | "compressed"; pixel: number[] } | { type: "linked"; frame: number } | { type: "palette" };
function asepriteFixture(depth: 8 | 32, frames: readonly (readonly ChunkSpec[])[]): Uint8Array {
  const frameBytes = frames.map((chunks, frameIndex) => {
    const encoded = chunks.map((chunk) => encodeChunk(chunk, depth, frameIndex)), size = 16 + encoded.reduce((sum, chunk) => sum + chunk.length, 0), writer = new Writer(size);
    writer.u32(size); writer.u16(0xf1fa); writer.u16(encoded.length); writer.u16(100); writer.u16(0); writer.u32(encoded.length); for (const chunk of encoded) writer.bytes(chunk); return writer.output;
  }), total = 128 + frameBytes.reduce((sum, frame) => sum + frame.length, 0), output = new Uint8Array(total), view = new DataView(output.buffer);
  view.setUint32(0, total, true); view.setUint16(4, 0xa5e0, true); view.setUint16(6, frames.length, true); view.setUint16(8, 1, true); view.setUint16(10, 1, true); view.setUint16(12, depth, true); output[28] = 0; view.setUint16(32, depth === 8 ? 2 : 0, true);
  let offset = 128; for (const frame of frameBytes) { output.set(frame, offset); offset += frame.length; } return output;
}
function encodeChunk(spec: ChunkSpec, depth: 8 | 32, frameIndex: number): Uint8Array {
  let type: number, payload: Uint8Array;
  if (spec.type === "layer") { type = 0x2004; const writer = new Writer(32); writer.u16(1); writer.u16(0); writer.u16(0); writer.u16(0); writer.u16(0); writer.u16(0); writer.u8(255); writer.skip(3); writer.string("Layer"); payload = writer.used; }
  else if (spec.type === "palette") { type = 0x2019; const writer = new Writer(34); writer.u32(2); writer.u32(0); writer.u32(1); writer.skip(8); writer.u16(0); writer.bytes(Uint8Array.from([0,0,0,0])); writer.u16(0); writer.bytes(Uint8Array.from([255,0,0,255])); payload = writer.used; }
  else { type = 0x2005; const pixel = Uint8Array.from(spec.type === "linked" ? [] : spec.pixel), body = spec.type === "compressed" ? zlibSync(pixel) : pixel, writer = new Writer(32 + body.length); writer.u16(0); writer.i16(0); writer.i16(0); writer.u8(255); writer.u16(spec.type === "raw" ? 0 : spec.type === "linked" ? 1 : 2); writer.i16(0); writer.skip(5); if (spec.type === "linked") writer.u16(spec.frame); else { writer.u16(1); writer.u16(1); writer.bytes(body); } payload = writer.used; void depth; void frameIndex; }
  const writer = new Writer(payload.length + 6); writer.u32(payload.length + 6); writer.u16(type); writer.bytes(payload); return writer.output;
}
class Writer { readonly output: Uint8Array; readonly #view: DataView; offset = 0; constructor(size: number) { this.output = new Uint8Array(size); this.#view = new DataView(this.output.buffer); } get used() { return this.output.slice(0, this.offset); } u8(value: number) { this.output[this.offset++] = value; } u16(value: number) { this.#view.setUint16(this.offset, value, true); this.offset += 2; } i16(value: number) { this.#view.setInt16(this.offset, value, true); this.offset += 2; } u32(value: number) { this.#view.setUint32(this.offset, value, true); this.offset += 4; } skip(length: number) { this.offset += length; } bytes(value: Uint8Array) { this.output.set(value, this.offset); this.offset += value.length; } string(value: string) { const bytes = new TextEncoder().encode(value); this.u16(bytes.length); this.bytes(bytes); } }
