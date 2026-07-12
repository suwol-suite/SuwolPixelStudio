import type { ToolId } from "./workspace";

export type ToolOptionId =
  | "foreground"
  | "background"
  | "size"
  | "opacity"
  | "preset"
  | "pixelPerfect"
  | "symmetry"
  | "tolerance"
  | "selectionLimit"
  | "fillMode"
  | "selectionMode"
  | "moveTarget"
  | "tile"
  | "tileTransform";

export function toolOptionIds(tool: ToolId): readonly ToolOptionId[] {
  if (tool === "pencil")
    return ["foreground", "background", "size", "opacity", "preset", "pixelPerfect", "symmetry"];
  if (tool === "eraser") return ["size", "opacity", "preset"];
  if (tool === "fill") return ["foreground", "tolerance", "selectionLimit"];
  if (tool === "line" || tool === "rectangle" || tool === "ellipse")
    return ["foreground", "size", "opacity", "fillMode", "symmetry"];
  if (tool === "selectionRect") return ["selectionMode"];
  if (tool === "move") return ["moveTarget"];
  if (tool.startsWith("tile")) return ["tile", "tileTransform"];
  return ["foreground", "background"];
}
