import { describe, expect, it } from "vitest";
import { EditorSession, hashSnapshot } from "@suwol/editor-core";
import { PluginDocumentBroker, type PluginHostDocument } from "./document-broker";
import { PluginError } from "./errors";

function setup() {
  const session = EditorSession.create({ name: "Plugin Test", width: 4, height: 4, layerName: "Layer 1" });
  const layerId = session.model.layerOrder[0];
  const frameId = session.model.frameOrder[0];
  if (layerId === undefined || frameId === undefined) throw new Error("Test document is incomplete.");
  const document: PluginHostDocument = {
    session,
    activeLayerId: layerId,
    activeFrameId: frameId,
    selectionBounds: { x: 1, y: 1, width: 2, height: 2 },
  };
  const broker = new PluginDocumentBroker({ getActive: () => document, listOpen: () => [document] });
  const grants = ["document.read", "document.write", "selection.read", "palette.read", "palette.write"] as const;
  return { session, layerId, frameId, document, broker, grants };
}
function pixelBuffer(red: number): ArrayBuffer {
  return new Uint8Array([red, 20, 30, 255]).buffer;
}

describe("plugin document broker", () => {
  it("returns immutable summaries and selection bounds", () => {
    const { broker, grants, session } = setup();
    expect(broker.getActive("com.example.plugin", grants)).toMatchObject({ id: session.model.id, width: 4, height: 4 });
    expect(broker.getSelectionBounds(session.model.id, "com.example.plugin", grants)).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });
  it("requires explicit read and selection permissions", () => {
    const { broker, session } = setup();
    expect(() => broker.getActive("com.example.plugin", [])).toThrow(PluginError);
    expect(() => broker.getSelectionBounds(session.model.id, "com.example.plugin", ["document.read"])).toThrow(PluginError);
  });
  it("reads pixels without creating an empty Cel", () => {
    const { broker, grants, session, layerId, frameId } = setup();
    const emptyFrame = session.addFrame(frameId, "empty");
    const celCount = Object.keys(session.model.cels).length;
    const bytes = broker.readPixels(session.model.id, { layerId, frameId: emptyFrame, rect: { x: 0, y: 0, width: 1, height: 1 } }, "com.example.plugin", grants);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(4));
    expect(Object.keys(session.model.cels)).toHaveLength(celCount);
  });
  it("commits pixel write as one undo and supports redo", () => {
    const { broker, grants, session, layerId, frameId } = setup();
    const before = hashSnapshot(session.snapshot());
    broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Plugin write",
      operations: [{ type: "writePixels", options: { layerId, frameId, rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: pixelBuffer(200) } }],
    }, "com.example.plugin", grants);
    const after = hashSnapshot(session.snapshot());
    expect(after).not.toBe(before);
    expect(session.history.undoCount).toBe(1);
    expect(session.undo()).toBe(true);
    expect(hashSnapshot(session.snapshot())).toBe(before);
    expect(session.redo()).toBe(true);
    expect(hashSnapshot(session.snapshot())).toBe(after);
  });
  it("groups layer, frame and pixel changes into one undo", () => {
    const { broker, grants, session, frameId } = setup();
    const before = hashSnapshot(session.snapshot());
    broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Plugin multi change",
      operations: [
        { type: "addPixelLayer", temporaryId: "temp:layer", name: "Generated" },
        { type: "addFrame", temporaryId: "temp:frame", afterFrameId: frameId },
        { type: "writePixels", options: { layerId: "temp:layer", frameId: "temp:frame", rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: pixelBuffer(90) } },
      ],
    }, "com.example.plugin", grants);
    expect(session.model.layerOrder).toHaveLength(2);
    expect(session.model.frameOrder).toHaveLength(2);
    expect(session.history.undoCount).toBe(1);
    session.undo();
    expect(hashSnapshot(session.snapshot())).toBe(before);
  });
  it("rolls back all earlier operations on validation failure", () => {
    const { broker, grants, session, layerId, frameId } = setup();
    const before = hashSnapshot(session.snapshot());
    expect(() => broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Rollback",
      operations: [
        { type: "addPixelLayer", temporaryId: "temp:layer", name: "Temporary" },
        { type: "writePixels", options: { layerId, frameId, rect: { x: 4, y: 4, width: 1, height: 1 }, pixels: pixelBuffer(1) } },
      ],
    }, "com.example.plugin", grants)).toThrow(PluginError);
    expect(hashSnapshot(session.snapshot())).toBe(before);
    expect(session.history.undoCount).toBe(0);
  });
  it("rolls back a cancelled transaction", () => {
    const { broker, grants, session } = setup();
    const before = hashSnapshot(session.snapshot()), controller = new AbortController();
    controller.abort();
    expect(() => broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Cancelled",
      operations: [{ type: "addPixelLayer", temporaryId: "temp:layer", name: "Temporary" }],
    }, "com.example.plugin", grants, controller.signal)).toThrow(/cancel/i);
    expect(hashSnapshot(session.snapshot())).toBe(before);
  });
  it("rejects locked layer writes", () => {
    const { broker, grants, session, layerId, frameId } = setup();
    session.setLayerLocked(layerId, true);
    expect(() => broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Locked",
      operations: [{ type: "writePixels", options: { layerId, frameId, rect: { x: 0, y: 0, width: 1, height: 1 }, pixels: pixelBuffer(2) } }],
    }, "com.example.plugin", grants)).toThrow(/locked/i);
  });
  it("requires palette.write and stores document plugin data by namespace", () => {
    const { broker, grants, session } = setup();
    expect(() => broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Palette",
      operations: [{ type: "setPalette", palette: { colors: [] } }],
    }, "com.example.plugin", ["document.write"])).toThrow(PluginError);
    broker.transaction({
      documentId: session.model.id,
      expectedRevision: session.model.revision,
      label: "Metadata",
      operations: [{ type: "setPluginData", value: { generation: 1 } }],
    }, "com.example.plugin", grants);
    expect(session.model.pluginData?.["com.example.plugin"]).toEqual({ generation: 1 });
  });
});
