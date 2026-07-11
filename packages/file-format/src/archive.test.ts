import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { EditorSession, hashSnapshot } from "@suwol/editor-core";
import { deserializeSuwolPixel, serializeSuwolPixel } from "./archive";

function editedSession() {
  const session = EditorSession.create({
    name: "Round Trip",
    width: 4,
    height: 4,
    layerName: "Layer 1",
  });
  const layer = session.model.layerOrder[0] ?? "";
  const stroke = session.beginStroke(layer, [12, 34, 56, 200], "Draw");
  stroke.addPoint({ x: 0, y: 0 });
  stroke.addPoint({ x: 3, y: 3 });
  session.commitStroke(stroke);
  const top = session.addLayer("Top"),
    topStroke = session.beginStroke(top, [90, 80, 70, 255], "Top");
  topStroke.addPoint({ x: 1, y: 1 });
  session.commitStroke(topStroke);
  return session;
}

function convertV4ArchiveToLegacy(version: 1 | 2): Uint8Array {
  const files = unzipSync(serializeSuwolPixel(editedSession().snapshot(), "0.3.0")),
    manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as Record<string, unknown>,
    document = JSON.parse(new TextDecoder().decode(files["document.json"])) as Record<string, unknown>,
    frameOrder = document.frameOrder as string[],
    firstFrame = frameOrder[0] ?? "",
    layers = document.layers as Record<string, Record<string, unknown>>,
    cels = document.cels as Record<string, { layerId: string; frameId: string; imageId: string }>;
  document.layerOrder = [...(document.rootLayerIds as string[])];
  for (const [layerId, layer] of Object.entries(layers)) {
    const cel = Object.values(cels).find((value) => value.layerId === layerId && value.frameId === firstFrame);
    if (cel === undefined) throw new Error("Fixture cel missing");
    layer.imageId = cel.imageId;
    Reflect.deleteProperty(layer, "parentId");
    Reflect.deleteProperty(layer, "blendMode");
  }
  const palette = document.palette as { entries: Record<string, unknown>[] };
  document.palette = {
    colors: palette.entries.map((entry) => {
      const color = { ...entry };
      Reflect.deleteProperty(color, "index");
      Reflect.deleteProperty(color, "locked");
      return color;
    }),
  };
  document.schemaVersion = version;
  for (const key of ["rootLayerIds", "frameOrder", "frames", "cels", "celByLayerAndFrame", "tags", "tilemaps", "tileSets", "slices", "metadata"])
    Reflect.deleteProperty(document, key);
  if (version === 1) delete document.palette;
  manifest.schemaVersion = version;
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  files["document.json"] = strToU8(JSON.stringify(document));
  return zipSync(files);
}

describe(".suwolpixel v4", () => {
  it("round trips model metadata and image bytes exactly", () => {
    const session = editedSession();
    const before = session.snapshot();
    const loaded = deserializeSuwolPixel(serializeSuwolPixel(before, "0.1.0"));
    expect(hashSnapshot(loaded)).toBe(hashSnapshot(before));
    for (const [id, bytes] of before.images)
      expect(loaded.images.get(id)).toEqual(bytes);
  });
  it("contains the required v4 entries", () => {
    const files = unzipSync(
      serializeSuwolPixel(editedSession().snapshot(), "0.1.0"),
    );
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "mimetype",
        "manifest.json",
        "document.json",
        "thumbnail.png",
      ]),
    );
    expect(
      Object.keys(files).filter((name) => name.startsWith("images/")),
    ).toHaveLength(2);
  });
  it("round trips a palette with stable ids", () => {
    const session = editedSession();
    session.addPaletteColor([1, 2, 3, 255], "Ink");
    const loaded = deserializeSuwolPixel(
      serializeSuwolPixel(session.snapshot(), "0.2.0"),
    );
    expect(loaded.model.palette).toEqual(session.model.palette);
  });
  it("migrates a strict M2 document through v3 to v4", () => {
    const loaded = deserializeSuwolPixel(convertV4ArchiveToLegacy(2));
    expect(loaded.model.schemaVersion).toBe(4);
    expect(loaded.model.frameOrder).toHaveLength(1);
    expect(Object.keys(loaded.model.cels)).toHaveLength(2);
  });
  it("migrates M1 through the v2 and v3 path to v4 with an empty palette", () => {
    const loaded = deserializeSuwolPixel(convertV4ArchiveToLegacy(1));
    expect(loaded.model.schemaVersion).toBe(4);
    expect(loaded.model.palette.colors).toEqual([]);
  });
  it("rejects a damaged manifest", () => {
    const files = unzipSync(
      serializeSuwolPixel(editedSession().snapshot(), "0.1.0"),
    );
    files["manifest.json"] = strToU8(JSON.stringify({ format: "wrong" }));
    expect(() => deserializeSuwolPixel(zipSync(files))).toThrow();
  });
  it("rejects image blob length mismatches", () => {
    const files = unzipSync(
      serializeSuwolPixel(editedSession().snapshot(), "0.1.0"),
    );
    const image = Object.keys(files).find((name) => name.startsWith("images/"));
    if (image === undefined) throw new Error();
    files[image] = new Uint8Array(3);
    expect(() => deserializeSuwolPixel(zipSync(files))).toThrow("length");
  });
  it("rejects path traversal before extraction", () => {
    const archive = zipSync({
      "../evil": new Uint8Array([1]),
      mimetype: strToU8("x"),
    });
    expect(() => deserializeSuwolPixel(archive)).toThrow("unsafe");
  });
  it("rejects unsupported schema versions", () => {
    const files = unzipSync(
      serializeSuwolPixel(editedSession().snapshot(), "0.1.0"),
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(files["manifest.json"]),
    ) as Record<string, unknown>;
    manifest.schemaVersion = 99;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    expect(() => deserializeSuwolPixel(zipSync(files))).toThrow();
  });
  it("rejects random archive bytes without crashing the process", () => {
    for (let length = 1; length < 64; length += 7)
      expect(() =>
        deserializeSuwolPixel(new Uint8Array(length).fill(42)),
      ).toThrow();
  });
});
