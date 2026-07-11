import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CommandRegistry, type CommandDefinition } from "@suwol/command-system";
import {
  BitSelectionMask,
  EditorSession,
  anchorOffset,
  commitFloatingSelection,
  compositeFrame,
  copyPixels,
  deleteSelectedPixels,
  assertDocumentIntegrity,
  celKey,
  hashSnapshot,
  recountImageReferences,
  playbackFrameRange,
  selectionForFloating,
  addDocumentSlice,
  addGroup,
  commitPreparedIndexedConversion,
  convertSessionToRgba,
  flattenDocument,
  flattenGroupLayer,
  mergeLayerDown,
  mergeVisibleLayers,
  makeId,
  mergeDuplicatePaletteEntries,
  moveLayerToParent,
  paletteUsage,
  removeUnusedPaletteEntries,
  reorderSessionPalette,
  remapSessionPalette,
  setLayerBlendMode,
  sortPalette,
  type BlendMode,
  createTileSet,
  addTilemapLayer,
  parsePaletteFile,
  exportPaletteFile,
  createCustomBrushPreset,
  transformMask,
  brushMask,
  packMask,
  IndexedPixelSurface,
  deleteDocumentSlice,
  updateDocumentSlice,
  deleteTileSet,
  createTilemapCel,
  deleteTilemapCel,
  linkTilemapCelToPrevious,
  unlinkTilemapCel,
  deleteLayerTree,
  duplicateLayerTree,
  type LayerId,
  type FrameId,
  type Rgba,
  type IndexedConversionOptions,
} from "@suwol/editor-core";
import type { PluginImportResult } from "@suwol/plugin-api";
import {
  createThumbnailPng,
  decodePng,
  deserializeSuwolPixel,
  encodePng,
  exportPng,
  importPng,
  exportTilemapJson,
  type CompatibilityReport,
  serializeSuwolPixelAsync,
} from "@suwol/file-format";
import { Viewport } from "@suwol/pixel-renderer";
import { PanelRegistry } from "@suwol/ui";
import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_SETTINGS,
  NATIVE_MENU_COMMAND_IDS,
  PANEL_IDS,
  SETTINGS_STORAGE_KEY,
  UI_SCALES,
  createLogger,
  deserializeSettings,
  normalizeSettings,
  resetLayout,
  resolveLanguage,
  serializeSettings,
  parseWorkspaceLayout,
  serializeWorkspaceLayout,
  layoutPanelIds,
  normalizeShortcut,
  parseKeybindingSettings,
  serializeKeybindingSettings,
  uiScaleSchema,
  type AppSettings,
  type AppDiagnostics,
  type FileHandle,
  type LanguageMode,
  type PanelId,
  type RecoverySnapshotInfo,
  type ThemeMode,
  type UiScale,
} from "@suwol/shared";
import { AboutDialog } from "./components/AboutDialog";
import { CloseDocumentDialog } from "./components/CloseDocumentDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CommandPalette } from "./components/CommandPalette";
import { DurationDialog } from "./components/DurationDialog";
import { EditorShell } from "./components/EditorShell";
import { NewDocumentDialog } from "./components/NewDocumentDialog";
import { OnionSkinDialog } from "./components/OnionSkinDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";
import { ExportDialog, type AnimationExportKind } from "./components/ExportDialog";
import { ProgressDialog } from "./components/ProgressDialog";
import { PluginManager } from "./components/PluginManager";
import { TagDialog, type TagDialogResult } from "./components/TagDialog";
import type { AnimationExportJob } from "./workers/animation-export.worker";
import type { AsepriteWorkerResult } from "./workers/aseprite-import.worker";
import {
  ResizeDialog,
  type ResizeDialogResult,
} from "./components/ResizeDialog";
import {
  CanvasStatusStore,
  WorkspaceStore,
  type ToolId,
  type WorkspaceDocument,
} from "./editor/workspace";
import { createTranslator } from "./i18n";
import { PluginRuntimeController } from "./plugins/runtime";
import { AsepriteCompatibilityDialog, BrushPresetManagerDialog, IndexedConversionDialog, KeybindingEditorDialog, LayoutManagerDialog } from "./components/ProfessionalDialogs";

const logger = createLogger("renderer", import.meta.env.DEV),
  toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
