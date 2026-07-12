export interface CoordinatePoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasClientRect {
  readonly left: number;
  readonly top: number;
}

export interface ViewportTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

/**
 * Pointer coordinates always enter the editor in CSS pixels. Device pixel
 * ratio is intentionally absent here; it belongs only to canvas backing-store
 * allocation and rendering.
 */
export function clientToCanvasLocal(
  client: CoordinatePoint,
  rect: CanvasClientRect,
): CoordinatePoint {
  return { x: client.x - rect.left, y: client.y - rect.top };
}

export function canvasLocalToClient(
  local: CoordinatePoint,
  rect: CanvasClientRect,
): CoordinatePoint {
  return { x: local.x + rect.left, y: local.y + rect.top };
}

export function canvasLocalToDocument(
  local: CoordinatePoint,
  viewport: ViewportTransform,
): CoordinatePoint {
  return {
    x: (local.x - viewport.panX) / viewport.zoom,
    y: (local.y - viewport.panY) / viewport.zoom,
  };
}

export function documentToCanvasLocal(
  document: CoordinatePoint,
  viewport: ViewportTransform,
): CoordinatePoint {
  return {
    x: viewport.panX + document.x * viewport.zoom,
    y: viewport.panY + document.y * viewport.zoom,
  };
}

export function clientToDocument(
  client: CoordinatePoint,
  rect: CanvasClientRect,
  viewport: ViewportTransform,
): CoordinatePoint {
  return canvasLocalToDocument(clientToCanvasLocal(client, rect), viewport);
}

export function documentToClient(
  document: CoordinatePoint,
  rect: CanvasClientRect,
  viewport: ViewportTransform,
): CoordinatePoint {
  return canvasLocalToClient(documentToCanvasLocal(document, viewport), rect);
}

export function canvasLocalToPixel(
  local: CoordinatePoint,
  viewport: ViewportTransform,
): CoordinatePoint | null {
  const document = canvasLocalToDocument(local, viewport),
    x = Math.floor(document.x),
    y = Math.floor(document.y);
  return x < 0 ||
    y < 0 ||
    x >= viewport.documentWidth ||
    y >= viewport.documentHeight
    ? null
    : { x, y };
}
