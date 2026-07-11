import {
  DEFAULT_FRAME_DURATION_MS,
  assertDocumentIntegrity,
  celKey,
  getCel,
  getAnyCel as lookupAnyCel,
  recountImageReferences,
  requireFrameDuration,
} from "./animation";
import {
  createDocument,
  snapshotDocument,
  stateFromSnapshot,
  type CreateDocumentOptions,
  type DocumentState,
} from "./document";
import {
  EditorHistory,
  FunctionalCommand,
  PixelPatchCommand,
  TransactionCommand,
  type EditorCommand,
} from "./history";
import {
  anchorOffset,
  canvasResizeRgba,
  canvasResizeIndexed,
  resizeNearestRgba,
  resizeNearestIndexed,
  type ResizeAnchor,
} from "./operations";
import {
  IndexedPixelSurface,
  RgbaPixelSurface,
  type PixelSurface,
} from "./surface";
import { StrokeTransaction, type StrokeTransformOptions } from "./stroke";
import {
  intersectRect,
  makeId,
  normalizeRgba,
  type CelId,
  type Cel,
  type DocumentSnapshot,
  type Frame,
  type FrameId,
  type FrameTag,
  type ImageId,
  type IntRect,
  type LayerId,
  type Layer,
  type PaletteColorId,
  type PixelImageMeta,
  type PixelCel,
  type PixelLayer,
  type Rgba,
  type TagId,
  type TagPlayback,
  type TilemapCel,
  type TilemapImageMeta,
  type TilemapImageId,
} from "./types";

interface PendingStrokeCel {
  readonly cel: PixelCel;
  readonly image: PixelImageMeta;
  readonly surface: PixelSurface;
}

interface CapturedImages {
  readonly entries: readonly {
    readonly image: PixelImageMeta;
    readonly surface: PixelSurface;
  }[];
  readonly memory: number;
}

export type FrameDuplicateMode = "empty" | "independent" | "linked";

export class EditorSession {
  readonly #state: DocumentState;
  readonly history: EditorHistory;
  #savedRevision: number;
  #activeTransaction: StrokeTransaction | null = null;
  #pendingStrokeCel: PendingStrokeCel | null = null;
  #commandBatch: EditorCommand[] | null = null;
  #activeFrameId: FrameId;

  constructor(state: DocumentState, historyMemoryBytes?: number) {
    this.#state = state;
    this.history = new EditorHistory(historyMemoryBytes);
    this.#savedRevision = state.model.revision;
    const firstFrame = state.model.frameOrder[0];
    if (firstFrame === undefined) throw new Error("Document has no frame.");
    this.#activeFrameId = firstFrame;
  }

  static create(options: CreateDocumentOptions, historyMemoryBytes?: number): EditorSession {
    return new EditorSession(createDocument(options), historyMemoryBytes);
  }
  static fromSnapshot(snapshot: DocumentSnapshot, historyMemoryBytes?: number): EditorSession {
    return new EditorSession(stateFromSnapshot(snapshot), historyMemoryBytes);
  }

