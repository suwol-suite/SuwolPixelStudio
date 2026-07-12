import { useEffect, useRef, useState } from "react";
import {
  applyRasterPoints,
  commitFloodFillComputation,
  commitFloatingSelection,
  copyPixels,
  floodFill,
  inclusiveRect,
  movePixels,
  rasterizeEllipse,
  rasterizeLine,
  rasterizeRectangle,
  readCompositePixel,
  getTilemapCel,
  paintTile,
  fillTile,
  readTile,
  stampBrush,
  type BrushPreset,
  type DirtyRegion,
  type FloatingSelection,
  type FloodFillComputation,
  type IntPoint,
  type Rgba,
  type StrokeTransaction,
} from "@suwol/editor-core";
import {
  PixelRenderer,
  canvasLocalToDocument,
  canvasLocalToPixel,
  clientToCanvasLocal,
  drawDeclarativeOverlays,
  drawEditorOverlay,
} from "@suwol/pixel-renderer";
import {
  PLUGIN_LIMITS,
  type OverlayUpdate,
  type PluginToolOperation,
} from "@suwol/plugin-api";
import { PluginToolStrokeBroker } from "@suwol/plugin-host";
import type { BrushPresetSetting } from "@suwol/shared";
import { createLogger } from "@suwol/shared";
import type { Translate } from "../i18n";
import type {
  CanvasStatusStore,
  WorkspaceDocument,
  WorkspaceStore,
} from "../editor/workspace";

interface PixelCanvasProps {
  readonly entry: WorkspaceDocument;
  readonly workspace: WorkspaceStore;
  readonly status: CanvasStatusStore;
  readonly t: Translate;
  readonly pluginOverlays?: readonly OverlayUpdate[];
  readonly brushPreset?: BrushPresetSetting | undefined;
  readonly brushSize?: number;
  readonly brushOpacity?: number;
  readonly onForegroundUsed?: (color: Rgba) => void;
  readonly pluginTool?: Readonly<{ pluginId: string; toolId: string }> | null;
  readonly onPluginToolEvent?: (
    pluginId: string,
    toolId: string,
    event: unknown,
  ) => Promise<readonly PluginToolOperation[]>;
}
interface DragState {
  readonly kind: "shape" | "selection" | "move";
  readonly start: IntPoint;
  current: IntPoint;
  readonly moveSource?: FloatingSelection;
  readonly floatingOrigin?: IntPoint;
}
const logger = createLogger("renderer", import.meta.env.DEV);

interface PluginStrokeState {
  readonly id: string;
  readonly pluginId: string;
  readonly toolId: string;
  readonly broker: PluginToolStrokeBroker;
  readonly generation: number;
  queue: Promise<void>;
  pending: Readonly<{ x: number; y: number; pressure: number }>[];
  frame: number | null;
  ending: boolean;
  lastPoint: IntPoint;
}
const PLUGIN_TOOL_BATCH_MAX = Math.min(128, PLUGIN_LIMITS.toolPixelsPerStroke);

