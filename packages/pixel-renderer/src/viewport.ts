import type { IntPoint } from "@suwol/editor-core";

export const ZOOM_STEPS = [
  0.0625, 0.125, 0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
] as const;

export class Viewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  constructor(
    readonly documentWidth: number,
    readonly documentHeight: number,
    public viewportWidth = 1,
    public viewportHeight = 1,
  ) {}

  documentToScreen(point: IntPoint): IntPoint {
    return {
      x: this.panX + point.x * this.zoom,
      y: this.panY + point.y * this.zoom,
    };
  }
  screenToDocument(point: IntPoint): IntPoint {
    return {
      x: (point.x - this.panX) / this.zoom,
      y: (point.y - this.panY) / this.zoom,
    };
  }
  screenToPixel(point: IntPoint): IntPoint | null {
    const documentPoint = this.screenToDocument(point);
    const x = Math.floor(documentPoint.x);
    const y = Math.floor(documentPoint.y);
    return x < 0 || y < 0 || x >= this.documentWidth || y >= this.documentHeight
      ? null
      : { x, y };
  }
  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }
  center(): void {
    this.panX = (this.viewportWidth - this.documentWidth * this.zoom) / 2;
    this.panY = (this.viewportHeight - this.documentHeight * this.zoom) / 2;
  }
  fit(padding = 32): void {
    this.zoom = Math.min(
      64,
      Math.max(
        0.0625,
        Math.min(
          (this.viewportWidth - padding * 2) / this.documentWidth,
          (this.viewportHeight - padding * 2) / this.documentHeight,
        ),
      ),
    );
    this.center();
  }
  setZoomAt(zoom: number, anchor: IntPoint): void {
    const before = this.screenToDocument(anchor);
    this.zoom = Math.min(64, Math.max(0.0625, zoom));
    this.panX = anchor.x - before.x * this.zoom;
    this.panY = anchor.y - before.y * this.zoom;
  }
  zoomIn(
    anchor: IntPoint = {
      x: this.viewportWidth / 2,
      y: this.viewportHeight / 2,
    },
  ): void {
    this.setZoomAt(
      ZOOM_STEPS.find((step) => step > this.zoom + 0.0001) ?? 64,
      anchor,
    );
  }
  zoomOut(
    anchor: IntPoint = {
      x: this.viewportWidth / 2,
      y: this.viewportHeight / 2,
    },
  ): void {
    this.setZoomAt(
      [...ZOOM_STEPS].reverse().find((step) => step < this.zoom - 0.0001) ??
        0.0625,
      anchor,
    );
  }
  zoom100(
    anchor: IntPoint = {
      x: this.viewportWidth / 2,
      y: this.viewportHeight / 2,
    },
  ): void {
    this.setZoomAt(1, anchor);
  }
  panBy(deltaX: number, deltaY: number): void {
    this.panX += deltaX;
    this.panY += deltaY;
  }
}
