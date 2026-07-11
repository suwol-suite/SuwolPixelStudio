import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONION_SKIN,
  advancePlayback,
  imageReferenceCounts,
  onionSkinFrames,
  playbackFrameRange,
  timelineVisibleRange,
  updateFrameSelection,
  validateDocumentIntegrity,
} from "./animation";
import { hashSnapshot } from "./composite";
import { EditorSession } from "./session";

function session() {
  return EditorSession.create({ name: "Animation", width: 4, height: 4, layerName: "Layer" });
}

describe("frame and cel model", () => {
  it("adds empty, independent and linked frames with exact undo", () => {
    const current = session(),
      initial = hashSnapshot(current.snapshot()),
      layer = current.model.layerOrder[0] ?? "";
    const independent = current.addFrame(current.activeFrameId, "independent"),
      independentCel = current.getCel(layer, independent);
    expect(independentCel).not.toBeNull();
    const linked = current.addFrame(independent, "linked"),
      linkedCel = current.getCel(layer, linked);
    expect(linkedCel?.imageId).toBe(independentCel?.imageId);
    expect(imageReferenceCounts(current.model).get(linkedCel?.imageId ?? "")).toBe(2);
    current.undo();
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(initial);
  });

  it("auto-creates a cel on the first real edit and removes it in one undo", () => {
    const current = session(),
      layer = current.model.layerOrder[0] ?? "",
      frame = current.addFrame(),
      before = hashSnapshot(current.snapshot());
    expect(current.getCel(layer, frame)).toBeNull();
    const stroke = current.beginStroke(layer, [1, 2, 3, 255], "Draw");
    stroke.addPoint({ x: 1, y: 1 });
    expect(current.commitStroke(stroke)).toBe(true);
    expect(current.getCel(layer, frame)).not.toBeNull();
    current.undo();
    expect(current.getCel(layer, frame)).toBeNull();
    expect(hashSnapshot(current.snapshot())).toBe(before);
  });

  it("does not leave an empty cel after a canceled edit", () => {
    const current = session(),
      layer = current.model.layerOrder[0] ?? "",
      frame = current.addFrame(),
      revision = current.model.revision,
      stroke = current.beginStroke(layer, [1, 1, 1, 255], "Draw");
    stroke.addPoint({ x: 0, y: 0 });
    current.cancelStroke(stroke);
    expect(current.getCel(layer, frame)).toBeNull();
    expect(current.model.revision).toBe(revision);
  });

  it("unlinks shared images without changing the visible pixels", () => {
    const current = session(),
      layer = current.model.layerOrder[0] ?? "",
      first = current.activeFrameId,
      linked = current.addFrame(first, "linked"),
      before = current.getCel(layer, linked)?.imageId;
    expect(current.unlinkCel(layer, linked)).toBe(true);
    expect(current.getCel(layer, linked)?.imageId).not.toBe(before);
    current.undo();
    expect(current.getCel(layer, linked)?.imageId).toBe(before);
  });

  it("blocks deleting the final frame and adjusts tag endpoints", () => {
    const current = session(),
      first = current.activeFrameId;
    expect(() => current.deleteFrame(first)).toThrow("final frame");
    const second = current.addFrame(),
      tag = current.addTag("Range", first, second);
    current.deleteFrame(second);
    expect(current.model.tags[tag]).toMatchObject({ fromFrameId: first, toFrameId: first });
    current.undo();
    expect(current.model.tags[tag]).toMatchObject({ fromFrameId: first, toFrameId: second });
  });

  it("keeps ids stable while reordering and validates duration", () => {
    const current = session(),
      first = current.activeFrameId,
      second = current.addFrame();
    current.moveFrame(second, 0);
    expect(current.model.frameOrder).toEqual([second, first]);
    current.setFrameDuration([first, second], 250);
    expect(Object.values(current.model.frames).map((frame) => frame.durationMs)).toEqual([250, 250]);
    expect(() => current.setFrameDuration(first, 5)).toThrow();
    expect(validateDocumentIntegrity(current.model)).toEqual({ valid: true, errors: [] });
  });

  it("creates, deletes and unlinks cels while collecting orphan images", () => {
    const current = session(),
      layer = current.model.layerOrder[0] ?? "",
      empty = current.addFrame(),
      celId = current.createCel(layer, empty),
      imageId = current.model.cels[celId]?.imageId ?? "";
    expect(current.model.images[imageId]?.refCount).toBe(1);
    expect(current.deleteCel(layer, empty)).toBe(true);
    expect(current.model.cels[celId]).toBeUndefined();
    expect(current.model.images[imageId]).toBeUndefined();
    current.undo();
    expect(current.model.cels[celId]?.imageId).toBe(imageId);
    expect(current.model.images[imageId]?.refCount).toBe(1);
  });

  it("adds, edits and deletes overlapping tags with reverse ranges", () => {
    const current = session(),
      first = current.activeFrameId,
      second = current.addFrame(),
      third = current.addFrame(),
      walk = current.addTag("walk", first, third),
      overlap = current.addTag("walk", second, third, "reverse");
    current.editTag(walk, { name: "idle", fromFrameId: second });
    expect(current.model.tags[walk]?.name).toBe("idle");
    expect(playbackFrameRange(current.model, overlap)).toEqual([third, second]);
    current.deleteTag(walk);
    expect(current.model.tags[walk]).toBeUndefined();
    current.undo();
    expect(current.model.tags[walk]?.name).toBe("idle");
  });

  it("groups multi-frame duplicate, duration and delete into exact history steps", () => {
    const current = session(),
      first = current.activeFrameId,
      second = current.addFrame(),
      beforeDuplicate = hashSnapshot(current.snapshot()),
      undoBefore = current.history.undoCount,
      copies = current.duplicateFrames([first, second], "linked");
    expect(copies).toHaveLength(2);
    expect(current.history.undoCount).toBe(undoBefore + 1);
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(beforeDuplicate);
    current.redo();
    current.setFrameDuration(copies, 333);
    expect(copies.map((id) => current.model.frames[id]?.durationMs)).toEqual([333, 333]);
    const beforeDelete = hashSnapshot(current.snapshot());
    current.deleteFrames(copies);
    expect(current.model.frameOrder).toEqual([first, second]);
    current.undo();
    expect(hashSnapshot(current.snapshot())).toBe(beforeDelete);
  });
});

