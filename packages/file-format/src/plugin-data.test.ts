import { describe, expect, it } from "vitest";
import { EditorSession } from "@suwol/editor-core";
import { deserializeSuwolPixel, serializeSuwolPixel } from "./archive";

describe("v4 optional plugin-data", () => {
  it("round-trips namespaced document metadata", () => {
    const session = EditorSession.create({ name: "Plugin data", width: 2, height: 2, layerName: "Layer" });
    session.setPluginData("com.example.unknown", { version: 1, values: ["preserved", true] });
    const restored = deserializeSuwolPixel(serializeSuwolPixel(session.snapshot(), "0.4.0"));
    expect(restored.model.schemaVersion).toBe(4);
    expect(restored.model.pluginData?.["com.example.unknown"]).toEqual({ version: 1, values: ["preserved", true] });
  });
  it("does not require plugin-data for older v3 documents", () => {
    const session = EditorSession.create({ name: "No data", width: 1, height: 1, layerName: "Layer" });
    delete session.model.pluginData;
    const restored = deserializeSuwolPixel(serializeSuwolPixel(session.snapshot(), "0.4.0"));
    expect(restored.model.pluginData).toEqual({});
  });
  it("plugin-data changes remain undoable", () => {
    const session = EditorSession.create({ name: "Undo data", width: 1, height: 1, layerName: "Layer" });
    session.setPluginData("com.example.plugin", { value: 2 });
    expect(session.model.pluginData?.["com.example.plugin"]).toEqual({ value: 2 });
    session.undo();
    expect(session.model.pluginData?.["com.example.plugin"]).toBeUndefined();
    session.redo();
    expect(session.model.pluginData?.["com.example.plugin"]).toEqual({ value: 2 });
  });
});
