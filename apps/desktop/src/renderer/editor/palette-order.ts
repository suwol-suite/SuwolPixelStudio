import {
  reorderSessionPalette,
  type EditorSession,
} from "@suwol/editor-core";

export function moveDocumentPaletteColor(
  session: EditorSession,
  colorId: string,
  targetIndex: number,
): void {
  const order = session.model.palette.colors.map((color) => color.id),
    source = order.indexOf(colorId),
    target = Math.min(order.length - 1, Math.max(0, Math.round(targetIndex)));
  if (source < 0 || source === target) return;
  if (session.model.canvas.colorMode === "indexed") {
    order.splice(source, 1);
    order.splice(target, 0, colorId);
    reorderSessionPalette(session, order);
  } else session.movePaletteColor(colorId, target);
}
