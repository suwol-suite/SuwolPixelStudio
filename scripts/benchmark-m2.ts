import {
  BitSelectionMask,
  EditorSession,
  floodFill,
  movePixels,
} from "../packages/editor-core/src/index";

function measure(
  name: string,
  operation: () => void,
): Readonly<{ name: string; milliseconds: number; heapDelta: number }> {
  const before = process.memoryUsage().heapUsed,
    start = performance.now();
  operation();
  return {
    name,
    milliseconds: Number((performance.now() - start).toFixed(2)),
    heapDelta: process.memoryUsage().heapUsed - before,
  };
}
function layer(session: EditorSession): string {
  return session.model.layerOrder[0] ?? "";
}

const results = [
  measure("1024x1024 full fill", () => {
    const session = EditorSession.create({
      name: "fill",
      width: 1024,
      height: 1024,
      layerName: "L",
    });
    floodFill(session, layer(session), { x: 0, y: 0 }, [12, 34, 56, 255], null);
  }),
  measure("1024x1024 canvas resize", () => {
    const session = EditorSession.create({
      name: "canvas",
      width: 1024,
      height: 1024,
      layerName: "L",
    });
    session.resizeCanvas(1100, 1100, "center", [0, 0, 0, 0]);
  }),
  measure("512x512 sprite resize", () => {
    const session = EditorSession.create({
      name: "sprite",
      width: 512,
      height: 512,
      layerName: "L",
    });
    session.resizeSprite(768, 640);
  }),
  measure("256x256 selection move", () => {
    const session = EditorSession.create({
        name: "move",
        width: 256,
        height: 256,
        layerName: "L",
      }),
      selection = new BitSelectionMask(256, 256);
    selection.setRect({ x: 32, y: 32, width: 192, height: 192 }, "replace");
    movePixels(session, layer(session), selection, 8, 8);
  }),
  measure("100 color palette reorder", () => {
    const session = EditorSession.create({
      name: "palette",
      width: 1,
      height: 1,
      layerName: "L",
    });
    const ids = Array.from({ length: 100 }, (_, index) =>
      session.addPaletteColor([index, index, index, 255]),
    );
    for (let index = ids.length - 1; index > 0; index -= 1)
      session.movePaletteColor(ids[index] ?? "", 0);
  }),
];
console.log(
  JSON.stringify({ benchmark: "suwol-pixel-studio-m2", results }, null, 2),
);
