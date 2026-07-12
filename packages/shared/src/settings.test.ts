import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  deserializeSettings,
  normalizeSettings,
  themeModeSchema,
  uiScaleSchema,
} from "./settings";

describe("settings validation", () => {
  it("accepts supported themes and rejects unknown themes", () => {
    expect(themeModeSchema.safeParse("dark").success).toBe(true);
    expect(themeModeSchema.safeParse("midnight").success).toBe(false);
  });

  it("accepts only supported UI scale values", () => {
    expect(uiScaleSchema.safeParse(1.25).success).toBe(true);
    expect(uiScaleSchema.safeParse(1.2).success).toBe(false);
  });

  it("recovers from malformed JSON", () => {
    expect(deserializeSettings("{broken")).toEqual(DEFAULT_SETTINGS);
  });

  it("restores valid fields, ignores unknown fields, and clamps layout dimensions", () => {
    const settings = normalizeSettings({
      version: 1,
      theme: "dark",
      language: "ko",
      uiScale: 1.5,
      panels: { tools: false, layers: "bad", unknown: true },
      leftPanelWidth: -50,
      rightPanelWidth: 5_000,
      timelineHeight: 50,
      unknown: "ignored",
    });
    expect(settings.theme).toBe("dark");
    expect(settings.panels.tools).toBe(false);
    expect(settings.panels.layers).toBe(DEFAULT_SETTINGS.panels.layers);
    expect(settings.leftPanelWidth).toBe(48);
    expect(settings.rightPanelWidth).toBe(720);
    expect(settings.timelineHeight).toBe(112);
    expect(settings).not.toHaveProperty("unknown");
  });
  it("migrates old layouts, ignores the resizable tool width and defaults Timeline off for new users", () => {
    expect(DEFAULT_SETTINGS.panels.timeline).toBe(false);
    expect(DEFAULT_SETTINGS.panels.brushes).toBe(false);
    const settings = normalizeSettings({ version: 2, panels: { timeline: true }, leftPanelWidth: 260 });
    expect(settings.panels.timeline).toBe(true);
    expect(settings.leftPanelWidth).toBe(48);
    expect(settings.layouts[0]?.schemaVersion).toBe(3);
    expect(settings.workspaceLayout.timelineVisible).toBe(true);
  });
  it.each([1, 2, 3] as const)("boots schema v%s settings with a valid workspace", (version) => {
    const settings = normalizeSettings({
      version,
      theme: "dark",
      panels: { layers: false, palette: false, properties: false, preview: false, timeline: false },
    });
    expect(settings.theme).toBe("dark");
    expect(settings.workspaceLayout.schemaVersion).toBe(3);
    expect(settings.workspaceLayout.timelineVisible).toBe(false);
  });

  it("rejects settings from an unknown schema version", () => {
    expect(normalizeSettings({ version: 99, theme: "dark" })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
  it("persists a customized built-in workspace before switching presets", () => {
    const customized = {
      ...structuredClone(DEFAULT_SETTINGS.workspaceLayout),
      rightDockWidth: 368,
      rightSplitRatio: 0.6,
      upperGroup: { panelIds: ["layers"], activePanelId: "layers" },
      lowerGroup: { panelIds: ["properties", "palette", "preview"], activePanelId: "palette" },
    };
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      workspaceLayout: customized,
      layouts: [customized, ...DEFAULT_SETTINGS.layouts.filter((layout) => layout.id !== customized.id)],
    });
    expect(settings.layouts.find((layout) => layout.id === "static-editing")).toMatchObject({
      rightDockWidth: 368,
      rightSplitRatio: 0.6,
      lowerGroup: { activePanelId: "palette" },
    });
  });
  it("validates, deduplicates and caps persisted recent colors", () => {
    const colors = Array.from({ length: 15 }, (_, index) => [
      index,
      index,
      index,
      255,
    ]);
    colors.push([1, 1, 1, 255]);
    const settings = normalizeSettings({
      version: 1,
      recentColors: colors.slice(0, 12),
    });
    expect(settings.recentColors).toHaveLength(12);
    expect(
      normalizeSettings({ version: 1, recentColors: [[1, 2, 3, 999]] })
        .recentColors,
    ).toEqual([]);
  });
  it("recovers corrupt preference areas without discarding valid siblings", () => {
    const settings = normalizeSettings({
      version: 2,
      theme: "light",
      language: "ko",
      uiScale: 2,
      layouts: [{ broken: true }],
      keybindings: { schemaVersion: 1, preset: "bad", entries: [] },
      recentColors: [[1, 2, 3, 999]],
      brushPresets: [{ id: "broken" }],
    });
    expect(settings).toMatchObject({ theme: "light", language: "ko", uiScale: 2 });
    expect(settings.layouts).toHaveLength(3);
    expect(settings.layouts.map((layout) => layout.id)).toEqual([
      "static-editing",
      "animation",
      "tilemap",
    ]);
    expect(settings.keybindings).toEqual(DEFAULT_SETTINGS.keybindings);
    expect(settings.recentColors).toEqual([]);
    expect(settings.brushPresets).toEqual([]);
  });
});
