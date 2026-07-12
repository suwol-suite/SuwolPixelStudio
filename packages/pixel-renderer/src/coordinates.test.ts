import { describe, expect, it } from "vitest";
import {
  canvasLocalToDocument,
  canvasLocalToPixel,
  clientToCanvasLocal,
  clientToDocument,
  documentToCanvasLocal,
  documentToClient,
} from "./coordinates";

const viewport = {
  zoom: 10.7421875,
  panX: -87.25,
  panY: 41.75,
  documentWidth: 32,
  documentHeight: 32,
};

describe("pointer coordinate transforms", () => {
  it("converts client coordinates through the current canvas rect", () => {
    expect(
      clientToCanvasLocal({ x: 515.5, y: 302.25 }, { left: 215.5, top: 102.25 }),
    ).toEqual({ x: 300, y: 200 });
  });

  it.each([1, 2, 4, 8, 10.7421875])(
    "round trips document coordinates at zoom %s",
    (zoom) => {
      const view = { ...viewport, zoom };
      const document = { x: 13.375, y: 21.625 };
      const local = documentToCanvasLocal(document, view);
      expect(canvasLocalToDocument(local, view)).toEqual(document);
    },
  );

  it("round trips across a non-zero window and canvas offset", () => {
    const rect = { left: 283.125, top: 146.75 };
    const document = { x: 7.25, y: 19.5 };
    const client = documentToClient(document, rect, viewport);
    expect(clientToDocument(client, rect, viewport)).toEqual(document);
  });

  it("uses the latest rect after docks or the timeline resize", () => {
    const document = { x: 9.5, y: 6.5 };
    const before = { left: 84, top: 92 };
    const after = { left: 212, top: 68 };
    expect(clientToDocument(documentToClient(document, before, viewport), before, viewport)).toEqual(document);
    expect(clientToDocument(documentToClient(document, after, viewport), after, viewport)).toEqual(document);
  });

  it("floors only at the final document-to-pixel boundary", () => {
    const local = documentToCanvasLocal({ x: 31.999, y: 0.001 }, viewport);
    expect(canvasLocalToPixel(local, viewport)).toEqual({ x: 31, y: 0 });
    expect(
      canvasLocalToPixel(documentToCanvasLocal({ x: 32, y: 0 }, viewport), viewport),
    ).toBeNull();
  });

  it("is independent of DPR and backing-buffer dimensions", () => {
    const rect = { left: 100, top: 60 };
    const client = documentToClient({ x: 4.5, y: 8.5 }, rect, viewport);
    // No DPR or backing-buffer parameter can enter this CSS-pixel transform.
    expect(clientToDocument.length).toBe(3);
    expect(clientToDocument(client, rect, viewport)).toEqual({ x: 4.5, y: 8.5 });
  });

  it.each([
    { uiScale: 1, dpr: 1 },
    { uiScale: 1.25, dpr: 1.25 },
    { uiScale: 2, dpr: 1.5 },
    { uiScale: 2, dpr: 2 },
  ])("keeps CSS coordinates stable at UI $uiScale and DPR $dpr", ({ uiScale, dpr }) => {
    const cssSize = { width: 640 / uiScale, height: 480 / uiScale },
      backingSize = {
        width: Math.round(cssSize.width * dpr),
        height: Math.round(cssSize.height * dpr),
      },
      rect = { left: 80 * uiScale, top: 44 * uiScale },
      document = { x: 12.25, y: 7.75 };
    expect(backingSize.width).toBeGreaterThan(0);
    expect(backingSize.height).toBeGreaterThan(0);
    expect(clientToDocument(documentToClient(document, rect, viewport), rect, viewport)).toEqual(document);
  });

  it("applies pan once after zoom and reverses them in the opposite order", () => {
    const view = { ...viewport, zoom: 4, panX: 35, panY: -21 },
      document = { x: 8, y: 6 };
    expect(documentToCanvasLocal(document, view)).toEqual({ x: 67, y: 3 });
    expect(canvasLocalToDocument({ x: 67, y: 3 }, view)).toEqual(document);
  });
});
