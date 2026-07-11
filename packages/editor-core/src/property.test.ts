import { describe, expect, it } from "vitest";
import {
  EditorSession,
  applyRasterPoints,
  hashSnapshot,
  rasterizeEllipse,
  rasterizeRectangle,
  validateDocumentIntegrity,
} from "./index";

describe("deterministic edit properties", () => {
  it("restores hashes after undo and redo across repeated edits", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const current = EditorSession.create({
        name: "P",
        width: 8,
        height: 8,
        layerName: "L",
      });
      const initial = hashSnapshot(current.snapshot());
      for (let step = 0; step < 8; step += 1) {
        const layer = current.model.layerOrder[0] ?? "";
        const stroke = current.beginStroke(
          layer,
          [(seed * 11) % 256, (step * 27) % 256, 99, 255],
          "Draw",
        );
        stroke.addPoint({ x: (seed * step + 3) % 8, y: (seed + step * 2) % 8 });
        current.commitStroke(stroke);
      }
      const edited = hashSnapshot(current.snapshot());
      while (current.history.canUndo) current.undo();
      expect(hashSnapshot(current.snapshot())).toBe(initial);
      while (current.history.canRedo) current.redo();
      expect(hashSnapshot(current.snapshot())).toBe(edited);
    }
  });
  it("never crashes on arbitrary clipped rectangles", () => {
    const current = EditorSession.create({
      name: "P",
      width: 4,
      height: 4,
      layerName: "L",
    });
    const surface = current.getActiveSurfaceForRead(
      current.model.layerOrder[0] ?? "",
    );
    for (let x = -6; x < 7; x += 1)
      for (let y = -6; y < 7; y += 1)
        expect(() =>
          surface.clearRegion({ x, y, width: 3, height: 3 }),
        ).not.toThrow();
  });
  it("never writes outside the canvas for arbitrary raster shapes", () => {
    const current = EditorSession.create({
        name: "P",
        width: 8,
        height: 8,
        layerName: "L",
      }),
      layer = current.model.layerOrder[0] ?? "";
    for (let x = -5; x < 12; x += 2)
      for (let y = -5; y < 12; y += 3) {
        expect(() =>
          applyRasterPoints(
            current,
            layer,
            rasterizeRectangle({ x, y, width: 5, height: 4 }, "outline"),
            [1, 2, 3, 255],
            null,
            "rect",
          ),
        ).not.toThrow();
        expect(() =>
          applyRasterPoints(
            current,
            layer,
            rasterizeEllipse({ x, y, width: 6, height: 5 }, "filled"),
            [4, 5, 6, 255],
            null,
            "ellipse",
          ),
        ).not.toThrow();
      }
  });

  it("preserves frame, cel and reference invariants through repeated mixed operations", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const current = EditorSession.create({ name: "Animation property", width: 4, height: 4, layerName: "L" }),
        layer = current.model.layerOrder[0] ?? "",
        initial = hashSnapshot(current.snapshot());
      for (let step = 0; step < 36; step += 1) {
        const order = current.model.frameOrder,
          choice = (seed * 17 + step * 13) % 7;
        if (choice <= 1 && order.length < 10)
          current.addFrame(order[(seed + step) % order.length], choice === 0 ? "linked" : "independent");
        else if (choice === 2 && order.length > 1)
          current.deleteFrame(order[(seed + step) % order.length]);
        else if (choice === 3) {
          const frame = order[(seed * 3 + step) % order.length];
          if (frame !== undefined) current.moveFrame(frame, (seed + step * 2) % order.length);
        } else if (choice === 4) {
          const frame = order[(seed + step) % order.length];
          if (frame !== undefined) current.setFrameDuration(frame, 10 + ((seed + step) % 500));
        } else {
          const frame = order[(seed * 5 + step) % order.length];
          if (frame !== undefined) {
            current.setActiveFrame(frame);
            const stroke = current.beginStroke(layer, [seed * 20, step * 7, 99, 255], "Property draw");
            stroke.addPoint({ x: (seed + step) % 4, y: (seed * 2 + step) % 4 });
            current.commitStroke(stroke);
          }
        }
        expect(validateDocumentIntegrity(current.model)).toEqual({ valid: true, errors: [] });
      }
      const edited = hashSnapshot(current.snapshot());
      while (current.history.canUndo) current.undo();
      expect(hashSnapshot(current.snapshot())).toBe(initial);
      while (current.history.canRedo) current.redo();
      expect(hashSnapshot(current.snapshot())).toBe(edited);
      expect(validateDocumentIntegrity(current.model).valid).toBe(true);
    }
  });
});
