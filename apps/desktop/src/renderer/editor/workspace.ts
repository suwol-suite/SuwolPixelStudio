import {
  BitSelectionMask,
  DEFAULT_ONION_SKIN,
  type EditorSession,
  type DocumentId,
  type FloatingSelection,
  type FrameId,
  type CelId,
  type LayerId,
  type Rgba,
  type PlaybackMode,
  type OnionSkinSettings,
  type SelectionOperation,
  type ShapeFillMode,
} from "@suwol/editor-core";
import { Viewport } from "@suwol/pixel-renderer";
import type { FileHandle } from "@suwol/shared";

export type ToolId =
  | "pencil"
  | "eraser"
  | "eyedropper"
  | "fill"
  | "line"
  | "rectangle"
  | "ellipse"
  | "selectionRect"
  | "move"
  | "tilePencil"
  | "tileEraser"
  | "tileEyedropper"
  | "tileFill"
  | "tileSelection"
  | "tileMove";

export interface DocumentViewState {
  viewport: Viewport;
  activeTool: ToolId;
  pluginTool: Readonly<{ pluginId: string; toolId: string }> | null;
  activeLayerId: LayerId;
  foreground: Rgba;
  background: Rgba;
  recentColors: Rgba[];
  selection: BitSelectionMask;
  selectionOperation: SelectionOperation;
  floating: FloatingSelection | null;
  rectangleMode: ShapeFillMode;
  ellipseMode: ShapeFillMode;
  selectedPaletteColorId: string | null;
  foregroundIndex: number;
  pixelPerfect: boolean;
  symmetry: Readonly<{ mode: "off" | "horizontal" | "vertical" | "both"; axisX: number; axisY: number }>;
  expandedGroupIds: Set<LayerId>;
  selectedTileId: number;
  tileTransform: Readonly<{
    rotation: 0 | 1 | 2 | 3;
    flipX: boolean;
    flipY: boolean;
  }>;
  brushPresetId: string | null;
  brushSize: number;
  brushOpacity: number;
  pixelGrid: boolean;
  fitPending: boolean;
  activeFrameId: FrameId;
  playback: {
    isPlaying: boolean;
    mode: PlaybackMode;
    direction: 1 | -1;
    lastTime: number;
    elapsedInFrame: number;
  };
  onionSkin: OnionSkinSettings;
  activeTagId: string | null;
  timeline: {
    zoom: number;
    scrollLeft: number;
    selectedFrames: Set<FrameId>;
    selectionAnchor: FrameId | null;
    selectedCelId: CelId | null;
    selectedCels: Set<CelId>;
    celSelectionAnchor: Readonly<{ layerId: LayerId; frameId: FrameId }> | null;
  };
}

export interface WorkspaceDocument {
  readonly id: DocumentId;
  readonly session: EditorSession;
  readonly view: DocumentViewState;
  handle: FileHandle | null;
  sourceKind: "suwolpixel" | "png" | "aseprite" | "new";
  saving: boolean;
  canvasVersion: number;
  lastSavedAt: number | null;
  recoveryRevision: number | null;
}

type Listener = () => void;

export class WorkspaceStore {
  readonly #documents = new Map<DocumentId, WorkspaceDocument>();
  readonly #order: DocumentId[] = [];
  readonly #listeners = new Set<Listener>();
  #activeId: DocumentId | null = null;
  #clipboard: FloatingSelection | null = null;
  #version = 0;

