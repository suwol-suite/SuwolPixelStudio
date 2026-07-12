import {
  useEffect,
  useRef,
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
import { BLEND_MODES, compositeFrame, getTilemapCel, layerAncestors } from "@suwol/editor-core";
import {
  activateLayoutPanel,
  LANGUAGE_MODES,
  moveLayoutPanel,
  setLayoutPanelVisibility,
  THEME_MODES,
  UI_SCALES,
  type AppSettings,
  type DockGroupId,
  type LanguageMode,
  type TabGroupLayout,
  type WorkspaceLayout,
} from "@suwol/shared";
import type { Translate } from "../i18n";
import {
  parseHexColor,
  rgbaToHex,
  type CanvasStatusStore,
  type ToolId,
  type WorkspaceDocument,
  type WorkspaceStore,
} from "../editor/workspace";
import { Icon, type IconName } from "./Icon";
import { PixelCanvas } from "./PixelCanvas";
import { Timeline } from "./Timeline";
import { Tooltip } from "./Tooltip";

interface Props {
  readonly settings: AppSettings;
  readonly commands: CommandRegistry;
  readonly workspace: WorkspaceStore;
  readonly status: CanvasStatusStore;
  readonly t: Translate;
  readonly onForeground: (color: Rgba) => void;
  readonly onLanguage: (language: LanguageMode) => void;
  readonly onResize: (
    dimension: "right" | "timeline",
    value: number,
  ) => void;
  readonly onLayoutChange: (layout: WorkspaceLayout) => void;
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
  description,
  shortcut,
  disabledReason,
  onClick,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly pressed?: boolean;
  readonly testId?: string;
  readonly disabled?: boolean;
  readonly description?: string;
  readonly shortcut?: string;
  readonly disabledReason?: string;
  readonly onClick: () => void;
}) {
  return <Tooltip metadata={{ name: label, description: description ?? label, ...(shortcut === undefined ? {} : { shortcut }), ...(disabled === true && disabledReason !== undefined ? { disabledReason } : {}) }}>
    {(descriptionId) => <button className="icon-button" type="button" aria-label={label} aria-describedby={descriptionId} aria-pressed={pressed} data-testid={testId} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>}
  </Tooltip>;
}
function Splitter({
  orientation,
  value,
  min,
  max,
  label,
  resetLabel,
  direction,
  resetValue,
  onChange,
}: {
  readonly orientation: "vertical" | "horizontal";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly resetLabel: string;
  readonly direction: 1 | -1;
  readonly resetValue?: number;
  readonly onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  function start(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    document.documentElement.dataset.resizing = "true";
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
        delete document.documentElement.dataset.resizing;
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
      title={`${label} — ${resetLabel}`}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => onChange(resetValue ?? Math.round((min + max) / 2))}
      onKeyDown={key}
    />
  );
}

const panelIcons: Readonly<Record<string, IconName>> = {
  layers: "layers",
  palette: "palette",
  properties: "properties",
  preview: "preview",
  brushes: "pencil",
  tilesets: "palette",
  slices: "select",
};