export function PixelCanvas({ entry, workspace, status, t, pluginOverlays = [], brushPreset, brushSize = 1, brushOpacity = 1, onForegroundUsed, pluginTool = null, onPluginToolEvent }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    overlayRef = useRef<HTMLCanvasElement>(null),
    rendererRef = useRef<PixelRenderer | null>(null),
    strokeRef = useRef<StrokeTransaction | null>(null),
    strokeUsesForegroundRef = useRef(false),
    hoverRef = useRef<IntPoint | null>(null),
    panRef = useRef<IntPoint | null>(null),
    dragRef = useRef<DragState | null>(null),
    previewPointsRef = useRef<readonly IntPoint[]>([]),
    previewFloatingRef = useRef<FloatingSelection | null>(null),
    selectionPreviewRef = useRef(entry.view.selection.clone()),
    fillWorkerRef = useRef<Worker | null>(null),
    pluginStrokeRef = useRef<PluginStrokeState | null>(null),
    pluginGenerationRef = useRef(0),
    spaceRef = useRef(false),
    [spacePressed, setSpacePressed] = useState(false),
    [panning, setPanning] = useState(false);

  function activeBrush(): BrushPreset {
    if (brushPreset !== undefined)
      return { ...brushPreset, opacity: brushOpacity };
    const size = Math.min(64, Math.max(1, Math.round(brushSize)));
    return {
      id: "builtin-square",
      name: `${size} px Square`,
      kind: "square",
      width: size,
      height: size,
      opacity: brushOpacity,
      spacing: 1,
      angle: 0,
      flipX: false,
      flipY: false,
      center: { x: Math.floor(size / 2), y: Math.floor(size / 2) },
    };
  }

  function queuePluginEvent(state: PluginStrokeState, input: unknown): void {
    state.queue = state.queue.then(async () => {
      if (
        state.generation !== pluginGenerationRef.current ||
        pluginStrokeRef.current !== state ||
        onPluginToolEvent === undefined
      )
        return;
      const operations = await onPluginToolEvent(
        state.pluginId,
        state.toolId,
        input,
      );
      if (
        state.generation !== pluginGenerationRef.current ||
        pluginStrokeRef.current !== state
      )
        return;
      for (const operation of operations)
        state.broker.append(state.id, operation);
    }).catch(() => {
      if (pluginStrokeRef.current === state) cancelPluginStroke("crash");
    });
  }
  function flushPluginPoints(state: PluginStrokeState): void {
    state.frame = null;
    if (state.pending.length === 0 || state.ending) return;
    const points = state.pending.splice(0, PLUGIN_TOOL_BATCH_MAX);
    queuePluginEvent(state, { type: "pointerMove", strokeId: state.id, points });
    if (state.pending.length > 0)
      state.frame = requestAnimationFrame(() => flushPluginPoints(state));
  }
  function schedulePluginPoints(
    state: PluginStrokeState,
    points: readonly Readonly<{ x: number; y: number; pressure: number }>[],
  ): void {
    for (const point of points) {
      const dx = point.x - state.lastPoint.x,
        dy = point.y - state.lastPoint.y,
        steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
      for (let step = 1; step <= steps; step += 1) {
        if (state.pending.length >= PLUGIN_LIMITS.toolPixelsPerStroke) break;
        state.pending.push({
          x: Math.round(state.lastPoint.x + (dx * step) / steps),
          y: Math.round(state.lastPoint.y + (dy * step) / steps),
          pressure: point.pressure,
        });
      }
      state.lastPoint = { x: Math.round(point.x), y: Math.round(point.y) };
    }
    state.frame ??= requestAnimationFrame(() => flushPluginPoints(state));
  }
  function cancelPluginStroke(reason: "user" | "timeout" | "crash" | "playback" | "deactivated" = "user"): boolean {
    const state = pluginStrokeRef.current;
    if (state === null) return false;
    pluginGenerationRef.current += 1;
    pluginStrokeRef.current = null;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.broker.cancel(state.id);
    if (onPluginToolEvent !== undefined)
      void onPluginToolEvent(state.pluginId, state.toolId, {
        type: "cancel",
        strokeId: state.id,
        reason,
      }).catch(() => undefined);
    return true;
  }

  function activeSelection() {
    return entry.view.selection.bounds === null ? null : entry.view.selection;
  }
  function overlaySelection() {
    return dragRef.current?.kind === "selection"
      ? selectionPreviewRef.current
      : activeSelection();
  }
  function renderOverlay(): void {
    const overlay = overlayRef.current;
    if (overlay === null) return;
    drawEditorOverlay(
      overlay,
      entry.view.viewport,
      entry.session.model.canvas.width,
      entry.session.model.canvas.height,
      {
        hover: hoverRef.current,
        selection: overlaySelection(),
        previewPoints: previewPointsRef.current,
        previewColor: entry.view.foreground,
        floating: previewFloatingRef.current ?? entry.view.floating,
        symmetry: entry.view.symmetry,
        brushHoverPoints:
          hoverRef.current !== null &&
          (entry.view.activeTool === "pencil" || entry.view.activeTool === "eraser")
            ? stampBrush(activeBrush(), hoverRef.current)
            : [],
      },
    );
    drawDeclarativeOverlays(overlay, entry.view.viewport, pluginOverlays.flatMap((update) => update.primitives));
  }
  function refresh(dirty: DirtyRegion | null = null): void {
    rendererRef.current?.update(entry.session, entry.view.viewport, dirty, {
      activeFrameId: entry.view.activeFrameId,
      activeLayerId: entry.view.activeLayerId,
      onionSkin: entry.view.onionSkin,
    });
    renderOverlay();
    const point = hoverRef.current;
    status.set({
      zoom: entry.view.viewport.zoom,
      x: point?.x ?? null,
      y: point?.y ?? null,
      color:
        point === null
          ? null
          : readCompositePixel(entry.session, point.x, point.y),
    });
  }
  function canvasPoint(event: {
    readonly currentTarget: HTMLCanvasElement;
    readonly clientX: number;
    readonly clientY: number;
  }): IntPoint {
    return clientToCanvasLocal(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
  }
  function rawPixelPoint(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): IntPoint {
    const point = canvasLocalToDocument(canvasPoint(event), entry.view.viewport);
    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  }
  function pixelPoint(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): IntPoint | null {
    return canvasLocalToPixel(canvasPoint(event), entry.view.viewport);
  }
  function tilePoint(point: IntPoint): Readonly<{ x: number; y: number }> | null {
    const layer = entry.session.model.layers[entry.view.activeLayerId];
    if (layer?.kind !== "tilemap") return null;
    const tileSet = entry.session.model.tileSets[layer.tileSetId], cel = getTilemapCel(entry.session.model, layer.id, entry.view.activeFrameId);
    if (tileSet === undefined || cel === null) return null;
    return { x: Math.floor((point.x - cel.x) / tileSet.tileWidth), y: Math.floor((point.y - cel.y) / tileSet.tileHeight) };
  }
  function applyTileTool(point: IntPoint): boolean {
    const tile = tilePoint(point);
    if (tile === null) return false;
    try {
      if (entry.view.activeTool === "tileEyedropper") {
        const cell = readTile(entry.session, entry.view.activeLayerId, tile.x, tile.y);
        if (cell?.tileId !== null && cell?.tileId !== undefined) entry.view.selectedTileId = cell.tileId;
        workspace.touch();
      } else if (entry.view.activeTool === "tileFill") {
        if (fillTile(entry.session, entry.view.activeLayerId, tile.x, tile.y, { tileId: entry.view.selectedTileId, ...entry.view.tileTransform })) workspace.invalidateCanvas(entry.id);
      } else if (entry.view.activeTool === "tilePencil" || entry.view.activeTool === "tileEraser") {
        paintTile(entry.session, entry.view.activeLayerId, tile.x, tile.y, { tileId: entry.view.activeTool === "tileEraser" ? null : entry.view.selectedTileId, ...entry.view.tileTransform });
        workspace.invalidateCanvas(entry.id);
      } else if (entry.view.activeTool === "tileSelection") {
        const layer = entry.session.model.layers[entry.view.activeLayerId];
        if (layer?.kind === "tilemap") {
          const tileSet = entry.session.model.tileSets[layer.tileSetId];
          if (tileSet !== undefined) entry.view.selection.setRect({ x: tile.x * tileSet.tileWidth, y: tile.y * tileSet.tileHeight, width: tileSet.tileWidth, height: tileSet.tileHeight }, "replace");
        }
        workspace.touch();
      }
      refresh();
      return true;
    } catch { return false; }
  }
  function updateHover(event: React.PointerEvent<HTMLCanvasElement>): void {
    hoverRef.current = pixelPoint(event);
    renderOverlay();
    const point = hoverRef.current;
    status.set({
      zoom: entry.view.viewport.zoom,
      x: point?.x ?? null,
      y: point?.y ?? null,
      color:
        point === null
          ? null
          : readCompositePixel(entry.session, point.x, point.y),
    });
  }
  function pickColor(point: IntPoint): void {
    const color = readCompositePixel(entry.session, point.x, point.y);
    if (color === null) return;
    entry.view.foreground = color;
    entry.view.recentColors = [
      color,
      ...entry.view.recentColors.filter(
        (recent) => recent.join(",") !== color.join(","),
      ),
    ].slice(0, 12);
    workspace.touch();
  }
  function selectionOperation(event: { shiftKey: boolean; altKey: boolean }) {
    return event.shiftKey && event.altKey
      ? "intersect"
      : event.shiftKey
        ? "add"
        : event.altKey
          ? "subtract"
          : entry.view.selectionOperation;
  }
  function shapePoints(
    start: IntPoint,
    end: IntPoint,
    shiftKey = false,
  ): readonly IntPoint[] {
    const expand = (points: readonly IntPoint[]) =>
      points.flatMap((point) => stampBrush(activeBrush(), point));
    if (entry.view.activeTool === "line")
      return expand(rasterizeLine(start, end, shiftKey));
    const rect = inclusiveRect(start, end, shiftKey);
    if (entry.view.activeTool === "rectangle")
      return expand(rasterizeRectangle(rect, entry.view.rectangleMode));
    if (entry.view.activeTool === "ellipse")
      return expand(rasterizeEllipse(rect, entry.view.ellipseMode));
    return [];
  }
  function commitFloating(): boolean {
    const floating = entry.view.floating;
    if (floating === null) return false;
    const committed = commitFloatingSelection(
      entry.session,
      entry.view.activeLayerId,
      floating,
      t("command.edit.paste"),
    );
    entry.view.floating = null;
    entry.view.selection.clear();
    previewFloatingRef.current = null;
    if (committed) workspace.invalidateCanvas(entry.id);
    else workspace.touch();
    refresh();
    return committed;
  }
  function cancelTransient(): boolean {
    if (cancelPluginStroke()) return true;
    if (fillWorkerRef.current !== null) {
      fillWorkerRef.current.terminate();
      fillWorkerRef.current = null;
      return true;
    }
    if (strokeRef.current !== null) {
      entry.session.cancelStroke(strokeRef.current);
      strokeRef.current = null;
      refresh();
      return true;
    }
    if (dragRef.current !== null) {
      dragRef.current = null;
      previewPointsRef.current = [];
      previewFloatingRef.current = null;
      selectionPreviewRef.current = entry.view.selection.clone();
      renderOverlay();
      return true;
    }
    if (entry.view.floating !== null) {
      entry.view.floating = null;
      entry.view.selection.clear();
      previewFloatingRef.current = null;
      workspace.touch();
      renderOverlay();
      return true;
    }
    return false;
  }
  function cancelDrawingForPan(): void {
    cancelPluginStroke();
    fillWorkerRef.current?.terminate();
    fillWorkerRef.current = null;
    if (strokeRef.current !== null) {
      entry.session.cancelStroke(strokeRef.current);
      strokeRef.current = null;
    }
    dragRef.current = null;
    previewPointsRef.current = [];
    previewFloatingRef.current = null;
    selectionPreviewRef.current = entry.view.selection.clone();
    refresh();
  }

  function beginPluginStroke(
    event: React.PointerEvent<HTMLCanvasElement>,
    point: IntPoint,
  ): boolean {
    if (pluginTool === null || onPluginToolEvent === undefined) return false;
    const layer = entry.session.model.layers[entry.view.activeLayerId];
    if (layer?.kind !== "pixel" || layer.locked || !layer.visible) return true;
    cancelPluginStroke("deactivated");
    const id = crypto.randomUUID(),
      generation = pluginGenerationRef.current + 1,
      broker = new PluginToolStrokeBroker(entry.session, pluginTool.pluginId),
      state: PluginStrokeState = {
        id,
        pluginId: pluginTool.pluginId,
        toolId: pluginTool.toolId,
        broker,
        generation,
        queue: Promise.resolve(),
        pending: [],
        frame: null,
        ending: false,
        lastPoint: point,
      };
    pluginGenerationRef.current = generation;
    pluginStrokeRef.current = state;
    try {
      broker.begin(id, layer.id);
      queuePluginEvent(state, {
        type: "pointerDown",
        strokeId: id,
        position: point,
        pressure: event.pressure > 0 ? event.pressure : 1,
        modifiers: {
          shift: event.shiftKey,
          alt: event.altKey,
          primary: event.button !== 2,
        },
        layerId: layer.id,
        frameId: entry.view.activeFrameId,
      });
      state.pending.push({
        ...point,
        pressure: event.pressure > 0 ? event.pressure : 1,
      });
      state.frame = requestAnimationFrame(() => flushPluginPoints(state));
    } catch {
      cancelPluginStroke("crash");
    }
    return true;
  }

  function finishPluginStroke(): boolean {
    const state = pluginStrokeRef.current;
    if (state === null) return false;
    state.ending = true;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    while (state.pending.length > 0) {
      const points = state.pending.splice(0, PLUGIN_TOOL_BATCH_MAX);
      queuePluginEvent(state, {
        type: "pointerMove",
        strokeId: state.id,
        points,
      });
    }
    queuePluginEvent(state, { type: "pointerUp", strokeId: state.id });
    void state.queue.then(() => {
      if (
        pluginStrokeRef.current !== state ||
        pluginGenerationRef.current !== state.generation
      )
        return;
      pluginStrokeRef.current = null;
      pluginGenerationRef.current += 1;
      try {
        if (state.broker.commit(state.id)) workspace.invalidateCanvas(entry.id);
        else workspace.touch();
        refresh();
      } catch {
        state.broker.cancel(state.id);
      }
    });
    return true;
  }

  useEffect(() => {
    const canvas = canvasRef.current,
      overlay = overlayRef.current;
    if (canvas === null || overlay === null) return;
    const renderer = new PixelRenderer(canvas, (message) => {
      if (message.includes("unavailable") || message.includes("lost"))
        logger.warn(message);
      else logger.info(message);
    });
    if (__SUWOL_E2E__) overlay.dataset.rendererMode = renderer.mode;
    rendererRef.current = renderer;
    const resize = () => {
      renderer.resize(entry.view.viewport);
      if (entry.view.fitPending) {
        entry.view.viewport.fit();
        entry.view.fitPending = false;
      }
      refresh();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    observer.observe(overlay);
    if (canvas.parentElement !== null) observer.observe(canvas.parentElement);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      entry.view.viewport.setZoomAt(
        entry.view.viewport.zoom * (event.deltaY < 0 ? 1.25 : 0.8),
        clientToCanvasLocal(
          { x: event.clientX, y: event.clientY },
          overlay.getBoundingClientRect(),
        ),
      );
      refresh();
    };
    overlay.addEventListener("wheel", wheel, { passive: false });
    resize();
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (event.code === "Space") {
        if (!spaceRef.current) cancelDrawingForPan();
        spaceRef.current = true;
        setSpacePressed(true);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (!cancelTransient()) {
          entry.view.selection.clear();
          workspace.touch();
          renderOverlay();
        }
        event.preventDefault();
      } else if (event.key === "Enter" && entry.view.floating !== null) {
        commitFloating();
        event.preventDefault();
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        (entry.view.activeTool === "move" || entry.view.floating !== null)
      ) {
        const distance = event.shiftKey ? 10 : 1,
          dx =
            event.key === "ArrowLeft"
              ? -distance
              : event.key === "ArrowRight"
                ? distance
                : 0,
          dy =
            event.key === "ArrowUp"
              ? -distance
              : event.key === "ArrowDown"
                ? distance
                : 0;
        if (entry.view.floating !== null) {
          entry.view.floating.x += dx;
          entry.view.floating.y += dy;
          entry.view.selection = entry.view.selection.translated(dx, dy);
          workspace.touch();
          renderOverlay();
        } else if (
          movePixels(
            entry.session,
            entry.view.activeLayerId,
            activeSelection(),
            dx,
            dy,
            t("tool.move"),
            (mx, my) => {
              entry.view.selection = entry.view.selection.translated(mx, my);
            },
          )
        ) {
          workspace.invalidateCanvas(entry.id);
          refresh();
        }
        event.preventDefault();
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") { spaceRef.current = false; setSpacePressed(false); }
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      cancelPluginStroke("deactivated");
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      overlay.removeEventListener("wheel", wheel);
      renderer.dispose();
      rendererRef.current = null;
      fillWorkerRef.current?.terminate();
      fillWorkerRef.current = null;
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [entry]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null && entry.view.fitPending) {
      entry.view.viewport.resize(canvas.clientWidth, canvas.clientHeight);
      entry.view.viewport.fit();
      entry.view.fitPending = false;
    }
    refresh();
  }, [entry.canvasVersion, entry.view.viewport.zoom]);
  useEffect(() => {
    renderOverlay();
  }, [workspace.version]);
  useEffect(
    () => () => {
      cancelPluginStroke("deactivated");
    },
    [
      pluginTool?.pluginId,
      pluginTool?.toolId,
      entry.view.activeLayerId,
      entry.view.activeFrameId,
    ],
  );

  function handlePointerDown(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): void {
    if (entry.view.playback.isPlaying) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHover(event);
    if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
      event.preventDefault();
      cancelDrawingForPan();
      panRef.current = canvasPoint(event);
      setPanning(true);
      return;
    }
    const point = pixelPoint(event);
    if (point === null) return;
    if (beginPluginStroke(event, point)) return;
    if (entry.view.activeTool.startsWith("tile")) {
      applyTileTool(point);
      return;
    }
    if (event.altKey && entry.view.activeTool !== "selectionRect") {
      pickColor(point);
      return;
    }
    if (entry.view.floating !== null && entry.view.activeTool !== "move")
      commitFloating();
    if (entry.view.activeTool === "eyedropper") {
      pickColor(point);
      return;
    }
    if (entry.view.activeTool === "fill") {
      try {
        const color =
            event.button === 2 ? entry.view.background : entry.view.foreground,
          selection = activeSelection(),
          pixels =
            entry.session.model.canvas.width *
            entry.session.model.canvas.height;
        if (pixels > 262_144 && selection === null && entry.session.model.canvas.colorMode === "rgba") {
          fillWorkerRef.current?.terminate();
          const layer = entry.session.model.layers[entry.view.activeLayerId];
          if (layer === undefined) return;
          const bytes = entry.session
              .getActiveSurfaceForRead(entry.view.activeLayerId)
              .getBytes(),
            revision = entry.session.model.revision,
            worker = new Worker(
              new URL("../workers/fill.worker.ts", import.meta.url),
              { type: "module" },
            );
          fillWorkerRef.current = worker;
          worker.onmessage = (
            message: MessageEvent<{
              readonly revision: number;
              readonly result: FloodFillComputation | null;
            }>,
          ) => {
            worker.terminate();
            if (fillWorkerRef.current === worker) fillWorkerRef.current = null;
            if (
              message.data.revision !== entry.session.model.revision ||
              message.data.revision !== revision ||
              message.data.result === null
            )
              return;
            if (
              commitFloodFillComputation(
                entry.session,
                entry.view.activeLayerId,
                message.data.result,
                t("tool.fill"),
              )
            ) {
              workspace.invalidateCanvas(entry.id);
              if (event.button !== 2) onForegroundUsed?.(entry.view.foreground);
              refresh(message.data.result.rect);
            }
          };
          worker.postMessage(
            {
              bytes: bytes.buffer,
              width: entry.session.model.canvas.width,
              height: entry.session.model.canvas.height,
              x: point.x,
              y: point.y,
              color,
              revision,
            },
            [bytes.buffer],
          );
        } else {
          const dirty = floodFill(
            entry.session,
            entry.view.activeLayerId,
            point,
            color,
            selection,
            t("tool.fill"),
          );
          if (dirty !== null) {
            workspace.invalidateCanvas(entry.id);
            if (event.button !== 2) onForegroundUsed?.(entry.view.foreground);
            refresh(dirty);
          }
        }
      } catch {
        return;
      }
      return;
    }
    if (entry.view.activeTool === "selectionRect") {
      dragRef.current = { kind: "selection", start: point, current: point };
      selectionPreviewRef.current = entry.view.selection.clone();
      selectionPreviewRef.current.setRect(
        inclusiveRect(point, point),
        selectionOperation(event),
      );
      renderOverlay();
      return;
    }
    if (
      entry.view.activeTool === "line" ||
      entry.view.activeTool === "rectangle" ||
      entry.view.activeTool === "ellipse"
    ) {
      dragRef.current = { kind: "shape", start: point, current: point };
      previewPointsRef.current = shapePoints(point, point, event.shiftKey);
      renderOverlay();
      return;
    }
    if (entry.view.activeTool === "move") {
      if (entry.view.floating !== null) {
        dragRef.current = {
          kind: "move",
          start: point,
          current: point,
          floatingOrigin: {
            x: entry.view.floating.x,
            y: entry.view.floating.y,
          },
        };
      } else {
        try {
          const source = copyPixels(
            entry.session,
            entry.view.activeLayerId,
            activeSelection(),
          );
          dragRef.current = {
            kind: "move",
            start: point,
            current: point,
            moveSource: source,
          };
          previewFloatingRef.current = {
            ...source,
            pixels: source.pixels.slice(),
          };
        } catch {
          return;
        }
      }
      renderOverlay();
      return;
    }
    const baseColor: Rgba =
      entry.view.activeTool === "eraser"
        ? [0, 0, 0, 0]
        : event.button === 2
          ? entry.view.background
          : entry.view.foreground;
    const color: Rgba = [
      baseColor[0],
      baseColor[1],
      baseColor[2],
      Math.round(baseColor[3] * Math.min(1, Math.max(0, brushOpacity))),
    ];
    try {
      const normalizedPreset = activeBrush();
      const stroke = entry.session.beginStroke(
        entry.view.activeLayerId,
        color,
        entry.view.activeTool === "eraser"
          ? t("tool.eraser")
          : t("tool.pencil"),
        {
          pixelPerfect: entry.view.pixelPerfect,
          symmetry: entry.view.symmetry,
          stampOffsets: stampBrush(normalizedPreset, { x: 0, y: 0 }),
        },
      );
      strokeRef.current = stroke;
      strokeUsesForegroundRef.current =
        entry.view.activeTool === "pencil" && event.button !== 2;
      refresh(stroke.addPoint(point));
    } catch {
      return;
    }
  }
  function handlePointerMove(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): void {
    updateHover(event);
    const screen = canvasPoint(event);
    if (panRef.current === null && spaceRef.current && (event.buttons & 1) !== 0) {
      cancelDrawingForPan();
      panRef.current = screen;
      setPanning(true);
      return;
    }
    if (panRef.current !== null) {
      entry.view.viewport.panBy(
        screen.x - panRef.current.x,
        screen.y - panRef.current.y,
      );
      panRef.current = screen;
      refresh();
      return;
    }
    const raw = rawPixelPoint(event),
      point = pixelPoint(event);
    const pluginStroke = pluginStrokeRef.current;
    if (pluginStroke !== null && !pluginStroke.ending) {
      schedulePluginPoints(pluginStroke, [
        {
          ...raw,
          pressure: event.pressure > 0 ? event.pressure : 1,
        },
      ]);
      return;
    }
    if (point !== null && (entry.view.activeTool === "tilePencil" || entry.view.activeTool === "tileEraser") && event.buttons !== 0) {
      applyTileTool(point);
      return;
    }
    if (point !== null && strokeRef.current !== null) {
      refresh(strokeRef.current.addPoint(point));
      return;
    }
    const drag = dragRef.current;
    if (drag === null) return;
    drag.current = raw;
    if (drag.kind === "shape") {
      previewPointsRef.current = shapePoints(drag.start, raw, event.shiftKey);
    } else if (drag.kind === "selection") {
      selectionPreviewRef.current = entry.view.selection.clone();
      selectionPreviewRef.current.setRect(
        inclusiveRect(drag.start, raw),
        selectionOperation(event),
      );
    } else {
      const dx = raw.x - drag.start.x,
        dy = raw.y - drag.start.y;
      if (entry.view.floating !== null && drag.floatingOrigin !== undefined) {
        entry.view.floating.x = drag.floatingOrigin.x + dx;
        entry.view.floating.y = drag.floatingOrigin.y + dy;
      } else if (drag.moveSource !== undefined)
        previewFloatingRef.current = {
          ...drag.moveSource,
          x: drag.moveSource.x + dx,
          y: drag.moveSource.y + dy,
          pixels: drag.moveSource.pixels,
        };
    }
    renderOverlay();
  }
  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
    panRef.current = null;
    setPanning(false);
    if (finishPluginStroke()) {
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (strokeRef.current !== null) {
      const stroke = strokeRef.current;
      strokeRef.current = null;
      if (entry.session.commitStroke(stroke)) {
        workspace.invalidateCanvas(entry.id);
        if (strokeUsesForegroundRef.current)
          onForegroundUsed?.(entry.view.foreground);
      } else workspace.touch();
      strokeUsesForegroundRef.current = false;
      refresh();
    }
    const drag = dragRef.current;
    if (drag !== null) {
      dragRef.current = null;
      if (drag.kind === "shape") {
        const points = previewPointsRef.current;
        previewPointsRef.current = [];
        try {
          if (
            applyRasterPoints(
              entry.session,
              entry.view.activeLayerId,
              points,
              [
                entry.view.foreground[0],
                entry.view.foreground[1],
                entry.view.foreground[2],
                Math.round(entry.view.foreground[3] * entry.view.brushOpacity),
              ],
              activeSelection(),
              t(`tool.${entry.view.activeTool}`),
            )
          ) {
            workspace.invalidateCanvas(entry.id);
            onForegroundUsed?.(entry.view.foreground);
            refresh();
          }
        } catch {
          renderOverlay();
        }
      } else if (drag.kind === "selection") {
        entry.view.selection = selectionPreviewRef.current.clone();
        workspace.touch();
        renderOverlay();
      } else {
        const dx = drag.current.x - drag.start.x,
          dy = drag.current.y - drag.start.y;
        if (entry.view.floating !== null) {
          entry.view.selection = entry.view.selection.translated(dx, dy);
          workspace.touch();
        } else if (
          movePixels(
            entry.session,
            entry.view.activeLayerId,
            activeSelection(),
            dx,
            dy,
            t("tool.move"),
            (mx, my) => {
              entry.view.selection = entry.view.selection.translated(mx, my);
            },
          )
        ) {
          workspace.invalidateCanvas(entry.id);
          refresh();
        }
        previewFloatingRef.current = null;
        renderOverlay();
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div className={`pixel-canvas-host ${spacePressed || panning ? "pan-ready" : ""} ${panning ? "panning" : ""}`} data-testid="pixel-canvas-host" data-pan-state={panning ? "grabbing" : spacePressed ? "grab" : "idle"}>
      <canvas
        ref={canvasRef}
        className="pixel-canvas"
        aria-hidden="true"
      />
      <canvas
        ref={overlayRef}
        className="pixel-overlay"
        data-testid="pixel-canvas"
        role="application"
        tabIndex={0}
        aria-label={t("canvas.label")}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => {
          cancelTransient();
          finishPointer(event);
        }}
        onPointerLeave={() => {
          hoverRef.current = null;
          renderOverlay();
        }}
      />
      <div className="sr-live" aria-live="polite">
        {entry.view.floating !== null
          ? t("selection.floating")
          : entry.view.selection.bounds !== null
            ? t("selection.active")
            : ""}
      </div>
    </div>
  );
}