  get version(): number {
    return this.#version;
  }
  get activeId(): DocumentId | null {
    return this.#activeId;
  }
  get active(): WorkspaceDocument | null {
    return this.#activeId === null
      ? null
      : (this.#documents.get(this.#activeId) ?? null);
  }
  get documents(): readonly WorkspaceDocument[] {
    return this.#order
      .map((id) => this.#documents.get(id))
      .filter((entry): entry is WorkspaceDocument => entry !== undefined);
  }
  get clipboard(): FloatingSelection | null {
    return this.#clipboard === null
      ? null
      : { ...this.#clipboard, pixels: this.#clipboard.pixels.slice() };
  }
  set clipboard(value: FloatingSelection | null) {
    this.#clipboard =
      value === null ? null : { ...value, pixels: value.pixels.slice() };
    this.touch();
  }

  add(
    session: EditorSession,
    sourceKind: WorkspaceDocument["sourceKind"] = "new",
    handle: FileHandle | null = null,
  ): WorkspaceDocument {
    const existing = this.#documents.get(session.model.id);
    if (existing !== undefined) {
      let kept = false;
      for (let index = 0; index < this.#order.length; index += 1) {
        if (this.#order[index] !== existing.id) continue;
        if (!kept) kept = true;
        else {
          this.#order.splice(index, 1);
          index -= 1;
        }
      }
      this.#activeId = existing.id;
      this.touch();
      return existing;
    }
    for (let index = this.#order.length - 1; index >= 0; index -= 1)
      if (this.#order[index] === session.model.id) this.#order.splice(index, 1);
    const firstLayer =
      session.model.layerOrder[session.model.layerOrder.length - 1];
    if (firstLayer === undefined) throw new Error("Document has no layer.");
    const firstFrame = session.model.frameOrder[0];
    if (firstFrame === undefined) throw new Error("Document has no frame.");
    session.setActiveFrame(firstFrame);
    const entry: WorkspaceDocument = {
      id: session.model.id,
      session,
      sourceKind,
      handle,
      saving: false,
      canvasVersion: 0,
      lastSavedAt: null,
      recoveryRevision: null,
      view: {
        viewport: new Viewport(
          session.model.canvas.width,
          session.model.canvas.height,
        ),
        activeTool: "pencil",
        pluginTool: null,
        activeLayerId: firstLayer,
        foreground: [0, 0, 0, 255],
        background: [255, 255, 255, 255],
        recentColors: [],
        selection: new BitSelectionMask(
          session.model.canvas.width,
          session.model.canvas.height,
        ),
        selectionOperation: "replace",
        floating: null,
        rectangleMode: "outline",
        ellipseMode: "outline",
        selectedPaletteColorId: null,
        foregroundIndex: session.model.palette.transparentIndex === 0 ? 1 : 0,
        pixelPerfect: false,
        symmetry: { mode: "off", axisX: session.model.canvas.width / 2 - 0.5, axisY: session.model.canvas.height / 2 - 0.5 },
        expandedGroupIds: new Set(),
        selectedTileId: 0,
        tileTransform: { rotation: 0, flipX: false, flipY: false },
        brushPresetId: null,
        brushSize: 1,
        brushOpacity: 1,
        pixelGrid: true,
        fitPending: true,
        activeFrameId: firstFrame,
        playback: {
          isPlaying: false,
          mode: "loop",
          direction: 1,
          lastTime: 0,
          elapsedInFrame: 0,
        },
        onionSkin: { ...DEFAULT_ONION_SKIN },
        activeTagId: null,
        timeline: {
          zoom: 1,
          scrollLeft: 0,
          selectedFrames: new Set([firstFrame]),
          selectionAnchor: firstFrame,
          selectedCelId: null,
          selectedCels: new Set(),
          celSelectionAnchor: null,
        },
      },
    };
    this.#documents.set(entry.id, entry);
    this.#order.push(entry.id);
    this.#activeId = entry.id;
    this.touch();
    return entry;
  }

  activate(id: DocumentId): boolean {
    if (!this.#documents.has(id)) return false;
    for (const entry of this.#documents.values()) entry.view.playback.isPlaying = false;
    this.#activeId = id;
    this.touch();
    return true;
  }
  reorder(id: DocumentId, targetIndex: number): boolean {
    const current = this.#order.indexOf(id);
    if (current < 0) return false;
    const next = Math.max(0, Math.min(this.#order.length - 1, targetIndex));
    if (current === next) return true;
    this.#order.splice(current, 1);
    this.#order.splice(next, 0, id);
    this.touch();
    return true;
  }
  close(id: DocumentId): boolean {
    const entry = this.#documents.get(id);
    if (entry === undefined || entry.saving || entry.session.transactionActive)
      return false;
    const index = this.#order.indexOf(id);
    this.#documents.delete(id);
    this.#order.splice(index, 1);
    if (this.#activeId === id)
      this.#activeId =
        this.#order[Math.min(index, this.#order.length - 1)] ?? null;
    this.touch();
    return true;
  }
  setHandle(
    id: DocumentId,
    handle: FileHandle,
    sourceKind: WorkspaceDocument["sourceKind"],
  ): void {
    const entry = this.#documents.get(id);
    if (entry !== undefined) {
      entry.handle = handle;
      entry.sourceKind = sourceKind;
      this.touch();
    }
  }
  invalidateCanvas(id: DocumentId): void {
    const entry = this.#documents.get(id);
    if (entry !== undefined) {
      entry.canvasVersion += 1;
      this.touch();
    }
  }
  touch(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export interface CanvasStatusSnapshot {
  readonly zoom: number;
  readonly x: number | null;
  readonly y: number | null;
  readonly color: Rgba | null;
}

export class CanvasStatusStore {
  #snapshot: CanvasStatusSnapshot = { zoom: 1, x: null, y: null, color: null };
  readonly #listeners = new Set<Listener>();
  get snapshot(): CanvasStatusSnapshot {
    return this.#snapshot;
  }
  set(next: CanvasStatusSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export function rgbaToHex(color: Rgba): string {
  return `#${color
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}
export function parseHexColor(value: string, alpha: number): Rgba | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (match?.[1] === undefined) return null;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
    Math.min(255, Math.max(0, Math.round(alpha))),
  ];
}
