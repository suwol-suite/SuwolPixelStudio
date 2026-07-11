import { decodeTileCell, getTilemapCel, type DocumentSnapshot } from "@suwol/editor-core";

export function exportTilemapJson(snapshot: DocumentSnapshot): Uint8Array {
  const layers = Object.values(snapshot.model.layers).filter((layer) => layer.kind === "tilemap").map((layer) => {
    const tileSet = snapshot.model.tileSets[layer.tileSetId];
    if (tileSet === undefined) throw new Error("Tilemap layer references a missing Tile Set.");
    return {
      id: layer.id,
      name: layer.name,
      tileSet: { id: tileSet.id, name: tileSet.name, imageName: `${tileSet.name}.png`, tileWidth: tileSet.tileWidth, tileHeight: tileSet.tileHeight, columns: tileSet.columns, tileCount: tileSet.tileCount },
      frames: snapshot.model.frameOrder.flatMap((frameId, frameIndex) => {
        const cel = getTilemapCel(snapshot.model, layer.id, frameId);
        if (cel === null) return [];
        const meta = snapshot.model.tilemaps[cel.tilemapImageId], cells = snapshot.tilemaps?.get(cel.tilemapImageId);
        if (meta === undefined || cells?.length !== meta.widthInTiles * meta.heightInTiles) throw new Error("Tilemap cells are missing.");
        return [{ frameIndex, frameId, durationMs: snapshot.model.frames[frameId]?.durationMs ?? 100, width: meta.widthInTiles, height: meta.heightInTiles, x: cel.x, y: cel.y, cells: [...cells].map((encoded) => { const cell = decodeTileCell(encoded); return { tileId: cell.tileId, flipX: cell.flipX, flipY: cell.flipY, rotation: cell.rotation }; }) }];
      }),
    };
  });
  const output = { schemaVersion: 1, canvas: { width: snapshot.model.canvas.width, height: snapshot.model.canvas.height }, layers };
  return new TextEncoder().encode(JSON.stringify(output, null, 2));
}
