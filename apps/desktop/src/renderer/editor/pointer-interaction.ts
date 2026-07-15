export type PointerInteractionKind =
  | "none"
  | "stroke"
  | "pan"
  | "eyedropper"
  | "selection"
  | "shape"
  | "move"
  | "plugin-tool";

export type PointerCleanupReason =
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture"
  | "pointerleave"
  | "escape"
  | "tool-change"
  | "document-change"
  | "frame-change"
  | "layer-change"
  | "layout-change"
  | "window-blur"
  | "visibility-change"
  | "unmount"
  | "plugin-deactivated"
  | "runtime-crash"
  | "pan"
  | "exception"
  | "superseded";

export interface PointerInteractionState {
  pointerId: number | null;
  kind: PointerInteractionKind;
  isPointerDown: boolean;
  temporaryToolId: string | null;
  previousToolId: string | null;
  busy: boolean;
}

interface CaptureTarget {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export interface PointerInteractionHooks {
  cancelPending(kind: PointerInteractionKind, reason: PointerCleanupReason): void;
  clearPreviews(): void;
  stateChanged(): void;
}

export function createPointerInteractionState(): PointerInteractionState {
  return {
    pointerId: null,
    kind: "none",
    isPointerDown: false,
    temporaryToolId: null,
    previousToolId: null,
    busy: false,
  };
}

/** Owns capture, busy state, temporary tools, and every pointer cleanup path. */
export class PointerInteractionController {
  readonly state: PointerInteractionState;
  readonly #hooks: PointerInteractionHooks;
  #captureTarget: CaptureTarget | null = null;
  #cleaning = false;

  constructor(state: PointerInteractionState, hooks: PointerInteractionHooks) {
    this.state = state;
    this.#hooks = hooks;
  }

  get effectiveToolId(): string | null {
    return this.state.temporaryToolId;
  }

  begin(target: CaptureTarget, pointerId: number, kind: Exclude<PointerInteractionKind, "none">): void {
    if (this.state.isPointerDown || this.state.kind !== "none")
      this.cancel("superseded");
    this.#captureTarget = target;
    this.state.pointerId = pointerId;
    this.state.kind = kind;
    this.state.isPointerDown = true;
    try {
      target.setPointerCapture(pointerId);
    } catch (error) {
      this.#resetInteraction();
      this.#captureTarget = null;
      throw error;
    } finally {
      this.#hooks.stateChanged();
    }
  }

  finish(pointerId: number, finalize: () => void): boolean {
    if (this.state.pointerId !== pointerId || !this.state.isPointerDown) return false;
    this.state.busy = true;
    this.#hooks.stateChanged();
    try {
      finalize();
      return true;
    } catch (error) {
      this.#hooks.cancelPending(this.state.kind, "exception");
      throw error;
    } finally {
      this.#releaseCapture();
      this.#resetInteraction();
      this.state.busy = false;
      this.#hooks.clearPreviews();
      this.#hooks.stateChanged();
    }
  }

  cancel(reason: PointerCleanupReason, clearTemporaryTool = false): boolean {
    if (this.#cleaning) return false;
    const active = this.state.isPointerDown || this.state.kind !== "none" ||
      (clearTemporaryTool && this.state.temporaryToolId !== null);
    if (!active) return false;
    this.#cleaning = true;
    this.state.busy = true;
    this.#hooks.stateChanged();
    try {
      this.#hooks.cancelPending(this.state.kind, reason);
      return true;
    } finally {
      this.#releaseCapture();
      this.#resetInteraction();
      if (clearTemporaryTool) {
        this.state.temporaryToolId = null;
        this.state.previousToolId = null;
      }
      this.state.busy = false;
      this.#hooks.clearPreviews();
      this.#hooks.stateChanged();
      this.#cleaning = false;
    }
  }

  activateTemporaryTool(toolId: string, currentToolId: string): boolean {
    if (currentToolId === toolId || this.state.temporaryToolId === toolId) return false;
    this.state.previousToolId = currentToolId;
    this.state.temporaryToolId = toolId;
    this.#hooks.clearPreviews();
    this.#hooks.stateChanged();
    return true;
  }

  restoreTemporaryTool(): string | null {
    if (this.state.temporaryToolId === null) return null;
    const previous = this.state.previousToolId;
    this.state.temporaryToolId = null;
    this.state.previousToolId = null;
    this.#hooks.clearPreviews();
    this.#hooks.stateChanged();
    return previous;
  }

  #releaseCapture(): void {
    const target = this.#captureTarget,
      pointerId = this.state.pointerId;
    this.#captureTarget = null;
    if (target === null || pointerId === null) return;
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // The browser may have already released capture during blur/unmount.
    }
  }

  #resetInteraction(): void {
    this.state.pointerId = null;
    this.state.kind = "none";
    this.state.isPointerDown = false;
  }
}
