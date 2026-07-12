import { z } from "zod";
import {
  BUILTIN_WORKSPACE_LAYOUTS,
  DEFAULT_WORKSPACE_LAYOUT,
  layoutPanelIds,
  recoverWorkspaceLayout,
  setLayoutPanelVisibility,
  type WorkspaceLayout,
} from "./layout";
import { KEYBINDING_SCHEMA_VERSION, parseKeybindingSettings, type KeybindingSettings } from "./keybindings";

export const SETTINGS_STORAGE_KEY = "suwol.pixel-studio.settings";
export const SETTINGS_SCHEMA_VERSION = 4 as const;

export const THEME_MODES = ["system", "dark", "light"] as const;
export const LANGUAGE_MODES = ["auto", "ko", "en"] as const;
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const PANEL_IDS = [
  "tools",
  "layers",
  "palette",
  "properties",
  "preview",
  "timeline",
  "brushes",
  "tilesets",
  "slices",
] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type LanguageMode = (typeof LANGUAGE_MODES)[number];
export type UiScale = (typeof UI_SCALES)[number];
export type PanelId = (typeof PANEL_IDS)[number];

export const themeModeSchema = z.enum(THEME_MODES);
export const languageModeSchema = z.enum(LANGUAGE_MODES);
export const uiScaleSchema = z.union(
  UI_SCALES.map((scale) => z.literal(scale)),
);

const persistedSettingsSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(SETTINGS_SCHEMA_VERSION)]),
  theme: z.unknown().optional(),
  language: z.unknown().optional(),
  uiScale: z.unknown().optional(),
  panels: z.unknown().optional(),
  leftPanelWidth: z.unknown().optional(),
  rightPanelWidth: z.unknown().optional(),
  timelineHeight: z.unknown().optional(),
  workspaceLayout: z.unknown().optional(),
  recentColors: z.unknown().optional(),
  layouts: z.unknown().optional(),
  activeLayoutId: z.unknown().optional(),
  keybindings: z.unknown().optional(),
  brushPresets: z.unknown().optional(),
  symmetry: z.unknown().optional(),
  editingHintDismissed: z.unknown().optional(),
});

export interface AppSettings {
  readonly version: typeof SETTINGS_SCHEMA_VERSION;
  readonly theme: ThemeMode;
  readonly language: LanguageMode;
  readonly uiScale: UiScale;
  readonly panels: Readonly<Record<PanelId, boolean>>;
  readonly leftPanelWidth: number;
  readonly rightPanelWidth: number;
  readonly timelineHeight: number;
  readonly workspaceLayout: WorkspaceLayout;
  readonly recentColors: readonly (readonly [number, number, number, number])[];
  readonly layouts: readonly WorkspaceLayout[];
  readonly activeLayoutId: string;
  readonly keybindings: KeybindingSettings;
  readonly brushPresets: readonly BrushPresetSetting[];
  readonly symmetry: Readonly<{ mode: "off" | "horizontal" | "vertical" | "both"; axisX: number; axisY: number }>;
  readonly editingHintDismissed: boolean;
}

export interface BrushPresetSetting {
  readonly id: string;
  readonly name: string;
  readonly kind: "square" | "circle" | "custom";
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly spacing: number;
  readonly angle: 0 | 90 | 180 | 270;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly center: Readonly<{ x: number; y: number }>;
  readonly mask?: string;
}

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  version: SETTINGS_SCHEMA_VERSION,
  theme: "system",
  language: "auto",
  uiScale: 1,
  panels: Object.freeze({
    tools: true,
    layers: true,
    palette: true,
    properties: true,
    preview: true,
    timeline: false,
    brushes: false,
    tilesets: false,
    slices: false,
  }),
  leftPanelWidth: 48,
  rightPanelWidth: 320,
  timelineHeight: 180,
  workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
  recentColors: Object.freeze([]),
  layouts: BUILTIN_WORKSPACE_LAYOUTS,
  activeLayoutId: DEFAULT_WORKSPACE_LAYOUT.id,
  keybindings: Object.freeze({ schemaVersion: KEYBINDING_SCHEMA_VERSION, preset: "suwol-default", entries: Object.freeze([]) }),
  brushPresets: Object.freeze([]),
  symmetry: Object.freeze({ mode: "off", axisX: 32, axisY: 32 }),
  editingHintDismissed: false,
});

function clampNumber(
  input: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(input)));
}

function parsedOrDefault<T>(
  schema: z.ZodType<T>,
  input: unknown,
  fallback: T,
): T {
  const result = schema.safeParse(input);
  return result.success ? result.data : fallback;
}

