import {
  PLUGIN_LIMITS,
  overlayUpdateSchema,
  pluginExportResultSchema,
  pluginImportResultSchema,
  pluginToolOperationSchema,
  type OverlayPrimitive,
  type OverlayUpdate,
  type PluginExportResult,
  type PluginImportResult,
  type PluginToolOperation,
} from "@suwol/plugin-api";
import {
  IndexedPixelSurface,
  applyRasterPoints,
  intersectRect,
  unionRect,
  type EditorSession,
  type IntPoint,
  type IntRect,
  type LayerId,
} from "@suwol/editor-core";
import { PluginError } from "./errors";

export function validatePluginImportResult(input: unknown): PluginImportResult {
  const parsed = pluginImportResultSchema.safeParse(input);
  if (!parsed.success) throw new PluginError("MESSAGE_INVALID", "Plugin importer returned an invalid document.");
  const document = parsed.data.document, layerIds = new Set(document.layers.map((layer) => layer.id));
  let bytes = 0;
  for (const cel of document.cels) {
    if (!layerIds.has(cel.layerId) || cel.frameIndex >= document.frames.length)
      throw new PluginError("MESSAGE_INVALID", "Plugin importer Cel references an invalid layer or frame.");
    const expected = cel.width * cel.height * (cel.format === "rgba8" ? 4 : 1);
    bytes += cel.pixels.byteLength;
    if (cel.pixels.byteLength !== expected || cel.format !== (document.colorMode === "rgba" ? "rgba8" : "indexed8"))
      throw new PluginError("MESSAGE_INVALID", "Plugin importer Cel format or byte length is invalid.");
  }
  if (bytes > PLUGIN_LIMITS.importerBytes)
    throw new PluginError("MESSAGE_TOO_LARGE", "Plugin importer output exceeds the memory budget.");
  if (document.colorMode === "indexed") {
    if (document.transparentIndex === undefined || document.transparentIndex >= document.palette.length)
      throw new PluginError("MESSAGE_INVALID", "Plugin importer transparent index is invalid.");
    for (const cel of document.cels)
      for (const index of new Uint8Array(cel.pixels))
        if (index >= document.palette.length)
          throw new PluginError("MESSAGE_INVALID", "Plugin importer pixels reference an undefined palette slot.");
  }
  return parsed.data;
}

export function validatePluginExportResult(input: unknown): PluginExportResult {
  const parsed = pluginExportResultSchema.safeParse(input);
  if (!parsed.success) throw new PluginError("MESSAGE_INVALID", "Plugin exporter returned invalid files.");
  return parsed.data;
}

export function validateOverlayUpdate(input: unknown, canvas: Readonly<{ width: number; height: number }>): OverlayUpdate {
  const parsed = overlayUpdateSchema.safeParse(input);
  if (!parsed.success) throw new PluginError("MESSAGE_INVALID", "Plugin overlay update is invalid.");
  const bounds = { x: 0, y: 0, width: canvas.width, height: canvas.height }, primitives = parsed.data.primitives.map((primitive) => clipPrimitive(primitive, bounds)).filter((primitive): primitive is OverlayPrimitive => primitive !== null);
  let pointCount = 0;
  for (const primitive of primitives) if (primitive.kind === "pixelPreview") pointCount += primitive.points.length;
  if (pointCount > PLUGIN_LIMITS.toolPixelsPerStroke) throw new PluginError("MESSAGE_TOO_LARGE", "Plugin overlay point count exceeds the limit.");
  return { ...parsed.data, primitives };
}

interface ActiveToolStroke { readonly id: string; readonly layerId: LayerId; readonly revision: number; readonly startedAt: number; readonly operations: PluginToolOperation[]; pixels: number; }

/** Buffers declarative operations; the document changes only when commit succeeds. */
export class PluginToolStrokeBroker {
  #active: ActiveToolStroke | null = null;
  constructor(readonly session: EditorSession, readonly pluginId: string) {}

