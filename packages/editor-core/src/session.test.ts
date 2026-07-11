import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import {
  EditorHistory,
  FunctionalCommand,
  TransactionCommand,
} from "./history";
import {
  compositeDocument,
  compositeRegion,
  hashSnapshot,
  readCompositePixel,
} from "./composite";
import { EditorSession } from "./session";
import { bresenhamLine } from "./stroke";

function session() {
  return EditorSession.create({
    name: "Test",
    width: 4,
    height: 4,
    layerName: "Layer 1",
  });
}
function draw(
  current: EditorSession,
  points: readonly { x: number; y: number }[],
  color: [number, number, number, number] = [255, 0, 0, 255],
) {
  const layer = current.model.layerOrder[0];
  if (layer === undefined) throw new Error();
  const stroke = current.beginStroke(layer, color, "Draw");
  for (const point of points) stroke.addPoint(point);
  current.commitStroke(stroke);
}

describe("editor sessions", () => {
  it("interpolates Bresenham lines without gaps", () => {
    expect(bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ]);
  });
  it("stores a pencil stroke as one exact undo patch", () => {
    const current = session();
    const initial = hashSnapshot(current.snapshot());
    draw(current, [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    const edited = hashSnapshot(current.snapshot());
    expect(current.history.undoCount).toBe(1);
    expect(
      current
        .getActiveSurfaceForRead(current.model.layerOrder[0] ?? "")
        .getBytes()
        .slice(0, 16),
    ).toEqual(
      Uint8Array.from([
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
      ]),
    );
    expect(current.undo()).toBe(true);
    expect(hashSnapshot(current.snapshot())).toBe(initial);
    expect(current.redo()).toBe(true);
    expect(hashSnapshot(current.snapshot())).toBe(edited);
  });
  it("eraser produces normalized transparent bytes and is undoable", () => {
    const current = session();
    draw(current, [{ x: 1, y: 1 }]);
    const layer = current.model.layers[current.model.layerOrder[0] ?? ""];
    if (layer === undefined) throw new Error();
    const erase = current.beginStroke(layer.id, [0, 0, 0, 0], "Erase");
    erase.addPoint({ x: 1, y: 1 });
    current.commitStroke(erase);
    expect(current.getActiveSurfaceForRead(layer.id).getPixel(1, 1)).toEqual([
      0, 0, 0, 0,
    ]);
    current.undo();
    expect(current.getActiveSurfaceForRead(layer.id).getPixel(1, 1)).toEqual([
      255, 0, 0, 255,
    ]);
  });
  it("rolls back a canceled stroke without revision", () => {
    const current = session();
    const layer = current.model.layerOrder[0] ?? "";
    const stroke = current.beginStroke(layer, [1, 2, 3, 255], "Draw");
    stroke.addPoint({ x: 0, y: 0 });
    current.cancelStroke(stroke);
    expect(current.model.revision).toBe(0);
    expect(compositeDocument(current)).toEqual(new Uint8Array(64));
  });
  it("undo followed by a new command clears redo", () => {
    const current = session();
    draw(current, [{ x: 0, y: 0 }]);
    current.undo();
    draw(current, [{ x: 1, y: 0 }]);
    expect(current.history.canRedo).toBe(false);
  });
  it("adds, duplicates, moves, renames, hides, locks and deletes layers with undo", () => {
    const current = session();
    const added = current.addLayer("Ink");
    current.renameLayer(added, "Lines");
    current.setLayerVisible(added, false);
    current.setLayerLocked(added, true);
    current.setLayerOpacity(added, 0.5);
    const duplicate = current.duplicateLayer(added, "Copy");
    current.moveLayer(duplicate, 0);
    expect(current.model.layers[added]).toMatchObject({
      name: "Lines",
      visible: false,
      locked: true,
      opacity: 0.5,
    });
    current.deleteLayer(duplicate);
    expect(current.model.layers[duplicate]).toBeUndefined();
    current.undo();
    expect(current.model.layers[duplicate]).toBeDefined();
  });
  it("keeps at least one layer", () => {
    const current = session();
    expect(() =>
      current.deleteLayer(current.model.layerOrder[0] ?? ""),
    ).toThrow("at least one");
  });
  it("composites visible layers in order with opacity", () => {
    const current = session();
    draw(current, [{ x: 0, y: 0 }], [255, 0, 0, 255]);
    const top = current.addLayer("Top");
    drawOn(current, top, [0, 0, 255, 255]);
    current.setLayerOpacity(top, 0.5);
    expect(readCompositePixel(current, 0, 0)).toEqual([128, 0, 128, 255]);
    current.setLayerVisible(top, false);
    expect(readCompositePixel(current, 0, 0)).toEqual([255, 0, 0, 255]);
  });
  it("composites a clipped dirty region without reading full layer buffers", () => {
    const current = session();
    draw(current, [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ]);
    const surface = current.getActiveSurfaceForRead(
      current.model.layerOrder[0] ?? "",
    );
    surface.getBytes = () => {
      throw new Error("full read");
    };
    expect(
      compositeRegion(current, { x: 1, y: 1, width: 2, height: 2 }),
    ).toEqual({
      rect: { x: 1, y: 1, width: 2, height: 2 },
      pixels: Uint8Array.from([
        255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255,
      ]),
    });
  });
  it("increments revisions and tracks the captured saved revision", () => {
    const current = session();
    draw(current, [{ x: 0, y: 0 }]);
    const saved = current.model.revision;
    current.markSaved(saved);
    expect(current.isDirty).toBe(false);
    draw(current, [{ x: 1, y: 0 }]);
    expect(current.isDirty).toBe(true);
    current.markSaved(saved);
    expect(current.isDirty).toBe(true);
  });
  it("rolls back executed transaction commands on failure", () => {
    const state = createDocument({
      name: "T",
      width: 1,
      height: 1,
      layerName: "L",
    });
    const history = new EditorHistory();
    const first = new FunctionalCommand(
      "one",
      "one",
      1,
      (context) => {
        context.model.name = "changed";
      },
      (context) => {
        context.model.name = "T";
      },
    );
    const fail = new FunctionalCommand(
      "fail",
      "fail",
      1,
      () => {
        throw new Error("fail");
      },
      () => undefined,
    );
    expect(() =>
      history.execute(
        state,
        new TransactionCommand("transaction", [first, fail]),
      ),
    ).toThrow();
    expect(state.model.name).toBe("T");
    expect(state.model.revision).toBe(0);
  });
  it("evicts oldest history entries above the memory budget", () => {
    const current = EditorSession.create(
      { name: "T", width: 8, height: 8, layerName: "L" },
      40,
    );
    draw(current, [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    draw(current, [
      { x: 0, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(current.history.undoCount).toBe(1);
  });
});

function drawOn(
  current: EditorSession,
  layerId: string,
  color: [number, number, number, number],
) {
  const stroke = current.beginStroke(layerId, color, "Draw");
  stroke.addPoint({ x: 0, y: 0 });
  current.commitStroke(stroke);
}
