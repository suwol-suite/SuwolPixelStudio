import { describe, expect, it } from "vitest";
import { Viewport } from "./viewport";

describe("Viewport", () => {
  it("converts document and screen coordinates consistently", () => {
    const view = new Viewport(64, 64, 640, 480);
    view.zoom = 4;
    view.panX = 10;
    view.panY = 20;
    expect(view.documentToScreen({ x: 2, y: 3 })).toEqual({ x: 18, y: 32 });
    expect(view.screenToPixel({ x: 18, y: 32 })).toEqual({ x: 2, y: 3 });
  });
  it("anchors zoom under the cursor", () => {
    const view = new Viewport(64, 64, 640, 480);
    view.zoom = 2;
    view.panX = 100;
    view.panY = 50;
    const before = view.screenToDocument({ x: 200, y: 150 });
    view.setZoomAt(8, { x: 200, y: 150 });
    expect(view.screenToDocument({ x: 200, y: 150 })).toEqual(before);
  });
  it("fits and centers a document", () => {
    const view = new Viewport(100, 50, 500, 300);
    view.fit(0);
    expect(view.zoom).toBe(5);
    expect(view.panX).toBe(0);
    expect(view.panY).toBe(25);
  });
  it("uses declared zoom steps", () => {
    const view = new Viewport(10, 10, 100, 100);
    view.zoom100();
    view.zoomIn();
    expect(view.zoom).toBe(2);
    view.zoomOut();
    expect(view.zoom).toBe(1);
  });
  it("rejects screen pixels outside the document", () => {
    const view = new Viewport(10, 10);
    expect(view.screenToPixel({ x: -1, y: 0 })).toBeNull();
  });
});