  begin(strokeId: string, layerId: LayerId, now = Date.now()): void {
    if (this.#active !== null) throw new PluginError("TRANSACTION_FAILED", "A plugin tool stroke is already active.");
    const layer = this.session.model.layers[layerId];
    if (layer?.kind !== "pixel" || layer.locked || !layer.visible) throw new PluginError("PERMISSION_DENIED", "Plugin tool target is not editable.");
    this.#active = { id: strokeId, layerId, revision: this.session.model.revision, startedAt: now, operations: [], pixels: 0 };
  }

  append(strokeId: string, input: unknown, now = Date.now()): void {
    const active = this.#require(strokeId, now), operation = pluginToolOperationSchema.parse(input), count = operation.points.length;
    if (active.pixels + count > PLUGIN_LIMITS.toolPixelsPerStroke) { this.cancel(strokeId); throw new PluginError("MESSAGE_TOO_LARGE", "Plugin tool stroke exceeds its pixel budget."); }
    active.operations.push(operation); active.pixels += count;
  }

  commit(strokeId: string, now = Date.now()): boolean {
    const active = this.#require(strokeId, now);
    this.#active = null;
    if (this.session.model.revision !== active.revision) throw new PluginError("TRANSACTION_FAILED", "Document changed during plugin tool stroke.");
    let changed = false;
    this.session.runTransaction("Plugin Tool Stroke", () => {
      for (const operation of active.operations) {
        if (operation.type === "pixels") {
          if (this.session.model.canvas.colorMode === "indexed" && operation.paletteIndex !== undefined)
            changed = applyIndexedPoints(this.session, active.layerId, operation.points, operation.paletteIndex) || changed;
          else if (operation.rgba !== undefined)
            changed = applyRasterPoints(this.session, active.layerId, operation.points, operation.rgba, null, "Plugin Tool") || changed;
          else throw new PluginError("MESSAGE_INVALID", "Plugin tool pixel operation has no compatible color.");
        } else {
          if (this.session.model.canvas.colorMode === "indexed")
            changed = applyIndexedPoints(this.session, active.layerId, operation.points, this.session.model.palette.transparentIndex ?? 0) || changed;
          else changed = applyRasterPoints(this.session, active.layerId, operation.points, [0, 0, 0, 0], null, "Plugin Tool Clear") || changed;
        }
      }
    }, { source: "plugin", pluginId: this.pluginId });
    return changed;
  }

  cancel(strokeId?: string): void { if (strokeId === undefined || this.#active?.id === strokeId) this.#active = null; }
  get active(): boolean { return this.#active !== null; }
  #require(strokeId: string, now: number): ActiveToolStroke {
    const active = this.#active;
    if (active?.id !== strokeId) throw new PluginError("TRANSACTION_FAILED", "Plugin tool stroke is not active.");
    if (now - active.startedAt > PLUGIN_LIMITS.transactionTimeoutMs) { this.#active = null; throw new PluginError("REQUEST_TIMEOUT", "Plugin tool stroke timed out."); }
    return active;
  }
}

function applyIndexedPoints(session: EditorSession, layerId: LayerId, points: readonly IntPoint[], index: number): boolean {
  const surface = session.getActiveSurfaceForRead(layerId);
  if (!(surface instanceof IndexedPixelSurface)) throw new PluginError("MESSAGE_INVALID", "Indexed operation targeted an RGBA surface.");
  if (!session.model.palette.entries.some((entry) => entry.index === index)) throw new PluginError("MESSAGE_INVALID", "Plugin tool palette index is undefined.");
  const unique = new Set<number>(); let bounds: IntRect | null = null;
  for (const point of points) { const x = Math.round(point.x), y = Math.round(point.y); if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) continue; const offset = y * surface.width + x; if (unique.has(offset)) continue; unique.add(offset); if (surface.getIndex(x, y) !== index) bounds = unionRect(bounds, { x, y, width: 1, height: 1 }); }
  if (bounds === null) return false;
  const before = surface.readRegion(bounds), after = before.slice();
  for (const offset of unique) { const x = offset % surface.width, y = Math.floor(offset / surface.width); if (x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height) after[(y - bounds.y) * bounds.width + x - bounds.x] = index; }
  session.applyPixelPatch(layerId, bounds, before, after, "Plugin Tool");
  return true;
}

function clipPrimitive(primitive: OverlayPrimitive, bounds: IntRect): OverlayPrimitive | null {
  if (primitive.kind === "rect" || primitive.kind === "imagePreview") {
    const rect = intersectRect(primitive.rect, bounds);
    return rect.width === 0 || rect.height === 0 ? null : { ...primitive, rect };
  }
  if (primitive.kind === "pixelPreview") return { ...primitive, points: primitive.points.filter((point) => point.x >= 0 && point.y >= 0 && point.x < bounds.width && point.y < bounds.height) };
  if (primitive.kind === "text") return primitive.position.x < 0 || primitive.position.y < 0 || primitive.position.x >= bounds.width || primitive.position.y >= bounds.height ? null : primitive;
  return primitive;
}
