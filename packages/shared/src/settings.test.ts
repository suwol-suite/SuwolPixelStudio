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
    expect(settings.leftPanelWidth).toBe(52);
    expect(settings.rightPanelWidth).toBe(520);
    expect(settings.timelineHeight).toBe(112);
    expect(settings).not.toHaveProperty("unknown");
  });

  it("rejects settings from an unknown schema version", () => {
    expect(normalizeSettings({ version: 99, theme: "dark" })).toEqual(
      DEFAULT_SETTINGS,
    );
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
    expect(settings.layouts).toHaveLength(1);
    expect(settings.keybindings).toEqual(DEFAULT_SETTINGS.keybindings);
    expect(settings.recentColors).toEqual([]);
    expect(settings.brushPresets).toEqual([]);
  });
});