export function normalizeSettings(input: unknown): AppSettings {
  const root = persistedSettingsSchema.safeParse(input);
  if (!root.success) return DEFAULT_SETTINGS;

  const incomingPanels: Readonly<Record<string, unknown>> =
    typeof root.data.panels === "object" && root.data.panels !== null
      ? (root.data.panels as Readonly<Record<string, unknown>>)
      : {};

  const rgba = z.tuple([
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
    ]),
    parsedRecent = z.array(rgba).max(12).safeParse(root.data.recentColors),
    recentColors: readonly (readonly [number, number, number, number])[] =
      parsedRecent.success
        ? parsedRecent.data.filter(
            (color, index, all) =>
              all.findIndex((entry) => entry.join(",") === color.join(",")) ===
              index,
          )
        : [],
    layoutInput = Array.isArray(root.data.layouts) ? root.data.layouts.slice(0, 50) : [],
    recoveredLayouts = layoutInput.map(recoverWorkspaceLayout),
    layouts = [...recoveredLayouts, ...BUILTIN_WORKSPACE_LAYOUTS.map((layout) => structuredClone(layout))]
      .filter((layout, index, all) => all.findIndex((item) => item.id === layout.id) === index),
    activeLayoutId = typeof root.data.activeLayoutId === "string" && layouts.some((layout) => layout.id === root.data.activeLayoutId)
      ? root.data.activeLayoutId
      : DEFAULT_WORKSPACE_LAYOUT.id,
    keybindings = (() => { try { return parseKeybindingSettings(root.data.keybindings); } catch { return DEFAULT_SETTINGS.keybindings; } })(),
    brushSchema = z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(100), kind: z.enum(["square", "circle", "custom"]), width: z.number().int().min(1).max(64), height: z.number().int().min(1).max(64), opacity: z.number().min(0).max(1), spacing: z.number().min(1).max(256), angle: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), flipX: z.boolean(), flipY: z.boolean(), center: z.object({ x: z.number().int(), y: z.number().int() }).strict(), mask: z.string().max(1024).optional() }).strict(),
    parsedBrushes = z.array(brushSchema).max(100).safeParse(root.data.brushPresets),
    symmetrySchema = z.object({ mode: z.enum(["off", "horizontal", "vertical", "both"]), axisX: z.number().min(-8192).max(16384), axisY: z.number().min(-8192).max(16384) }).strict(),
    parsedSymmetry = symmetrySchema.safeParse(root.data.symmetry);
  let workspaceLayout = root.data.workspaceLayout === undefined
    ? structuredClone(recoveredLayouts.find((layout) => layout.id === activeLayoutId) ?? DEFAULT_WORKSPACE_LAYOUT)
    : recoverWorkspaceLayout(root.data.workspaceLayout);
  if (root.data.version < SETTINGS_SCHEMA_VERSION) {
    for (const id of PANEL_IDS) {
      const visible = incomingPanels[id];
      if (typeof visible === "boolean") workspaceLayout = setLayoutPanelVisibility(workspaceLayout, id, visible);
    }
    workspaceLayout = recoverWorkspaceLayout({
      ...workspaceLayout,
      rightDockWidth: clampNumber(root.data.rightPanelWidth, workspaceLayout.rightDockWidth, 220, 720),
      timelineHeight: clampNumber(root.data.timelineHeight, workspaceLayout.timelineHeight, 112, 420),
    });
  }
  const visiblePanels = new Set(layoutPanelIds(workspaceLayout)),
    panels = Object.fromEntries(PANEL_IDS.map((id) => [id, visiblePanels.has(id)])) as Record<PanelId, boolean>;
  return {
    version: SETTINGS_SCHEMA_VERSION,
    theme: parsedOrDefault(
      themeModeSchema,
      root.data.theme,
      DEFAULT_SETTINGS.theme,
    ),
    language: parsedOrDefault(
      languageModeSchema,
      root.data.language,
      DEFAULT_SETTINGS.language,
    ),
    uiScale: parsedOrDefault(
      uiScaleSchema,
      root.data.uiScale,
      DEFAULT_SETTINGS.uiScale,
    ),
    panels,
    leftPanelWidth: DEFAULT_SETTINGS.leftPanelWidth,
    rightPanelWidth: workspaceLayout.rightDockWidth,
    timelineHeight: workspaceLayout.timelineHeight,
    workspaceLayout,
    recentColors,
    layouts,
    activeLayoutId,
    keybindings,
    brushPresets: parsedBrushes.success
      ? parsedBrushes.data.map((preset) => ({
          ...preset,
          ...(preset.mask === undefined ? {} : { mask: preset.mask }),
        })) as readonly BrushPresetSetting[]
      : [],
    symmetry: parsedSymmetry.success ? parsedSymmetry.data : DEFAULT_SETTINGS.symmetry,
    editingHintDismissed:
      typeof root.data.editingHintDismissed === "boolean"
        ? root.data.editingHintDismissed
        : false,
  };
}

export function deserializeSettings(serialized: string | null): AppSettings {
  if (serialized === null) return DEFAULT_SETTINGS;
  try {
    return normalizeSettings(JSON.parse(serialized) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(normalizeSettings(settings));
}

export function resetLayout(settings: AppSettings): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    theme: settings.theme,
    language: settings.language,
    uiScale: settings.uiScale,
    editingHintDismissed: settings.editingHintDismissed,
  };
}
