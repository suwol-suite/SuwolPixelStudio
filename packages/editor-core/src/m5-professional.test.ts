import { describe, expect, it } from "vitest";
import { addGroup, addTilemapLayer, applyRasterPoints, blendRgba, canReparentLayer, createCustomBrushPreset, createTileSet, decodeTileCell, deleteLayerTree, duplicateLayerTree, encodeTileCell, fillTile, flattenGroupLayer, flattenLayerTree, mergeLayerDown, moveLayerToParent, paintTile, pixelPerfectPoints, readTile, symmetryPoints, tilemapFromLittleEndian, tilemapToLittleEndian, unlinkTilemapCel, validateSlice, EditorSession } from "./index";

describe("M5 professional editing primitives", () => {
  it.each([
    ["normal", [200, 100, 50, 255]], ["multiply", [78, 78, 39, 255]], ["screen", [222, 222, 211, 255]], ["difference", [100, 100, 150, 255]], ["addition", [255, 255, 250, 255]], ["subtract", [0, 100, 150, 255]],
  ] as const)("composites %s with the reference formula", (mode, expected) => expect(blendRgba([100, 200, 200, 255], [200, 100, 50, 255], mode)).toEqual(expected));
  it("maintains a cycle-free nested layer tree", () => {
    const session = EditorSession.create({ name: "Tree", layerName: "Pixel" }), root = session.model.rootLayerIds[0] ?? "", group = addGroup(session, "Group");
    expect(canReparentLayer(session.model, root, group)).toBe(true);
    expect(canReparentLayer(session.model, group, group)).toBe(false);
    expect(flattenLayerTree(session.model)).toEqual([root, group]);
  });
  it("duplicates and deletes a complete Group subtree in one undoable snapshot", () => {
    const session = EditorSession.create({ name: "Tree", layerName: "Pixel" }), pixel = session.model.rootLayerIds[0] ?? "", group = addGroup(session, "Group");
    moveLayerToParent(session, pixel, group, 0);
    const copy = duplicateLayerTree(session, group);
    expect(session.model.layers[copy]?.kind).toBe("group");
    expect(session.model.layerOrder).toHaveLength(4);
    deleteLayerTree(session, group);
    expect(session.model.layers[group]).toBeUndefined();
    expect(session.model.layerOrder).toHaveLength(2);
    expect(session.undo()).toBe(true);
    expect(session.model.layers[group]).toBeDefined();
  });
  it("merges two animated layers down without flattening unrelated structure", () => {
    const session = EditorSession.create({ name: "Merge", layerName: "Bottom", width: 4, height: 4 }), bottom = session.model.rootLayerIds[0] ?? "", top = session.addLayer("Top");
    applyRasterPoints(session, bottom, [{ x: 0, y: 0 }], [255, 0, 0, 255], null, "Red");
    applyRasterPoints(session, top, [{ x: 1, y: 0 }], [0, 0, 255, 255], null, "Blue");
    const merged = mergeLayerDown(session, top), pixels = session.getActiveSurfaceForRead(merged);
    expect(session.model.layerOrder).toEqual([merged]);
    expect(pixels.getPixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixels.getPixel(1, 0)).toEqual([0, 0, 255, 255]);
    expect(session.undo()).toBe(true);
    expect(session.model.layerOrder).toEqual([bottom, top]);
  });
  it("flattens only the selected Group", () => {
    const session = EditorSession.create({ name: "Group", layerName: "Child" }), child = session.model.rootLayerIds[0] ?? "", group = addGroup(session, "Group");
    moveLayerToParent(session, child, group, 0);
    const flattened = flattenGroupLayer(session, group);
    expect(session.model.layers[flattened]?.kind).toBe("pixel");
    expect(session.model.layerOrder).toEqual([flattened]);
  });
  it("encodes tile id, flips and rotation as little-endian tile32", () => {
    const encoded = encodeTileCell({ tileId: 42, flipX: true, flipY: true, rotation: 3 }), bytes = tilemapToLittleEndian(Uint32Array.from([0, encoded]));
    expect(tilemapFromLittleEndian(bytes)).toEqual(Uint32Array.from([0, encoded]));
    expect(decodeTileCell(encoded)).toEqual({ tileId: 42, flipX: true, flipY: true, rotation: 3 });
  });
  it("paints and scanline-fills a Tilemap Layer with undo", () => {
    const session = EditorSession.create({ name: "Tiles", layerName: "Pixel", width: 16, height: 16 }), atlas = new Uint8Array(16 * 8 * 4).fill(255), tileSet = createTileSet(session, { name: "Set", tileWidth: 8, tileHeight: 8, columns: 2, tileCount: 2, atlasWidth: 16, atlasHeight: 8, atlasBytes: atlas }), layer = addTilemapLayer(session, tileSet, 4, 4);
    paintTile(session, layer, 0, 0, { tileId: 1, flipX: false, flipY: false, rotation: 0 });
    expect(readTile(session, layer, 0, 0)?.tileId).toBe(1);
    expect(fillTile(session, layer, 1, 1, { tileId: 0, flipX: false, flipY: false, rotation: 0 })).toBe(true);
    expect(readTile(session, layer, 3, 3)?.tileId).toBe(0);
    expect(session.undo()).toBe(true);
    expect(readTile(session, layer, 3, 3)?.tileId).toBeNull();
  });
  it("duplicates, links, unlinks, and deletes Tilemap Cels across frames", () => {
    const session = EditorSession.create({ name: "Tile animation", layerName: "Pixel", width: 16, height: 16 }), tileSet = createTileSet(session, { name: "Set", tileWidth: 8, tileHeight: 8, columns: 1, tileCount: 1, atlasWidth: 8, atlasHeight: 8, atlasBytes: new Uint8Array(8 * 8 * 4) }), layer = addTilemapLayer(session, tileSet, 2, 2), first = session.activeFrameId;
    const firstCel = session.getAnyCel(layer, first);
    expect(firstCel?.kind).toBe("tilemap");
    const second = session.addFrame(first, "linked"), secondCel = session.getAnyCel(layer, second);
    expect(secondCel?.kind).toBe("tilemap");
    if (firstCel?.kind !== "tilemap" || secondCel?.kind !== "tilemap") throw new Error("Tilemap Cel missing.");
    expect(secondCel.tilemapImageId).toBe(firstCel.tilemapImageId);
    expect(unlinkTilemapCel(session, layer, second)).toBe(true);
    const unlinked = session.getAnyCel(layer, second);
    expect(unlinked?.kind === "tilemap" ? unlinked.tilemapImageId : null).not.toBe(firstCel.tilemapImageId);
    session.deleteFrame(second);
    expect(session.model.frameOrder).toEqual([first]);
    expect(session.undo()).toBe(true);
    expect(session.model.frameOrder).toEqual([first, second]);
  });
  it("rotates a compact custom mask and removes pixel-perfect corner doubles", () => {
    const brush = createCustomBrushPreset("L", 2, 2, Uint8Array.from([1, 0, 1, 1]));
    expect(brush.mask).toBeTruthy();
    expect(pixelPerfectPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  it("deduplicates points on symmetry axes", () => expect(symmetryPoints({ x: 5, y: 2 }, { mode: "both", axisX: 5, axisY: 2 })).toEqual([{ x: 5, y: 2 }]));
  it("validates slice and 9-slice bounds", () => {
    expect(() => validateSlice({ id: "slice", name: "Button", bounds: { x: 0, y: 0, width: 16, height: 16 }, center: { x: 4, y: 4, width: 8, height: 8 } }, 16, 16)).not.toThrow();
    expect(() => validateSlice({ id: "bad", name: "Bad", bounds: { x: 0, y: 0, width: 16, height: 16 }, center: { x: 14, y: 14, width: 4, height: 4 } }, 16, 16)).toThrow();
  });
});
