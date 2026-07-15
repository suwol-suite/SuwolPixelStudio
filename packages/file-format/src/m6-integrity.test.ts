import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  EditorSession,
  addGroup,
  convertSessionToIndexed,
  hashSnapshot,
} from "@suwol/editor-core";
import { deserializeSuwolPixel, serializeSuwolPixel } from "./archive";

function archive() {
  const session = EditorSession.create({
    name: "M6 fixture",
    layerName: "Pixel",
    width: 4,
    height: 4,
  });
  const layer = session.model.layerOrder[0] ?? "";
  const stroke = session.beginStroke(layer, [240, 20, 40, 255], "fixture");
  stroke.addPoint({ x: 1, y: 1 });
  session.commitStroke(stroke);
  session.setPluginData("studio.suwol.fixture", { schemaVersion: 1, stable: true });
  session.model.metadata["future.optional"] = { value: 7 };
  return { session, bytes: serializeSuwolPixel(session.snapshot(), "1.0.1") };
}
function mutateDocument(
  bytes: Uint8Array,
  change: (document: Record<string, unknown>) => void,
): Uint8Array {
  const files = unzipSync(bytes), documentBytes = files["document.json"];
  if (documentBytes === undefined) throw new Error("Missing fixture document.");
  const document = JSON.parse(new TextDecoder().decode(documentBytes)) as Record<string, unknown>;
  change(document);
  files["document.json"] = strToU8(JSON.stringify(document));
  return zipSync(files);
}

describe("M6 v4 format freeze", () => {
  it("preserves IDs, ordering, metadata and plugin data across save/reopen/save", () => {
    const first = archive(), loaded = deserializeSuwolPixel(first.bytes),
      second = deserializeSuwolPixel(serializeSuwolPixel(loaded, "1.0.1"));
    expect(hashSnapshot(second)).toBe(hashSnapshot(loaded));
    expect(second.model.rootLayerIds).toEqual(loaded.model.rootLayerIds);
    expect(second.model.frameOrder).toEqual(loaded.model.frameOrder);
    expect(second.model.metadata["future.optional"]).toEqual({ value: 7 });
    expect(second.model.pluginData?.["studio.suwol.fixture"]).toEqual({ schemaVersion: 1, stable: true });
  });
  it("round-trips an indexed fixture with a valid transparent slot", () => {
    const { session } = archive();
    convertSessionToIndexed(session, {
      maxColors: 8,
      transparentIndex: 0,
      alphaThreshold: 1,
      quantization: "exact",
      dithering: "none",
    });
    const loaded = deserializeSuwolPixel(serializeSuwolPixel(session.snapshot(), "1.0.1"));
    expect(loaded.model.canvas.colorMode).toBe("indexed");
    expect(loaded.model.palette.transparentIndex).toBe(0);
  });
  it("rejects archive blobs that have no matching metadata", () => {
    const files = unzipSync(archive().bytes);
    files["images/orphan.rgba"] = new Uint8Array(4);
    expect(() => deserializeSuwolPixel(zipSync(files))).toThrow(/orphan|mismatched/i);
    delete files["images/orphan.rgba"];
    files["tilemaps/orphan.tile32"] = new Uint8Array(4);
    expect(() => deserializeSuwolPixel(zipSync(files))).toThrow(/orphan/i);
  });
  it("rejects a layer cycle before exposing a document", () => {
    const { session } = archive(), group = addGroup(session, "Group"),
      bytes = serializeSuwolPixel(session.snapshot(), "1.0.1");
    const broken = mutateDocument(bytes, (document) => {
      const layers = document.layers as Record<string, Record<string, unknown>>;
      layers[group] = { ...layers[group], parentId: group, childIds: [group] };
      document.rootLayerIds = [group];
    });
    expect(() => deserializeSuwolPixel(broken)).toThrow();
  });
  it("rejects a missing linked-Cel image reference", () => {
    const broken = mutateDocument(archive().bytes, (document) => {
      const cels = document.cels as Record<string, Record<string, unknown>>;
      const first = Object.values(cels)[0];
      if (first !== undefined) first.imageId = "missing-linked-image";
    });
    expect(() => deserializeSuwolPixel(broken)).toThrow();
  });
});
