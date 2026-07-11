import {
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { CommandRegistry } from "@suwol/command-system";
import type {
  OverlayUpdate,
  PluginToolContribution,
  PluginToolOperation,
} from "@suwol/plugin-api";
import type {
  Rgba,
  SelectionOperation,
  ShapeFillMode,
} from "@suwol/editor-core";
import { BLEND_MODES, layerAncestors } from "@suwol/editor-core";
import {
  LANGUAGE_MODES,
  THEME_MODES,
  UI_SCALES,
  type AppSettings,
  type LanguageMode,
  type PanelId,
} from "@suwol/shared";
import type { PanelRegistry } from "@suwol/ui";
import type { Translate } from "../i18n";
import {
  parseHexColor,
  rgbaToHex,
  type CanvasStatusStore,
  type ToolId,
  type WorkspaceStore,
} from "../editor/workspace";
import { Icon, type IconName } from "./Icon";
import { PixelCanvas } from "./PixelCanvas";
import { Timeline } from "./Timeline";

interface Props {
  readonly settings: AppSettings;
  readonly panels: PanelRegistry<PanelId>;
  readonly commands: CommandRegistry;
  readonly workspace: WorkspaceStore;
  readonly status: CanvasStatusStore;
  readonly t: Translate;
  readonly onForeground: (color: Rgba) => void;
  readonly onLanguage: (language: LanguageMode) => void;
  readonly onResize: (
    dimension: "left" | "right" | "timeline",
    value: number,
  ) => void;
  readonly onCloseDocument: (id: string) => void;
  readonly pluginOverlays?: readonly OverlayUpdate[];
  readonly pluginTools?: readonly Readonly<{ pluginId: string; contribution: PluginToolContribution }>[];
  readonly onPluginTool?: (pluginId: string, toolId: string) => Promise<void>;
  readonly onPluginToolEvent?: (
    pluginId: string,
    toolId: string,
    event: unknown,
  ) => Promise<readonly PluginToolOperation[]>;
}
function IconButton({
  label,
  icon,
  pressed,
  testId,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly pressed?: boolean;
  readonly testId?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
function Panel({
  title,
  icon,
  children,
  testId,
}: {
  readonly title: string;
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly testId: string;
}) {
  return (
    <section className="panel" data-testid={testId}>
      <header className="panel-header">
        <Icon name={icon} />
        <h2>{title}</h2>
      </header>
      <div className="panel-content">{children}</div>
    </section>
  );
}
function Splitter({
  orientation,
  value,
  min,
  max,
  label,
  direction,
  onChange,
}: {
  readonly orientation: "vertical" | "horizontal";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly direction: 1 | -1;
  readonly onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  function start(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const origin = orientation === "vertical" ? e.clientX : e.clientY,
      initial = value,
      move = (m: PointerEvent) =>
        onChange(
          clamp(
            initial +
              ((orientation === "vertical" ? m.clientX : m.clientY) - origin) *
                direction,
          ),
        ),
      stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const dec = orientation === "vertical" ? "ArrowLeft" : "ArrowUp",
      inc = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    onChange(clamp(value + (e.key === inc ? 8 : -8) * direction));
  }
  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
    />
  );
}
const colorCss = (color: Rgba) =>
  `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`;

function PalettePanel({
  settings,
  workspace,
  commands,
  t,
  onForeground,
}: {
  readonly settings: AppSettings;
  readonly workspace: WorkspaceStore;
  readonly commands: CommandRegistry;
  readonly t: Translate;
  readonly onForeground: (color: Rgba) => void;
}) {
  const entry = workspace.active;
  if (entry === null)
    return <p className="panel-empty">{t("status.noDocument")}</p>;
  const fg = entry.view.foreground,
    colors = entry.session.model.palette.colors;
  function set(color: Rgba) {
    onForeground(color);
  }
  return (
    <div className="color-panel">
      <div className="color-swatches">
        <button
          aria-label={t("color.foreground")}
          style={{ background: colorCss(fg) }}
        />
        <button
          aria-label={t("color.background")}
          style={{ background: colorCss(entry.view.background) }}
        />
      </div>
      <label>
        {t("color.hex")}
        <input
          value={rgbaToHex(fg)}
          onChange={(event) => {
            const color = parseHexColor(event.target.value, fg[3]);
            if (color !== null) set(color);
          }}
        />
      </label>
      <div className="rgba-fields">
        {(["R", "G", "B", "A"] as const).map((label, index) => (
          <label key={label}>
            {label}
            <input
              type="number"
              min="0"
              max="255"
              value={fg[index]}
              onChange={(event) =>
                set(
                  fg.map((item, i) =>
                    i === index
                      ? Math.min(255, Math.max(0, Number(event.target.value)))
                      : item,
                  ) as unknown as Rgba,
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="color-actions">
        <IconButton
          label={t("color.swap")}
          icon="swap"
          onClick={() => {
            const background = entry.view.background;
            entry.view.background = entry.view.foreground;
            set(background);
          }}
        />
        <button type="button" onClick={() => set([0, 0, 0, 255])}>
          {t("color.reset")}
        </button>
      </div>
      <h3>{t("palette.recent")}</h3>
      <div className="recent-colors">
        {settings.recentColors.map((color) => (
          <button
            key={color.join("-")}
            aria-label={rgbaToHex(color)}
            style={{ background: colorCss(color) }}
            onClick={() => set(color)}
          />
        ))}
      </div>
      <div className="palette-actions">
        <button
          data-testid="palette-add"
          type="button"
          onClick={() => {
            void commands.execute("palette.addCurrent");
          }}
        >
          {t("palette.add")}
        </button>
        <IconButton
          label={t("palette.delete")}
          icon="delete"
          disabled={entry.view.selectedPaletteColorId === null}
          onClick={() => {
            void commands.execute("palette.delete");
          }}
        />
        <IconButton
          label={t("palette.up")}
          icon="up"
          disabled={entry.view.selectedPaletteColorId === null}
          onClick={() => {
            void commands.execute("palette.moveUp");
          }}
        />
        <IconButton
          label={t("palette.down")}
          icon="down"
          disabled={entry.view.selectedPaletteColorId === null}
          onClick={() => {
            void commands.execute("palette.moveDown");
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          entry.session.loadDefaultPalette([
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [196, 40, 40, 255],
            [238, 156, 42, 255],
            [246, 232, 92, 255],
            [46, 160, 67, 255],
            [54, 104, 218, 255],
            [132, 61, 184, 255],
          ]);
          workspace.touch();
        }}
      >
        {t("palette.loadDefault")}
      </button>
      {colors.length === 0 ? (
        <p className="panel-empty">{t("palette.empty")}</p>
      ) : (
        <div
          className="document-palette"
          role="listbox"
          aria-label={t("panel.palette")}
        >
          {colors.map((color) => {
            const duplicate = colors.some(
              (other) =>
                other.id !== color.id &&
                other.rgba.join(",") === color.rgba.join(","),
            );
            return (
              <div
                className={`palette-color ${entry.view.selectedPaletteColorId === color.id ? "active" : ""}`}
                key={color.id}
              >
                <button
                  className="palette-swatch"
                  role="option"
                  aria-selected={entry.view.selectedPaletteColorId === color.id}
                  aria-label={`${t("palette.slot")} ${color.index}, ${color.name ?? rgbaToHex(color.rgba)}, ${rgbaToHex(color.rgba)}${color.index === entry.session.model.palette.transparentIndex ? `, ${t("indexed.transparentIndex")}` : ""}`}
                  title={
                    duplicate ? t("palette.duplicate") : rgbaToHex(color.rgba)
                  }
                  style={{ background: colorCss(color.rgba) }}
                  onClick={() => {
                    entry.view.selectedPaletteColorId = color.id;
                    entry.view.foregroundIndex = color.index;
                    set(color.rgba);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    entry.view.background = color.rgba;
                    workspace.touch();
                  }}
                />
                <span className="palette-index" aria-hidden="true">{color.index}</span>
                <input
                  type="color"
                  aria-label={`${t("palette.slot")} ${color.index}`}
                  value={rgbaToHex(color.rgba).slice(0, 7)}
                  disabled={color.locked === true}
                  onChange={(event) => {
                    const next = parseHexColor(event.target.value, color.rgba[3]);
                    if (next !== null) { entry.session.setPaletteColor(color.id, next); workspace.invalidateCanvas(entry.id); }
                  }}
                />
                <button type="button" aria-pressed={color.locked === true} onClick={() => { entry.session.setPaletteLocked(color.id, color.locked !== true); workspace.touch(); }}>{color.locked ? "🔒" : "🔓"}</button>
                {entry.session.model.canvas.colorMode === "indexed" && <input type="radio" name="transparent-index" aria-label={`${t("indexed.transparentIndex")} ${color.index}`} checked={color.index === entry.session.model.palette.transparentIndex} onChange={() => { entry.session.setTransparentIndex(color.index); workspace.invalidateCanvas(entry.id); }} />}
                <input
                  aria-label={t("palette.name")}
                  value={color.name ?? ""}
                  placeholder={rgbaToHex(color.rgba)}
                  onChange={(event) => {
                    entry.session.renamePaletteColor(
                      color.id,
                      event.target.value,
                    );
                    workspace.touch();
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LayersPanel({
  workspace,
  commands,
  t,
}: {
  readonly workspace: WorkspaceStore;
  readonly commands: CommandRegistry;
  readonly t: Translate;
}) {
  const entry = workspace.active;
  if (entry === null)
    return <p className="panel-empty">{t("status.noDocument")}</p>;
  const { session, view } = entry,
    canvas = () => workspace.invalidateCanvas(entry.id);
  return (
    <div className="layers-panel">
      <div className="layer-actions">
        <IconButton
          label={t("layer.add")}
          icon="add"
          testId="layer-add"
          onClick={() => {
            void commands.execute("layer.add");
          }}
        />
        <button type="button" data-testid="layer-add-group" onClick={() => { void commands.execute("layer.addGroup"); }}>{t("layer.group")}</button>
        <button type="button" onClick={() => { void commands.execute("layer.indent"); }}>{t("layer.indent")}</button>
        <button type="button" onClick={() => { void commands.execute("layer.outdent"); }}>{t("layer.outdent")}</button>
        <IconButton
          label={t("layer.delete")}
          icon="delete"
          testId="layer-delete"
          disabled={session.model.layerOrder.length <= 1}
          onClick={() => {
            void commands.execute("layer.delete");
          }}
        />
        <IconButton
          label={t("layer.duplicate")}
          icon="duplicate"
          testId="layer-duplicate"
          onClick={() => {
            void commands.execute("layer.duplicate");
          }}
        />
      </div>
      <div className="layer-list">
        {[...session.model.layerOrder].reverse().map((id) => {
          const layer = session.model.layers[id];
          if (layer === undefined) return null;
          const index = session.model.layerOrder.indexOf(id);
          const depth = layerAncestors(session.model, id).length;
          const hiddenByCollapsedParent = layerAncestors(session.model, id).some((parentId) => !view.expandedGroupIds.has(parentId));
          if (hiddenByCollapsedParent) return null;
          return (
            <div
              className={`layer-row ${view.activeLayerId === id ? "active" : ""}`}
              key={id}
              tabIndex={0}
              role="option"
              aria-selected={view.activeLayerId === id}
              data-testid="layer-row"
              style={{ paddingInlineStart: `${depth * 1.1}rem` }}
              onClick={() => {
                view.activeLayerId = id;
                workspace.touch();
              }}
            >
              {layer.kind === "group" ? <button type="button" aria-expanded={view.expandedGroupIds.has(id)} aria-label={t("layer.expand")} onClick={(event) => { event.stopPropagation(); if (view.expandedGroupIds.has(id)) view.expandedGroupIds.delete(id); else view.expandedGroupIds.add(id); workspace.touch(); }}>{view.expandedGroupIds.has(id) ? "▾" : "▸"}</button> : <span aria-label={layer.kind === "tilemap" ? t("tilemap.layer") : t("layer.pixel")}>{layer.kind === "tilemap" ? "▦" : "▪"}</span>}
              <IconButton
                label={t("layer.visibility")}
                icon="eye"
                testId="layer-visibility"
                pressed={layer.visible}
                onClick={() => {
                  session.setLayerVisible(id, !layer.visible);
                  canvas();
                }}
              />
              <IconButton
                label={t("layer.lock")}
                icon="lock"
                pressed={layer.locked}
                onClick={() => {
                  session.setLayerLocked(id, !layer.locked);
                  workspace.touch();
                }}
              />
              <input
                aria-label={t("layer.name")}
                data-testid="layer-name"
                value={layer.name}
                onChange={(event) => {
                  session.renameLayer(id, event.target.value);
                  workspace.touch();
                }}
              />
              <div className="layer-order">
                <IconButton
                  label={t("layer.up")}
                  icon="up"
                  disabled={index === session.model.layerOrder.length - 1}
                  onClick={() => {
                    session.moveLayer(id, index + 1);
                    canvas();
                  }}
                />
                <IconButton
                  label={t("layer.down")}
                  icon="down"
                  disabled={index === 0}
                  onClick={() => {
                    session.moveLayer(id, index - 1);
                    canvas();
                  }}
                />
              </div>
              <label className="opacity-label">
                {Math.round(layer.opacity * 100)}%
                <input
                  aria-label={t("layer.opacity")}
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(layer.opacity * 100)}
                  onChange={(event) => {
                    session.setLayerOpacity(
                      id,
                      Number(event.target.value) / 100,
                    );
                    canvas();
                  }}
                />
              </label>
              <label className="blend-label">{t("blend.mode")}<select aria-label={t("blend.mode")} value={layer.blendMode} onChange={(event) => { void commands.execute("layer.setBlendMode", { layerId: id, blendMode: event.target.value }); }}>{BLEND_MODES.map((mode) => <option value={mode} key={mode}>{mode}</option>)}</select></label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolOptions({
  settings,
  workspace,
  commands,
  t,
}: {
  readonly settings: AppSettings;
  readonly workspace: WorkspaceStore;
  readonly commands: CommandRegistry;
  readonly t: Translate;
}) {
  const entry = workspace.active;
  if (entry === null)
    return <p className="panel-empty">{t("panel.empty.properties")}</p>;
  const tool = entry.view.activeTool,
    view = entry.view;
  const shape = (mode: ShapeFillMode, set: (mode: ShapeFillMode) => void) => (
    <label>
      {t("toolOptions.fillMode")}
      <select
        value={mode}
        onChange={(event) => {
          set(event.target.value as ShapeFillMode);
          workspace.touch();
        }}
      >
        <option value="outline">{t("toolOptions.outline")}</option>
        <option value="filled">{t("toolOptions.filled")}</option>
      </select>
    </label>
  );
  return (
    <div className="tool-options">
      <h3>{t(`tool.${tool}`)}</h3>
      <p className="mode-badge" aria-label={`${t("new.colorMode")}: ${entry.session.model.canvas.colorMode === "indexed" ? t("colorMode.indexed") : t("colorMode.rgba")}`}>{entry.session.model.canvas.colorMode === "indexed" ? t("colorMode.indexed") : t("colorMode.rgba")}</p>
      {(tool === "pencil" || tool === "eraser") && <>
        <label>{t("brush.preset")}<select value={view.brushPresetId ?? ""} onChange={(event) => { view.brushPresetId = event.target.value || null; workspace.touch(); }}><option value="">1 px Square</option>{settings.brushPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <button type="button" onClick={() => { void commands.execute("brush.createFromSelection"); }}>{t("command.brush.createFromSelection")}</button>
        <button type="button" onClick={() => { void commands.execute("brush.managePresets"); }}>{t("command.brush.managePresets")}</button>
        <label><input type="checkbox" checked={view.pixelPerfect} onChange={(event) => { view.pixelPerfect = event.target.checked; workspace.touch(); }} />{t("brush.pixelPerfect")}</label>
        <label>{t("symmetry.mode")}<select value={view.symmetry.mode} onChange={(event) => { view.symmetry = { ...view.symmetry, mode: event.target.value as typeof view.symmetry.mode }; workspace.touch(); }}><option value="off">{t("symmetry.off")}</option><option value="horizontal">{t("symmetry.horizontal")}</option><option value="vertical">{t("symmetry.vertical")}</option><option value="both">{t("symmetry.both")}</option></select></label>
        {view.symmetry.mode !== "off" && <div className="field-row"><label>{t("symmetry.axisX")}<input type="number" value={view.symmetry.axisX} onChange={(event) => { view.symmetry = { ...view.symmetry, axisX: Number(event.target.value) }; workspace.touch(); }} /></label><label>{t("symmetry.axisY")}<input type="number" value={view.symmetry.axisY} onChange={(event) => { view.symmetry = { ...view.symmetry, axisY: Number(event.target.value) }; workspace.touch(); }} /></label><button type="button" onClick={() => { view.symmetry = { ...view.symmetry, axisX: entry.session.model.canvas.width / 2 - .5, axisY: entry.session.model.canvas.height / 2 - .5 }; workspace.touch(); }}>{t("symmetry.reset")}</button></div>}
      </>}
      {tool === "fill" && <p>{t("toolOptions.toleranceZero")}</p>}
      {tool === "line" && <p>{t("toolOptions.onePixel")}</p>}
      {tool === "rectangle" &&
        shape(view.rectangleMode, (mode) => {
          view.rectangleMode = mode;
        })}
      {tool === "ellipse" &&
        shape(view.ellipseMode, (mode) => {
          view.ellipseMode = mode;
        })}
      {tool === "selectionRect" && (
        <label>
          {t("toolOptions.selectionMode")}
          <select
            value={view.selectionOperation}
            onChange={(event) => {
              view.selectionOperation = event.target
                .value as SelectionOperation;
              workspace.touch();
            }}
          >
            {(["replace", "add", "subtract", "intersect"] as const).map(
              (operation) => (
                <option value={operation} key={operation}>
                  {t(`selection.${operation}`)}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {tool === "move" && (
        <p>
          {view.selection.bounds === null
            ? t("toolOptions.moveLayer")
            : t("toolOptions.moveSelection")}
        </p>
      )}
      {tool.startsWith("tile") && <div className="tile-tool-options"><label>{t("tilemap.selectedTile")}<input type="number" min="0" value={view.selectedTileId} onChange={(event) => { view.selectedTileId = Math.max(0, Math.round(Number(event.target.value))); workspace.touch(); }} /></label><button type="button" onClick={() => { void commands.execute("tileset.import"); }}>{t("command.tileset.import")}</button><button type="button" onClick={() => { void commands.execute("layer.addTilemap"); }}>{t("command.layer.addTilemap")}</button></div>}
      <dl className="properties-list">
        <dt>{t("new.width")}</dt>
        <dd>{entry.session.model.canvas.width}</dd>
        <dt>{t("new.height")}</dt>
        <dd>{entry.session.model.canvas.height}</dd>
      </dl>
      <div className="transform-actions">
        <button
          data-testid="crop-selection"
          type="button"
          disabled={!commands.canExecute("sprite.cropToSelection")}
          onClick={() => {
            void commands.execute("sprite.cropToSelection");
          }}
        >
          {t("command.sprite.cropToSelection")}
        </button>
        <button
          data-testid="canvas-resize"
          type="button"
          onClick={() => {
            void commands.execute("sprite.canvasResize");
          }}
        >
          {t("command.sprite.canvasResize")}
        </button>
        <button
          data-testid="sprite-resize"
          type="button"
          onClick={() => {
            void commands.execute("sprite.spriteResize");
          }}
        >
          {t("command.sprite.spriteResize")}
        </button>
      </div>
    </div>
  );
}

function StatusBar({
  settings,
  commands,
  status,
  t,
  onLanguage,
}: {
  readonly settings: AppSettings;
  readonly commands: CommandRegistry;
  readonly status: CanvasStatusStore;
  readonly t: Translate;
  readonly onLanguage: (language: LanguageMode) => void;
}) {
  const canvas = useSyncExternalStore(
    (listener) => status.subscribe(listener),
    () => status.snapshot,
  );
  return (
    <footer className="status-bar">
      <div className="status-message">
        <span className="status-dot" />
        {t("status.ready")}
        <span className="status-separator" />
        <span>{canvas.x === null ? "—" : `${canvas.x}, ${canvas.y}`}</span>
        <span className="status-separator" />
        <span data-testid="zoom-status">{Math.round(canvas.zoom * 100)}%</span>
        {canvas.color !== null && (
          <>
            <span className="status-separator" />
            <span>
              {rgbaToHex(canvas.color)} · A{canvas.color[3]}
            </span>
          </>
        )}
      </div>
      <div className="status-controls">
        <label>
          {t("setting.language")}
          <select
            value={settings.language}
            onChange={(event) => onLanguage(event.target.value as LanguageMode)}
          >
            {LANGUAGE_MODES.map((value) => (
              <option value={value} key={value}>
                {t(`language.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("setting.theme")}
          <select
            data-testid="theme-select"
            value={settings.theme}
            onChange={(event) => {
              const map = {
                system: "view.setThemeSystem",
                dark: "view.setThemeDark",
                light: "view.setThemeLight",
              } as const;
              void commands.execute(
                map[event.target.value as keyof typeof map],
              );
            }}
          >
            {THEME_MODES.map((value) => (
              <option value={value} key={value}>
                {t(`theme.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("setting.uiScale")}
          <select
            data-testid="ui-scale-select"
            value={settings.uiScale}
            onChange={(event) => {
              void commands.execute(
                "view.setUiScale",
                Number(event.target.value),
              );
            }}
          >
            {UI_SCALES.map((value) => (
              <option value={value} key={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
        </label>
        <IconButton
          label={t("setting.resetLayout")}
          icon="reset"
          testId="reset-layout"
          onClick={() => {
            void commands.execute("view.resetLayout");
          }}
        />
      </div>
    </footer>
  );
}

const tools: readonly ToolId[] = [
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
  ],
  toolIcons: Record<ToolId, IconName> = {
    pencil: "pencil",
    eraser: "eraser",
    eyedropper: "eyedropper",
    fill: "fill",
    line: "line",
    rectangle: "rectangle",
    ellipse: "ellipse",
    selectionRect: "select",
    move: "move",
    tilePencil: "pencil",
    tileEraser: "eraser",
    tileEyedropper: "eyedropper",
    tileFill: "fill",
    tileSelection: "select",
    tileMove: "move",
  };
export function EditorShell({
  settings,
  panels,
  commands,
  workspace,
  status,
  t,
  onForeground,
  onLanguage,
  onResize,
  onCloseDocument,
  pluginOverlays = [],
  pluginTools = [],
  onPluginTool,
  onPluginToolEvent,
}: Props) {
  const active = workspace.active,
    right =
      panels.isVisible("layers") ||
      panels.isVisible("palette") ||
      panels.isVisible("properties") ||
      panels.isVisible("preview") ||
      panels.isVisible("brushes") ||
      panels.isVisible("tilesets") ||
      panels.isVisible("slices");
  return (
    <div className="app-shell" data-testid="workspace-shell">
      <header className="document-tabs">
        <div className="app-brand">
          <Icon name="app" />
          <span>{t("app.name")}</span>
        </div>
        <div className="tab-list" role="tablist">
          {workspace.documents.length === 0 ? (
            <div className="document-tab" role="tab" aria-selected="true">
              <Icon name="document" />
              {t("tabs.noDocument")}
            </div>
          ) : (
            workspace.documents.map((entry) => (
              <div
                className={`document-tab ${active?.id === entry.id ? "active" : ""}`}
                role="tab"
                tabIndex={active?.id === entry.id ? 0 : -1}
                aria-selected={active?.id === entry.id}
                key={entry.id}
                onClick={() => workspace.activate(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    workspace.activate(entry.id);
                  }
                }}
              >
                <span>
                  {entry.session.model.name}
                  {entry.session.isDirty ? " •" : ""}
                </span>
                <button
                  className="tab-close"
                  type="button"
                  aria-label={t("file.close")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseDocument(entry.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <div className="workspace-actions">
          <IconButton
            label={t("toolbar.toggleTools")}
            icon="tools"
            pressed={panels.isVisible("tools")}
            testId="toggle-tools"
            onClick={() => {
              void commands.execute("window.toggleTools");
            }}
          />
          <IconButton
            label={t("toolbar.toggleLayers")}
            icon="layers"
            pressed={panels.isVisible("layers")}
            testId="toggle-layers"
            onClick={() => {
              void commands.execute("window.toggleLayers");
            }}
          />
          <IconButton
            label={t("toolbar.commands")}
            icon="command"
            testId="open-command-palette"
            onClick={() => {
              void commands.execute("view.commandPalette");
            }}
          />
        </div>
      </header>
      <main className="workspace-main">
        {panels.isVisible("tools") && (
          <>
            <aside
              className="tool-panel"
              data-testid="panel-tools"
              style={{ width: `${settings.leftPanelWidth / 14}rem` }}
            >
              {tools.map((tool) => (
                <button
                  className="tool-button"
                  type="button"
                  data-testid={`tool-${tool}`}
                  aria-label={t(`tool.${tool}`)}
                  aria-pressed={active?.view.activeTool === tool}
                  disabled={active === null}
                  key={tool}
                  onClick={() => {
                    void commands.execute(`tool.${tool}`);
                  }}
                >
                  <Icon name={toolIcons[tool]} />
                </button>
              ))}
              {pluginTools.map(({ pluginId, contribution }) => (
                <button
                  className="tool-button plugin-tool-button"
                  type="button"
                  data-testid={`plugin-tool-${contribution.id}`}
                  aria-label={contribution.title}
                  title={contribution.title}
                  disabled={active === null || onPluginTool === undefined}
                  aria-pressed={
                    active?.view.pluginTool?.pluginId === pluginId &&
                    active.view.pluginTool.toolId === contribution.id
                  }
                  key={`${pluginId}:${contribution.id}`}
                  onClick={() => { if (onPluginTool !== undefined) void onPluginTool(pluginId, contribution.id); }}
                >
                  <Icon name="command" />
                </button>
              ))}
            </aside>
            <Splitter
              orientation="vertical"
              value={settings.leftPanelWidth}
              min={52}
              max={280}
              label={t("panel.tools")}
              direction={1}
              onChange={(value) => onResize("left", value)}
            />
          </>
        )}
        {active === null ? (
          <section className="canvas-workspace">
            <div className="empty-state">
              <div className="empty-state-icon">
                <Icon name="app" />
              </div>
              <h1>{t("empty.title")}</h1>
              <p>{t("empty.description.m2")}</p>
              <button
                type="button"
                data-testid="empty-new"
                onClick={() => {
                  void commands.execute("file.new");
                }}
              >
                <Icon name="add" />
                {t("new.title")}
              </button>
            </div>
          </section>
        ) : (
          <section className="canvas-workspace editor-active">
            <PixelCanvas
              key={active.id}
              entry={active}
              workspace={workspace}
              status={status}
              t={t}
              pluginOverlays={pluginOverlays}
              pluginTool={active.view.pluginTool}
              {...(onPluginToolEvent === undefined
                ? {}
                : { onPluginToolEvent })}
              brushPreset={settings.brushPresets.find((preset) => preset.id === active.view.brushPresetId)}
            />
          </section>
        )}
        {right && (
          <>
            <Splitter
              orientation="vertical"
              value={settings.rightPanelWidth}
              min={220}
              max={520}
              label={t("panel.layers")}
              direction={-1}
              onChange={(value) => onResize("right", value)}
            />
            <aside
              className="inspector"
              style={{ width: `${settings.rightPanelWidth / 14}rem` }}
            >
              {panels.isVisible("layers") && (
                <Panel
                  title={t("panel.layers")}
                  icon="layers"
                  testId="panel-layers"
                >
                  <LayersPanel
                    workspace={workspace}
                    commands={commands}
                    t={t}
                  />
                </Panel>
              )}
              {panels.isVisible("palette") && (
                <Panel
                  title={t("panel.palette")}
                  icon="palette"
                  testId="panel-palette"
                >
                  <PalettePanel
                    settings={settings}
                    workspace={workspace}
                    commands={commands}
                    t={t}
                    onForeground={onForeground}
                  />
                </Panel>
              )}
              {panels.isVisible("properties") && (
                <Panel
                  title={t("panel.properties")}
                  icon="properties"
                  testId="panel-properties"
                >
                  <ToolOptions
                    settings={settings}
                    workspace={workspace}
                    commands={commands}
                    t={t}
                  />
                </Panel>
              )}
              {panels.isVisible("preview") && (
                <Panel
                  title={t("panel.preview")}
                  icon="preview"
                  testId="panel-preview"
                >
                  <p className="panel-empty">
                    {active === null
                      ? t("panel.empty.preview")
                      : `${active.session.model.canvas.width} × ${active.session.model.canvas.height}`}
                  </p>
                </Panel>
              )}
              {panels.isVisible("brushes") && (
                <Panel title={t("panel.brushes")} icon="pencil" testId="panel-brushes">
                  <button type="button" onClick={() => { void commands.execute("brush.managePresets"); }}>{t("brush.manage")}</button>
                  <div className="manager-list">{settings.brushPresets.map((preset) => <button type="button" aria-pressed={active?.view.brushPresetId === preset.id} key={preset.id} onClick={() => { if (active !== null) { active.view.brushPresetId = preset.id; workspace.touch(); } }}>{preset.name} {preset.width}×{preset.height}</button>)}</div>
                </Panel>
              )}
              {panels.isVisible("tilesets") && (
                <Panel title={t("panel.tilesets")} icon="palette" testId="panel-tilesets">
                  <div className="panel-actions"><button type="button" onClick={() => { void commands.execute("tileset.import"); }}>{t("command.tileset.import")}</button><button type="button" onClick={() => { void commands.execute("layer.addTilemap"); }}>{t("command.layer.addTilemap")}</button></div>
                  {active === null || Object.keys(active.session.model.tileSets).length === 0 ? <p className="panel-empty">{t("tileset.empty")}</p> : <div className="manager-list" role="listbox">{Object.values(active.session.model.tileSets).map((tileSet) => <div className="manager-row" key={tileSet.id}><span>{tileSet.name} · {tileSet.tileWidth}×{tileSet.tileHeight} · {tileSet.tileCount}</span><button type="button" onClick={() => { void commands.execute("tileset.delete", tileSet.id); }}>{t("layout.delete")}</button></div>)}</div>}
                </Panel>
              )}
              {panels.isVisible("slices") && (
                <Panel title={t("panel.slices")} icon="select" testId="panel-slices">
                  <button type="button" onClick={() => { void commands.execute("slice.add"); }}>{t("command.slice.add")}</button>
                  {active === null || Object.keys(active.session.model.slices).length === 0 ? <p className="panel-empty">{t("slice.empty")}</p> : <div className="manager-list">{Object.values(active.session.model.slices).map((slice) => <div className="manager-row" key={slice.id}><span aria-label={`${slice.name}: ${slice.bounds.x}, ${slice.bounds.y}, ${slice.bounds.width} × ${slice.bounds.height}`}>{slice.name} · {slice.bounds.x},{slice.bounds.y} {slice.bounds.width}×{slice.bounds.height}{slice.center === undefined ? "" : " · 9-slice"}</span><button type="button" onClick={() => { void commands.execute("slice.edit", slice.id); }}>{t("command.slice.edit")}</button><button type="button" onClick={() => { void commands.execute("slice.delete", slice.id); }}>{t("layout.delete")}</button></div>)}</div>}
                </Panel>
              )}
            </aside>
          </>
        )}
      </main>
      {panels.isVisible("timeline") && (
        <>
          <Splitter
            orientation="horizontal"
            value={settings.timelineHeight}
            min={112}
            max={360}
            label={t("panel.timeline")}
            direction={-1}
            onChange={(value) => onResize("timeline", value)}
          />
          <section
            className="timeline-panel"
            data-testid="panel-timeline"
            style={{ height: `${settings.timelineHeight / 14}rem` }}
          >
            <header className="panel-header">
              <Icon name="timeline" />
              <h2>{t("panel.timeline")}</h2>
            </header>
            {active === null ? (
              <div className="timeline-empty">{t("panel.empty.timeline")}</div>
            ) : (
              <Timeline
                entry={active}
                workspace={workspace}
                commands={commands}
                t={t}
              />
            )}
          </section>
        </>
      )}
      <StatusBar
        settings={settings}
        commands={commands}
        status={status}
        t={t}
        onLanguage={onLanguage}
      />
    </div>
  );
}
