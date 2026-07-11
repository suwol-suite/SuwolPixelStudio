import { describe, expect, it } from "vitest";
import { DEFAULT_ONION_SKIN } from "./animation";
import { compositeFrame, compositeOnionSkin } from "./composite";
import { EditorSession } from "./session";

function draw(session: EditorSession, frameId: string, x: number, color: readonly [number, number, number, number]) {
  const layer = session.model.layerOrder[0] ?? "";
  session.setActiveFrame(frameId);
  const stroke = session.beginStroke(layer, color, "Draw");
  stroke.addPoint({ x, y: 0 });
  session.commitStroke(stroke);
}

describe("animation composite golden pixels", () => {
  it("composites independent and empty frames byte-exactly", () => {
    const session = EditorSession.create({ name: "Golden", width: 2, height: 1, layerName: "L" }),
      first = session.activeFrameId;
    draw(session, first, 0, [255, 0, 0, 255]);
    const empty = session.addFrame(first, "empty"),
      second = session.addFrame(empty, "empty");
    draw(session, second, 1, [0, 0, 255, 128]);
    expect(compositeFrame(session, first)).toEqual(Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]));
    expect(compositeFrame(session, empty)).toEqual(new Uint8Array(8));
    expect(compositeFrame(session, second)).toEqual(Uint8Array.from([0, 0, 0, 0, 0, 0, 255, 128]));
  });

  it("applies cel offsets, cel opacity and layer opacity with clipping", () => {
    const session = EditorSession.create({ name: "Opacity", width: 2, height: 1, layerName: "L" }),
      frame = session.activeFrameId,
      layer = session.model.layerOrder[0] ?? "";
    draw(session, frame, 0, [20, 40, 60, 255]);
    session.setCelPosition(layer, 1, 0, frame);
    session.setCelOpacity(layer, 0.5, frame);
    session.setLayerOpacity(layer, 0.5);
    expect(compositeFrame(session, frame)).toEqual(Uint8Array.from([0, 0, 0, 0, 20, 40, 60, 64]));
  });

  it("renders linked cels once per frame without changing shared pixels", () => {
    const session = EditorSession.create({ name: "Linked", width: 1, height: 1, layerName: "L" }),
      first = session.activeFrameId;
    draw(session, first, 0, [11, 22, 33, 255]);
    const linked = session.addFrame(first, "linked"),
      layer = session.model.layerOrder[0] ?? "";
    expect(session.getCel(layer, linked)?.imageId).toBe(session.getCel(layer, first)?.imageId);
    expect(compositeFrame(session, linked)).toEqual(compositeFrame(session, first));
  });

  it("renders previous and next onion skins with tint and active-layer policy", () => {
    const session = EditorSession.create({ name: "Onion", width: 3, height: 1, layerName: "L" }),
      first = session.activeFrameId;
    draw(session, first, 0, [255, 0, 0, 255]);
    const middle = session.addFrame(first, "empty"),
      last = session.addFrame(middle, "empty"),
      layer = session.model.layerOrder[0] ?? "";
    draw(session, last, 2, [0, 0, 255, 255]);
    const rgba = compositeOnionSkin(
      session,
      middle,
      {
        ...DEFAULT_ONION_SKIN,
        enabled: true,
        previousOpacity: 0.5,
        nextOpacity: 0.25,
        previousTint: [255, 0, 0, 255],
        nextTint: [0, 0, 255, 255],
        source: "activeLayer",
      },
      layer,
    );
    expect(rgba).toEqual(Uint8Array.from([
      255, 0, 0, 128,
      0, 0, 0, 0,
      0, 0, 255, 64,
    ]));
    expect(compositeFrame(session, middle)).toEqual(new Uint8Array(12));
  });
});