describe("animation view algorithms", () => {
  it("virtualizes only the visible timeline range", () => {
    expect(timelineVisibleRange(500, 5_000, 600, 50, 2)).toEqual({ start: 98, end: 114, offset: 4_900 });
  });
  it("selects ranges and toggled frames", () => {
    const order = ["a", "b", "c", "d"];
    const range = updateFrameSelection(order, new Set(), "b", "d", "range");
    expect([...range.selected]).toEqual(["b", "c", "d"]);
    expect([...updateFrameSelection(order, range.selected, range.anchor, "c", "toggle").selected]).toEqual(["b", "d"]);
  });
  it("advances loop, once and pingpong without wall-clock timing", () => {
    const cursor = { index: 0, direction: 1 as const, elapsedInFrame: 0, isPlaying: true };
    expect(advancePlayback([100, 200], cursor, 350, "loop").index).toBe(0);
    expect(advancePlayback([100, 200], cursor, 500, "once")).toMatchObject({ index: 1, isPlaying: false });
    expect(advancePlayback([100, 100, 100], cursor, 350, "pingpong")).toMatchObject({ index: 1, direction: -1 });
    expect(advancePlayback([10, 20, 30], cursor, 1_000_000, "loop")).toMatchObject({ isPlaying: true });
    expect(advancePlayback([100, 200], { ...cursor, direction: -1 }, 100, "once")).toMatchObject({ index: 0, isPlaying: false });
  });
  it("selects onion frames without wrapping", () => {
    expect(
      onionSkinFrames(["a", "b", "c", "d"], "c", {
        ...DEFAULT_ONION_SKIN,
        enabled: true,
        previousFrames: 3,
        nextFrames: 3,
      }),
    ).toEqual({ previous: ["a", "b"], next: ["d"] });
  });
});