function DockGroup({ id, group, layout, t, children, onChange, onClose }: {
  readonly id: DockGroupId;
  readonly group: TabGroupLayout;
  readonly layout: WorkspaceLayout;
  readonly t: Translate;
  readonly children: ReactNode;
  readonly onChange: (layout: WorkspaceLayout) => void;
  readonly onClose?: (panelId: string) => void;
}) {
  const active = group.activePanelId ?? group.panelIds[0] ?? null;
  function focusTab(panelId: string): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dock-tab="${panelId}"]`)?.focus());
  }
  function close(panelId: string): void {
    const index = group.panelIds.indexOf(panelId), next = group.panelIds[index + 1] ?? group.panelIds[index - 1] ?? null;
    onClose?.(panelId);
    if (next !== null) focusTab(next);
  }
  return <section className="dock-group" data-testid={`right-${id}-group`}>
    <div className="dock-tabs" role="tablist" aria-label={t(id === "upper" ? "dock.upperGroup" : "dock.lowerGroup")}>
      {group.panelIds.map((panelId, index) => {
        const selected = panelId === active;
        return <div
          className={`dock-tab ${selected ? "active" : ""}`}
          role="tab"
          aria-selected={selected}
          aria-controls={`dock-panel-${id}`}
          tabIndex={selected ? 0 : -1}
          draggable
          data-dock-tab={panelId}
          title={`${t(`panel.${panelId}`)} — ${t("tooltip.dock.tab")}`}
          key={panelId}
          onClick={() => onChange(activateLayoutPanel(layout, id, panelId))}
          onDragStart={(event) => event.dataTransfer.setData("text/panel-id", panelId)}
          onDragOver={(event) => { event.preventDefault(); event.currentTarget.dataset.dropTarget = "true"; }}
          onDragLeave={(event) => { delete event.currentTarget.dataset.dropTarget; }}
          onDrop={(event) => {
            event.preventDefault();
            delete event.currentTarget.dataset.dropTarget;
            const moved = event.dataTransfer.getData("text/panel-id");
            if (moved !== "") onChange(moveLayoutPanel(layout, moved, id, index));
          }}
          onKeyDown={(event) => {
            const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
            if (offset !== 0) {
              event.preventDefault();
              const next = group.panelIds[(index + offset + group.panelIds.length) % group.panelIds.length];
              if (next !== undefined) { onChange(activateLayoutPanel(layout, id, next)); focusTab(next); }
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const next = event.key === "Home" ? group.panelIds[0] : group.panelIds.at(-1);
              if (next !== undefined) { onChange(activateLayoutPanel(layout, id, next)); focusTab(next); }
            } else if (event.key === "Delete") {
              event.preventDefault();
              close(panelId);
            } else if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              const target: DockGroupId = event.key === "ArrowUp" ? "upper" : "lower";
              onChange(moveLayoutPanel(layout, panelId, target, target === "upper" ? layout.upperGroup?.panelIds.length ?? 0 : layout.lowerGroup?.panelIds.length ?? 0));
            }
          }}
        >
          <Icon name={panelIcons[panelId] ?? "command"} />
          <span>{t(`panel.${panelId}`)}</span>
          <Tooltip metadata={{ name: t("dock.closePanel"), description: t("tooltip.dock.closePanel") }}>
            {(descriptionId) => <button type="button" className="dock-tab-close" aria-label={t("dock.closePanel")} aria-describedby={descriptionId} onClick={(event) => { event.stopPropagation(); close(panelId); }}><Icon name="close" /></button>}
          </Tooltip>
        </div>;
      })}
    </div>
    <div className="dock-panel-content" id={`dock-panel-${id}`} role="tabpanel" aria-label={active === null ? undefined : t(`panel.${active}`)} data-testid={active === null ? undefined : `panel-${active}`}>
      {children}
    </div>
  </section>;
}

function DockRatioSplitter({ value, t, onChange }: { readonly value: number; readonly t: Translate; readonly onChange: (value: number) => void }) {
  function start(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (container === null) return;
    document.documentElement.dataset.resizing = "true";
    const move = (pointer: PointerEvent): void => {
        const rect = container.getBoundingClientRect();
        onChange(Math.min(0.75, Math.max(0.25, (pointer.clientY - rect.top) / Math.max(1, rect.height))));
      },
      stop = (): void => {
        delete document.documentElement.dataset.resizing;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  return <div
    className="splitter splitter-horizontal dock-group-splitter"
    role="separator"
    aria-label={t("dock.groupResize")}
    aria-orientation="horizontal"
    aria-valuemin={25}
    aria-valuemax={75}
    aria-valuenow={Math.round(value * 100)}
    title={`${t("dock.groupResize")} — ${t("layout.resetPanelSize")}`}
    tabIndex={0}
    onPointerDown={start}
    onDoubleClick={() => onChange(0.55)}
    onKeyDown={(event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 0.05 : -0.05;
      onChange(Math.min(0.75, Math.max(0.25, value + offset)));
    }}
  />;
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
        <Tooltip metadata={{ name: t("color.foreground"), description: t("color.foreground") }}>
          {(descriptionId) => <button aria-label={t("color.foreground")} aria-describedby={descriptionId} style={{ background: colorCss(fg) }} />}
        </Tooltip>
        <Tooltip metadata={{ name: t("color.background"), description: t("color.background") }}>
          {(descriptionId) => <button aria-label={t("color.background")} aria-describedby={descriptionId} style={{ background: colorCss(entry.view.background) }} />}
        </Tooltip>
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
          <Tooltip key={color.join("-")} metadata={{ name: rgbaToHex(color), description: t("palette.recent") }}>
            {(descriptionId) => <button aria-label={rgbaToHex(color)} aria-describedby={descriptionId} style={{ background: colorCss(color) }} onClick={() => set(color)} />}
          </Tooltip>
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
          disabledReason={t("tooltip.disabled.paletteSelection")}
          onClick={() => {
            void commands.execute("palette.delete");
          }}
        />
        <IconButton
          label={t("palette.up")}
          icon="up"
          disabled={entry.view.selectedPaletteColorId === null}
          disabledReason={t("tooltip.disabled.paletteSelection")}
          onClick={() => {
            void commands.execute("palette.moveUp");
          }}
        />
        <IconButton
          label={t("palette.down")}
          icon="down"
          disabled={entry.view.selectedPaletteColorId === null}
          disabledReason={t("tooltip.disabled.paletteSelection")}
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
                <Tooltip metadata={{ name: `${t("palette.slot")} ${color.index}`, description: duplicate ? t("palette.duplicate") : rgbaToHex(color.rgba) }}>
                  {(descriptionId) => <button
                    className="palette-swatch"
                    role="option"
                    aria-selected={entry.view.selectedPaletteColorId === color.id}
                    aria-label={`${t("palette.slot")} ${color.index}, ${color.name ?? rgbaToHex(color.rgba)}, ${rgbaToHex(color.rgba)}${color.index === entry.session.model.palette.transparentIndex ? `, ${t("indexed.transparentIndex")}` : ""}`}
                    aria-describedby={descriptionId}
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
                  />}
                </Tooltip>
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
                <Tooltip metadata={{ name: t("layer.lock"), description: t("layer.lock") }}>
                  {(descriptionId) => <button type="button" aria-label={t("layer.lock")} aria-describedby={descriptionId} aria-pressed={color.locked === true} onClick={() => { entry.session.setPaletteLocked(color.id, color.locked !== true); workspace.touch(); }}>{color.locked ? "🔒" : "🔓"}</button>}
                </Tooltip>
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
  const activate = (id: string): void => { view.activeLayerId = id; workspace.touch(); };
  return (
    <div className="layers-panel">
      <div className="layer-actions" role="toolbar" aria-label={t("layer.toolbar")}>
        <IconButton
          label={t("layer.add")}
          description={t("tooltip.layer.add")}
          icon="add"
          testId="layer-add"
          onClick={() => {
            void commands.execute("layer.add");
          }}
        />
        <IconButton label={t("layer.group")} description={t("tooltip.layer.group")} icon="layers" testId="layer-add-group" onClick={() => { void commands.execute("layer.addGroup"); }} />
        <IconButton label={t("tilemap.layer")} description={t("tooltip.layer.tilemap")} icon="palette" onClick={() => { void commands.execute("layer.addTilemap"); }} />
        <IconButton label={t("layer.duplicate")} description={t("tooltip.layer.duplicate")} icon="duplicate" testId="layer-duplicate" onClick={() => { void commands.execute("layer.duplicate"); }} />
        <IconButton label={t("command.layer.mergeDown")} description={t("tooltip.layer.mergeDown")} icon="down" disabled={!commands.canExecute("layer.mergeDown")} disabledReason={t("tooltip.disabled.layerMerge")} onClick={() => { void commands.execute("layer.mergeDown"); }} />
        <IconButton
          label={t("layer.delete")}
          icon="delete"
          testId="layer-delete"
          disabled={session.model.layerOrder.length <= 1}
          disabledReason={t("tooltip.disabled.lastLayer")}
          onClick={() => {
            void commands.execute("layer.delete");
          }}
        />
      </div>
      <div className="layer-list" role="tree" aria-label={t("panel.layers")}>
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
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={layer.kind === "group" ? view.expandedGroupIds.has(id) : undefined}
              aria-selected={view.activeLayerId === id}
              data-testid="layer-row"
              style={{ paddingInlineStart: `${depth * 1.1}rem` }}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/layer-id", id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const dragged = event.dataTransfer.getData("text/layer-id"); if (session.model.layers[dragged] !== undefined) { session.moveLayer(dragged, index); canvas(); } }}
              onClick={() => activate(id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const visible = [...session.model.layerOrder].reverse().filter((layerId) => !layerAncestors(session.model, layerId).some((parentId) => !view.expandedGroupIds.has(parentId))), current = visible.indexOf(id), next = visible[current + (event.key === "ArrowUp" ? -1 : 1)];
                  if (next !== undefined) activate(next);
                } else if (event.key === "ArrowRight") { event.preventDefault(); void commands.execute(layer.kind === "group" ? "layer.indent" : "layer.indent"); }
                else if (event.key === "ArrowLeft") { event.preventDefault(); void commands.execute("layer.outdent"); }
              }}
            >
              {layer.kind === "group" ? <Tooltip metadata={{ name: t("layer.expand"), description: t("layer.expand") }}>
                {(descriptionId) => <button className="layer-expand" type="button" aria-expanded={view.expandedGroupIds.has(id)} aria-label={t("layer.expand")} aria-describedby={descriptionId} onClick={(event) => { event.stopPropagation(); if (view.expandedGroupIds.has(id)) view.expandedGroupIds.delete(id); else view.expandedGroupIds.add(id); workspace.touch(); }}>{view.expandedGroupIds.has(id) ? "▾" : "▸"}</button>}
              </Tooltip> : <span className="layer-expand" aria-hidden="true" />}
              <span className={`layer-thumbnail layer-kind-${layer.kind}`} aria-label={layer.kind === "group" ? t("layer.group") : layer.kind === "tilemap" ? t("tilemap.layer") : t("layer.pixel")}><Icon name={layer.kind === "group" ? "layers" : layer.kind === "tilemap" ? "palette" : "document"} /></span>
              <input
                className="layer-name"
                aria-label={t("layer.name")}
                data-testid="layer-name"
                value={layer.name}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => { session.renameLayer(id, event.target.value); workspace.touch(); }}
              />
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
    view = entry.view,
    layer = entry.session.model.layers[view.activeLayerId],
    selection = view.selection.bounds,
    tilemap = layer?.kind === "tilemap"
      ? (() => {
          const tileSet = entry.session.model.tileSets[layer.tileSetId],
            cel = getTilemapCel(entry.session.model, layer.id, view.activeFrameId),
            image = cel === null ? undefined : entry.session.model.tilemaps[cel.tilemapImageId];
          return { tileSet, image };
        })()
      : null;
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
      <section className="layer-properties" data-testid="layer-properties">
        <h3>{t("layer.properties")}</h3>
        {layer === undefined ? <p className="panel-empty">{t("layer.noneSelected")}</p> : <>
          <label>{t("layer.name")}<input value={layer.name} onChange={(event) => { entry.session.renameLayer(layer.id, event.target.value); workspace.touch(); }} /></label>
          <label>{t("layer.opacity")}<span className="property-range"><input type="range" min="0" max="100" value={Math.round(layer.opacity * 100)} onChange={(event) => { entry.session.setLayerOpacity(layer.id, Number(event.target.value) / 100); workspace.invalidateCanvas(entry.id); }} /><output>{Math.round(layer.opacity * 100)}%</output></span></label>
          <label>{t("blend.mode")}<select aria-label={t("blend.mode")} value={layer.blendMode} onChange={(event) => { void commands.execute("layer.setBlendMode", { layerId: layer.id, blendMode: event.target.value }); }}>{BLEND_MODES.map((mode) => <option value={mode} key={mode}>{mode}</option>)}</select></label>
          <dl className="properties-list"><dt>{t("layer.kind")}</dt><dd>{layer.kind === "group" ? t("layer.group") : layer.kind === "tilemap" ? t("tilemap.layer") : t("layer.pixel")}</dd>
          {tilemap !== null && <><dt>{t("properties.tileSet")}</dt><dd>{tilemap.tileSet?.name ?? t("properties.unavailable")}</dd><dt>{t("properties.tilemapSize")}</dt><dd>{tilemap.image === undefined ? t("properties.unavailable") : `${tilemap.image.widthInTiles} × ${tilemap.image.heightInTiles}`}</dd></>}</dl>
        </>}
      </section>
      <section className="tool-properties">
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
      {selection !== null && <section className="selection-properties"><h3>{t("properties.selection")}</h3><dl className="properties-list"><dt>{t("properties.position")}</dt><dd>{selection.x}, {selection.y}</dd><dt>{t("properties.size")}</dt><dd>{selection.width} × {selection.height}</dd></dl></section>}
      <details className="advanced-properties">
        <summary>{t("properties.canvasActions")}</summary>
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
      </details>
      </section>
    </div>
  );
}

function PreviewPanel({ entry, t }: { readonly entry: WorkspaceDocument | null; readonly t: Translate }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (entry === null || canvas.current === null) return;
    const width = entry.session.model.canvas.width,
      height = entry.session.model.canvas.height,
      context = canvas.current.getContext("2d");
    canvas.current.width = width;
    canvas.current.height = height;
    context?.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(entry.session, entry.view.activeFrameId)), width, height), 0, 0);
  }, [entry, entry?.session.model.revision, entry?.view.activeFrameId]);
  if (entry === null) return <p className="panel-empty">{t("panel.empty.preview")}</p>;
  return <div className="preview-panel">
    <canvas ref={canvas} className="pixel-preview" aria-label={t("preview.canvas")} />
    <span>{entry.session.model.canvas.width} × {entry.session.model.canvas.height}</span>
  </div>;
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
        <span className="status-hint">{t("status.panHint")}</span>
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
  },
  toolShortcuts: Partial<Record<ToolId, string>> = {
    pencil: "P", eraser: "E", eyedropper: "I", fill: "G", line: "L",
    rectangle: "R", ellipse: "Shift+O", selectionRect: "S", move: "M",
  };
export function EditorShell({
  settings,
  commands,
  workspace,
  status,
  t,
  onForeground,
  onLanguage,
  onResize,
  onLayoutChange,
  onCloseDocument,
  pluginOverlays = [],
  pluginTools = [],
  onPluginTool,
  onPluginToolEvent,
}: Props) {
  const active = workspace.active,
    layout = settings.workspaceLayout,
    right = layout.rightDockVisible && (layout.upperGroup !== null || layout.lowerGroup !== null);
  const closePanel = (panelId: string): void => {
    const commandId = panelId === "layers" ? "window.toggleLayers"
      : panelId === "palette" ? "window.togglePalette"
        : panelId === "properties" ? "window.toggleProperties"
          : panelId === "preview" ? "window.togglePreview"
            : panelId === "tilesets" ? "window.toggleTilesets"
              : undefined;
    if (commandId === undefined) onLayoutChange(setLayoutPanelVisibility(layout, panelId, false));
    else void commands.execute(commandId);
  };
  const panelContent = (panelId: string): ReactNode => {
    if (panelId === "layers") return <LayersPanel workspace={workspace} commands={commands} t={t} />;
    if (panelId === "palette") return <PalettePanel settings={settings} workspace={workspace} commands={commands} t={t} onForeground={onForeground} />;
    if (panelId === "properties") return <ToolOptions settings={settings} workspace={workspace} commands={commands} t={t} />;
    if (panelId === "preview") return <PreviewPanel entry={active} t={t} />;
    if (panelId === "brushes") return <><button type="button" onClick={() => { void commands.execute("brush.managePresets"); }}>{t("brush.manage")}</button><div className="manager-list">{settings.brushPresets.map((preset) => <button type="button" aria-pressed={active?.view.brushPresetId === preset.id} key={preset.id} onClick={() => { if (active !== null) { active.view.brushPresetId = preset.id; workspace.touch(); } }}>{preset.name} {preset.width}×{preset.height}</button>)}</div></>;
    if (panelId === "tilesets") return <><div className="panel-actions"><button type="button" onClick={() => { void commands.execute("tileset.import"); }}>{t("command.tileset.import")}</button><button type="button" onClick={() => { void commands.execute("layer.addTilemap"); }}>{t("command.layer.addTilemap")}</button></div>{active === null || Object.keys(active.session.model.tileSets).length === 0 ? <p className="panel-empty">{t("tileset.empty")}</p> : <div className="manager-list" role="listbox">{Object.values(active.session.model.tileSets).map((tileSet) => <div className="manager-row" key={tileSet.id}><span>{tileSet.name} · {tileSet.tileWidth}×{tileSet.tileHeight} · {tileSet.tileCount}</span><button type="button" onClick={() => { void commands.execute("tileset.delete", tileSet.id); }}>{t("layout.delete")}</button></div>)}</div>}</>;
    if (panelId === "slices") return <><button type="button" onClick={() => { void commands.execute("slice.add"); }}>{t("command.slice.add")}</button>{active === null || Object.keys(active.session.model.slices).length === 0 ? <p className="panel-empty">{t("slice.empty")}</p> : <div className="manager-list">{Object.values(active.session.model.slices).map((slice) => <div className="manager-row" key={slice.id}><span aria-label={`${slice.name}: ${slice.bounds.x}, ${slice.bounds.y}, ${slice.bounds.width} × ${slice.bounds.height}`}>{slice.name} · {slice.bounds.x},{slice.bounds.y} {slice.bounds.width}×{slice.bounds.height}{slice.center === undefined ? "" : " · 9-slice"}</span><button type="button" onClick={() => { void commands.execute("slice.edit", slice.id); }}>{t("command.slice.edit")}</button><button type="button" onClick={() => { void commands.execute("slice.delete", slice.id); }}>{t("layout.delete")}</button></div>)}</div>}</>;
    return <p className="panel-empty">{t("dock.panelUnavailable")}</p>;
  };
  return (
    <div className="app-shell" data-testid="workspace-shell">
      <header className="document-tabs">
        <div className="tab-list" role="tablist" aria-label={t("tabs.documents")}>
          {workspace.documents.map((entry, index) => (
              <div
                className={`document-tab ${active?.id === entry.id ? "active" : ""}`}
                role="tab"
                tabIndex={active?.id === entry.id ? 0 : -1}
                aria-selected={active?.id === entry.id}
                key={entry.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/document-id", entry.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); workspace.reorder(event.dataTransfer.getData("text/document-id"), index); }}
                onClick={() => workspace.activate(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    workspace.activate(entry.id);
                  }
                }}
              >
                <Tooltip metadata={{ name: t("tabs.documentIcon"), description: t("tooltip.documentTab") }}>
                  {(descriptionId) => <span className="document-tab-icon" aria-describedby={descriptionId}><Icon name="document" /></span>}
                </Tooltip>
                <span className="document-tab-name">
                  {entry.session.model.name}
                  {entry.session.isDirty ? " •" : ""}
                </span>
                <Tooltip metadata={{ name: t("file.close"), description: t("file.close") }}>
                  {(descriptionId) => (
                    <button
                      className="tab-close"
                      type="button"
                      aria-label={t("file.close")}
                      aria-describedby={descriptionId}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseDocument(entry.id);
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </Tooltip>
              </div>
            ))}
        </div>
        <div className="workspace-actions">
          <IconButton
            label={t("toolbar.toggleTools")}
            icon="tools"
            pressed={layout.toolsVisible}
            testId="toggle-tools"
            onClick={() => {
              void commands.execute("window.toggleTools");
            }}
          />
          <IconButton
            label={t("toolbar.toggleRightDock")}
            description={t("tooltip.dock.toggle")}
            icon="layers"
            pressed={right}
            testId="toggle-right-dock"
            onClick={() => {
              void commands.execute("window.toggleRightDock");
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
        {layout.toolsVisible && (
            <aside
              className="tool-panel"
              data-testid="panel-tools"
              aria-label={t("panel.tools")}
            >
              {tools.map((tool) => (
                <IconButton
                  label={t(`tool.${tool}`)}
                  description={t(`tooltip.tool.${tool}`)}
                  {...(toolShortcuts[tool] === undefined ? {} : { shortcut: toolShortcuts[tool] })}
                  icon={toolIcons[tool]}
                  testId={`tool-${tool}`}
                  pressed={active?.view.activeTool === tool}
                  disabled={active === null}
                  disabledReason={t("tooltip.disabled.noDocument")}
                  key={tool}
                  onClick={() => {
                    void commands.execute(`tool.${tool}`);
                  }}
                />
              ))}
              {pluginTools.map(({ pluginId, contribution }) => (
                <IconButton
                  label={contribution.title}
                  description={t("tooltip.pluginTool")}
                  icon="command"
                  testId={`plugin-tool-${contribution.id}`}
                  disabled={active === null || onPluginTool === undefined}
                  disabledReason={t("tooltip.disabled.noDocument")}
                  pressed={
                    active?.view.pluginTool?.pluginId === pluginId &&
                    active.view.pluginTool.toolId === contribution.id
                  }
                  key={`${pluginId}:${contribution.id}`}
                  onClick={() => { if (onPluginTool !== undefined) void onPluginTool(pluginId, contribution.id); }}
                />
              ))}
            </aside>
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
              value={layout.rightDockWidth}
              min={220}
              max={720}
              resetValue={320}
              label={t("dock.resize")}
              resetLabel={t("layout.resetPanelSize")}
              direction={-1}
              onChange={(value) => onResize("right", value)}
            />
            <aside
              className="inspector right-dock"
              data-testid="right-dock"
              aria-label={t("dock.right")}
              style={{ width: `${layout.rightDockWidth}px` }}
            >
              <div
                className="right-dock-groups"
                style={{ gridTemplateRows: layout.upperGroup !== null && layout.lowerGroup !== null ? `${layout.rightSplitRatio}fr auto ${1 - layout.rightSplitRatio}fr` : "minmax(0, 1fr)" }}
              >
                {layout.upperGroup !== null && <DockGroup id="upper" group={layout.upperGroup} layout={layout} t={t} onChange={onLayoutChange} onClose={closePanel}>{panelContent(layout.upperGroup.activePanelId ?? layout.upperGroup.panelIds[0] ?? "")}</DockGroup>}
                {layout.upperGroup !== null && layout.lowerGroup !== null && <DockRatioSplitter value={layout.rightSplitRatio} t={t} onChange={(rightSplitRatio) => onLayoutChange({ ...layout, rightSplitRatio })} />}
                {layout.lowerGroup !== null && <DockGroup id="lower" group={layout.lowerGroup} layout={layout} t={t} onChange={onLayoutChange} onClose={closePanel}>{panelContent(layout.lowerGroup.activePanelId ?? layout.lowerGroup.panelIds[0] ?? "")}</DockGroup>}
              </div>
            </aside>
          </>
        )}
      </main>
      {layout.timelineVisible && (
        <>
          <Splitter
            orientation="horizontal"
            value={layout.timelineHeight}
            min={112}
            max={420}
            resetValue={180}
            label={t("panel.timeline")}
            resetLabel={t("layout.resetPanelSize")}
            direction={-1}
            onChange={(value) => onResize("timeline", value)}
          />
          <section
            className="timeline-panel"
            data-testid="panel-timeline"
            style={{ height: `${layout.timelineHeight}px` }}
          >
            <header className="panel-header">
              <Icon name="timeline" />
              <h2>{t("panel.timeline")}</h2>
              <IconButton label={t("timeline.close")} description={t("tooltip.timeline.close")} icon="close" testId="timeline-close" onClick={() => { void commands.execute("window.toggleTimeline"); }} />
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
