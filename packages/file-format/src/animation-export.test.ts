import { describe, expect, it } from "vitest";
import { unzlibSync } from "fflate";
import { EditorSession, hashSnapshot } from "@suwol/editor-core";
import {
  encodeApngAnimation,
  encodeGifAnimation,
  exportPngSequence,
  exportSpriteSheet,
  gifDelayCentiseconds,
  inspectApng,
  inspectGif,
  pngSequenceFileName,
  renderAnimationFrames,
} from "./animation-export";
import { decodePng } from "./png";

function animation() {
  const session = EditorSession.create({ name: "Anim", width: 2, height: 2, layerName: "L" }),
    layer = session.model.layerOrder[0] ?? "",
    first = session.activeFrameId;
  let stroke = session.beginStroke(layer, [255, 0, 0, 255], "Red");
  stroke.addPoint({ x: 0, y: 0 });
  session.commitStroke(stroke);
  const second = session.addFrame(first, "empty");
  session.setFrameDuration(first, 80);
  session.setFrameDuration(second, 130);
  stroke = session.beginStroke(layer, [0, 0, 255, 128], "Blue");
  stroke.addPoint({ x: 1, y: 1 });
  session.commitStroke(stroke);
  session.addTag("walk", first, second);
  return session;
}

describe("animation export adapters", () => {
  it("creates deterministic PNG sequence names and exact frame pixels", () => {
    const session = animation(),
      before = hashSnapshot(session.snapshot()),
      entries = exportPngSequence(session.snapshot(), {
        prefix: "walk",
        digits: 4,
        startNumber: 1,
      });
    expect(entries.map((entry) => entry.relativePath)).toEqual(["walk_0001.png", "walk_0002.png"]);
    const firstEntry = entries[0],
      secondEntry = entries[1];
    if (firstEntry === undefined || secondEntry === undefined) throw new Error("Sequence fixture is incomplete.");
    expect(decodePng(firstEntry.data).rgba.slice(0, 4)).toEqual(Uint8Array.from([255, 0, 0, 255]));
    expect(decodePng(secondEntry.data).rgba.slice(12, 16)).toEqual(Uint8Array.from([0, 0, 255, 128]));
    expect(hashSnapshot(session.snapshot())).toBe(before);
    expect(pngSequenceFileName("../unsafe", 0, 3)).toBe("unsafe_000.png");
  });

  it.each([
    ["horizontal", 4, 2],
    ["vertical", 2, 4],
    ["grid", 4, 2],
  ] as const)("packs %s sprite sheets deterministically", (layout, width, height) => {
    const result = exportSpriteSheet(animation().snapshot(), {
      layout,
      columns: 2,
      spacing: 0,
      padding: 0,
      imageName: "walk",
      includeJson: true,
    });
    expect({ width: result.width, height: result.height }).toEqual({ width, height });
    expect(decodePng(result.png)).toMatchObject({ width, height });
    if (result.json === null) throw new Error("Sprite sheet JSON missing.");
    const metadata = JSON.parse(new TextDecoder().decode(result.json)) as {
      image: string;
      frames: unknown[];
      tags: unknown[];
    };
    expect(metadata).toMatchObject({ image: "walk.png" });
    expect(metadata.frames).toHaveLength(2);
    expect(metadata.tags).toHaveLength(1);
  });

  it("encodes GIF timing, loop data and transparency deterministically", () => {
    const frames = renderAnimationFrames(animation().snapshot()),
      first = encodeGifAnimation(frames, 2, 2, {
        loopCount: 0,
        scale: 1,
        transparentThreshold: 0,
        background: [255, 255, 255, 255],
      }),
      second = encodeGifAnimation(frames, 2, 2, {
        loopCount: 0,
        scale: 1,
        transparentThreshold: 0,
        background: [255, 255, 255, 255],
      });
    expect(new TextDecoder().decode(first.subarray(0, 6))).toBe("GIF89a");
    expect(first.at(-1)).toBe(0x3b);
    expect(first).toEqual(second);
    expect(gifDelayCentiseconds(5)).toBe(2);
    expect(gifDelayCentiseconds(126)).toBe(13);
    const decoded = inspectGif(first);
    expect(decoded).toMatchObject({ width: 2, height: 2 });
    expect(decoded.frames.map((frame) => frame.delayCentiseconds)).toEqual([8, 13]);
    expect(decoded.frames).toHaveLength(2);
    const redIndex = decoded.frames[0]?.indices[0] ?? 0,
      red = decoded.palette[redIndex];
    expect(redIndex).not.toBe(0);
    expect(red).toEqual([255, 0, 0]);
    expect(decoded.frames[0]?.indices[1]).toBe(0);
    expect(decoded.frames[1]?.indices[3]).not.toBe(0);
  });

  it("applies the GIF alpha threshold to transparent palette index zero", () => {
    const frames = [{ frameId: "f", durationMs: 100, rgba: Uint8Array.from([255, 0, 0, 127, 0, 255, 0, 128]) }],
      output = encodeGifAnimation(frames, 2, 1, {
        loopCount: 1,
        scale: 1,
        transparentThreshold: 127,
        background: [255, 255, 255, 255],
      }),
      decoded = inspectGif(output);
    expect(decoded.frames[0]?.indices[0]).toBe(0);
    expect(decoded.frames[0]?.indices[1]).not.toBe(0);
  });

  it("encodes APNG frame count, alpha-preserving chunks and delays", () => {
    const frames = renderAnimationFrames(animation().snapshot()),
      output = encodeApngAnimation(frames, 2, 2, { loopCount: 0, scale: 1 }),
      inspected = inspectApng(output);
    expect(inspected.frames).toBe(2);
    expect(inspected.delays).toEqual([80, 130]);
    expect(new TextDecoder().decode(output)).toContain("acTL");
    expect(new TextDecoder().decode(output)).toContain("fdAT");
    expect(decodeApngFrames(output, 2, 2)).toEqual(frames.map((frame) => frame.rgba));
  });
});

function decodeApngFrames(bytes: Uint8Array, width: number, height: number): readonly Uint8Array[] {
  let offset = 8;
  const compressed: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0),
      type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)),
      data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") compressed.push(data);
    if (type === "fdAT") compressed.push(data.subarray(4));
    offset += 12 + length;
  }
  return compressed.map((data) => {
    const scanlines = unzlibSync(data),
      rgba = new Uint8Array(width * height * 4),
      rowLength = width * 4 + 1;
    for (let y = 0; y < height; y += 1) {
      expect(scanlines[y * rowLength]).toBe(0);
      rgba.set(scanlines.subarray(y * rowLength + 1, (y + 1) * rowLength), y * width * 4);
    }
    return rgba;
  });
}
