import { describe, expect, it } from "vitest";
import { ANIMATION_LAYOUT, DEFAULT_WORKSPACE_LAYOUT, STATIC_EDITING_LAYOUT, TILEMAP_LAYOUT, activateLayoutPanel, findKeybindingConflicts, keybindingWarnings, moveLayoutPanel, normalizeShortcut, openDialogOptionsSchema, parseKeybindingSettings, parseWorkspaceLayout, recoverWorkspaceLayout, resolveKeybindingConflict, serializeWorkspaceLayout, setLayoutPanelVisibility } from "./index";

describe("RC9 layout schema", () => {
  it("starts with two right dock groups and mounts one active panel per group", () => {
    expect(DEFAULT_WORKSPACE_LAYOUT.upperGroup).toEqual({ panelIds: ["layers", "palette"], activePanelId: "layers" });
    expect(DEFAULT_WORKSPACE_LAYOUT.lowerGroup).toEqual({ panelIds: ["properties", "preview"], activePanelId: "properties" });
    expect(DEFAULT_WORKSPACE_LAYOUT.timelineVisible).toBe(false);
  });
  it("activates, reorders and moves tabs between groups", () => {
    const active = activateLayoutPanel(DEFAULT_WORKSPACE_LAYOUT, "upper", "palette"),
      moved = moveLayoutPanel(active, "palette", "lower", 1);
    expect(active.upperGroup?.activePanelId).toBe("palette");
    expect(moved.upperGroup?.panelIds).toEqual(["layers"]);
    expect(moved.lowerGroup).toEqual({ panelIds: ["properties", "palette", "preview"], activePanelId: "palette" });
  });
  it("closes, reopens and normalizes empty groups", () => {
    const withoutLayers = setLayoutPanelVisibility({ ...DEFAULT_WORKSPACE_LAYOUT, upperGroup: { panelIds: ["layers"], activePanelId: "layers" }, lowerGroup: null }, "layers", false),
      reopened = setLayoutPanelVisibility(withoutLayers, "layers", true);
    expect(withoutLayers.upperGroup).toBeNull();
    expect(withoutLayers.rightDockVisible).toBe(false);
    expect(reopened.upperGroup?.panelIds).toEqual(["layers"]);
    expect(reopened.rightDockVisible).toBe(true);
  });
  it("rejects duplicate panels and invalid size bounds, and recovers malformed state", () => {
    const duplicate = { ...DEFAULT_WORKSPACE_LAYOUT, lowerGroup: { panelIds: ["layers"], activePanelId: "layers" } };
    expect(() => parseWorkspaceLayout(duplicate)).toThrow();
    expect(() => parseWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT, rightDockWidth: 900 })).toThrow();
    expect(() => parseWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT, rightSplitRatio: 0.9 })).toThrow();
    expect(recoverWorkspaceLayout(duplicate)).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });
  it("preserves unknown plugin panel ids as inert layout entries", () => {
    const layout = { ...structuredClone(DEFAULT_WORKSPACE_LAYOUT), lowerGroup: { panelIds: ["properties", "plugin.missing.panel"], activePanelId: "properties" } };
    expect(parseWorkspaceLayout(layout)).toEqual(layout);
  });
  it("migrates named v1 layouts, preserves Timeline visibility and discards the old tool width", () => {
    const legacy = { schemaVersion: 2, id: "named-animation-layout", name: "Animation", root: { type: "split", id: "root", direction: "horizontal", ratio: 0.1, first: { type: "tabs", id: "left", edge: "left", panelIds: ["tools"], activePanelId: "tools", size: 360 }, second: { type: "split", id: "right", direction: "horizontal", ratio: 0.7, first: { type: "tabs", id: "bottom", edge: "bottom", panelIds: ["timeline"], activePanelId: "timeline", size: 240 }, second: { type: "tabs", id: "right-tabs", edge: "right", panelIds: ["layers", "plugin.example.panel"], activePanelId: "layers", size: 340 } } }, hiddenPanelIds: ["preview"] };
    const migrated = parseWorkspaceLayout(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.id).toBe("named-animation-layout");
    expect(migrated.timelineVisible).toBe(true);
    expect(migrated.timelineHeight).toBe(240);
    expect(migrated.rightDockWidth).toBe(340);
    expect(JSON.stringify(migrated)).toContain("plugin.example.panel");
    expect(parseWorkspaceLayout(JSON.parse(serializeWorkspaceLayout(migrated)))).toEqual(migrated);
  });
  it("provides distinct Static, Animation and Tilemap presets without document state", () => {
    expect(STATIC_EDITING_LAYOUT.timelineVisible).toBe(false);
    expect(ANIMATION_LAYOUT.timelineVisible).toBe(true);
    expect(ANIMATION_LAYOUT.lowerGroup?.activePanelId).toBe("preview");
    expect(TILEMAP_LAYOUT.upperGroup?.panelIds).toContain("tilesets");
    expect(TILEMAP_LAYOUT.timelineVisible).toBe(false);
  });
  it("accepts only bounded plugin-declared importer extensions", () => { expect(openDialogOptionsSchema.safeParse({ kind: "plugin-import", title: "Pixel JSON", extensions: [".pixeljson"] }).success).toBe(true); expect(openDialogOptionsSchema.safeParse({ kind: "plugin-import", title: "Bad", extensions: ["exe"] }).success).toBe(false); });
});

describe("M5 keybinding conflict policy", () => {
  const settings = parseKeybindingSettings({ schemaVersion: 1, preset: "suwol-default", entries: [{ commandId: "file.save", shortcuts: ["Ctrl+S"], context: "global" }, { commandId: "plugin.command", shortcuts: ["Ctrl+S"], context: "global" }] });
  it("normalizes chords and reports exact same-context collisions", () => { expect(normalizeShortcut("shift+ctrl+p")).toBe("Ctrl+Shift+P"); expect(findKeybindingConflicts(settings)[0]?.commandIds).toEqual(["file.save", "plugin.command"]); });
  it("removes an existing shortcut before applying replacement", () => { const resolved = resolveKeybindingConflict(settings, "plugin.command", "Ctrl+S", "global", "remove-existing"); expect(findKeybindingConflicts(resolved)).toHaveLength(0); expect(resolved.entries.find((entry) => entry.commandId === "file.save")?.shortcuts).toEqual([]); });
  it("warns for OS-reserved and unsafe unmodified character shortcuts", () => { expect(keybindingWarnings("Alt+F4", "global", "windows")).toContain("Shortcut is reserved by the operating system."); expect(keybindingWarnings("A", "canvas")).toContain("Unmodified character shortcuts are unsafe while typing."); });
  it("rejects malformed imported settings", () => expect(() => parseKeybindingSettings({ schemaVersion: 1, preset: "bad", entries: [] })).toThrow());
});
