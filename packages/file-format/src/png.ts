import { decode, encode } from "fast-png";
import {
  EditorSession,
  compositeSnapshot,
  type DocumentSnapshot,
} from "@suwol/editor-core";

export interface DecodedRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function decodePng(bytes: Uint8Array): DecodedRgbaImage {
  const decoded = decode(bytes, { checkCrc: true });
  if (decoded.depth !== 8)
    throw new Error("Only 8-bit PNG images are supported in M1.");
  const pixels = decoded.width * decoded.height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels < 1 ||
    pixels * 4 > 256 * 1024 * 1024
  )
    throw new Error("PNG dimensions exceed the supported limit.");
  const source = Uint8Array.from(decoded.data);
  const rgba = new Uint8Array(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const sourceOffset = pixel * decoded.channels;
    const targetOffset = pixel * 4;
    if (decoded.channels === 4)
      rgba.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    else if (decoded.channels === 3)
      rgba.set(
        [
          source[sourceOffset] ?? 0,
          source[sourceOffset + 1] ?? 0,
          source[sourceOffset + 2] ?? 0,
          255,
        ],
        targetOffset,
      );
    else if (decoded.channels === 2) {
      const gray = source[sourceOffset] ?? 0;
      rgba.set(
        [gray, gray, gray, source[sourceOffset + 1] ?? 255],
        targetOffset,
      );
    } else {
      const gray = source[sourceOffset] ?? 0;
      rgba.set([gray, gray, gray, 255], targetOffset);
    }
    if (rgba[targetOffset + 3] === 0)
      rgba.fill(0, targetOffset, targetOffset + 4);
  }
  return { width: decoded.width, height: decoded.height, rgba };
}

export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  if (rgba.byteLength !== width * height * 4)
    throw new RangeError("PNG data length does not match its dimensions.");
  return encode({ width, height, data: rgba, depth: 8, channels: 4 });
}

export function importPng(
  name: string,
  bytes: Uint8Array,
  layerName: string,
): EditorSession {
  const decoded = decodePng(bytes);
  const session = EditorSession.create({
    name,
    width: decoded.width,
    height: decoded.height,
    layerName,
  });
  const layerId = session.model.layerOrder[0];
  if (layerId === undefined || session.model.layers[layerId] === undefined)
    throw new Error("Imported document layer was not created.");
  session
    .getActiveSurfaceForRead(layerId)
    .writeRegion(
      { x: 0, y: 0, width: decoded.width, height: decoded.height },
      decoded.rgba,
    );
  return session;
}

export function exportPng(snapshot: DocumentSnapshot): Uint8Array {
  return encodePng(
    snapshot.model.canvas.width,
    snapshot.model.canvas.height,
    compositeSnapshot(snapshot),
  );
}
