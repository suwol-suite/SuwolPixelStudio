import { describe, expect, it, vi } from "vitest";
import {
  PointerInteractionController,
  createPointerInteractionState,
  type PointerCleanupReason,
} from "./pointer-interaction";

function harness() {
  let captured: number | null = null;
  const target = {
      setPointerCapture: vi.fn((id: number) => { captured = id; }),
      hasPointerCapture: vi.fn((id: number) => captured === id),
      releasePointerCapture: vi.fn((id: number) => { if (captured === id) captured = null; }),
    },
    hooks = {
      cancelPending: vi.fn(),
      clearPreviews: vi.fn(),
      stateChanged: vi.fn(),
    },
    state = createPointerInteractionState(),
    controller = new PointerInteractionController(state, hooks);
  return { controller, hooks, state, target, captured: () => captured };
}

describe("PointerInteractionController", () => {
  it.each([
    "pointercancel",
    "lostpointercapture",
    "pointerleave",
    "escape",
    "tool-change",
    "document-change",
    "frame-change",
    "layer-change",
    "window-blur",
    "visibility-change",
    "unmount",
    "plugin-deactivated",
    "runtime-crash",
  ] satisfies PointerCleanupReason[])("releases every state on %s", (reason) => {
    const { controller, hooks, state, target, captured } = harness();
    controller.begin(target, 7, "stroke");
    controller.activateTemporaryTool("eyedropper", "pencil");
    expect(controller.cancel(reason, true)).toBe(true);
    expect(captured()).toBeNull();
    expect(state).toEqual({
      pointerId: null,
      kind: "none",
      isPointerDown: false,
      temporaryToolId: null,
      previousToolId: null,
      busy: false,
    });
    expect(hooks.cancelPending).toHaveBeenCalledWith("stroke", reason);
  });

  it("finishes pointerup in finally and cleans a failed commit", () => {
    const { controller, hooks, state, target, captured } = harness();
    controller.begin(target, 3, "stroke");
    expect(() => controller.finish(3, () => { throw new Error("commit failed"); })).toThrow("commit failed");
    expect(hooks.cancelPending).toHaveBeenCalledWith("stroke", "exception");
    expect(captured()).toBeNull();
    expect(state.kind).toBe("none");
    expect(state.busy).toBe(false);
  });

  it("keeps direct Eyedropper separate from an Alt temporary tool", () => {
    const { controller, state } = harness();
    expect(controller.activateTemporaryTool("eyedropper", "pencil")).toBe(true);
    expect(state).toMatchObject({ temporaryToolId: "eyedropper", previousToolId: "pencil" });
    expect(controller.restoreTemporaryTool()).toBe("pencil");
    expect(controller.activateTemporaryTool("eyedropper", "eyedropper")).toBe(false);
    expect(state.temporaryToolId).toBeNull();
  });

  it("survives 100 tool-switch lifecycles without capture or busy state", () => {
    const { controller, state, target, captured } = harness();
    for (let index = 0; index < 100; index += 1) {
      controller.begin(target, index, "eyedropper");
      controller.finish(index, () => undefined);
      controller.activateTemporaryTool("eyedropper", "pencil");
      controller.restoreTemporaryTool();
      controller.begin(target, 1000 + index, "selection");
      controller.cancel("escape", true);
    }
    expect(captured()).toBeNull();
    expect(state).toMatchObject({ kind: "none", isPointerDown: false, busy: false, temporaryToolId: null });
  });
});