function loadInitialSettings(): AppSettings {
  try {
    return deserializeSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function createPanels(settings: AppSettings) {
  const registry = new PanelRegistry<PanelId>(),
    locations: Record<PanelId, "left" | "right" | "bottom"> = {
      tools: "left",
      layers: "right",
      palette: "right",
      properties: "right",
      preview: "right",
      timeline: "bottom",
      brushes: "right",
      tilesets: "right",
      slices: "right",
    };
  for (const id of PANEL_IDS)
    registry.register({
      id,
      titleKey: `panel.${id}`,
      defaultLocation: locations[id],
      defaultVisible: true,
    });
  registry.restoreVisibility(settings.panels);
  return registry;
}

export function App() {
  const [settings, setSettings] = useState(loadInitialSettings),
    settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [panels] = useState(() => createPanels(settings)),
    [commands] = useState(() => new CommandRegistry()),
    [workspace] = useState(() => new WorkspaceStore()),
    [status] = useState(() => new CanvasStatusStore());
  const [pluginController] = useState(
    () => new PluginRuntimeController(commands, workspace),
  );
  const workspaceVersion = useSyncExternalStore(
    (listener) => workspace.subscribe(listener),
    () => workspace.version,
  );
  const pluginVersion = useSyncExternalStore(
    (listener) => pluginController.subscribe(listener),
    () => pluginController.snapshot.version,
  );
  const [paletteOpen, setPaletteOpen] = useState(false),
    [aboutOpen, setAboutOpen] = useState(false),
    [newOpen, setNewOpen] = useState(false),
    [closeId, setCloseId] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [resizeMode, setResizeMode] = useState<"canvas" | "sprite" | null>(null),
    [exportKind, setExportKind] = useState<AnimationExportKind | null>(null),
    [tagDialog, setTagDialog] = useState<"add" | "edit" | null>(null),
    [durationOpen, setDurationOpen] = useState(false),
    [onionSettingsOpen, setOnionSettingsOpen] = useState(false),
    [jobProgress, setJobProgress] = useState<{
      readonly kind: "export" | "resize" | "indexed" | "aseprite";
      readonly completed: number;
      readonly total: number;
    } | null>(null),
    [recoveryItems, setRecoveryItems] = useState<
      readonly RecoverySnapshotInfo[]
    >([]),
    [recoveryOpen, setRecoveryOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "clear-recovery" | "disable-plugins" | "reset-keybindings" | "reset-preferences" | null
  >(null);
  const [indexedConversionOpen, setIndexedConversionOpen] = useState(false),
    [layoutManagerOpen, setLayoutManagerOpen] = useState(false),
    [keybindingEditorOpen, setKeybindingEditorOpen] = useState(false);
  const [brushManagerOpen, setBrushManagerOpen] = useState(false);
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<AppDiagnostics | null>(null);
  const exportWorkerRef = useRef<Worker | null>(null),
    resizeWorkerRef = useRef<Worker | null>(null),
    indexedWorkerRef = useRef<Worker | null>(null),
    asepriteWorkerRef = useRef<Worker | null>(null);
  const language = resolveLanguage(settings.language, navigator.languages),
    t = useMemo(() => createTranslator(language), [language]),
    tRef = useRef(t);
  tRef.current = t;
  const changeTheme = useCallback(
      (theme: ThemeMode) =>
        setSettings((current) => normalizeSettings({ ...current, theme })),
      [],
    ),
    changeScale = useCallback(
      (uiScale: UiScale) =>
        setSettings((current) => normalizeSettings({ ...current, uiScale })),
      [],
    ),
    togglePanel = useCallback(
      (id: PanelId) => {
        if (panels.toggle(id))
          setSettings((current) =>
            normalizeSettings({
              ...current,
              panels: panels.exportVisibility(),
            }),
          );
      },
      [panels],
    ),
    resetWorkspace = useCallback(() => {
      panels.reset();
      setSettings((current) => ({
        ...resetLayout(current),
        panels: panels.exportVisibility(),
      }));
    }, [panels]);

  function editable(entry = workspace.active): boolean {
    if (
      entry === null ||
      entry.session.transactionActive ||
      entry.saving ||
      entry.view.playback.isPlaying ||
      jobProgress !== null
    )
      return false;
    const layer = entry.session.model.layers[entry.view.activeLayerId];
    return layer !== undefined && layer.visible && !layer.locked;
  }
  function animationCommandReady(entry = workspace.active): entry is WorkspaceDocument {
    return (
      entry !== null &&
      !entry.session.transactionActive &&
      !entry.saving &&
      jobProgress === null
    );
  }
  function activeLayer(): LayerId | null {
    return workspace.active?.view.activeLayerId ?? null;
  }
  function replaceViewport(entry: WorkspaceDocument): void {
    entry.view.viewport = new Viewport(
      entry.session.model.canvas.width,
      entry.session.model.canvas.height,
    );
    entry.view.fitPending = true;
  }
  function syncViewport(entry: WorkspaceDocument): void {
    if (
      entry.view.viewport.documentWidth !== entry.session.model.canvas.width ||
      entry.view.viewport.documentHeight !== entry.session.model.canvas.height
    )
      replaceViewport(entry);
  }
  function syncAnimationView(entry: WorkspaceDocument): void {
    const order = entry.session.model.frameOrder,
      active = entry.session.model.frames[entry.view.activeFrameId] === undefined
        ? entry.session.activeFrameId
        : entry.view.activeFrameId;
    entry.view.activeFrameId = active;
    entry.session.setActiveFrame(active);
    entry.view.timeline.selectedFrames = new Set(
      [...entry.view.timeline.selectedFrames].filter(
        (frameId) => entry.session.model.frames[frameId] !== undefined,
      ),
    );
    if (entry.view.timeline.selectedFrames.size === 0)
      entry.view.timeline.selectedFrames.add(active);
    if (
      entry.view.timeline.selectionAnchor === null ||
      entry.session.model.frames[entry.view.timeline.selectionAnchor] === undefined
    )
      entry.view.timeline.selectionAnchor = active;
    if (
      entry.view.activeTagId !== null &&
      entry.session.model.tags[entry.view.activeTagId] === undefined
    )
      entry.view.activeTagId = null;
    entry.view.timeline.selectedCels = new Set(
      [...entry.view.timeline.selectedCels].filter(
        (celId) => entry.session.model.cels[celId] !== undefined,
      ),
    );
    if (
      entry.view.timeline.selectedCelId !== null &&
      entry.session.model.cels[entry.view.timeline.selectedCelId] === undefined
    )
      entry.view.timeline.selectedCelId = null;
    if (!order.includes(active)) throw new Error("Active frame invariant failed.");
  }
  function commitFloating(entry: WorkspaceDocument): void {
    if (entry.view.floating === null) return;
    if (
      commitFloatingSelection(
        entry.session,
        entry.view.activeLayerId,
        entry.view.floating,
        tRef.current("command.edit.paste"),
      )
    )
      workspace.invalidateCanvas(entry.id);
    entry.view.floating = null;
    entry.view.selection.clear();
  }
  function stopPlayback(entry = workspace.active): void {
    if (entry === null) return;
    entry.view.playback.isPlaying = false;
    entry.view.playback.elapsedInFrame = 0;
    entry.view.playback.lastTime = 0;
  }
  function selectFrame(entry: WorkspaceDocument, frameId: FrameId): void {
    stopPlayback(entry);
    commitFloating(entry);
    entry.view.activeFrameId = frameId;
    entry.session.setActiveFrame(frameId);
    entry.view.timeline.selectedFrames = new Set([frameId]);
    entry.view.timeline.selectionAnchor = frameId;
    entry.view.timeline.selectedCelId = entry.session.getActiveCel(
      entry.view.activeLayerId,
    )?.id ?? null;
    workspace.invalidateCanvas(entry.id);
  }
  function frameAtOffset(entry: WorkspaceDocument, offset: number): FrameId {
    const order = entry.session.model.frameOrder,
      index = order.indexOf(entry.view.activeFrameId),
      target = Math.min(order.length - 1, Math.max(0, index + offset));
    return order[target] ?? entry.view.activeFrameId;
  }
  function setForeground(color: Rgba): void {
    const entry = workspace.active;
    if (entry === null) return;
    entry.view.foreground = color;
    const recent = [
      color,
      ...settingsRef.current.recentColors.filter(
        (item) => item.join(",") !== color.join(","),
      ),
    ].slice(0, 12);
    setSettings((current) =>
      normalizeSettings({ ...current, recentColors: recent }),
    );
    workspace.touch();
  }

  async function saveEntry(
    entry = workspace.active,
    forceDialog = false,
  ): Promise<boolean> {
    const api = window.suwolDesktop;
    if (entry === null || api === undefined || entry.session.transactionActive)
      return false;
    commitFloating(entry);
    let handle: FileHandle | null = entry.handle;
    if (forceDialog || handle === null || entry.sourceKind !== "suwolpixel") {
      const result = await api.files.showSaveDialog({
        kind: "suwolpixel",
        suggestedName: `${entry.session.model.name}.suwolpixel`,
      });
      if (result.canceled) return false;
      handle = result.handle;
    }
    const snapshot = entry.session.snapshot(),
      revision = snapshot.model.revision;
    entry.saving = true;
    workspace.touch();
    try {
      const bytes = await serializeSuwolPixelAsync(
        snapshot,
        desktopInfo?.version ?? "0.6.0-rc.4",
      );
      await api.files.writeAtomic(handle, toArrayBuffer(bytes));
      entry.session.markSaved(revision);
      entry.lastSavedAt = Date.now();
      entry.recoveryRevision = null;
      workspace.setHandle(entry.id, handle, "suwolpixel");
      await api.recovery.delete(entry.id);
      return true;
    } catch {
      setMessage(tRef.current("error.fileSave"));
      return false;
    } finally {
      entry.saving = false;
      workspace.touch();
    }
  }
  async function openDocument(): Promise<void> {
    const api = window.suwolDesktop;
    if (api === undefined) return;
    try {
      const result = await api.files.showOpenDialog({ kind: "document" });
      if (result.canceled) return;
      const buffer = await api.files.read(result.handle),
        bytes = new Uint8Array(buffer),
        lower = result.handle.displayName.toLocaleLowerCase("en-US");
      if (lower.endsWith(".ase") || lower.endsWith(".aseprite")) {
        startAsepriteImport(
          result.handle.displayName.replace(/\.(?:ase|aseprite)$/i, ""),
          buffer,
        );
        return;
      }
      const entry = lower.endsWith(".png")
        ? workspace.add(
            importPng(
              result.handle.displayName.replace(/\.png$/i, ""),
              bytes,
              `${tRef.current("panel.layers")} 1`,
            ),
            "png",
            result.handle,
          )
        : workspace.add(
              EditorSession.fromSnapshot(deserializeSuwolPixel(bytes)),
              "suwolpixel",
              result.handle,
            );
      entry.lastSavedAt = Date.now();
    } catch {
      setMessage(tRef.current("error.fileOpen"));
    }
  }
  async function exportActivePng(): Promise<void> {
    const entry = workspace.active,
      api = window.suwolDesktop;
    if (entry === null || api === undefined) return;
    commitFloating(entry);
    try {
      const result = await api.files.showSaveDialog({
        kind: "png",
        suggestedName: `${entry.session.model.name}.png`,
      });
      if (result.canceled) return;
      await api.files.writeAtomic(
        result.handle,
        toArrayBuffer(exportPng(entry.session.snapshot())),
      );
    } catch {
      setMessage(tRef.current("error.fileSave"));
    }
  }
  async function importLayoutSettings(): Promise<void> {
    const api = window.suwolDesktop;
    if (api === undefined) return;
    try {
      const result = await api.files.showOpenDialog({ kind: "layout" });
      if (result.canceled) return;
      const layout = parseWorkspaceLayout(JSON.parse(new TextDecoder().decode(await api.files.read(result.handle))) as unknown);
      setSettings((current) => normalizeSettings({ ...current, layouts: [...current.layouts.filter((item) => item.id !== layout.id), layout], activeLayoutId: layout.id }));
    } catch { setMessage(tRef.current("error.fileOpen")); }
  }
  async function exportLayoutSettings(layoutId: string): Promise<void> {
    const api = window.suwolDesktop, layout = settingsRef.current.layouts.find((item) => item.id === layoutId);
    if (api === undefined || layout === undefined) return;
    try { const result = await api.files.showSaveDialog({ kind: "layout", suggestedName: `${layout.name}.suwollayout` }); if (!result.canceled) await api.files.writeAtomic(result.handle, toArrayBuffer(new TextEncoder().encode(serializeWorkspaceLayout(layout)))); }
    catch { setMessage(tRef.current("error.fileSave")); }
  }
  async function importKeybindingSettings(): Promise<void> {
    const api = window.suwolDesktop; if (api === undefined) return;
    try { const result = await api.files.showOpenDialog({ kind: "keybindings" }); if (result.canceled) return; const value = parseKeybindingSettings(JSON.parse(new TextDecoder().decode(await api.files.read(result.handle))) as unknown); setSettings((current) => normalizeSettings({ ...current, keybindings: value })); }
    catch { setMessage(tRef.current("error.fileOpen")); }
  }
  async function exportKeybindingSettings(): Promise<void> {
    const api = window.suwolDesktop; if (api === undefined) return;
    try { const result = await api.files.showSaveDialog({ kind: "keybindings", suggestedName: "suwol-keybindings.suwolkeys" }); if (!result.canceled) await api.files.writeAtomic(result.handle, toArrayBuffer(new TextEncoder().encode(serializeKeybindingSettings(settingsRef.current.keybindings)))); }
    catch { setMessage(tRef.current("error.fileSave")); }
  }
  async function importAsepriteDocument(): Promise<void> {
    const api = window.suwolDesktop; if (api === undefined) return;
    try {
      const selected = await api.files.showOpenDialog({ kind: "aseprite" });
      if (selected.canceled) return;
      startAsepriteImport(
        selected.handle.displayName.replace(/\.(?:ase|aseprite)$/i, ""),
        await api.files.read(selected.handle),
      );
    } catch { setMessage(tRef.current("error.fileOpen")); }
  }
  function startAsepriteImport(name: string, bytes: ArrayBuffer): void {
    const jobId = crypto.randomUUID(),
      worker = new Worker(new URL("./workers/aseprite-import.worker.ts", import.meta.url), { type: "module" });
    asepriteWorkerRef.current?.terminate();
    asepriteWorkerRef.current = worker;
    setJobProgress({ kind: "aseprite", completed: 0, total: 1 });
    const fail = () => {
      worker.terminate();
      if (asepriteWorkerRef.current === worker) asepriteWorkerRef.current = null;
      setJobProgress(null);
      setMessage(tRef.current("error.fileOpen"));
    };
    worker.onerror = fail;
    worker.onmessage = (event: MessageEvent<Readonly<{
      type: "progress" | "result" | "error";
      jobId: string;
      completed?: number;
      total?: number;
      result?: AsepriteWorkerResult;
    }>>) => {
      if (event.data.jobId !== jobId) return;
      if (event.data.type === "progress") {
        setJobProgress({ kind: "aseprite", completed: event.data.completed ?? 0, total: event.data.total ?? 1 });
        return;
      }
      if (event.data.type !== "result" || event.data.result === undefined) { fail(); return; }
      const result = event.data.result;
      worker.terminate();
      if (asepriteWorkerRef.current === worker) asepriteWorkerRef.current = null;
      setJobProgress(null);
      workspace.add(EditorSession.fromSnapshot({
        model: result.model,
        images: new Map(result.images.map(([id, buffer]) => [id, new Uint8Array(buffer)])),
        tilemaps: new Map(result.tilemaps.map(([id, buffer]) => [id, new Uint32Array(buffer)])),
      }), "aseprite", null);
      setCompatibilityReport(result.report);
    };
    worker.postMessage({ type: "start", jobId, name, bytes }, [bytes]);
  }
  async function importPalette(): Promise<void> {
    const entry = workspace.active, api = window.suwolDesktop; if (entry === null || api === undefined) return;
    try { const result = await api.files.showOpenDialog({ kind: "palette" }); if (result.canceled) return; const lower = result.handle.displayName.toLowerCase(), format = lower.endsWith(".gpl") ? "gpl" : lower.endsWith(".pal") ? "jasc" : lower.endsWith(".json") ? "suwol-json" : "hex", imported = parsePaletteFile(new Uint8Array(await api.files.read(result.handle)), format); if (entry.session.model.canvas.colorMode === "rgba") entry.session.setPalette(imported); else { const previous = entry.session.model.palette.entries, mapping = new Map(previous.map((old) => [old.index, imported.find((item) => item.rgba.join(",") === old.rgba.join(","))?.index ?? 0])); remapSessionPalette(entry.session, imported, mapping, Math.min(entry.session.model.palette.transparentIndex ?? 0, imported.length - 1), "Import Palette"); } workspace.invalidateCanvas(entry.id); }
    catch { setMessage(tRef.current("error.fileOpen")); }
  }
  async function exportPalette(): Promise<void> {
    const entry = workspace.active, api = window.suwolDesktop; if (entry === null || api === undefined || entry.session.model.palette.entries.length === 0) return;
    try { const result = await api.files.showSaveDialog({ kind: "palette", suggestedName: `${entry.session.model.name}-palette.json` }); if (!result.canceled) await api.files.writeAtomic(result.handle, toArrayBuffer(exportPaletteFile(entry.session.model.palette.entries, "suwol-json"))); }
    catch { setMessage(tRef.current("error.fileSave")); }
  }
  async function importTileSet(): Promise<void> {
    const entry = workspace.active, api = window.suwolDesktop; if (entry === null || api === undefined) return;
    try { const result = await api.files.showOpenDialog({ kind: "tileset" }); if (result.canceled) return; const decoded = decodePng(new Uint8Array(await api.files.read(result.handle))), tileWidth = Math.min(16, decoded.width), tileHeight = Math.min(16, decoded.height), columns = Math.max(1, Math.floor(decoded.width / tileWidth)), rows = Math.max(1, Math.floor(decoded.height / tileHeight)); if (entry.session.model.canvas.colorMode === "indexed") throw new Error("RGBA tile set must be imported after converting or remapping to the indexed palette."); createTileSet(entry.session, { name: result.handle.displayName.replace(/\.png$/i, ""), tileWidth, tileHeight, columns, tileCount: columns * rows, atlasWidth: decoded.width, atlasHeight: decoded.height, atlasBytes: decoded.rgba }); workspace.invalidateCanvas(entry.id); }
    catch { setMessage(tRef.current("error.fileOpen")); }
  }
  async function exportActiveTilemap(): Promise<void> {
    const entry = workspace.active, api = window.suwolDesktop; if (entry === null || api === undefined) return;
    try { const result = await api.files.showSaveDialog({ kind: "tilemap-json", suggestedName: `${entry.session.model.name}-tilemap.json` }); if (!result.canceled) await api.files.writeAtomic(result.handle, toArrayBuffer(exportTilemapJson(entry.session.snapshot()))); }
    catch { setMessage(tRef.current("error.fileSave")); }
  }
  async function runPluginImporter(pluginId: string, importerId: string, title: string, extensions: readonly string[]): Promise<void> {
    const api = window.suwolDesktop;
    if (api === undefined) return;
    const selected = await api.files.showOpenDialog({ kind: "plugin-import", title, extensions });
    if (selected.canceled) return;
    const bytes = await api.files.read(selected.handle), result = await pluginController.runImporter(pluginId, importerId, {
      name: selected.handle.displayName,
      mediaType: null,
      bytes,
    });
    workspace.add(sessionFromPluginImport(result), "new", null);
    if (result.warnings.length > 0) setMessage(result.warnings.join(" "));
  }
  async function runPluginExporter(pluginId: string, exporterId: string): Promise<void> {
    const entry = workspace.active, api = window.suwolDesktop;
    if (entry === null || api === undefined) throw new Error("An active document is required.");
    const destination = await api.files.showExportDirectory();
    if (destination.canceled) return;
    const model = entry.session.model, result = await pluginController.runExporter(pluginId, exporterId, {
      document: {
        id: model.id, name: model.name, revision: model.revision,
        canvas: { ...model.canvas }, frameCount: model.frameOrder.length,
        layers: model.layerOrder.map((id) => ({ id, name: model.layers[id]?.name ?? "", kind: model.layers[id]?.kind ?? "missing" })),
      },
    });
    await api.files.writeExportBatch(destination.handle, result.files.map((file) => ({ relativePath: file.relativePath, data: file.data })));
  }
  function selectPluginTool(pluginId: string, toolId: string): Promise<void> {
    const entry = workspace.active;
    if (entry === null) throw new Error("An active document is required.");
    const layer = entry.session.model.layers[entry.view.activeLayerId];
    if (layer?.kind !== "pixel") throw new Error("Plugin tools require an active Pixel Layer.");
    entry.view.pluginTool = { pluginId, toolId };
    workspace.touch();
    return Promise.resolve();
  }
  async function runPluginToolEvent(pluginId: string, toolId: string, event: unknown) {
    return await pluginController.runToolEvent(pluginId, toolId, event);
  }
  function transformBrushPresetSetting(id: string, transform: "rotate" | "flipX" | "flipY"): void {
    setSettings((current) => normalizeSettings({ ...current, brushPresets: current.brushPresets.map((preset) => {
      if (preset.id !== id) return preset;
      const normalized = preset, source = brushMask(normalized), changed = transformMask(source, preset.width, preset.height, transform === "rotate" ? 90 : 0, transform === "flipX", transform === "flipY");
      return { ...preset, width: changed.width, height: changed.height, angle: 0, flipX: false, flipY: false, center: { x: Math.floor(changed.width / 2), y: Math.floor(changed.height / 2) }, mask: packMask(changed.mask) };
    }) }));
  }
  function requestClose(id: string): void {
    const entry = workspace.documents.find((item) => item.id === id);
    if (entry === undefined) return;
    if (workspace.activeId === id && jobProgress !== null) cancelBackgroundJob();
    if (entry.session.isDirty) setCloseId(id);
    else {
      workspace.close(id);
      void window.suwolDesktop?.recovery.delete(id);
    }
  }
  function setTool(tool: ToolId): void {
    const entry = workspace.active;
    if (entry !== null) {
      entry.view.activeTool = tool;
      entry.view.pluginTool = null;
      workspace.touch();
    }
  }

  async function copyActive(): Promise<boolean> {
    const entry = workspace.active,
      api = window.suwolDesktop;
    if (entry === null || api === undefined) return false;
    try {
      const payload = copyPixels(
        entry.session,
        entry.view.activeLayerId,
        entry.view.selection.bounds === null ? null : entry.view.selection,
      );
      workspace.clipboard = payload;
      const rgbaPixels = payload.format === "indexed8"
        ? (() => {
            const output = new Uint8Array(payload.sourceWidth * payload.sourceHeight * 4);
            for (let index = 0; index < payload.pixels.length; index += 1) {
              const paletteIndex = payload.pixels[index] ?? 0;
              if (paletteIndex === (payload.transparentIndex ?? 0)) continue;
              output.set(payload.palette?.[paletteIndex] ?? [0, 0, 0, 0], index * 4);
            }
            return output;
          })()
        : payload.pixels;
      const png = encodePng(
        payload.sourceWidth,
        payload.sourceHeight,
        rgbaPixels,
      );
      await api.clipboard
        .writePng({
          width: payload.sourceWidth,
          height: payload.sourceHeight,
          png: toArrayBuffer(png),
        })
        .catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }
  async function cutActive(): Promise<void> {
    const entry = workspace.active;
    if (entry === null || !editable(entry) || !(await copyActive())) return;
    let selection = entry.view.selection;
    if (selection.bounds === null) {
      selection = new BitSelectionMask(
        entry.session.model.canvas.width,
        entry.session.model.canvas.height,
      );
      selection.setRect(
        {
          x: 0,
          y: 0,
          width: entry.session.model.canvas.width,
          height: entry.session.model.canvas.height,
        },
        "replace",
      );
    }
    if (
      deleteSelectedPixels(
        entry.session,
        entry.view.activeLayerId,
        selection,
        tRef.current("command.edit.cut"),
      )
    )
      workspace.invalidateCanvas(entry.id);
  }
  async function pasteActive(): Promise<void> {
    const entry = workspace.active,
      api = window.suwolDesktop;
    if (entry === null || api === undefined || !editable(entry)) return;
    commitFloating(entry);
    let floating = workspace.clipboard;
    if (floating === null) {
      const png = await api.clipboard.readPng();
      if (png === null) return;
      const decoded = decodePng(new Uint8Array(png));
      floating = {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        pixels: decoded.rgba,
        x: Math.floor((entry.session.model.canvas.width - decoded.width) / 2),
        y: Math.floor((entry.session.model.canvas.height - decoded.height) / 2),
        source: "clipboard",
      };
    }
    entry.view.floating = { ...floating, pixels: floating.pixels.slice() };
    entry.view.selection = selectionForFloating(
      entry.view.floating,
      entry.session.model.canvas.width,
      entry.session.model.canvas.height,
    );
    entry.view.activeTool = "move";
    workspace.touch();
  }
  function deleteActive(): void {
    const entry = workspace.active;
    if (entry?.view.selection.bounds == null) return;
    if (
      deleteSelectedPixels(
        entry.session,
        entry.view.activeLayerId,
        entry.view.selection,
        tRef.current("command.edit.delete"),
      )
    )
      workspace.invalidateCanvas(entry.id);
  }
  function cropActive(): void {
    const entry = workspace.active;
    if (entry === null) return;
    const bounds = entry.view.selection.bounds;
    if (bounds === null) return;
    entry.session.cropToRect(bounds);
    entry.view.selection = new BitSelectionMask(bounds.width, bounds.height);
    entry.view.selection.setRect(
      { x: 0, y: 0, width: bounds.width, height: bounds.height },
      "replace",
    );
    syncViewport(entry);
    workspace.invalidateCanvas(entry.id);
  }
  function applyResize(result: ResizeDialogResult): void {
    const entry = workspace.active,
      mode = resizeMode;
    if (entry === null || mode === null) return;
    const imageCount = Object.keys(entry.session.model.images).length,
      totalPixels = result.width * result.height * Math.max(1, imageCount);
    if (entry.session.model.canvas.colorMode === "rgba" && (totalPixels >= 262_144 || (imageCount > 1 && totalPixels >= 131_072))) {
      startResizeWorker(entry, mode, result);
      return;
    }
    try {
      if (mode === "canvas") {
        const offset = anchorOffset(
            result.anchor,
            entry.session.model.canvas.width,
            entry.session.model.canvas.height,
            result.width,
            result.height,
          ),
          fill =
            result.fill === "foreground"
              ? entry.view.foreground
              : result.fill === "background"
                ? entry.view.background
                : ([0, 0, 0, 0] as const);
        entry.session.resizeCanvas(
          result.width,
          result.height,
          result.anchor,
          fill,
        );
        entry.view.selection = entry.view.selection.translated(
          offset.x,
          offset.y,
          result.width,
          result.height,
        );
      } else {
        entry.session.resizeSprite(result.width, result.height);
        entry.view.selection = entry.view.selection.resized(
          result.width,
          result.height,
        );
      }
      entry.view.floating = null;
      syncViewport(entry);
      workspace.invalidateCanvas(entry.id);
      setResizeMode(null);
    } catch {
      setMessage(tRef.current("error.resize"));
    }
  }

  function startResizeWorker(
    entry: WorkspaceDocument,
    mode: "canvas" | "sprite",
    result: ResizeDialogResult,
  ): void {
    const snapshot = entry.session.snapshot(),
      revision = snapshot.model.revision,
      jobId = crypto.randomUUID(),
      fill =
        result.fill === "foreground"
          ? entry.view.foreground
          : result.fill === "background"
            ? entry.view.background
            : ([0, 0, 0, 0] as const),
      images = [...snapshot.images].map(([imageId, bytes]) => {
        const data = toArrayBuffer(bytes);
        return [imageId, data] as const;
      }),
      worker = new Worker(new URL("./workers/resize.worker.ts", import.meta.url), {
        type: "module",
      });
    resizeWorkerRef.current?.terminate();
    resizeWorkerRef.current = worker;
    setResizeMode(null);
    setJobProgress({ kind: "resize", completed: 0, total: images.length });
    worker.onerror = () => {
      if (resizeWorkerRef.current === worker) resizeWorkerRef.current = null;
      worker.terminate();
      setJobProgress(null);
      setMessage(tRef.current("error.resize"));
    };
    worker.onmessage = (
      event: MessageEvent<
        | { readonly type: "progress"; readonly jobId: string; readonly completed: number; readonly total: number }
        | {
            readonly type: "result";
            readonly jobId: string;
            readonly revision: number;
            readonly width: number;
            readonly height: number;
            readonly images: readonly { readonly imageId: string; readonly data: ArrayBuffer }[];
          }
        | { readonly type: "error"; readonly jobId: string }
      >,
    ) => {
      if (event.data.jobId !== jobId) return;
      if (event.data.type === "progress") {
        setJobProgress({ kind: "resize", completed: event.data.completed, total: event.data.total });
        return;
      }
      worker.terminate();
      if (resizeWorkerRef.current === worker) resizeWorkerRef.current = null;
      setJobProgress(null);
      if (event.data.type === "error") {
        setMessage(tRef.current("error.resize"));
        return;
      }
      const target = workspace.documents.find((document) => document.id === entry.id);
      if (target?.session.model.revision !== event.data.revision) return;
      try {
        const oldWidth = target.session.model.canvas.width,
          oldHeight = target.session.model.canvas.height,
          prepared = new Map(event.data.images.map((image) => [image.imageId, new Uint8Array(image.data)]));
        target.session.applyPreparedResize(
          event.data.width,
          event.data.height,
          prepared,
          mode === "canvas" ? "sprite.canvasResize" : "sprite.spriteResize",
        );
        if (mode === "canvas") {
          const offset = anchorOffset(
            result.anchor,
            oldWidth,
            oldHeight,
            result.width,
            result.height,
          );
          target.view.selection = target.view.selection.translated(
            offset.x,
            offset.y,
            result.width,
            result.height,
          );
        } else target.view.selection = target.view.selection.resized(result.width, result.height);
        target.view.floating = null;
        syncViewport(target);
        workspace.invalidateCanvas(target.id);
      } catch {
        setMessage(tRef.current("error.resize"));
      }
    };
    worker.postMessage(
      {
        type: "start",
        jobId,
        revision,
        sourceWidth: snapshot.model.canvas.width,
        sourceHeight: snapshot.model.canvas.height,
        width: result.width,
        height: result.height,
        images,
        job:
          mode === "canvas"
            ? { kind: "canvas", anchor: result.anchor, fill }
            : { kind: "sprite" },
      },
      images.map(([, data]) => data),
    );
  }

  async function startAnimationExport(job: AnimationExportJob): Promise<void> {
    const entry = workspace.active,
      api = window.suwolDesktop;
    if (entry === null || api === undefined || jobProgress !== null) return;
    stopPlayback(entry);
    commitFloating(entry);
    const destination = await api.files.showExportDirectory();
    if (destination.canceled) return;
    const snapshot = entry.session.snapshot(),
      totalBytes = [...snapshot.images.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    if (totalBytes > 512 * 1024 * 1024) {
      setMessage(tRef.current("export.failed"));
      return;
    }
    const jobId = crypto.randomUUID(),
      images = [...snapshot.images].map(([imageId, bytes]) => [imageId, toArrayBuffer(bytes)] as const),
      worker = new Worker(new URL("./workers/animation-export.worker.ts", import.meta.url), {
        type: "module",
      });
    exportWorkerRef.current?.terminate();
    exportWorkerRef.current = worker;
    setExportKind(null);
    setJobProgress({ kind: "export", completed: 0, total: 3 });
    const fail = () => {
      worker.terminate();
      if (exportWorkerRef.current === worker) exportWorkerRef.current = null;
      setJobProgress(null);
      setMessage(tRef.current("export.failed"));
    };
    worker.onerror = fail;
    worker.onmessage = (
      event: MessageEvent<
        | { readonly type: "progress"; readonly jobId: string; readonly completed: number; readonly total: number }
        | {
            readonly type: "result";
            readonly jobId: string;
            readonly entries: readonly { readonly relativePath: string; readonly data: ArrayBuffer }[];
          }
        | { readonly type: "error"; readonly jobId: string }
      >,
    ) => {
      if (event.data.jobId !== jobId) return;
      if (event.data.type === "progress") {
        setJobProgress({ kind: "export", completed: event.data.completed, total: event.data.total });
        return;
      }
      if (event.data.type === "error") {
        fail();
        return;
      }
      void api.files
        .writeExportBatch(destination.handle, event.data.entries)
        .then(() => {
          worker.terminate();
          if (exportWorkerRef.current === worker) exportWorkerRef.current = null;
          setJobProgress(null);
        })
        .catch(fail);
    };
    const tilemaps: readonly (readonly [string, ArrayBuffer])[] = snapshot.tilemaps === undefined
      ? []
      : [...snapshot.tilemaps].map(([id, cells]) => {
          const copy = cells.slice();
          return [id, copy.buffer] as const;
        });
    worker.postMessage(
      {
        type: "start",
        jobId,
        revision: snapshot.model.revision,
        snapshot: { model: snapshot.model, images, tilemaps },
        job,
      },
      [...images.map(([, data]) => data), ...tilemaps.map(([, data]) => data)],
    );
  }

  function startIndexedConversion(entry: WorkspaceDocument, options: IndexedConversionOptions): void {
    if (jobProgress !== null || entry.session.model.canvas.colorMode !== "rgba") return;
    const snapshot = entry.session.snapshot(), jobId = crypto.randomUUID(), revision = snapshot.model.revision,
      images = [...snapshot.images].map(([id, bytes]) => [id, toArrayBuffer(bytes)] as const),
      worker = new Worker(new URL("./workers/indexed-conversion.worker.ts", import.meta.url), { type: "module" });
    indexedWorkerRef.current?.terminate(); indexedWorkerRef.current = worker;
    setIndexedConversionOpen(false); setJobProgress({ kind: "indexed", completed: 0, total: 2 });
    const fail = () => { worker.terminate(); if (indexedWorkerRef.current === worker) indexedWorkerRef.current = null; setJobProgress(null); setMessage(tRef.current("error.command")); };
    worker.onerror = fail;
    worker.onmessage = (event: MessageEvent<
      | Readonly<{ type: "progress"; jobId: string; completed: number; total: number }>
      | Readonly<{ type: "error"; jobId: string }>
      | Readonly<{ type: "result"; jobId: string; revision: number; palette: readonly Rgba[]; transparentIndex: number; images: readonly (readonly [string, ArrayBuffer])[] }>
    >) => {
      if (event.data.jobId !== jobId) return;
      if (event.data.type === "progress") { setJobProgress({ kind: "indexed", completed: event.data.completed, total: event.data.total }); return; }
      if (event.data.type === "error") { fail(); return; }
      try {
        if (entry.session.model.revision !== event.data.revision || entry.session.model.revision !== revision) throw new Error("Document changed during conversion.");
        commitPreparedIndexedConversion(entry.session, { palette: event.data.palette, transparentIndex: event.data.transparentIndex, images: event.data.images.map(([id, buffer]) => [id, new Uint8Array(buffer)] as const) }, options.maxColors);
        entry.view.foregroundIndex = entry.session.model.palette.transparentIndex === 0 ? 1 : 0;
        workspace.invalidateCanvas(entry.id);
        worker.terminate(); if (indexedWorkerRef.current === worker) indexedWorkerRef.current = null; setJobProgress(null);
      } catch { fail(); }
    };
    worker.postMessage({ type: "start", jobId, revision, options, images }, images.map(([, buffer]) => buffer));
  }

  function cancelBackgroundJob(): void {
    exportWorkerRef.current?.terminate();
    exportWorkerRef.current = null;
    resizeWorkerRef.current?.terminate();
    resizeWorkerRef.current = null;
    indexedWorkerRef.current?.terminate();
    indexedWorkerRef.current = null;
    asepriteWorkerRef.current?.terminate();
    asepriteWorkerRef.current = null;
    setJobProgress(null);
  }

  async function refreshRecovery(): Promise<void> {
    try {
      const items = (await window.suwolDesktop?.recovery.list()) ?? [];
      setRecoveryItems(items);
      setRecoveryOpen(items.length > 0);
    } catch {
      logger.warn("Recovery scan failed.");
    }
  }
  async function recover(item: RecoverySnapshotInfo): Promise<void> {
    const api = window.suwolDesktop;
    if (api === undefined || item.corrupt) return;
    try {
      const snapshot = deserializeSuwolPixel(
          new Uint8Array(await api.recovery.read(item.documentId)),
        ),
        session = EditorSession.fromSnapshot(snapshot);
      session.markRecovered();
      const entry = workspace.add(session, "new", null);
      entry.lastSavedAt = item.lastSavedTimestamp;
      await api.recovery.delete(item.documentId);
      const remaining = recoveryItems.filter(
        (value) => value.documentId !== item.documentId,
      );
      setRecoveryItems(remaining);
      setRecoveryOpen(remaining.length > 0);
    } catch {
      setMessage(tRef.current("error.recoveryOpen"));
    }
  }
  async function deleteRecovery(item: RecoverySnapshotInfo): Promise<void> {
    await window.suwolDesktop?.recovery.delete(item.documentId);
    const remaining = recoveryItems.filter(
      (value) => value.documentId !== item.documentId,
    );
    setRecoveryItems(remaining);
    setRecoveryOpen(remaining.length > 0);
  }
  async function deleteAllRecovery(): Promise<void> {
    await window.suwolDesktop?.recovery.deleteAll();
    setRecoveryItems([]);
    setRecoveryOpen(false);
  }

  useEffect(() => {
    const binding = (id: keyof typeof DEFAULT_KEYBINDINGS) => [
        DEFAULT_KEYBINDINGS[id],
      ],
      toolDefinitions = (
        [
          "pencil",
          "eraser",
          "eyedropper",
          "fill",
          "line",
          "rectangle",
          "ellipse",
          "selectionRect",
          "move",
          "tilePencil",
          "tileEraser",
          "tileEyedropper",
          "tileFill",
          "tileSelection",
          "tileMove",
        ] as const
      ).map((tool): CommandDefinition => ({
        id: `tool.${tool}`,
        titleKey: `command.tool.${tool}`,
        category: "category.tool",
        ...(!tool.startsWith("tile") ? { defaultKeybindings: binding(`tool.${tool}` as keyof typeof DEFAULT_KEYBINDINGS) } : {}),
        canExecute: () => {
          const entry = workspace.active, layer = entry?.session.model.layers[entry.view.activeLayerId];
          return tool.startsWith("tile")
            ? entry !== null && layer?.kind === "tilemap" && !entry.view.playback.isPlaying
            : tool === "eyedropper" ? entry !== null : editable();
        },
        isChecked: () => workspace.active?.view.activeTool === tool,
        execute: () => setTool(tool),
      }));
    const definitions: readonly CommandDefinition[] = [
      {
        id: "file.new",
        titleKey: "command.file.new",
        category: "category.file",
        defaultKeybindings: binding("file.new"),
        canExecute: () => true,
        execute: () => setNewOpen(true),
      },
      {
        id: "file.open",
        titleKey: "command.file.open",
        category: "category.file",
        defaultKeybindings: binding("file.open"),
        canExecute: () => true,
        execute: openDocument,
      },
      {
        id: "file.save",
        titleKey: "command.file.save",
        category: "category.file",
        defaultKeybindings: binding("file.save"),
        canExecute: () => animationCommandReady(),
        execute: async () => {
          await saveEntry();
        },
      },
      {
        id: "file.saveAs",
        titleKey: "command.file.saveAs",
        category: "category.file",
        defaultKeybindings: binding("file.saveAs"),
        canExecute: () => animationCommandReady(),
        execute: async () => {
          await saveEntry(workspace.active, true);
        },
      },
      {
        id: "file.exportPng",
        titleKey: "command.file.exportPng",
        category: "category.file",
        canExecute: () => animationCommandReady(),
        execute: exportActivePng,
      },
      ...(
        [
          ["file.exportPngSequence", "png-sequence"],
          ["file.exportSpriteSheet", "sprite-sheet"],
          ["file.exportGif", "gif"],
          ["file.exportApng", "apng"],
        ] as const
      ).map(
        ([id, kind]): CommandDefinition => ({
          id,
          titleKey: `command.${id}`,
          category: "category.file",
          canExecute: () => animationCommandReady(),
          execute: () => setExportKind(kind),
        }),
      ),
      {
        id: "file.close",
        titleKey: "command.file.close",
        category: "category.file",
        defaultKeybindings: binding("file.close"),
        canExecute: () => animationCommandReady(),
        execute: () => {
          if (workspace.active !== null) requestClose(workspace.active.id);
        },
      },
      {
        id: "edit.undo",
        titleKey: "command.edit.undo",
        category: "category.edit",
        defaultKeybindings: binding("edit.undo"),
        canExecute: () => workspace.active?.session.history.canUndo ?? false,
        execute: () => {
          const entry = workspace.active;
          if (entry?.session.undo() === true) {
            syncAnimationView(entry);
            replaceViewport(entry);
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "edit.redo",
        titleKey: "command.edit.redo",
        category: "category.edit",
        defaultKeybindings: binding("edit.redo"),
        canExecute: () => workspace.active?.session.history.canRedo ?? false,
        execute: () => {
          const entry = workspace.active;
          if (entry?.session.redo() === true) {
            syncAnimationView(entry);
            replaceViewport(entry);
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "edit.copy",
        titleKey: "command.edit.copy",
        category: "category.edit",
        defaultKeybindings: binding("edit.copy"),
        canExecute: () => animationCommandReady(),
        execute: copyActive,
      },
      {
        id: "edit.cut",
        titleKey: "command.edit.cut",
        category: "category.edit",
        defaultKeybindings: binding("edit.cut"),
        canExecute: () => editable(),
        execute: cutActive,
      },
      {
        id: "edit.paste",
        titleKey: "command.edit.paste",
        category: "category.edit",
        defaultKeybindings: binding("edit.paste"),
        canExecute: () => editable(),
        execute: pasteActive,
      },
      {
        id: "edit.delete",
        titleKey: "command.edit.delete",
        category: "category.edit",
        defaultKeybindings: binding("edit.delete"),
        canExecute: () =>
          editable() && workspace.active?.view.selection.bounds !== null,
        execute: deleteActive,
      },
      {
        id: "select.all",
        titleKey: "command.select.all",
        category: "category.select",
        defaultKeybindings: binding("select.all"),
        canExecute: () => workspace.active !== null,
        execute: () => {
          const entry = workspace.active;
          if (entry !== null) {
            entry.view.selection.setRect(
              {
                x: 0,
                y: 0,
                width: entry.session.model.canvas.width,
                height: entry.session.model.canvas.height,
              },
              "replace",
            );
            workspace.touch();
          }
        },
      },
      {
        id: "select.none",
        titleKey: "command.select.none",
        category: "category.select",
        defaultKeybindings: binding("select.none"),
        canExecute: () => workspace.active?.view.selection.bounds !== null,
        execute: () => {
          const entry = workspace.active;
          if (entry !== null) {
            entry.view.selection.clear();
            entry.view.floating = null;
            workspace.touch();
          }
        },
      },
      {
        id: "sprite.cropToSelection",
        titleKey: "command.sprite.cropToSelection",
        category: "category.sprite",
        canExecute: () =>
          animationCommandReady(workspace.active) &&
          workspace.active.view.selection.bounds !== null,
        execute: cropActive,
      },
      {
        id: "sprite.canvasResize",
        titleKey: "command.sprite.canvasResize",
        category: "category.sprite",
        canExecute: () => animationCommandReady(),
        execute: () => setResizeMode("canvas"),
      },
      {
        id: "sprite.spriteResize",
        titleKey: "command.sprite.spriteResize",
        category: "category.sprite",
        canExecute: () => animationCommandReady(),
        execute: () => setResizeMode("sprite"),
      },
      {
        id: "frame.add",
        titleKey: "command.frame.add",
        category: "category.frame",
        defaultKeybindings: binding("frame.add"),
        canExecute: () => animationCommandReady(),
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          stopPlayback(entry);
          const frameId = entry.session.addFrame(entry.view.activeFrameId, "empty");
          selectFrame(entry, frameId);
        },
      },
      {
        id: "frame.duplicate",
        titleKey: "command.frame.duplicate",
        category: "category.frame",
        defaultKeybindings: binding("frame.duplicate"),
        canExecute: () => animationCommandReady(),
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          stopPlayback(entry);
          const selected = entry.view.timeline.selectedFrames.size > 0
              ? [...entry.view.timeline.selectedFrames]
              : [entry.view.activeFrameId],
            copies = entry.session.duplicateFrames(selected, "independent"),
            activeCopy = copies.at(-1);
          if (activeCopy !== undefined) {
            selectFrame(entry, activeCopy);
            entry.view.timeline.selectedFrames = new Set(copies);
          }
        },
      },
      {
        id: "frame.duplicateLinked",
        titleKey: "command.frame.duplicateLinked",
        category: "category.frame",
        defaultKeybindings: binding("frame.duplicateLinked"),
        canExecute: () => animationCommandReady(),
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          stopPlayback(entry);
          const selected = entry.view.timeline.selectedFrames.size > 0
              ? [...entry.view.timeline.selectedFrames]
              : [entry.view.activeFrameId],
            copies = entry.session.duplicateFrames(selected, "linked"),
            activeCopy = copies.at(-1);
          if (activeCopy !== undefined) {
            selectFrame(entry, activeCopy);
            entry.view.timeline.selectedFrames = new Set(copies);
          }
        },
      },
      {
        id: "frame.delete",
        titleKey: "command.frame.delete",
        category: "category.frame",
        defaultKeybindings: binding("frame.delete"),
        canExecute: () =>
          animationCommandReady(workspace.active) &&
          workspace.active.session.model.frameOrder.length >
            Math.max(1, workspace.active.view.timeline.selectedFrames.size),
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          stopPlayback(entry);
          const selected = entry.view.timeline.selectedFrames.size > 0
            ? [...entry.view.timeline.selectedFrames]
            : [entry.view.activeFrameId];
          selectFrame(entry, entry.session.deleteFrames(selected));
        },
      },
      ...(
        [
          ["frame.moveLeft", -1],
          ["frame.moveRight", 1],
        ] as const
      ).map(
        ([id, offset]): CommandDefinition => ({
          id,
          titleKey: `command.${id}`,
          category: "category.frame",
          canExecute: () => animationCommandReady(),
          execute: () => {
            const entry = workspace.active;
            if (entry === null) return;
            stopPlayback(entry);
            const index = entry.session.model.frameOrder.indexOf(entry.view.activeFrameId);
            entry.session.moveFrame(entry.view.activeFrameId, index + offset);
            workspace.touch();
          },
        }),
      ),
      ...(
        [
          ["frame.first", "first"],
          ["frame.previous", "previous"],
          ["frame.next", "next"],
          ["frame.last", "last"],
        ] as const
      ).map(
        ([id, direction]): CommandDefinition => ({
          id,
          titleKey: `command.${id}`,
          category: "category.frame",
          ...(id in DEFAULT_KEYBINDINGS
            ? { defaultKeybindings: binding(id as keyof typeof DEFAULT_KEYBINDINGS) }
            : {}),
          canExecute: () =>
            workspace.active !== null &&
            !workspace.active.session.transactionActive,
          execute: () => {
            const entry = workspace.active;
            if (entry === null) return;
            const order = entry.session.model.frameOrder,
              frameId =
                direction === "first"
                  ? order[0]
                  : direction === "last"
                    ? order.at(-1)
                    : frameAtOffset(entry, direction === "previous" ? -1 : 1);
            if (frameId !== undefined) selectFrame(entry, frameId);
          },
        }),
      ),
      {
        id: "frame.setDuration",
        titleKey: "command.frame.setDuration",
        category: "category.frame",
        canExecute: () => animationCommandReady(),
        execute: () => setDurationOpen(true),
      },
      {
        id: "cel.create",
        titleKey: "command.cel.create",
        category: "category.frame",
        canExecute: () =>
          animationCommandReady(workspace.active) &&
          workspace.active.session.getAnyCel(workspace.active.view.activeLayerId) === null,
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          if (entry.session.model.layers[entry.view.activeLayerId]?.kind === "tilemap") createTilemapCel(entry.session, entry.view.activeLayerId);
          else entry.session.createCel(entry.view.activeLayerId);
          workspace.invalidateCanvas(entry.id);
        },
      },
      {
        id: "cel.delete",
        titleKey: "command.cel.delete",
        category: "category.frame",
        canExecute: () =>
          animationCommandReady(workspace.active) &&
          workspace.active.session.getAnyCel(workspace.active.view.activeLayerId) !== null,
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          const deleted = entry.session.model.layers[entry.view.activeLayerId]?.kind === "tilemap"
            ? deleteTilemapCel(entry.session, entry.view.activeLayerId)
            : entry.session.deleteCel(entry.view.activeLayerId);
          if (deleted) workspace.invalidateCanvas(entry.id);
        },
      },
      {
        id: "cel.duplicate",
        titleKey: "command.cel.duplicate",
        category: "category.frame",
        canExecute: () => animationCommandReady(workspace.active) && workspace.active.session.getAnyCel(workspace.active.view.activeLayerId) !== null,
        execute: () => void commands.execute("frame.duplicate"),
      },
      {
        id: "cel.linkToPrevious",
        titleKey: "command.cel.linkToPrevious",
        category: "category.frame",
        canExecute: () => {
          const entry = workspace.active;
          if (!animationCommandReady(entry)) return false;
          if (entry.session.getAnyCel(entry.view.activeLayerId) !== null) return false;
          const index = entry.session.model.frameOrder.indexOf(entry.view.activeFrameId),
            previous = entry.session.model.frameOrder[index - 1];
          return previous !== undefined && entry.session.getAnyCel(entry.view.activeLayerId, previous) !== null;
        },
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          if (entry.session.model.layers[entry.view.activeLayerId]?.kind === "tilemap") linkTilemapCelToPrevious(entry.session, entry.view.activeLayerId);
          else entry.session.linkCelToPrevious(entry.view.activeLayerId);
          workspace.invalidateCanvas(entry.id);
        },
      },
      {
        id: "cel.unlink",
        titleKey: "command.cel.unlink",
        category: "category.frame",
        canExecute: () => {
          const entry = workspace.active,
            cel = entry?.session.getAnyCel(entry.view.activeLayerId);
          if (!animationCommandReady(entry) || cel === null || cel === undefined) return false;
          return cel.kind === "tilemap"
            ? Object.values(entry.session.model.cels).filter((item) => item.kind === "tilemap" && item.tilemapImageId === cel.tilemapImageId).length > 1
            : Object.values(entry.session.model.cels).filter((item) => item.kind === "pixel" && item.imageId === cel.imageId).length > 1;
        },
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          const unlinked = entry.session.model.layers[entry.view.activeLayerId]?.kind === "tilemap"
            ? unlinkTilemapCel(entry.session, entry.view.activeLayerId)
            : entry.session.unlinkCel(entry.view.activeLayerId);
          if (unlinked) workspace.invalidateCanvas(entry.id);
        },
      },
      {
        id: "animation.playPause",
        titleKey: "command.animation.playPause",
        category: "category.frame",
        defaultKeybindings: binding("animation.playPause"),
        canExecute: () => animationCommandReady(),
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          commitFloating(entry);
          const playback = entry.view.playback;
          playback.isPlaying = !playback.isPlaying;
          playback.lastTime = performance.now();
          if (playback.isPlaying) {
            const range = playbackFrameRange(entry.session.model, entry.view.activeTagId);
            if (!range.includes(entry.view.activeFrameId) && range[0] !== undefined)
              selectFrame(entry, range[0]);
            playback.isPlaying = true;
            playback.lastTime = performance.now();
          }
          workspace.touch();
        },
      },
      {
        id: "animation.stop",
        titleKey: "command.animation.stop",
        category: "category.frame",
        defaultKeybindings: binding("animation.stop"),
        canExecute: () => workspace.active !== null && !workspace.active.session.transactionActive,
        execute: () => {
          stopPlayback();
          workspace.touch();
        },
      },
      ...(
        [
          ["animation.setLoop", "loop"],
          ["animation.setOnce", "once"],
          ["animation.setPingPong", "pingpong"],
        ] as const
      ).map(
        ([id, mode]): CommandDefinition => ({
          id,
          titleKey: `command.${id}`,
          category: "category.frame",
          canExecute: () => workspace.active !== null,
          isChecked: () => workspace.active?.view.playback.mode === mode,
          execute: () => {
            const entry = workspace.active;
            if (entry !== null) {
              entry.view.playback.mode = mode;
              workspace.touch();
            }
          },
        }),
      ),
      {
        id: "animation.toggleOnionSkin",
        titleKey: "command.animation.toggleOnionSkin",
        category: "category.frame",
        defaultKeybindings: binding("animation.toggleOnionSkin"),
        canExecute: () => animationCommandReady(),
        isChecked: () => workspace.active?.view.onionSkin.enabled ?? false,
        execute: () => {
          const entry = workspace.active;
          if (entry !== null) {
            entry.view.onionSkin.enabled = !entry.view.onionSkin.enabled;
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "animation.onionSkinSettings",
        titleKey: "command.animation.onionSkinSettings",
        category: "category.frame",
        canExecute: () => animationCommandReady(),
        execute: () => setOnionSettingsOpen(true),
      },
      {
        id: "tag.add",
        titleKey: "command.tag.add",
        category: "category.frame",
        defaultKeybindings: binding("tag.add"),
        canExecute: () => animationCommandReady(),
        execute: () => setTagDialog("add"),
      },
      {
        id: "tag.edit",
        titleKey: "command.tag.edit",
        category: "category.frame",
        canExecute: () => animationCommandReady(workspace.active) && workspace.active.view.activeTagId != null,
        execute: () => setTagDialog("edit"),
      },
      {
        id: "tag.delete",
        titleKey: "command.tag.delete",
        category: "category.frame",
        canExecute: () => animationCommandReady(workspace.active) && workspace.active.view.activeTagId != null,
        execute: () => {
          const entry = workspace.active,
            id = entry?.view.activeTagId;
          if (entry !== null && id !== null && id !== undefined) {
            entry.session.deleteTag(id);
            entry.view.activeTagId = null;
            workspace.touch();
          }
        },
      },
      ...(
        [
          ["timeline.zoomIn", 1.25],
          ["timeline.zoomOut", 0.8],
        ] as const
      ).map(
        ([id, factor]): CommandDefinition => ({
          id,
          titleKey: `command.${id}`,
          category: "category.frame",
          canExecute: () => workspace.active !== null,
          execute: () => {
            const entry = workspace.active;
            if (entry !== null) {
              entry.view.timeline.zoom = Math.min(3, Math.max(0.5, entry.view.timeline.zoom * factor));
              workspace.touch();
            }
          },
        }),
      ),
      {
        id: "view.commandPalette",
        titleKey: "command.view.commandPalette",
        category: "category.view",
        defaultKeybindings: binding("view.commandPalette"),
        canExecute: () => true,
        execute: () => setPaletteOpen(true),
      },
      {
        id: "view.setThemeSystem",
        titleKey: "command.view.setThemeSystem",
        category: "category.view",
        canExecute: () => true,
        isChecked: () => settingsRef.current.theme === "system",
        execute: () => changeTheme("system"),
      },
      {
        id: "view.setThemeDark",
        titleKey: "command.view.setThemeDark",
        category: "category.view",
        canExecute: () => true,
        isChecked: () => settingsRef.current.theme === "dark",
        execute: () => changeTheme("dark"),
      },
      {
        id: "view.setThemeLight",
        titleKey: "command.view.setThemeLight",
        category: "category.view",
        canExecute: () => true,
        isChecked: () => settingsRef.current.theme === "light",
        execute: () => changeTheme("light"),
      },
      {
        id: "view.setUiScale",
        titleKey: "command.view.setUiScale",
        category: "category.view",
        canExecute: () => true,
        execute: (value) => {
          const parsed = uiScaleSchema.safeParse(value);
          if (parsed.success) changeScale(parsed.data);
          else {
            const index = UI_SCALES.indexOf(settingsRef.current.uiScale);
            changeScale(UI_SCALES[(index + 1) % UI_SCALES.length] ?? 1);
          }
        },
      },
      {
        id: "view.resetLayout",
        titleKey: "command.view.resetLayout",
        category: "category.view",
        canExecute: () => true,
        execute: resetWorkspace,
      },
      ...(["zoomIn", "zoomOut", "zoom100", "zoomFit"] as const).map(
        (action): CommandDefinition => ({
          id: `view.${action}`,
          titleKey: `command.view.${action}`,
          category: "category.view",
          ...(action === "zoomFit"
            ? {}
            : {
                defaultKeybindings: binding(
                  action === "zoomIn"
                    ? "view.zoomIn"
                    : action === "zoomOut"
                      ? "view.zoomOut"
                      : "view.zoom100",
                ),
              }),
          canExecute: () => workspace.active !== null,
          execute: () => {
            const viewport = workspace.active?.view.viewport;
            if (viewport === undefined) return;
            if (action === "zoomIn") viewport.zoomIn();
            else if (action === "zoomOut") viewport.zoomOut();
            else if (action === "zoom100") viewport.zoom100();
            else viewport.fit();
            workspace.touch();
          },
        }),
      ),
      {
        id: "window.toggleTools",
        titleKey: "command.window.toggleTools",
        category: "category.window",
        canExecute: () => true,
        isChecked: () => panels.isVisible("tools"),
        execute: () => togglePanel("tools"),
      },
      {
        id: "window.toggleLayers",
        titleKey: "command.window.toggleLayers",
        category: "category.window",
        canExecute: () => true,
        isChecked: () => panels.isVisible("layers"),
        execute: () => togglePanel("layers"),
      },
      {
        id: "window.toggleTimeline",
        titleKey: "command.window.toggleTimeline",
        category: "category.window",
        canExecute: () => true,
        isChecked: () => panels.isVisible("timeline"),
        execute: () => togglePanel("timeline"),
      },
      ...toolDefinitions,
      {
        id: "layer.add",
        titleKey: "command.layer.add",
        category: "category.layer",
        canExecute: () => workspace.active !== null,
        execute: () => {
          const entry = workspace.active;
          if (entry !== null) {
            entry.view.activeLayerId = entry.session.addLayer(
              `${tRef.current("panel.layers")} ${entry.session.model.layerOrder.length + 1}`,
            );
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "layer.delete",
        titleKey: "command.layer.delete",
        category: "category.layer",
        canExecute: () =>
          workspace.active !== null &&
          workspace.active.session.model.layerOrder.length > 1,
        execute: () => {
          const entry = workspace.active,
            id = activeLayer();
          if (entry !== null && id !== null) {
            const index = entry.session.model.layerOrder.indexOf(id);
            deleteLayerTree(entry.session, id);
            entry.view.activeLayerId =
              entry.session.model.layerOrder[Math.max(0, index - 1)] ??
              entry.session.model.layerOrder[0] ??
              "";
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "layer.duplicate",
        titleKey: "command.layer.duplicate",
        category: "category.layer",
        canExecute: () => workspace.active !== null,
        execute: () => {
          const entry = workspace.active,
            id = activeLayer();
          if (entry !== null && id !== null) {
            const layer = entry.session.model.layers[id];
            if (layer !== undefined)
              entry.view.activeLayerId = duplicateLayerTree(
                entry.session,
                id,
                `${layer.name} ${tRef.current("layer.copySuffix")}`,
              );
            workspace.invalidateCanvas(entry.id);
          }
        },
      },
      {
        id: "palette.addCurrent",
        titleKey: "command.palette.addCurrent",
        category: "category.palette",
        canExecute: () =>
          workspace.active !== null &&
          workspace.active.session.model.palette.colors.length < 256,
        execute: () => {
          const entry = workspace.active;
          if (entry !== null) {
            entry.view.selectedPaletteColorId = entry.session.addPaletteColor(
              entry.view.foreground,
            );
            workspace.touch();
          }
        },
      },
      {
        id: "palette.delete",
        titleKey: "command.palette.delete",
        category: "category.palette",
        canExecute: () => workspace.active?.view.selectedPaletteColorId != null,
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          const id = entry.view.selectedPaletteColorId;
          if (id === null) return;
          entry.session.deletePaletteColor(id);
          entry.view.selectedPaletteColorId = null;
          workspace.touch();
        },
      },
      {
        id: "palette.moveUp",
        titleKey: "command.palette.moveUp",
        category: "category.palette",
        canExecute: () => workspace.active?.view.selectedPaletteColorId != null,
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          const id = entry.view.selectedPaletteColorId;
          if (id === null) return;
          const index = entry.session.model.palette.colors.findIndex(
            (color) => color.id === id,
          );
          entry.session.movePaletteColor(id, index - 1);
          workspace.touch();
        },
      },
      {
        id: "palette.moveDown",
        titleKey: "command.palette.moveDown",
        category: "category.palette",
        canExecute: () => workspace.active?.view.selectedPaletteColorId != null,
        execute: () => {
          const entry = workspace.active;
          if (entry === null) return;
          const id = entry.view.selectedPaletteColorId;
          if (id === null) return;
          const index = entry.session.model.palette.colors.findIndex(
            (color) => color.id === id,
          );
          entry.session.movePaletteColor(id, index + 1);
          workspace.touch();
        },
      },
      {
        id: "sprite.convertToIndexed",
        titleKey: "command.sprite.convertToIndexed",
        category: "category.sprite",
        canExecute: () => workspace.active?.session.model.canvas.colorMode === "rgba" && editable(),
        execute: () => setIndexedConversionOpen(true),
      },
      {
        id: "sprite.convertToRgba",
        titleKey: "command.sprite.convertToRgba",
        category: "category.sprite",
        canExecute: () => workspace.active?.session.model.canvas.colorMode === "indexed" && editable(),
        execute: () => { const entry = workspace.active; if (entry !== null) { convertSessionToRgba(entry.session); workspace.invalidateCanvas(entry.id); } },
      },
      ...(["hue", "saturation", "value", "luminance", "usage"] as const).map((sort): CommandDefinition => ({
        id: `palette.sort${sort[0]?.toUpperCase()}${sort.slice(1)}`,
        titleKey: `command.palette.sort${sort[0]?.toUpperCase()}${sort.slice(1)}`,
        category: "category.palette",
        canExecute: () => (workspace.active?.session.model.palette.entries.length ?? 0) > 1,
        execute: () => { const entry = workspace.active; if (entry === null) return; const session = entry.session, usage = session.model.canvas.colorMode === "indexed" ? paletteUsage([...session.snapshot().images.values()]) : new Map<number, number>(), order = sortPalette(session.model.palette.entries, sort, usage).map((item) => item.id); if (session.model.canvas.colorMode === "indexed") reorderSessionPalette(session, order); else session.setPalette(order.map((id) => session.model.palette.entries.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => item !== undefined)); workspace.invalidateCanvas(entry.id); },
      })),
      {
        id: "palette.mergeDuplicates", titleKey: "command.palette.mergeDuplicates", category: "category.palette", canExecute: () => workspace.active?.session.model.canvas.colorMode === "indexed",
        execute: () => { const entry = workspace.active; if (entry === null) return; const result = mergeDuplicatePaletteEntries(entry.session.model.palette.entries), transparent = result.mapping.get(entry.session.model.palette.transparentIndex ?? 0) ?? 0; remapSessionPalette(entry.session, result.entries, result.mapping, transparent, "Merge Duplicate Palette Slots"); workspace.invalidateCanvas(entry.id); },
      },
      {
        id: "palette.removeUnused", titleKey: "command.palette.removeUnused", category: "category.palette", canExecute: () => workspace.active?.session.model.canvas.colorMode === "indexed",
        execute: () => { const entry = workspace.active; if (entry === null) return; const used = new Set<number>(); for (const bytes of entry.session.snapshot().images.values()) for (const index of bytes) used.add(index); const result = removeUnusedPaletteEntries(entry.session.model.palette.entries, used, entry.session.model.palette.transparentIndex), transparent = result.mapping.get(entry.session.model.palette.transparentIndex ?? 0) ?? 0; remapSessionPalette(entry.session, result.entries, result.mapping, transparent, "Remove Unused Palette Slots"); workspace.invalidateCanvas(entry.id); },
      },
      { id: "palette.compact", titleKey: "command.palette.compact", category: "category.palette", canExecute: () => commands.canExecute("palette.removeUnused"), execute: () => commands.execute("palette.removeUnused") },
      { id: "palette.import", titleKey: "command.palette.import", category: "category.palette", canExecute: () => workspace.active !== null, execute: importPalette },
      { id: "palette.export", titleKey: "command.palette.export", category: "category.palette", canExecute: () => (workspace.active?.session.model.palette.entries.length ?? 0) > 0, execute: exportPalette },
      {
        id: "layer.addGroup", titleKey: "command.layer.addGroup", category: "category.layer", canExecute: () => workspace.active !== null,
        execute: () => { const entry = workspace.active; if (entry === null) return; const id = addGroup(entry.session, tRef.current("layer.group")); entry.view.activeLayerId = id; entry.view.expandedGroupIds.add(id); workspace.invalidateCanvas(entry.id); },
      },
      {
        id: "layer.indent", titleKey: "command.layer.indent", category: "category.layer", canExecute: () => workspace.active !== null,
        execute: () => { const entry = workspace.active; if (entry === null) return; const active = entry.view.activeLayerId, index = entry.session.model.layerOrder.indexOf(active), parent = [...entry.session.model.layerOrder.slice(0, index)].reverse().find((id) => entry.session.model.layers[id]?.kind === "group"); if (parent !== undefined) { moveLayerToParent(entry.session, active, parent, Number.MAX_SAFE_INTEGER); entry.view.expandedGroupIds.add(parent); workspace.invalidateCanvas(entry.id); } },
      },
      {
        id: "layer.outdent", titleKey: "command.layer.outdent", category: "category.layer", canExecute: () => workspace.active?.session.model.layers[workspace.active.view.activeLayerId]?.parentId != null,
        execute: () => { const entry = workspace.active; if (entry === null) return; const layer = entry.session.model.layers[entry.view.activeLayerId]; if (layer?.parentId === null || layer?.parentId === undefined) return; const parent = entry.session.model.layers[layer.parentId], grandparent = parent?.parentId ?? null; moveLayerToParent(entry.session, layer.id, grandparent, Number.MAX_SAFE_INTEGER); workspace.invalidateCanvas(entry.id); },
      },
      {
        id: "layer.setBlendMode", titleKey: "command.layer.setBlendMode", category: "category.layer", canExecute: () => workspace.active !== null,
        execute: (context) => { const entry = workspace.active; if (entry === null || typeof context !== "object" || context === null) return; const value = context as Readonly<{ layerId?: unknown; blendMode?: unknown }>; if (typeof value.layerId === "string" && typeof value.blendMode === "string") { setLayerBlendMode(entry.session, value.layerId, value.blendMode as BlendMode); workspace.invalidateCanvas(entry.id); } },
      },
      ...(["mergeDown", "mergeVisible", "flattenGroup", "flattenDocument"] as const).map((name): CommandDefinition => ({ id: `layer.${name}`, titleKey: `command.layer.${name}`, category: "category.layer", canExecute: () => workspace.active !== null, execute: () => { const entry = workspace.active; if (entry === null) return; try { entry.view.activeLayerId = name === "mergeDown" ? mergeLayerDown(entry.session, entry.view.activeLayerId) : name === "mergeVisible" ? mergeVisibleLayers(entry.session) : name === "flattenGroup" ? flattenGroupLayer(entry.session, entry.view.activeLayerId) : (flattenDocument(entry.session), entry.session.model.layerOrder[0] ?? entry.view.activeLayerId); workspace.invalidateCanvas(entry.id); } catch { setMessage(tRef.current("error.command")); } } })),
      { id: "brush.createFromSelection", titleKey: "command.brush.createFromSelection", category: "category.brush", canExecute: () => workspace.active?.view.selection.bounds !== null, execute: () => { const entry = workspace.active, bounds = entry?.view.selection.bounds; if (entry === null || bounds === null || bounds === undefined) return; const surface = entry.session.getActiveSurfaceForRead(entry.view.activeLayerId), mask = new Uint8Array(bounds.width * bounds.height); if (surface instanceof IndexedPixelSurface) { const indices = surface.readRegion(bounds), transparent = entry.session.model.palette.transparentIndex ?? 0; for (let index = 0; index < mask.length; index += 1) mask[index] = indices[index] === transparent ? 0 : 1; } else { const rgba = surface.readRegion(bounds); for (let index = 0; index < mask.length; index += 1) mask[index] = (rgba[index * 4 + 3] ?? 0) === 0 ? 0 : 1; } for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) if (!entry.view.selection.contains(bounds.x + x, bounds.y + y)) mask[y * bounds.width + x] = 0; const preset = createCustomBrushPreset(`${tRef.current("brush.custom")} ${settingsRef.current.brushPresets.length + 1}`, bounds.width, bounds.height, mask); setSettings((current) => normalizeSettings({ ...current, brushPresets: [...current.brushPresets, preset] })); entry.view.brushPresetId = preset.id; workspace.touch(); } },
      { id: "brush.managePresets", titleKey: "command.brush.managePresets", category: "category.brush", canExecute: () => true, execute: () => setBrushManagerOpen(true) },
      { id: "brush.rotateClockwise", titleKey: "command.brush.rotateClockwise", category: "category.brush", canExecute: () => workspace.active?.view.brushPresetId != null, execute: () => { const id = workspace.active?.view.brushPresetId; if (id !== undefined && id !== null) transformBrushPresetSetting(id, "rotate"); } },
      { id: "brush.flipHorizontal", titleKey: "command.brush.flipHorizontal", category: "category.brush", canExecute: () => workspace.active?.view.brushPresetId != null, execute: () => { const id = workspace.active?.view.brushPresetId; if (id !== undefined && id !== null) transformBrushPresetSetting(id, "flipX"); } },
      { id: "brush.flipVertical", titleKey: "command.brush.flipVertical", category: "category.brush", canExecute: () => workspace.active?.view.brushPresetId != null, execute: () => { const id = workspace.active?.view.brushPresetId; if (id !== undefined && id !== null) transformBrushPresetSetting(id, "flipY"); } },
      { id: "brush.togglePixelPerfect", titleKey: "command.brush.togglePixelPerfect", category: "category.brush", canExecute: () => workspace.active !== null, isChecked: () => workspace.active?.view.pixelPerfect ?? false, execute: () => { const entry = workspace.active; if (entry !== null) { entry.view.pixelPerfect = !entry.view.pixelPerfect; workspace.touch(); } } },
      ...(["off", "horizontal", "vertical", "both"] as const).map((mode): CommandDefinition => ({ id: `symmetry.${mode}`, titleKey: `command.symmetry.${mode}`, category: "category.brush", canExecute: () => workspace.active !== null, isChecked: () => workspace.active?.view.symmetry.mode === mode, execute: () => { const entry = workspace.active; if (entry !== null) { entry.view.symmetry = { ...entry.view.symmetry, mode }; workspace.touch(); } } })),
      { id: "symmetry.resetAxes", titleKey: "command.symmetry.resetAxes", category: "category.brush", canExecute: () => workspace.active !== null, execute: () => { const entry = workspace.active; if (entry !== null) { entry.view.symmetry = { ...entry.view.symmetry, axisX: entry.session.model.canvas.width / 2 - .5, axisY: entry.session.model.canvas.height / 2 - .5 }; workspace.touch(); } } },
      { id: "tileset.import", titleKey: "command.tileset.import", category: "category.tilemap", canExecute: () => workspace.active !== null, execute: importTileSet },
      { id: "tileset.create", titleKey: "command.tileset.create", category: "category.tilemap", canExecute: () => workspace.active !== null, execute: importTileSet },
      { id: "tileset.edit", titleKey: "command.tileset.edit", category: "category.tilemap", canExecute: () => Object.keys(workspace.active?.session.model.tileSets ?? {}).length > 0, execute: () => setMessage(tRef.current("tileset.editHint")) },
      { id: "tileset.delete", titleKey: "command.tileset.delete", category: "category.tilemap", canExecute: () => Object.keys(workspace.active?.session.model.tileSets ?? {}).length > 0, execute: (context) => { const entry = workspace.active, id = typeof context === "string" ? context : Object.keys(entry?.session.model.tileSets ?? {})[0]; if (entry !== null && id !== undefined) { deleteTileSet(entry.session, id); workspace.invalidateCanvas(entry.id); } } },
      { id: "layer.addTilemap", titleKey: "command.layer.addTilemap", category: "category.layer", canExecute: () => Object.keys(workspace.active?.session.model.tileSets ?? {}).length > 0, execute: () => { const entry = workspace.active; if (entry === null) return; const tileSet = Object.values(entry.session.model.tileSets)[0]; if (tileSet === undefined) return; const id = addTilemapLayer(entry.session, tileSet.id, Math.max(1, Math.ceil(entry.session.model.canvas.width / tileSet.tileWidth)), Math.max(1, Math.ceil(entry.session.model.canvas.height / tileSet.tileHeight)), tRef.current("tilemap.layer")); entry.view.activeLayerId = id; workspace.invalidateCanvas(entry.id); } },
      { id: "slice.add", titleKey: "command.slice.add", category: "category.sprite", canExecute: () => workspace.active !== null, execute: () => { const entry = workspace.active; if (entry === null) return; addDocumentSlice(entry.session, { id: makeId("slice"), name: tRef.current("slice.defaultName"), bounds: { x: 0, y: 0, width: Math.min(16, entry.session.model.canvas.width), height: Math.min(16, entry.session.model.canvas.height) } }); workspace.touch(); } },
      { id: "slice.edit", titleKey: "command.slice.edit", category: "category.sprite", canExecute: () => Object.keys(workspace.active?.session.model.slices ?? {}).length > 0, execute: (context) => { const entry = workspace.active, id = typeof context === "string" ? context : Object.keys(entry?.session.model.slices ?? {})[0], slice = id === undefined ? undefined : entry?.session.model.slices[id]; if (entry !== null && slice !== undefined) { updateDocumentSlice(entry.session, { ...slice, center: slice.center ?? { x: slice.bounds.x + Math.floor(slice.bounds.width / 3), y: slice.bounds.y + Math.floor(slice.bounds.height / 3), width: Math.max(1, Math.floor(slice.bounds.width / 3)), height: Math.max(1, Math.floor(slice.bounds.height / 3)) } }); workspace.touch(); } } },
      { id: "slice.delete", titleKey: "command.slice.delete", category: "category.sprite", canExecute: () => Object.keys(workspace.active?.session.model.slices ?? {}).length > 0, execute: (context) => { const entry = workspace.active, id = typeof context === "string" ? context : Object.keys(entry?.session.model.slices ?? {})[0]; if (entry !== null && id !== undefined) { deleteDocumentSlice(entry.session, id); workspace.touch(); } } },
      { id: "file.importAseprite", titleKey: "command.file.importAseprite", category: "category.file", canExecute: () => true, execute: importAsepriteDocument },
      { id: "file.exportTilemap", titleKey: "command.file.exportTilemap", category: "category.file", canExecute: () => Object.values(workspace.active?.session.model.layers ?? {}).some((layer) => layer.kind === "tilemap"), execute: exportActiveTilemap },
      { id: "plugin.manageImporters", titleKey: "command.plugin.manageImporters", category: "category.plugins", canExecute: () => true, execute: () => setPluginManagerOpen(true) },
      { id: "plugin.manageExporters", titleKey: "command.plugin.manageExporters", category: "category.plugins", canExecute: () => true, execute: () => setPluginManagerOpen(true) },
      { id: "plugin.manageTools", titleKey: "command.plugin.manageTools", category: "category.plugins", canExecute: () => true, execute: () => setPluginManagerOpen(true) },
      { id: "window.saveLayout", titleKey: "command.window.saveLayout", category: "category.window", canExecute: () => true, execute: () => setLayoutManagerOpen(true) },
      { id: "window.manageLayouts", titleKey: "command.window.manageLayouts", category: "category.window", canExecute: () => true, execute: () => setLayoutManagerOpen(true) },
      { id: "window.exportLayout", titleKey: "command.window.exportLayout", category: "category.window", canExecute: () => true, execute: () => exportLayoutSettings(settingsRef.current.activeLayoutId) },
      { id: "window.importLayout", titleKey: "command.window.importLayout", category: "category.window", canExecute: () => true, execute: importLayoutSettings },
      { id: "preferences.keybindings", titleKey: "command.preferences.keybindings", category: "category.preferences", canExecute: () => true, execute: () => setKeybindingEditorOpen(true) },
      { id: "preferences.importKeybindings", titleKey: "command.preferences.importKeybindings", category: "category.preferences", canExecute: () => true, execute: importKeybindingSettings },
      { id: "preferences.exportKeybindings", titleKey: "command.preferences.exportKeybindings", category: "category.preferences", canExecute: () => true, execute: exportKeybindingSettings },
      { id: "preferences.resetKeybindings", titleKey: "command.preferences.resetKeybindings", category: "category.preferences", canExecute: () => true, execute: () => setConfirmAction("reset-keybindings") },
      { id: "preferences.resetAll", titleKey: "command.preferences.resetAll", category: "category.preferences", canExecute: () => true, execute: () => setConfirmAction("reset-preferences") },
      {
        id: "recovery.open",
        titleKey: "command.recovery.open",
        category: "category.file",
        canExecute: () => recoveryItems.length > 0,
        execute: () => setRecoveryOpen(true),
      },
      {
        id: "recovery.delete",
        titleKey: "command.recovery.delete",
        category: "category.file",
        canExecute: () => false,
        execute: () => undefined,
      },
      {
        id: "recovery.deleteAll",
        titleKey: "command.recovery.deleteAll",
        category: "category.file",
        canExecute: () => recoveryItems.length > 0,
        execute: () => setConfirmAction("clear-recovery"),
      },
      {
        id: "plugin.manage",
        titleKey: "command.plugin.manage",
        category: "category.plugins",
        canExecute: () => true,
        execute: () => setPluginManagerOpen(true),
      },
      {
        id: "plugin.install",
        titleKey: "command.plugin.install",
        category: "category.plugins",
        canExecute: () => true,
        execute: () => setPluginManagerOpen(true),
      },
      ...(
        [
          ["plugin.enable", "enable"],
          ["plugin.disable", "disable"],
        ] as const
      ).map(([id, action]): CommandDefinition => ({
        id,
        titleKey: `command.${id}`,
        category: "category.plugins",
        canExecute: () => {
          const snapshot = pluginController.snapshot,
            selected = snapshot.installed.find((plugin) => plugin.manifest.id === snapshot.selectedPluginId);
          return selected !== undefined && !snapshot.safeMode && (action === "enable" ? !selected.enabled : selected.enabled);
        },
        execute: async () => {
          const snapshot = pluginController.snapshot,
            pluginId = snapshot.selectedPluginId;
          if (pluginId === null) return;
          await window.suwolDesktop?.plugins.setEnabled(pluginId, action === "enable");
          await pluginController.refresh();
        },
      })),
      {
        id: "plugin.disableAll",
        titleKey: "command.plugin.disableAll",
        category: "category.plugins",
        canExecute: () => pluginController.snapshot.installed.some((plugin) => plugin.enabled),
        execute: () => setConfirmAction("disable-plugins"),
      },
      {
        id: "plugin.remove",
        titleKey: "command.plugin.remove",
        category: "category.plugins",
        canExecute: () => pluginController.snapshot.selectedPluginId !== null,
        execute: () => setPluginManagerOpen(true),
      },
      {
        id: "plugin.restart",
        titleKey: "command.plugin.restart",
        category: "category.plugins",
        canExecute: () => {
          const snapshot = pluginController.snapshot;
          return snapshot.selectedPluginId !== null && snapshot.installed.some((plugin) => plugin.manifest.id === snapshot.selectedPluginId && plugin.enabled);
        },
        execute: async () => {
          const pluginId = pluginController.snapshot.selectedPluginId;
          if (pluginId !== null) await pluginController.restart(pluginId);
        },
      },
      ...(
        [
          ["plugin.showPermissions", "permission"],
          ["plugin.openLogs", "logs"],
        ] as const
      ).map(([id]): CommandDefinition => ({
        id,
        titleKey: `command.${id}`,
        category: "category.plugins",
        canExecute: () => pluginController.snapshot.selectedPluginId !== null,
        execute: () => setPluginManagerOpen(true),
      })),
      {
        id: "plugin.clearStorage",
        titleKey: "command.plugin.clearStorage",
        category: "category.plugins",
        canExecute: () => pluginController.snapshot.selectedPluginId !== null,
        execute: () => setPluginManagerOpen(true),
      },
      {
        id: "plugin.enterSafeMode",
        titleKey: "command.plugin.enterSafeMode",
        category: "category.plugins",
        canExecute: () => !pluginController.snapshot.safeMode,
        execute: async () => {
          await window.suwolDesktop?.plugins.setSafeMode(true);
          await pluginController.refresh();
        },
      },
      {
        id: "plugin.exitSafeMode",
        titleKey: "command.plugin.exitSafeMode",
        category: "category.plugins",
        canExecute: () => pluginController.snapshot.safeMode,
        execute: async () => {
          await window.suwolDesktop?.plugins.setSafeMode(false);
          await pluginController.refresh();
        },
      },
      {
        id: "help.about",
        titleKey: "command.help.about",
        category: "category.help",
        canExecute: () => true,
        execute: () => setAboutOpen(true),
      },
    ];
    const unregister = definitions.map((definition) =>
      commands.register(definition),
    );
    return () => {
      for (const dispose of unregister) dispose();
    };
  }, [
    changeScale,
    changeTheme,
    commands,
    jobProgress,
    panels,
    recoveryItems.length,
    pluginController,
    resetWorkspace,
    togglePanel,
    workspace,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = language;
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(settings.uiScale),
    );
    document.documentElement.style.fontSize = `${14 * settings.uiScale}px`;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
    } catch {
      logger.warn("UI settings could not be persisted.");
    }
    commands.notifyStateChanged();
  }, [commands, language, settings, workspaceVersion]);
  useEffect(
    () => () => {
      exportWorkerRef.current?.terminate();
      resizeWorkerRef.current?.terminate();
      indexedWorkerRef.current?.terminate();
      asepriteWorkerRef.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    const api = window.suwolDesktop;
    if (api === undefined) return;
    const state = Object.fromEntries(
      NATIVE_MENU_COMMAND_IDS.map((id) => [id, commands.canExecute(id)]),
    );
    void api.commands.updateState(state);
  }, [commands, pluginVersion, recoveryItems.length, workspaceVersion]);
  useEffect(() => {
    const api = window.suwolDesktop;
    if (api === undefined) {
      setMessage(tRef.current("error.desktopApi"));
      return;
    }
    const unsubscribe = api.commands.onInvoke((id) => {
      void commands.execute(id);
    });
    const unsubscribePlugin = api.plugins.onCommandInvoke((id) => {
      void commands.execute(id);
    });
    void api.app.getDiagnostics()
      .then(setDesktopInfo)
      .catch(() => setMessage(tRef.current("error.desktopApi")));
    void refreshRecovery();
    void pluginController.refresh();
    return () => {
      unsubscribe();
      unsubscribePlugin();
      void pluginController.dispose();
    };
  }, [commands, pluginController]);
  useEffect(() => {
    const dirty = workspace.documents.filter(
      (entry) =>
        entry.session.isDirty &&
        !entry.session.transactionActive &&
        !entry.saving &&
        entry.recoveryRevision !== entry.session.model.revision,
    );
    if (dirty.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const entry of dirty) {
        const snapshot = entry.session.snapshot(),
          revision = snapshot.model.revision;
        void serializeSuwolPixelAsync(snapshot, desktopInfo?.version ?? "0.6.0-rc.4")
          .then(async (data) => {
            let thumbnail: ArrayBuffer | undefined;
            try {
              thumbnail = toArrayBuffer(createThumbnailPng(snapshot));
            } catch {
              logger.warn("Recovery thumbnail failed.");
            }
            await window.suwolDesktop?.recovery.write({
              documentId: entry.id,
              displayName: entry.session.model.name,
              originalHandleId: entry.handle?.id ?? null,
              originalDisplayName: entry.handle?.displayName ?? null,
              revision,
              timestamp: Date.now(),
              lastSavedTimestamp: entry.lastSavedAt,
              width: entry.session.model.canvas.width,
              height: entry.session.model.canvas.height,
              data: toArrayBuffer(data),
              ...(thumbnail === undefined ? {} : { thumbnail }),
            });
            entry.recoveryRevision = revision;
          })
          .catch(() => logger.warn("Recovery snapshot failed."));
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [desktopInfo?.version, workspace, workspaceVersion]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const key = event.key.toLocaleLowerCase("en-US"),
        primary = event.ctrlKey || event.metaKey;
      const chord = normalizeShortcut([event.ctrlKey ? "Ctrl" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.key === " " ? "Space" : event.key].filter(Boolean).join("+")),
        custom = settingsRef.current.keybindings.entries.find((entry) => (entry.context === "global" || entry.context === "canvas") && entry.shortcuts.includes(chord));
      let id: string | null = custom?.commandId ?? null;
      if (id === null && primary && event.shiftKey && key === "p") id = "view.commandPalette";
      else if (primary && key === "n") id = "file.new";
      else if (primary && key === "o") id = "file.open";
      else if (primary && event.shiftKey && key === "s") id = "file.saveAs";
      else if (primary && key === "s") id = "file.save";
      else if (primary && key === "w") id = "file.close";
      else if (primary && event.shiftKey && key === "z") id = "edit.redo";
      else if (primary && key === "z") id = "edit.undo";
      else if (primary && event.shiftKey && key === "a") id = "select.none";
      else if (primary && key === "a") id = "select.all";
      else if (primary && key === "c") id = "edit.copy";
      else if (primary && key === "x") id = "edit.cut";
      else if (primary && key === "v") id = "edit.paste";
      else if (primary && event.altKey && key === "t") id = "tag.add";
      else if (event.altKey && event.shiftKey && key === "d")
        id = "frame.duplicateLinked";
      else if (event.altKey && key === "n") id = "frame.add";
      else if (event.altKey && key === "d") id = "frame.duplicate";
      else if (event.altKey && key === "delete") id = "frame.delete";
      else if (key === "delete") id = "edit.delete";
      else if (key === "enter" && event.shiftKey) id = "animation.stop";
      else if (
        key === "enter" &&
        workspace.active?.view.floating === null
      )
        id = "animation.playPause";
      else if (key === "[" && event.shiftKey) id = "frame.first";
      else if (key === "]" && event.shiftKey) id = "frame.last";
      else if (key === "[") id = "frame.previous";
      else if (key === "]") id = "frame.next";
      else if (key === "o" && !event.shiftKey) id = "animation.toggleOnionSkin";
      else if (!primary) {
        const tools: Readonly<Record<string, string>> = {
          p: "tool.pencil",
          e: "tool.eraser",
          i: "tool.eyedropper",
          g: "tool.fill",
          l: "tool.line",
          r: "tool.rectangle",
          s: "tool.selectionRect",
          m: "tool.move",
        };
        id = event.shiftKey && key === "o" ? "tool.ellipse" : (tools[key] ?? null);
      }
      if (custom !== undefined) id = custom.commandId;
      if (id !== null && commands.canExecute(id)) {
        event.preventDefault();
        void commands.execute(id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commands]);
  useEffect(() => {
    if (!__SUWOL_E2E__) return;
    Object.defineProperty(window, "suwolTest", {
      configurable: true,
      value: Object.freeze({
        getActiveDocumentHash: () =>
          workspace.active === null
            ? null
            : hashSnapshot(workspace.active.session.snapshot()),
        getActiveFrameHash: () => {
          const entry = workspace.active;
          if (entry === null) return null;
          let hash = 2166136261;
          for (const byte of compositeFrame(entry.session, entry.view.activeFrameId)) {
            hash ^= byte;
            hash = Math.imul(hash, 16777619) >>> 0;
          }
          return hash.toString(16).padStart(8, "0");
        },
        getPaletteSize: () =>
          workspace.active?.session.model.palette.colors.length ?? 0,
        getCanvasSize: () =>
          workspace.active === null
            ? null
            : {
                width: workspace.active.session.model.canvas.width,
                height: workspace.active.session.model.canvas.height,
              },
        getViewport: () =>
          workspace.active === null
            ? null
            : {
                panX: workspace.active.view.viewport.panX,
                panY: workspace.active.view.viewport.panY,
                zoom: workspace.active.view.viewport.zoom,
              },
        getAnimationState: () => {
          const entry = workspace.active;
          if (entry === null) return null;
          const model = entry.session.model,
            references = Object.values(model.cels).reduce<Record<string, number>>(
              (counts, cel) => {
                if (cel.kind === "pixel")
                  counts[cel.imageId] = (counts[cel.imageId] ?? 0) + 1;
                return counts;
              },
              {},
            );
          return {
            frameCount: model.frameOrder.length,
            activeFrameIndex: model.frameOrder.indexOf(entry.view.activeFrameId),
            durations: model.frameOrder.map((id) => model.frames[id]?.durationMs ?? 0),
            celCount: Object.keys(model.cels).length,
            imageCount: Object.keys(model.images).length,
            linkedImageCount: Object.values(references).filter((count) => count > 1).length,
            tags: Object.values(model.tags).map((tag) => ({
              name: tag.name,
              playback: tag.playback,
              from: model.frameOrder.indexOf(tag.fromFrameId),
              to: model.frameOrder.indexOf(tag.toFrameId),
            })),
            isPlaying: entry.view.playback.isPlaying,
            playbackMode: entry.view.playback.mode,
            onionSkin: entry.view.onionSkin.enabled,
          };
        },
        openPluginManager: () => setPluginManagerOpen(true),
        executeCommand: async (commandId: string) => await commands.execute(commandId),
        getLayerCount: () => workspace.active?.session.model.layerOrder.length ?? 0,
        getProfessionalState: () => {
          const model = workspace.active?.session.model;
          return model === undefined ? null : {
            schemaVersion: model.schemaVersion,
            colorMode: model.canvas.colorMode,
            layerKinds: model.layerOrder.map((id) => model.layers[id]?.kind ?? "missing"),
            paletteSize: model.palette.entries.length,
          };
        },
        getPluginState: () => ({
          safeMode: pluginController.snapshot.safeMode,
          installed: pluginController.snapshot.installed.map((plugin) => ({
            id: plugin.manifest.id,
            enabled: plugin.enabled,
            runtimeStatus: plugin.runtimeStatus,
            grants: plugin.grants,
          })),
        }),
      }),
    });
    return () => {
      delete window.suwolTest;
    };
  }, [commands, pluginController, workspace]);

  function resize(dimension: "left" | "right" | "timeline", value: number) {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        ...(dimension === "left" ? { leftPanelWidth: value } : {}),
        ...(dimension === "right" ? { rightPanelWidth: value } : {}),
        ...(dimension === "timeline" ? { timelineHeight: value } : {}),
      }),
    );
  }
  const closing =
      closeId === null
        ? null
        : (workspace.documents.find((entry) => entry.id === closeId) ?? null),
    active = workspace.active;
  const activeTag =
      active?.view.activeTagId == null
        ? null
        : (active.session.model.tags[active.view.activeTagId] ?? null),
    tagFrameIds =
      active === null || activeTag === null
        ? null
        : playbackFrameRange(active.session.model, activeTag.id);
  return (
    <>
      {message !== null && (
        <div
          className="service-warning"
          role="alert"
          onClick={() => setMessage(null)}
        >
          {message}
        </div>
      )}
      <EditorShell
        settings={settings}
        panels={panels}
        commands={commands}
        workspace={workspace}
        status={status}
        t={t}
        onForeground={setForeground}
        onLanguage={(value: LanguageMode) =>
          setSettings((current) =>
            normalizeSettings({ ...current, language: value }),
          )
        }
        onResize={resize}
        onCloseDocument={requestClose}
        pluginOverlays={pluginController.snapshot.overlays.map((entry) => entry.update)}
        pluginTools={pluginController.snapshot.tools}
        onPluginTool={selectPluginTool}
        onPluginToolEvent={runPluginToolEvent}
      />
      {paletteOpen && (
        <CommandPalette
          registry={commands}
          t={t}
          onClose={() => setPaletteOpen(false)}
        />
      )}{" "}
      {aboutOpen && (
        <AboutDialog
          t={t}
          diagnostics={desktopInfo}
          onOpenRepository={() => {
            void window.suwolDesktop?.shell.openExternal(
              "https://github.com/suwol-suite/SuwolPixelStudio",
            );
          }}
          onOpenLicense={() => {
            void window.suwolDesktop?.shell.openExternal(
              "https://www.apache.org/licenses/LICENSE-2.0",
            );
          }}
          onOpenNotices={() => {
            void window.suwolDesktop?.shell.openExternal(
              "https://github.com/suwol-suite/SuwolPixelStudio/blob/main/THIRD_PARTY_NOTICES.md",
            );
          }}
          onOpenLogs={() => {
            void window.suwolDesktop?.app.openLogsFolder();
          }}
          onCopyDiagnostics={() => {
            void window.suwolDesktop?.app.copyDiagnostics();
          }}
          onClose={() => setAboutOpen(false)}
        />
      )}{" "}
      {newOpen && (
        <NewDocumentDialog
          t={t}
          onClose={() => setNewOpen(false)}
          onCreate={(name, width, height, colorMode, transparentIndex, maxPaletteSize) => {
            workspace.add(
              EditorSession.create({
                name,
                width,
                height,
                colorMode,
                transparentIndex,
                maxPaletteSize,
                layerName: `${t("panel.layers")} 1`,
              }),
            );
            setNewOpen(false);
          }}
        />
      )}{" "}
      {indexedConversionOpen && (
        <IndexedConversionDialog
          t={t}
          onClose={() => setIndexedConversionOpen(false)}
          onApply={(options) => {
            const entry = workspace.active;
            if (entry !== null) startIndexedConversion(entry, options);
          }}
        />
      )}{" "}
      {layoutManagerOpen && (
        <LayoutManagerDialog
          t={t}
          layouts={settings.layouts}
          activeId={settings.activeLayoutId}
          onActive={(id) => {
            const layout = settingsRef.current.layouts.find((item) => item.id === id);
            if (layout !== undefined) {
              const visible = new Set(layoutPanelIds(layout));
              panels.restoreVisibility(Object.fromEntries(PANEL_IDS.map((panelId) => [panelId, visible.has(panelId)])));
              setSettings((current) => normalizeSettings({ ...current, activeLayoutId: id, panels: panels.exportVisibility() }));
            }
          }}
          onSave={(name) => {
            const source = settingsRef.current.layouts.find((item) => item.id === settingsRef.current.activeLayoutId) ?? settingsRef.current.layouts[0];
            if (source === undefined) return;
            const layout = { ...structuredClone(source), id: crypto.randomUUID(), name: name.trim() || tRef.current("layout.untitled") };
            setSettings((current) => normalizeSettings({ ...current, layouts: [...current.layouts, layout], activeLayoutId: layout.id }));
          }}
          onDuplicate={(id) => {
            const source = settingsRef.current.layouts.find((item) => item.id === id);
            if (source === undefined) return;
            const layout = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} ${tRef.current("layout.copy")}` };
            setSettings((current) => normalizeSettings({ ...current, layouts: [...current.layouts, layout], activeLayoutId: layout.id }));
          }}
          onDelete={(id) => setSettings((current) => { const layouts = current.layouts.filter((item) => item.id !== id); return normalizeSettings({ ...current, layouts, activeLayoutId: current.activeLayoutId === id ? layouts[0]?.id : current.activeLayoutId }); })}
          onImport={() => { void importLayoutSettings(); }}
          onExport={(id) => { void exportLayoutSettings(id); }}
          onClose={() => setLayoutManagerOpen(false)}
        />
      )}{" "}
      {keybindingEditorOpen && (
        <KeybindingEditorDialog
          t={t}
          registry={commands}
          settings={settings.keybindings}
          onChange={(keybindings) => setSettings((current) => normalizeSettings({ ...current, keybindings }))}
          onImport={() => { void importKeybindingSettings(); }}
          onExport={() => { void exportKeybindingSettings(); }}
          onClose={() => setKeybindingEditorOpen(false)}
        />
      )}{" "}
      {brushManagerOpen && (
        <BrushPresetManagerDialog
          t={t}
          presets={settings.brushPresets}
          activeId={workspace.active?.view.brushPresetId ?? null}
          onSelect={(id) => { if (workspace.active !== null) { workspace.active.view.brushPresetId = id; workspace.touch(); } }}
          onDuplicate={(id) => setSettings((current) => { const source = current.brushPresets.find((preset) => preset.id === id); return source === undefined ? current : normalizeSettings({ ...current, brushPresets: [...current.brushPresets, { ...source, id: crypto.randomUUID(), name: `${source.name} ${tRef.current("layout.copy")}` }] }); })}
          onDelete={(id) => { setSettings((current) => normalizeSettings({ ...current, brushPresets: current.brushPresets.filter((preset) => preset.id !== id) })); if (workspace.active?.view.brushPresetId === id) workspace.active.view.brushPresetId = null; workspace.touch(); }}
          onRotate={(id) => transformBrushPresetSetting(id, "rotate")}
          onFlipX={(id) => transformBrushPresetSetting(id, "flipX")}
          onFlipY={(id) => transformBrushPresetSetting(id, "flipY")}
          onClose={() => setBrushManagerOpen(false)}
        />
      )}{" "}
      {closing !== null && (
        <CloseDocumentDialog
          t={t}
          name={closing.session.model.name}
          onClose={() => setCloseId(null)}
          onDiscard={() => {
            workspace.close(closing.id);
            setCloseId(null);
            void window.suwolDesktop?.recovery.delete(closing.id);
          }}
          onSave={() => {
            void saveEntry(closing).then((saved) => {
              if (saved) {
                workspace.close(closing.id);
                setCloseId(null);
              }
            });
          }}
        />
      )}
      {resizeMode !== null && active !== null && (
        <ResizeDialog
          mode={resizeMode}
          width={active.session.model.canvas.width}
          height={active.session.model.canvas.height}
          t={t}
          onClose={() => setResizeMode(null)}
          onApply={applyResize}
        />
      )}{" "}
      {durationOpen && active !== null && (
        <DurationDialog
          initial={active.session.model.frames[active.view.activeFrameId]?.durationMs ?? 100}
          t={t}
          onClose={() => setDurationOpen(false)}
          onApply={(duration) => {
            const selected = active.view.timeline.selectedFrames;
            active.session.setFrameDuration(
              selected.size > 0 ? [...selected] : active.view.activeFrameId,
              duration,
            );
            setDurationOpen(false);
            workspace.touch();
          }}
        />
      )}{" "}
      {onionSettingsOpen && active !== null && (
        <OnionSkinDialog
          initial={active.view.onionSkin}
          t={t}
          onClose={() => setOnionSettingsOpen(false)}
          onApply={(onionSkin) => {
            active.view.onionSkin = onionSkin;
            setOnionSettingsOpen(false);
            workspace.invalidateCanvas(active.id);
          }}
        />
      )}{" "}
      {tagDialog !== null && active !== null && (
        <TagDialog
          frameCount={active.session.model.frameOrder.length}
          {...(tagDialog === "edit" && activeTag !== null
            ? {
                initial: {
                  tag: activeTag,
                  fromIndex: active.session.model.frameOrder.indexOf(activeTag.fromFrameId),
                  toIndex: active.session.model.frameOrder.indexOf(activeTag.toFrameId),
                },
              }
            : {})}
          t={t}
          onClose={() => setTagDialog(null)}
          onApply={(result: TagDialogResult) => {
            const from = active.session.model.frameOrder[result.fromIndex],
              to = active.session.model.frameOrder[result.toIndex];
            if (from === undefined || to === undefined) return;
            if (tagDialog === "edit" && activeTag !== null)
              active.session.editTag(activeTag.id, {
                name: result.name,
                fromFrameId: from,
                toFrameId: to,
                playback: result.playback,
              });
            else
              active.view.activeTagId = active.session.addTag(
                result.name,
                from,
                to,
                result.playback,
              );
            setTagDialog(null);
            workspace.touch();
          }}
        />
      )}{" "}
      {exportKind !== null && active !== null && (
        <ExportDialog
          kind={exportKind}
          documentName={active.session.model.name}
          allFrameIds={active.session.model.frameOrder}
          tagFrameIds={tagFrameIds}
          t={t}
          onClose={() => setExportKind(null)}
          onApply={(job) => { void startAnimationExport(job); }}
        />
      )}{" "}
      {jobProgress !== null && (
        <ProgressDialog
          title={t(jobProgress.kind === "export" ? "export.progress" : jobProgress.kind === "indexed" ? "indexed.progress" : jobProgress.kind === "aseprite" ? "aseprite.progress" : "resize.progress")}
          completed={jobProgress.completed}
          total={jobProgress.total}
          t={t}
          onCancel={cancelBackgroundJob}
        />
      )}{" "}
      {recoveryOpen && (
        <RecoveryDialog
          items={recoveryItems}
          t={t}
          language={language}
          onRecover={(item) => {
            void recover(item);
          }}
          onDelete={(item) => {
            void deleteRecovery(item);
          }}
          onDeleteAll={() => {
            setRecoveryOpen(false);
            setConfirmAction("clear-recovery");
          }}
          onClose={() => setRecoveryOpen(false)}
        />
      )}
      {pluginManagerOpen && (
        <PluginManager
          controller={pluginController}
          t={t}
          onRunImporter={runPluginImporter}
          onRunExporter={runPluginExporter}
          onRunTool={selectPluginTool}
          onClose={() => setPluginManagerOpen(false)}
        />
      )}
      {compatibilityReport !== null && (
        <AsepriteCompatibilityDialog t={t} report={compatibilityReport} onClose={() => setCompatibilityReport(null)} />
      )}
      {confirmAction !== null && (
        <ConfirmDialog
          t={t}
          title={t(`confirm.${confirmAction}.title`)}
          message={t(`confirm.${confirmAction}.message`)}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "clear-recovery") {
              void deleteAllRecovery();
            } else if (action === "disable-plugins") {
              void (async () => {
                for (const plugin of pluginController.snapshot.installed)
                  if (plugin.enabled)
                    await window.suwolDesktop?.plugins.setEnabled(plugin.manifest.id, false);
                await pluginController.refresh();
              })();
            } else if (action === "reset-keybindings") {
              setSettings((current) => normalizeSettings({
                ...current,
                keybindings: DEFAULT_SETTINGS.keybindings,
              }));
            } else {
              panels.reset();
              setSettings(DEFAULT_SETTINGS);
            }
          }}
        />
      )}
    </>
  );
}

function sessionFromPluginImport(result: PluginImportResult): EditorSession {
  const input = result.document,
    session = EditorSession.create({
      name: input.name,
      width: input.width,
      height: input.height,
      layerName: input.layers[0]?.name ?? "Layer",
      colorMode: input.colorMode,
      ...(input.palette.length > 0 ? { palette: input.palette } : {}),
      ...(input.colorMode === "indexed" ? { transparentIndex: input.transparentIndex ?? 0, maxPaletteSize: Math.max(2, input.palette.length) } : {}),
    }),
    snapshot = session.snapshot(), model = snapshot.model, images = new Map<string, Uint8Array>(),
    frameIds = input.frames.map(() => makeId("plugin-frame")),
    layerIdMap = new Map(input.layers.map((layer) => [layer.id, makeId("plugin-layer")]));
  model.frames = {};
  input.frames.forEach((frame, index) => {
    const id = frameIds[index];
    if (id === undefined) throw new Error("Plugin importer frame id is missing.");
    model.frames[id] = { id, durationMs: frame.durationMs };
  });
  model.frameOrder = frameIds;
  model.layers = {};
  model.rootLayerIds = [];
  for (const layer of input.layers) {
    const id = layerIdMap.get(layer.id);
    if (id === undefined) throw new Error("Plugin importer layer id is missing.");
    model.layers[id] = { id, kind: "pixel", name: layer.name, parentId: null, visible: true, locked: false, opacity: 1, blendMode: "normal" };
    model.rootLayerIds.push(id);
  }
  model.layerOrder = [...model.rootLayerIds];
  model.cels = {}; model.celByLayerAndFrame = {}; model.images = {};
  for (const cel of input.cels) {
    const layerId = layerIdMap.get(cel.layerId), frameId = frameIds[cel.frameIndex];
    if (layerId === undefined || frameId === undefined) throw new Error("Plugin importer Cel reference is invalid.");
    const imageId = makeId("plugin-image"), celId = makeId("plugin-cel");
    model.images[imageId] = { id: imageId, width: cel.width, height: cel.height, format: cel.format, refCount: 0 };
    images.set(imageId, new Uint8Array(cel.pixels.slice(0)));
    model.cels[celId] = { kind: "pixel", id: celId, layerId, frameId, imageId, x: cel.x, y: cel.y, opacity: 1 };
    model.celByLayerAndFrame[celKey(layerId, frameId)] = celId;
  }
  model.tilemaps = {}; model.tileSets = {}; model.tags = {}; model.slices = {}; model.metadata = {}; model.pluginData = {}; model.revision = 0;
  recountImageReferences(model);
  assertDocumentIntegrity(model);
  return EditorSession.fromSnapshot({ ...snapshot, images });
}