  get model() {
    return this.#state.model;
  }
  get activeFrameId(): FrameId {
    return this.#activeFrameId;
  }
  setActiveFrame(frameId: FrameId): void {
    if (this.transactionActive) throw new Error("Cannot change frame during a stroke.");
    if (this.model.frames[frameId] === undefined) throw new Error("Frame does not exist.");
    this.#activeFrameId = frameId;
  }
  get savedRevision(): number {
    return this.#savedRevision;
  }
  get isDirty(): boolean {
    return this.model.revision !== this.#savedRevision;
  }
  get transactionActive(): boolean {
    return this.#activeTransaction !== null;
  }
  getSurface(imageId: ImageId): PixelSurface {
    const surface = this.#state.surfaces.get(imageId);
    if (surface === undefined) throw new Error("Image surface is missing.");
    return surface;
  }
  getTilemapCells(tilemapImageId: TilemapImageId): Uint32Array {
    const cells = this.#state.tilemapSurfaces.get(tilemapImageId);
    if (cells === undefined) throw new Error("Tilemap surface is missing.");
    return cells;
  }
  getCel(layerId: LayerId, frameId = this.#activeFrameId): PixelCel | null {
    return getCel(this.model, layerId, frameId);
  }
  getAnyCel(layerId: LayerId, frameId = this.#activeFrameId): Cel | null {
    return lookupAnyCel(this.model, layerId, frameId);
  }
  getActiveCel(layerId: LayerId): PixelCel | null {
    return this.getCel(layerId, this.#activeFrameId);
  }
  getActiveSurface(layerId: LayerId): PixelSurface | null {
    const cel = this.getActiveCel(layerId);
    return cel === null ? null : this.getSurface(cel.imageId);
  }
  getActiveSurfaceForRead(layerId: LayerId): PixelSurface {
    this.#requiredLayer(layerId);
    return (
      this.getActiveSurface(layerId) ??
      (this.model.canvas.colorMode === "indexed"
        ? new IndexedPixelSurface(
            this.model.canvas.width,
            this.model.canvas.height,
            undefined,
            this.model.palette.entries.map((entry) => entry.rgba),
            this.model.palette.transparentIndex ?? 0,
          )
        : new RgbaPixelSurface(this.model.canvas.width, this.model.canvas.height))
    );
  }
  snapshot(): DocumentSnapshot {
    return snapshotDocument(this.#state);
  }
  markSaved(revision: number): void {
    this.#savedRevision = revision;
  }
  markRecovered(): void {
    this.#savedRevision = this.model.revision - 1;
  }
  execute(command: EditorCommand): void {
    if (this.transactionActive)
      throw new Error("Cannot execute a command while a stroke is active.");
    if (this.#commandBatch !== null) {
      command.execute(this.#state);
      this.#commandBatch.push(command);
      this.#normalizePaletteAdapter();
      recountImageReferences(this.model);
      assertDocumentIntegrity(this.model);
      return;
    }
    this.history.execute(this.#state, command);
    this.#normalizePaletteAdapter();
    recountImageReferences(this.model);
    assertDocumentIntegrity(this.model);
  }
  undo(): boolean {
    if (this.transactionActive) return false;
    const result = this.history.undo(this.#state);
    if (result) this.#afterHistoryChange();
    return result;
  }
  redo(): boolean {
    if (this.transactionActive) return false;
    const result = this.history.redo(this.#state);
    if (result) this.#afterHistoryChange();
    return result;
  }

  runTransaction<T>(
    label: string,
    operation: () => T,
    metadata?: Readonly<{ source: "plugin"; pluginId: string }>,
  ): T {
    const activeFrame = this.#activeFrameId;
    try {
      return this.#runCommandTransaction(label, operation, metadata);
    } finally {
      if (this.model.frames[activeFrame] !== undefined)
        this.#activeFrameId = activeFrame;
    }
  }

  replaceDocumentSnapshot(
    snapshot: DocumentSnapshot,
    label: string,
    commandId = "document.replace",
  ): void {
    const activeFrame = this.#activeFrameId,
      before = this.snapshot(),
      after = EditorSession.fromSnapshot(snapshot).snapshot(),
      memory = snapshotMemory(before) + snapshotMemory(after);
    if (memory > 768 * 1024 * 1024)
      throw new RangeError("Document replacement exceeds the history memory budget.");
    this.execute(
      new FunctionalCommand(
        commandId,
        label,
        memory,
        (state) => installSnapshot(state, after),
        (state) => installSnapshot(state, before),
      ),
    );
    const nextFrame = this.model.frames[activeFrame] === undefined ? this.model.frameOrder[0] : activeFrame;
    if (nextFrame !== undefined) this.#activeFrameId = nextFrame;
  }

  beginStroke(layerId: LayerId, color: Rgba, label: string, options: StrokeTransformOptions = {}): StrokeTransaction {
    if (this.#activeTransaction !== null) throw new Error("A stroke is already active.");
    const layer = this.#requiredLayer(layerId);
    if (layer.locked || !layer.visible) throw new Error("The active layer cannot be edited.");
    let cel = this.getActiveCel(layerId),
      surface: PixelSurface;
    if (cel === null) {
      const pending = this.#createDetachedCel(layerId, this.#activeFrameId);
      this.#insertCel(this.#state, pending.cel, pending.image, pending.surface);
      this.#pendingStrokeCel = pending;
      cel = pending.cel;
      surface = pending.surface;
    } else surface = this.getSurface(cel.imageId);
    this.#activeTransaction = new StrokeTransaction(cel.imageId, surface, color, label, options);
    return this.#activeTransaction;
  }

  commitStroke(transaction: StrokeTransaction): boolean {
    if (this.#activeTransaction !== transaction)
      throw new Error("Stroke transaction is not active.");
    const patch = transaction.commit(),
      pending = this.#pendingStrokeCel;
    this.#activeTransaction = null;
    this.#pendingStrokeCel = null;
    if (patch === null) {
      if (pending !== null) this.#removeCel(this.#state, pending.cel);
      return false;
    }
    const command =
      pending === null
        ? patch
        : new TransactionCommand(transaction.label, [this.#celCreationCommand(pending), patch]);
    this.history.commitApplied(this.#state, command);
    recountImageReferences(this.model);
    assertDocumentIntegrity(this.model);
    return true;
  }

  cancelStroke(transaction: StrokeTransaction): void {
    if (this.#activeTransaction !== transaction) return;
    transaction.rollback();
    this.#activeTransaction = null;
    const pending = this.#pendingStrokeCel;
    this.#pendingStrokeCel = null;
    if (pending !== null) this.#removeCel(this.#state, pending.cel);
  }

  applyPixelPatch(
    layerId: LayerId,
    rect: IntRect,
    before: Uint8Array,
    after: Uint8Array,
    label: string,
  ): void {
    const layer = this.#requiredLayer(layerId);
    if (layer.locked || !layer.visible) throw new Error("The active layer cannot be edited.");
    const existing = this.getActiveCel(layerId);
    if (existing !== null) {
      this.execute(new PixelPatchCommand(label, { imageId: existing.imageId, format: this.getSurface(existing.imageId).format, rect, before, after }));
      return;
    }
    const pending = this.#createDetachedCel(layerId, this.#activeFrameId),
      patch = new PixelPatchCommand(label, {
        imageId: pending.image.id,
        format: pending.surface.format,
        rect,
        before,
        after,
      });
    this.execute(new TransactionCommand(label, [this.#celCreationCommand(pending), patch]));
  }

  addLayer(name: string, index = this.model.layerOrder.length): LayerId {
    const layerId = makeId("layer"),
      layer: PixelLayer = {
        id: layerId,
        kind: "pixel",
        name,
        parentId: null,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
      },
      target = Math.min(index, this.model.layerOrder.length);
    this.execute(
      new FunctionalCommand(
        "layer.add",
        "Add Layer",
        128,
        (state) => {
          state.model.layers[layerId] = layer;
          state.model.layerOrder.splice(target, 0, layerId);
          state.model.rootLayerIds.splice(target, 0, layerId);
        },
        (state) => {
          state.model.layerOrder = state.model.layerOrder.filter((id) => id !== layerId);
          state.model.rootLayerIds = state.model.rootLayerIds.filter((id) => id !== layerId);
          Reflect.deleteProperty(state.model.layers, layerId);
        },
      ),
    );
    return layerId;
  }

  deleteLayer(layerId: LayerId): void {
    if (this.model.layerOrder.length <= 1)
      throw new Error("A document must keep at least one layer.");
    const layer = this.#requiredLayer(layerId),
      index = this.model.layerOrder.indexOf(layerId),
      cels = Object.values(this.model.cels).filter(
        (cel): cel is PixelCel => cel.kind === "pixel" && cel.layerId === layerId,
      ),
      retained = this.#capturePotentiallyOrphanedImages(cels);
    this.execute(
      new FunctionalCommand(
        "layer.delete",
        "Delete Layer",
        retained.memory,
        (state) => {
          state.model.layerOrder = state.model.layerOrder.filter((id) => id !== layerId);
          state.model.rootLayerIds = state.model.rootLayerIds.filter((id) => id !== layerId);
          Reflect.deleteProperty(state.model.layers, layerId);
          for (const cel of cels) this.#removeCel(state, cel);
          this.#removeCapturedIfUnreferenced(state, retained);
        },
        (state) => {
          state.model.layers[layerId] = layer;
          state.model.layerOrder.splice(index, 0, layerId);
          state.model.rootLayerIds.splice(index, 0, layerId);
          this.#restoreCaptured(state, retained);
          for (const cel of cels) this.#insertExistingCel(state, cel);
        },
      ),
    );
  }

  duplicateLayer(layerId: LayerId, name: string): LayerId {
    const source = this.#requiredLayer(layerId),
      newLayerId = makeId("layer"),
      layer: PixelLayer = { ...source, id: newLayerId, name },
      index = this.model.layerOrder.indexOf(layerId) + 1,
      copies = Object.values(this.model.cels)
        .filter(
          (cel): cel is PixelCel => cel.kind === "pixel" && cel.layerId === layerId,
        )
        .map((cel) => this.#cloneDetachedCel(cel, newLayerId, cel.frameId));
    this.execute(
      new FunctionalCommand(
        "layer.duplicate",
        "Duplicate Layer",
        copies.reduce((sum, copy) => sum + copy.surface.getBytes().byteLength, 128),
        (state) => {
          state.model.layers[newLayerId] = layer;
          state.model.layerOrder.splice(index, 0, newLayerId);
          state.model.rootLayerIds.splice(index, 0, newLayerId);
          for (const copy of copies) this.#insertCel(state, copy.cel, copy.image, copy.surface);
        },
        (state) => {
          for (const copy of copies) this.#removeCel(state, copy.cel);
          state.model.layerOrder = state.model.layerOrder.filter((id) => id !== newLayerId);
          state.model.rootLayerIds = state.model.rootLayerIds.filter((id) => id !== newLayerId);
          Reflect.deleteProperty(state.model.layers, newLayerId);
        },
      ),
    );
    return newLayerId;
  }

  moveLayer(layerId: LayerId, targetIndex: number): void {
    this.#requiredLayer(layerId);
    const sourceIndex = this.model.layerOrder.indexOf(layerId),
      destination = Math.min(this.model.layerOrder.length - 1, Math.max(0, Math.round(targetIndex)));
    if (sourceIndex === destination) return;
    const move = (state: DocumentState, to: number) => {
      state.model.layerOrder.splice(state.model.layerOrder.indexOf(layerId), 1);
      state.model.layerOrder.splice(to, 0, layerId);
      state.model.rootLayerIds.splice(state.model.rootLayerIds.indexOf(layerId), 1);
      state.model.rootLayerIds.splice(to, 0, layerId);
    };
    this.execute(
      new FunctionalCommand(
        "layer.move",
        "Move Layer",
        64,
        (state) => move(state, destination),
        (state) => move(state, sourceIndex),
      ),
    );
  }

  renameLayer(layerId: LayerId, name: string): void {
    this.#setLayerValue(layerId, "name", name.trim() || this.#requiredAnyLayer(layerId).name, "layer.rename");
  }
  setLayerVisible(layerId: LayerId, visible: boolean): void {
    this.#setLayerValue(layerId, "visible", visible, "layer.visibility");
  }
  setLayerLocked(layerId: LayerId, locked: boolean): void {
    this.#setLayerValue(layerId, "locked", locked, "layer.lock");
  }
  setLayerOpacity(layerId: LayerId, opacity: number): void {
    this.#setLayerValue(layerId, "opacity", Math.min(1, Math.max(0, opacity)), "layer.opacity");
  }

  addFrame(afterFrameId = this.#activeFrameId, mode: FrameDuplicateMode = "empty"): FrameId {
    const sourceIndex = this.model.frameOrder.indexOf(afterFrameId);
    if (sourceIndex < 0) throw new Error("Frame does not exist.");
    const frameId = makeId("frame"),
      frame: Frame = {
        id: frameId,
        durationMs: mode === "empty" ? DEFAULT_FRAME_DURATION_MS : (this.model.frames[afterFrameId]?.durationMs ?? DEFAULT_FRAME_DURATION_MS),
      },
      copies =
        mode === "empty"
          ? []
          : Object.values(this.model.cels)
              .filter(
                (cel): cel is PixelCel =>
                  cel.kind === "pixel" && cel.frameId === afterFrameId,
              )
              .map((cel) =>
                mode === "linked"
                  ? { cel: { ...cel, id: makeId("cel"), frameId }, image: null, surface: null }
                  : this.#cloneDetachedCel(cel, cel.layerId, frameId),
              ),
      tileCopies: readonly Readonly<{
        cel: TilemapCel;
        image: TilemapImageMeta | null;
        cells: Uint32Array | null;
      }>[] = mode === "empty" ? [] : Object.values(this.model.cels)
        .filter((cel): cel is TilemapCel => cel.kind === "tilemap" && cel.frameId === afterFrameId)
        .map((cel) => {
          if (mode === "linked") return { cel: { ...cel, id: makeId("tilemap-cel"), frameId }, image: null, cells: null };
          const source = this.model.tilemaps[cel.tilemapImageId], cells = this.#state.tilemapSurfaces.get(cel.tilemapImageId);
          if (source === undefined || cells === undefined) throw new Error("Tilemap Cel data is missing.");
          const tilemapImageId = makeId("tilemap-image");
          return { cel: { ...cel, id: makeId("tilemap-cel"), frameId, tilemapImageId }, image: { ...source, id: tilemapImageId, refCount: 1 }, cells: cells.slice() };
        });
    this.execute(
      new FunctionalCommand(
        mode === "linked" ? "frame.duplicateLinked" : mode === "independent" ? "frame.duplicate" : "frame.add",
        "Add Frame",
        copies.reduce((sum, copy) => sum + (copy.surface?.getBytes().byteLength ?? 64), 128) + tileCopies.reduce((sum, copy) => sum + (copy.cells?.byteLength ?? 64), 0),
        (state) => {
          state.model.frames[frameId] = frame;
          state.model.frameOrder.splice(sourceIndex + 1, 0, frameId);
          for (const copy of copies) {
            if (copy.image === null) this.#insertExistingCel(state, copy.cel);
            else this.#insertCel(state, copy.cel, copy.image, copy.surface);
          }
          for (const copy of tileCopies) {
            if (copy.image !== null && copy.cells !== null) {
              state.model.tilemaps[copy.image.id] = { ...copy.image };
              state.tilemapSurfaces.set(copy.image.id, copy.cells.slice());
            } else {
              const image = state.model.tilemaps[copy.cel.tilemapImageId];
              if (image === undefined) throw new Error("Linked tilemap image is missing.");
              image.refCount += 1;
            }
            state.model.cels[copy.cel.id] = { ...copy.cel };
            state.model.celByLayerAndFrame[celKey(copy.cel.layerId, copy.cel.frameId)] = copy.cel.id;
          }
        },
        (state) => {
          for (const copy of copies) this.#removeCel(state, copy.cel);
          for (const copy of tileCopies) {
            Reflect.deleteProperty(state.model.celByLayerAndFrame, celKey(copy.cel.layerId, copy.cel.frameId));
            Reflect.deleteProperty(state.model.cels, copy.cel.id);
            const image = state.model.tilemaps[copy.cel.tilemapImageId];
            if (image !== undefined) {
              image.refCount -= 1;
              if (image.refCount === 0) { Reflect.deleteProperty(state.model.tilemaps, image.id); state.tilemapSurfaces.delete(image.id); }
            }
          }
          state.model.frameOrder = state.model.frameOrder.filter((id) => id !== frameId);
          Reflect.deleteProperty(state.model.frames, frameId);
        },
      ),
    );
    this.#activeFrameId = frameId;
    return frameId;
  }

  deleteFrame(frameId = this.#activeFrameId): FrameId {
    if (this.model.frameOrder.length <= 1) throw new Error("The final frame cannot be deleted.");
    const frame = this.model.frames[frameId];
    if (frame === undefined) throw new Error("Frame does not exist.");
    const index = this.model.frameOrder.indexOf(frameId),
      nextOrder = this.model.frameOrder.filter((id) => id !== frameId),
      replacement = nextOrder[Math.min(index, nextOrder.length - 1)];
    if (replacement === undefined) throw new Error("No replacement frame exists.");
    const cels = Object.values(this.model.cels).filter(
      (cel): cel is PixelCel => cel.kind === "pixel" && cel.frameId === frameId,
    ),
      tileCels = Object.values(this.model.cels).filter(
        (cel): cel is TilemapCel => cel.kind === "tilemap" && cel.frameId === frameId,
      ),
      retainedTilemaps = new Map(tileCels.map((cel) => {
        const meta = this.model.tilemaps[cel.tilemapImageId], cells = this.#state.tilemapSurfaces.get(cel.tilemapImageId);
        if (meta === undefined || cells === undefined) throw new Error("Tilemap Cel data is missing.");
        return [cel.tilemapImageId, { meta: { ...meta }, cells: cells.slice() }] as const;
      })),
      retained = this.#capturePotentiallyOrphanedImages(cels),
      beforeTags = this.#cloneTags(this.model.tags),
      afterTags = this.#tagsAfterFrameDelete(frameId, replacement);
    this.execute(
      new FunctionalCommand(
        "frame.delete",
        "Delete Frame",
        retained.memory + [...retainedTilemaps.values()].reduce((sum, value) => sum + value.cells.byteLength, 0) + 256,
        (state) => {
          for (const cel of cels) this.#removeCel(state, cel);
          for (const cel of tileCels) {
            Reflect.deleteProperty(state.model.celByLayerAndFrame, celKey(cel.layerId, cel.frameId));
            Reflect.deleteProperty(state.model.cels, cel.id);
            const meta = state.model.tilemaps[cel.tilemapImageId];
            if (meta !== undefined) meta.refCount -= 1;
          }
          for (const [id, meta] of Object.entries(state.model.tilemaps)) if (meta.refCount === 0) { Reflect.deleteProperty(state.model.tilemaps, id); state.tilemapSurfaces.delete(id); }
          this.#removeCapturedIfUnreferenced(state, retained);
          state.model.frameOrder = nextOrder.slice();
          Reflect.deleteProperty(state.model.frames, frameId);
          state.model.tags = this.#cloneTags(afterTags);
        },
        (state) => {
          state.model.frames[frameId] = frame;
          state.model.frameOrder.splice(index, 0, frameId);
          this.#restoreCaptured(state, retained);
          for (const [id, retainedTilemap] of retainedTilemaps) if (state.model.tilemaps[id] === undefined) {
            state.model.tilemaps[id] = { ...retainedTilemap.meta, refCount: 0 };
            state.tilemapSurfaces.set(id, retainedTilemap.cells.slice());
          }
          for (const cel of cels) this.#insertExistingCel(state, cel);
          for (const cel of tileCels) {
            state.model.cels[cel.id] = { ...cel };
            state.model.celByLayerAndFrame[celKey(cel.layerId, cel.frameId)] = cel.id;
            const meta = state.model.tilemaps[cel.tilemapImageId];
            if (meta === undefined) throw new Error("Tilemap image restore failed.");
            meta.refCount += 1;
          }
          state.model.tags = this.#cloneTags(beforeTags);
        },
      ),
    );
    if (this.#activeFrameId === frameId) this.#activeFrameId = replacement;
    return replacement;
  }

  deleteFrames(frameIds: readonly FrameId[]): FrameId {
    const selected = new Set(frameIds),
      ids = this.model.frameOrder.filter((id) => selected.has(id));
    if (ids.length === 0) return this.#activeFrameId;
    if (this.model.frameOrder.length - ids.length < 1)
      throw new Error("The final frame cannot be deleted.");
    return this.#runCommandTransaction("Delete Frames", () => {
      for (const id of ids) this.deleteFrame(id);
      return this.#activeFrameId;
    });
  }

  duplicateFrames(
    frameIds: readonly FrameId[],
    mode: Exclude<FrameDuplicateMode, "empty">,
  ): readonly FrameId[] {
    const selected = new Set(frameIds),
      ids = this.model.frameOrder.filter((id) => selected.has(id));
    return this.#runCommandTransaction("Duplicate Frames", () =>
      ids.map((id) => this.addFrame(id, mode)),
    );
  }

  moveFrame(frameId: FrameId, targetIndex: number): void {
    if (this.model.frames[frameId] === undefined) throw new Error("Frame does not exist.");
    const source = this.model.frameOrder.indexOf(frameId),
      target = Math.min(this.model.frameOrder.length - 1, Math.max(0, Math.round(targetIndex)));
    if (source === target) return;
    const move = (state: DocumentState, index: number) => {
      state.model.frameOrder.splice(state.model.frameOrder.indexOf(frameId), 1);
      state.model.frameOrder.splice(index, 0, frameId);
    };
    this.execute(
      new FunctionalCommand(
        "frame.move",
        "Move Frame",
        64,
        (state) => move(state, target),
        (state) => move(state, source),
      ),
    );
  }

  setFrameDuration(frameIds: FrameId | readonly FrameId[], durationMs: number): void {
    const ids = typeof frameIds === "string" ? [frameIds] : [...new Set(frameIds)],
      duration = requireFrameDuration(durationMs),
      before = ids.map((id) => {
        const frame = this.model.frames[id];
        if (frame === undefined) throw new Error("Frame does not exist.");
        return [id, frame.durationMs] as const;
      });
    if (before.every(([, value]) => value === duration)) return;
    this.execute(
      new FunctionalCommand(
        "frame.setDuration",
        "Set Frame Duration",
        ids.length * 16,
        (state) => {
          for (const id of ids) {
            const frame = state.model.frames[id];
            if (frame !== undefined) frame.durationMs = duration;
          }
        },
        (state) => {
          for (const [id, value] of before) {
            const frame = state.model.frames[id];
            if (frame !== undefined) frame.durationMs = value;
          }
        },
      ),
    );
  }

  createCel(layerId: LayerId, frameId = this.#activeFrameId): CelId {
    this.#requiredLayer(layerId);
    if (this.model.frames[frameId] === undefined) throw new Error("Frame does not exist.");
    const existing = this.getCel(layerId, frameId);
    if (existing !== null) return existing.id;
    const detached = this.#createDetachedCel(layerId, frameId);
    this.execute(this.#celCreationCommand(detached));
    return detached.cel.id;
  }

  deleteCel(layerId: LayerId, frameId = this.#activeFrameId): boolean {
    const cel = this.getCel(layerId, frameId);
    if (cel === null) return false;
    const retained = this.#capturePotentiallyOrphanedImages([cel]);
    this.execute(
      new FunctionalCommand(
        "cel.delete",
        "Delete Cel",
        retained.memory,
        (state) => {
          this.#removeCel(state, cel);
          this.#removeCapturedIfUnreferenced(state, retained);
        },
        (state) => {
          this.#restoreCaptured(state, retained);
          this.#insertExistingCel(state, cel);
        },
      ),
    );
    return true;
  }

  duplicateCel(
    layerId: LayerId,
    sourceFrameId: FrameId,
    targetFrameId: FrameId,
    linked = false,
  ): CelId {
    if (this.getCel(layerId, targetFrameId) !== null)
      throw new Error("Target frame already contains a cel.");
    const source = this.getCel(layerId, sourceFrameId);
    if (source === null) throw new Error("Source cel does not exist.");
    const copy = linked
      ? { cel: { ...source, id: makeId("cel"), frameId: targetFrameId }, image: null, surface: null }
      : this.#cloneDetachedCel(source, layerId, targetFrameId);
    this.execute(
      new FunctionalCommand(
        linked ? "cel.link" : "cel.duplicate",
        linked ? "Link Cel" : "Duplicate Cel",
        copy.surface?.getBytes().byteLength ?? 64,
        (state) => {
          if (copy.image === null) this.#insertExistingCel(state, copy.cel);
          else this.#insertCel(state, copy.cel, copy.image, copy.surface);
        },
        (state) => this.#removeCel(state, copy.cel),
      ),
    );
    return copy.cel.id;
  }

  linkCelToPrevious(layerId: LayerId, frameId = this.#activeFrameId): CelId {
    const index = this.model.frameOrder.indexOf(frameId),
      previous = this.model.frameOrder[index - 1];
    if (previous === undefined) throw new Error("There is no previous frame.");
    if (this.getCel(layerId, frameId) !== null) this.deleteCel(layerId, frameId);
    return this.duplicateCel(layerId, previous, frameId, true);
  }

  unlinkCel(layerId: LayerId, frameId = this.#activeFrameId): boolean {
    const cel = this.getCel(layerId, frameId);
    if (cel === null) return false;
    const referenceCount = Object.values(this.model.cels).filter(
      (item) => item.kind === "pixel" && item.imageId === cel.imageId,
    ).length;
    if (referenceCount < 2) return false;
    const oldImageId = cel.imageId,
      imageId = makeId("image"),
      surface = this.getSurface(oldImageId).clone(),
      image: PixelImageMeta = {
        id: imageId,
        width: surface.width,
        height: surface.height,
        format: surface.format,
        refCount: 1,
      };
    this.execute(
      new FunctionalCommand(
        "cel.unlink",
        "Unlink Cel",
        surface.getBytes().byteLength,
        (state) => {
          state.model.images[imageId] = image;
          state.surfaces.set(imageId, surface);
          this.#requiredStateCel(state, cel.id).imageId = imageId;
        },
        (state) => {
          this.#requiredStateCel(state, cel.id).imageId = oldImageId;
          Reflect.deleteProperty(state.model.images, imageId);
          state.surfaces.delete(imageId);
        },
      ),
    );
    return true;
  }

  setCelOpacity(layerId: LayerId, opacity: number, frameId = this.#activeFrameId): void {
    const cel = this.getCel(layerId, frameId);
    if (cel === null) throw new Error("Cel does not exist.");
    const before = cel.opacity,
      after = Math.min(1, Math.max(0, opacity));
    if (before === after) return;
    this.execute(
      new FunctionalCommand(
        "cel.opacity",
        "Set Cel Opacity",
        16,
        (state) => { this.#requiredStateCel(state, cel.id).opacity = after; },
        (state) => { this.#requiredStateCel(state, cel.id).opacity = before; },
      ),
    );
  }

  setCelPosition(layerId: LayerId, x: number, y: number, frameId = this.#activeFrameId): void {
    const cel = this.getCel(layerId, frameId);
    if (cel === null) throw new Error("Cel does not exist.");
    const before = { x: cel.x, y: cel.y },
      after = { x: Math.round(x), y: Math.round(y) };
    if (before.x === after.x && before.y === after.y) return;
    this.execute(
      new FunctionalCommand(
        "cel.position",
        "Move Cel",
        32,
        (state) => Object.assign(this.#requiredStateCel(state, cel.id), after),
        (state) => Object.assign(this.#requiredStateCel(state, cel.id), before),
      ),
    );
  }

  addTag(
    name: string,
    fromFrameId: FrameId,
    toFrameId: FrameId,
    playback: TagPlayback = "forward",
    color: Rgba = [116, 92, 224, 255],
  ): TagId {
    if (this.model.frames[fromFrameId] === undefined || this.model.frames[toFrameId] === undefined)
      throw new Error("Tag range references a missing frame.");
    const id = makeId("tag"),
      tag: FrameTag = {
        id,
        name: name.trim() || "Tag",
        fromFrameId,
        toFrameId,
        playback,
        color: normalizeRgba(color),
      };
    this.execute(
      new FunctionalCommand(
        "tag.add",
        "Add Tag",
        128,
        (state) => { state.model.tags[id] = tag; },
        (state) => { Reflect.deleteProperty(state.model.tags, id); },
      ),
    );
    return id;
  }

  editTag(id: TagId, update: Partial<Omit<FrameTag, "id">>): void {
    const current = this.model.tags[id];
    if (current === undefined) throw new Error("Tag does not exist.");
    const updatedName = update.name?.trim(),
      next: FrameTag = {
      ...current,
      ...update,
      id,
      name: updatedName === undefined || updatedName === "" ? current.name : updatedName,
      color: update.color === undefined ? current.color : normalizeRgba(update.color),
    };
    if (this.model.frames[next.fromFrameId] === undefined || this.model.frames[next.toFrameId] === undefined)
      throw new Error("Tag range references a missing frame.");
    this.execute(
      new FunctionalCommand(
        "tag.edit",
        "Edit Tag",
        128,
        (state) => { state.model.tags[id] = next; },
        (state) => { state.model.tags[id] = current; },
      ),
    );
  }

  deleteTag(id: TagId): void {
    const tag = this.model.tags[id];
    if (tag === undefined) return;
    this.execute(
      new FunctionalCommand(
        "tag.delete",
        "Delete Tag",
        128,
        (state) => { Reflect.deleteProperty(state.model.tags, id); },
        (state) => { state.model.tags[id] = tag; },
      ),
    );
  }

  cropToRect(input: IntRect): void {
    const rect = intersectRect(input, {
      x: 0,
      y: 0,
      width: this.model.canvas.width,
      height: this.model.canvas.height,
    });
    if (rect.width < 1 || rect.height < 1) throw new RangeError("Crop rectangle is empty.");
    this.#replaceCanvas(
      rect.width,
      rect.height,
      (surface) =>
        surface instanceof IndexedPixelSurface
          ? canvasResizeIndexed(surface.getBytes(), surface.width, surface.height, rect.width, rect.height, -rect.x, -rect.y, this.model.palette.transparentIndex ?? 0)
          : canvasResizeRgba(
          surface.getBytes(),
          surface.width,
          surface.height,
          rect.width,
          rect.height,
          -rect.x,
          -rect.y,
          [0, 0, 0, 0],
        ),
      "sprite.cropToSelection",
    );
  }

  resizeCanvas(width: number, height: number, anchor: ResizeAnchor, fill: Rgba): void {
    const offset = anchorOffset(
      anchor,
      this.model.canvas.width,
      this.model.canvas.height,
      width,
      height,
    );
    this.#replaceCanvas(
      width,
      height,
      (surface) =>
        surface instanceof IndexedPixelSurface
          ? canvasResizeIndexed(surface.getBytes(), surface.width, surface.height, width, height, offset.x, offset.y, surface.indexForColor(fill))
          : canvasResizeRgba(
          surface.getBytes(),
          surface.width,
          surface.height,
          width,
          height,
          offset.x,
          offset.y,
          fill,
        ),
      "sprite.canvasResize",
    );
  }

  resizeSprite(width: number, height: number): void {
    this.#replaceCanvas(
      width,
      height,
      (surface) => surface instanceof IndexedPixelSurface ? resizeNearestIndexed(surface.getBytes(), surface.width, surface.height, width, height) : resizeNearestRgba(surface.getBytes(), surface.width, surface.height, width, height),
      "sprite.spriteResize",
    );
  }

  applyPreparedResize(
    width: number,
    height: number,
    images: ReadonlyMap<ImageId, Uint8Array>,
    label: string,
  ): void {
    this.#validateResize(width, height);
    if (images.size !== Object.keys(this.model.images).length)
      throw new Error("Prepared resize image count is invalid.");
    this.#replaceCanvas(
      width,
      height,
      (_surface, imageId) => {
        const bytes = images.get(imageId);
        if (bytes?.byteLength !== width * height * (this.model.canvas.colorMode === "indexed" ? 1 : 4))
          throw new Error("Prepared resize image is invalid.");
        return bytes;
      },
      label,
    );
  }

  addPaletteColor(rgba: Rgba, name?: string): PaletteColorId {
    if (this.model.palette.colors.length >= 256) throw new RangeError("Palette color limit reached.");
      const color = {
        id: makeId("palette"),
        index: this.model.palette.colors.length,
        rgba: normalizeRgba(rgba),
        ...(name?.trim() ? { name: name.trim() } : {}),
      },
      index = this.model.palette.colors.length;
    this.execute(
      new FunctionalCommand(
        "palette.add",
        "Add Palette Color",
        64,
        (state) => { state.model.palette.colors.splice(index, 0, color); },
        (state) => { state.model.palette.colors = state.model.palette.colors.filter((entry) => entry.id !== color.id); },
      ),
    );
    return color.id;
  }
  deletePaletteColor(id: PaletteColorId): void {
    const index = this.model.palette.colors.findIndex((color) => color.id === id),
      color = this.model.palette.colors[index];
    if (index < 0 || color === undefined) return;
    this.execute(
      new FunctionalCommand(
        "palette.delete",
        "Delete Palette Color",
        64,
        (state) => { state.model.palette.colors = state.model.palette.colors.filter((entry) => entry.id !== id); },
        (state) => { state.model.palette.colors.splice(index, 0, color); },
      ),
    );
  }
  movePaletteColor(id: PaletteColorId, targetIndex: number): void {
    const source = this.model.palette.colors.findIndex((color) => color.id === id),
      target = Math.min(this.model.palette.colors.length - 1, Math.max(0, Math.round(targetIndex)));
    if (source < 0 || source === target) return;
    const move = (state: DocumentState, index: number) => {
      const current = state.model.palette.colors.findIndex((color) => color.id === id),
        [color] = state.model.palette.colors.splice(current, 1);
      if (color !== undefined) state.model.palette.colors.splice(index, 0, color);
    };
    this.execute(
      new FunctionalCommand(
        "palette.move",
        "Move Palette Color",
        64,
        (state) => move(state, target),
        (state) => move(state, source),
      ),
    );
  }
  renamePaletteColor(id: PaletteColorId, name: string): void {
    const color = this.model.palette.colors.find((entry) => entry.id === id);
    if (color === undefined) return;
    const before = color.name,
      after = name.trim() || undefined;
    if (before === after) return;
    this.execute(
      new FunctionalCommand(
        "palette.rename",
        "Rename Palette Color",
        64,
        (state) => {
          const target = state.model.palette.colors.find((entry) => entry.id === id);
          if (target !== undefined) {
            if (after === undefined) Reflect.deleteProperty(target, "name");
            else target.name = after;
          }
        },
        (state) => {
          const target = state.model.palette.colors.find((entry) => entry.id === id);
          if (target !== undefined) {
            if (before === undefined) Reflect.deleteProperty(target, "name");
            else target.name = before;
          }
        },
      ),
    );
  }
  setPaletteColor(id: PaletteColorId, rgba: Rgba): void {
    const color = this.model.palette.colors.find((entry) => entry.id === id);
    if (color === undefined || color.locked) return;
    const before = color.rgba, after = normalizeRgba(rgba);
    if (before.every((value, index) => value === after[index])) return;
    this.execute(new FunctionalCommand("palette.slotEdit", "Edit Palette Slot", 64,
      (state) => { const target = state.model.palette.colors.find((entry) => entry.id === id); if (target !== undefined) target.rgba = after; },
      (state) => { const target = state.model.palette.colors.find((entry) => entry.id === id); if (target !== undefined) target.rgba = before; },
    ));
  }
  setPaletteLocked(id: PaletteColorId, locked: boolean): void {
    const color = this.model.palette.colors.find((entry) => entry.id === id);
    if (color === undefined || color.locked === locked) return;
    const apply = (state: DocumentState, value: boolean) => { const target = state.model.palette.colors.find((entry) => entry.id === id); if (target !== undefined) { if (value) target.locked = true; else Reflect.deleteProperty(target, "locked"); } };
    this.execute(new FunctionalCommand("palette.lock", "Lock Palette Slot", 16, (state) => apply(state, locked), (state) => apply(state, !locked)));
  }
  setTransparentIndex(index: number): void {
    if (this.model.canvas.colorMode !== "indexed" || !this.model.palette.entries.some((entry) => entry.index === index)) throw new RangeError("Transparent index is invalid.");
    const before = this.model.palette.transparentIndex;
    if (before === index) return;
    this.execute(new FunctionalCommand("palette.transparentIndex", "Set Transparent Index", 16,
      (state) => { state.model.palette.transparentIndex = index; state.model.canvas.transparentIndex = index; },
      (state) => { state.model.palette.transparentIndex = before; if (before === null) Reflect.deleteProperty(state.model.canvas, "transparentIndex"); else state.model.canvas.transparentIndex = before; },
    ));
  }
  loadDefaultPalette(colors: readonly Rgba[]): void {
    const before = this.model.palette.colors.map((color) => ({ ...color })),
      after = colors.slice(0, 256).map((rgba, index) => ({
        id: makeId("palette"),
        index,
        name: `Color ${index + 1}`,
        rgba: normalizeRgba(rgba),
      }));
    this.execute(
      new FunctionalCommand(
        "palette.loadDefault",
        "Load Default Palette",
        after.length * 64,
        (state) => { state.model.palette.colors = after.map((color) => ({ ...color })); },
        (state) => { state.model.palette.colors = before.map((color) => ({ ...color })); },
      ),
    );
  }

  setPalette(colors: readonly Readonly<{ id: string; name?: string | undefined; rgba: Rgba }>[]): void {
    if (colors.length > 256) throw new RangeError("Palette color limit reached.");
    const normalize = () => colors.map((color, index) => ({
      id: color.id,
      index,
      ...(color.name?.trim() ? { name: color.name.trim() } : {}),
      rgba: normalizeRgba(color.rgba),
    }));
    const before = this.model.palette.colors.map((color) => ({ ...color, rgba: [...color.rgba] as unknown as Rgba }));
    const after = normalize();
    this.execute(new FunctionalCommand(
      "palette.set",
      "Set Palette",
      (before.length + after.length) * 64,
      (state) => { state.model.palette.colors = after.map((color) => ({ ...color })); },
      (state) => { state.model.palette.colors = before.map((color) => ({ ...color })); },
    ));
  }

  setPluginData(pluginId: string, value: unknown): void {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId))
      throw new Error("Plugin data namespace is invalid.");
    const beforeExists = Object.hasOwn(this.model.pluginData ?? {}, pluginId);
    const before = beforeExists ? structuredClone(this.model.pluginData?.[pluginId]) : undefined;
    const after = structuredClone(value);
    this.execute(new FunctionalCommand(
      "plugin.data.set",
      "Set Plugin Document Data",
      new TextEncoder().encode(JSON.stringify(after)).byteLength,
      (state) => {
        state.model.pluginData ??= {};
        state.model.pluginData[pluginId] = structuredClone(after);
      },
      (state) => {
        state.model.pluginData ??= {};
        if (beforeExists) state.model.pluginData[pluginId] = structuredClone(before);
        else Reflect.deleteProperty(state.model.pluginData, pluginId);
      },
    ));
  }

  #setLayerValue<Key extends "name" | "visible" | "locked" | "opacity">(
    layerId: LayerId,
    key: Key,
    value: Layer[Key],
    commandId: string,
  ): void {
    const layer = this.#requiredAnyLayer(layerId),
      before = layer[key];
    if (before === value) return;
    this.execute(
      new FunctionalCommand(
        commandId,
        commandId,
        32,
        (state) => { this.#requiredStateAnyLayer(state, layerId)[key] = value; },
        (state) => { this.#requiredStateAnyLayer(state, layerId)[key] = before; },
      ),
    );
  }
  #requiredLayer(layerId: LayerId): PixelLayer {
    const layer = this.model.layers[layerId];
    if (layer?.kind !== "pixel")
      throw new Error("Pixel layer does not exist.");
    return layer;
  }
  #requiredAnyLayer(layerId: LayerId): Layer {
    const layer = this.model.layers[layerId];
    if (layer === undefined) throw new Error("Layer does not exist.");
    return layer;
  }
  #runCommandTransaction<T>(
    label: string,
    operation: () => T,
    metadata?: Readonly<{ source: "plugin"; pluginId: string }>,
  ): T {
    if (this.transactionActive || this.#commandBatch !== null)
      throw new Error("Another editor transaction is active.");
    const activeBefore = this.#activeFrameId,
      commands: EditorCommand[] = [];
    this.#commandBatch = commands;
    try {
      const result = operation();
      this.#commandBatch = null;
      if (commands.length > 0)
        this.history.commitApplied(
          this.#state,
          new TransactionCommand(label, commands, metadata),
        );
      recountImageReferences(this.model);
      assertDocumentIntegrity(this.model);
      return result;
    } catch (error) {
      for (const command of [...commands].reverse()) command.undo(this.#state);
      this.#activeFrameId = activeBefore;
      recountImageReferences(this.model);
      assertDocumentIntegrity(this.model);
      throw error;
    } finally {
      this.#commandBatch = null;
    }
  }

  #requiredStateAnyLayer(state: DocumentState, layerId: LayerId): Layer {
    const layer = state.model.layers[layerId];
    if (layer === undefined) throw new Error("Layer does not exist.");
    return layer;
  }
  #requiredStateCel(state: DocumentState, celId: CelId): PixelCel {
    const cel = state.model.cels[celId];
    if (cel?.kind !== "pixel")
      throw new Error("Pixel cel does not exist.");
    return cel;
  }

  #replaceCanvas(
    width: number,
    height: number,
    transform: (surface: PixelSurface, imageId: ImageId) => Uint8Array,
    commandId: string,
  ): void {
    this.#validateResize(width, height);
    const beforeWidth = this.model.canvas.width,
      beforeHeight = this.model.canvas.height;
    if (beforeWidth === width && beforeHeight === height && commandId !== "sprite.cropToSelection") return;
    const before = new Map<ImageId, PixelSurface>(),
      after = new Map<ImageId, PixelSurface>();
    for (const imageId of Object.keys(this.model.images)) {
      const surface = this.getSurface(imageId);
      before.set(imageId, surface);
      const bytes = transform(surface, imageId);
      after.set(imageId, surface instanceof IndexedPixelSurface
        ? new IndexedPixelSurface(width, height, bytes, this.model.palette.entries.map((entry) => entry.rgba), this.model.palette.transparentIndex ?? 0)
        : new RgbaPixelSurface(width, height, bytes));
    }
    const memory = [...before.values()].reduce(
      (sum, surface) => sum + surface.getBytes().byteLength + width * height * (surface.format === "rgba8" ? 4 : 1),
      0,
    );
    if (memory > 512 * 1024 * 1024) throw new RangeError("Resize exceeds the safe memory budget.");
    const apply = (state: DocumentState, surfaces: ReadonlyMap<ImageId, PixelSurface>, w: number, h: number) => {
      state.model.canvas.width = w;
      state.model.canvas.height = h;
      for (const [imageId, surface] of surfaces) {
        state.surfaces.set(imageId, surface);
        const image = state.model.images[imageId];
        if (image !== undefined) {
          image.width = w;
          image.height = h;
        }
      }
    };
    this.execute(
      new FunctionalCommand(
        commandId,
        commandId,
        memory,
        (state) => apply(state, after, width, height),
        (state) => apply(state, before, beforeWidth, beforeHeight),
      ),
    );
  }

  #validateResize(width: number, height: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      width * height * 4 > 256 * 1024 * 1024
    )
      throw new RangeError("Resize dimensions are invalid.");
  }

  #createDetachedCel(layerId: LayerId, frameId: FrameId): PendingStrokeCel {
    const imageId = makeId("image"),
      cel: PixelCel = {
        kind: "pixel",
        id: makeId("cel"),
        layerId,
        frameId,
        imageId,
        x: 0,
        y: 0,
        opacity: 1,
      },
      surface = this.model.canvas.colorMode === "indexed"
        ? new IndexedPixelSurface(
            this.model.canvas.width,
            this.model.canvas.height,
            undefined,
            this.model.palette.entries.map((entry) => entry.rgba),
            this.model.palette.transparentIndex ?? 0,
          )
        : new RgbaPixelSurface(this.model.canvas.width, this.model.canvas.height),
      image: PixelImageMeta = {
        id: imageId,
        width: surface.width,
        height: surface.height,
        format: surface.format,
        refCount: 1,
      };
    return { cel, image, surface };
  }

  #cloneDetachedCel(cel: PixelCel, layerId: LayerId, frameId: FrameId): PendingStrokeCel {
    const imageId = makeId("image"),
      surface = this.getSurface(cel.imageId).clone();
    return {
      cel: { ...cel, id: makeId("cel"), layerId, frameId, imageId },
      image: {
        id: imageId,
        width: surface.width,
        height: surface.height,
        format: surface.format,
        refCount: 1,
      },
      surface,
    };
  }

  #celCreationCommand(pending: PendingStrokeCel): EditorCommand {
    return new FunctionalCommand(
      "cel.create",
      "Create Cel",
      pending.surface.getBytes().byteLength,
      (state) => this.#insertCel(state, pending.cel, pending.image, pending.surface),
      (state) => this.#removeCel(state, pending.cel),
    );
  }

  #insertCel(state: DocumentState, cel: PixelCel, image: PixelImageMeta, surface: PixelSurface): void {
    state.model.images[image.id] = image;
    state.surfaces.set(image.id, surface);
    this.#insertExistingCel(state, cel);
  }
  #insertExistingCel(state: DocumentState, cel: PixelCel): void {
    const key = celKey(cel.layerId, cel.frameId);
    if (state.model.celByLayerAndFrame[key] !== undefined)
      throw new Error("Layer and frame already contain a cel.");
    if (state.model.images[cel.imageId] === undefined)
      throw new Error("Cel image is missing.");
    state.model.cels[cel.id] = cel;
    state.model.celByLayerAndFrame[key] = cel.id;
    recountImageReferences(state.model);
  }
  #removeCel(state: DocumentState, cel: PixelCel): void {
    Reflect.deleteProperty(state.model.cels, cel.id);
    Reflect.deleteProperty(state.model.celByLayerAndFrame, celKey(cel.layerId, cel.frameId));
    recountImageReferences(state.model);
    const image = state.model.images[cel.imageId];
    if (image?.refCount === 0) {
      Reflect.deleteProperty(state.model.images, cel.imageId);
      state.surfaces.delete(cel.imageId);
    }
  }

  #capturePotentiallyOrphanedImages(cels: readonly PixelCel[]): CapturedImages {
    const imageIds = [...new Set(cels.map((cel) => cel.imageId))],
      entries = imageIds.map((imageId) => {
        const image = this.model.images[imageId],
          surface = this.#state.surfaces.get(imageId);
        if (image === undefined || surface === undefined) throw new Error("Cel image is missing.");
        return { image, surface };
      });
    return {
      entries,
      memory: entries.reduce((sum, entry) => sum + entry.surface.getBytes().byteLength, 0),
    };
  }
  #restoreCaptured(state: DocumentState, captured: CapturedImages): void {
    for (const { image, surface } of captured.entries) {
      state.model.images[image.id] = image;
      state.surfaces.set(image.id, surface);
    }
  }
  #removeCapturedIfUnreferenced(
    state: DocumentState,
    captured: CapturedImages,
  ): void {
    recountImageReferences(state.model);
    for (const { image } of captured.entries)
      if ((state.model.images[image.id]?.refCount ?? 0) === 0) {
        Reflect.deleteProperty(state.model.images, image.id);
        state.surfaces.delete(image.id);
      }
  }

  #cloneTags(tags: Readonly<Record<TagId, FrameTag>>): Record<TagId, FrameTag> {
    return Object.fromEntries(Object.entries(tags).map(([id, tag]) => [id, { ...tag, color: [...tag.color] as unknown as Rgba }]));
  }
  #tagsAfterFrameDelete(frameId: FrameId, replacement: FrameId): Record<TagId, FrameTag> {
    const result = this.#cloneTags(this.model.tags);
    for (const tag of Object.values(result)) {
      if (tag.fromFrameId === frameId) tag.fromFrameId = replacement;
      if (tag.toFrameId === frameId) tag.toFrameId = replacement;
    }
    return result;
  }
  #afterHistoryChange(): void {
    this.#normalizePaletteAdapter();
    recountImageReferences(this.model);
    if (this.model.frames[this.#activeFrameId] === undefined) {
      const first = this.model.frameOrder[0];
      if (first === undefined) throw new Error("Document has no frame.");
      this.#activeFrameId = first;
    }
    assertDocumentIntegrity(this.model);
  }

  #normalizePaletteAdapter(): void {
    const entries = this.model.palette.colors.map((entry, index) => ({
      ...entry,
      index,
      rgba: [...entry.rgba] as unknown as Rgba,
    }));
    this.model.palette.entries = entries;
    this.model.palette.colors = entries;
    if (this.model.canvas.colorMode === "indexed")
      for (const surface of this.#state.surfaces.values())
        if (surface instanceof IndexedPixelSurface)
          surface.updatePalette(entries.map((entry) => entry.rgba), this.model.palette.transparentIndex ?? 0);
  }
}

function snapshotMemory(snapshot: DocumentSnapshot): number {
  let bytes = 0;
  for (const image of snapshot.images.values()) bytes += image.byteLength;
  for (const tilemap of snapshot.tilemaps?.values() ?? []) bytes += tilemap.byteLength;
  return bytes;
}

function installSnapshot(state: DocumentState, snapshot: DocumentSnapshot): void {
  const replacement = stateFromSnapshot(snapshot);
  Object.assign(state.model, replacement.model);
  if (replacement.model.pluginData === undefined)
    Reflect.deleteProperty(state.model, "pluginData");
  state.surfaces.clear();
  for (const [id, surface] of replacement.surfaces) state.surfaces.set(id, surface);
  state.tilemapSurfaces.clear();
  for (const [id, surface] of replacement.tilemapSurfaces)
    state.tilemapSurfaces.set(id, surface);
}
