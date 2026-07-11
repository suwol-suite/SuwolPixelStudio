import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_LAYOUT, findKeybindingConflicts, keybindingWarnings, moveLayoutPanel, normalizeShortcut, openDialogOptionsSchema, parseKeybindingSettings, parseWorkspaceLayout, recoverWorkspaceLayout, resolveKeybindingConflict } from "./index";

describe("M5 layout schema", () => {
  it("round-trips a dock tree and moves panels between tab groups", () => { const layout = parseWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT), moved = moveLayoutPanel(layout, "palette", "left-tabs", 1); expect(moved.root.type).toBe("split"); expect(JSON.stringify(moved)).toContain("palette"); });
  it("rejects duplicate panels and recovers malformed startup state", () => { const malformed = { ...DEFAULT_WORKSPACE_LAYOUT, root: { type: "split", id: "root", direction: "horizontal", ratio: .5, first: { type: "tabs", id: "a", edge: "left", panelIds: ["layers"], activePanelId: "layers", size: 100 }, second: { type: "tabs", id: "b", edge: "right", panelIds: ["layers"], activePanelId: "layers", size: 100 } } }; expect(() => parseWorkspaceLayout(malformed)).toThrow(); expect(recoverWorkspaceLayout(malformed).id).toBe(DEFAULT_WORKSPACE_LAYOUT.id); });
  it("preserves unknown plugin panel ids as inert layout entries", () => { const layout = structuredClone(DEFAULT_WORKSPACE_LAYOUT); if (layout.root.type === "split" && layout.root.second.type === "split" && layout.root.second.second.type === "tabs") (layout.root.second.second.panelIds as string[]).push("plugin.missing.panel"); expect(parseWorkspaceLayout(layout)).toEqual(layout); });
  it("accepts only bounded plugin-declared importer extensions", () => { expect(openDialogOptionsSchema.safeParse({ kind: "plugin-import", title: "Pixel JSON", extensions: [".pixeljson"] }).success).toBe(true); expect(openDialogOptionsSchema.safeParse({ kind: "plugin-import", title: "Bad", extensions: ["exe"] }).success).toBe(false); });
});

describe("M5 keybinding conflict policy", () => {
  const settings = parseKeybindingSettings({ schemaVersion: 1, preset: "suwol-default", entries: [{ commandId: "file.save", shortcuts: ["Ctrl+S"], context: "global" }, { commandId: "plugin.command", shortcuts: ["Ctrl+S"], context: "global" }] });
  it("normalizes chords and reports exact same-context collisions", () => { expect(normalizeShortcut("shift+ctrl+p")).toBe("Ctrl+Shift+P"); expect(findKeybindingConflicts(settings)[0]?.commandIds).toEqual(["file.save", "plugin.command"]); });
  it("removes an existing shortcut before applying replacement", () => { const resolved = resolveKeybindingConflict(settings, "plugin.command", "Ctrl+S", "global", "remove-existing"); expect(findKeybindingConflicts(resolved)).toHaveLength(0); expect(resolved.entries.find((entry) => entry.commandId === "file.save")?.shortcuts).toEqual([]); });
  it("warns for OS-reserved and unsafe unmodified character shortcuts", () => { expect(keybindingWarnings("Alt+F4", "global", "windows")).toContain("Shortcut is reserved by the operating system."); expect(keybindingWarnings("A", "canvas")).toContain("Unmodified character shortcuts are unsafe while typing."); });
  it("rejects malformed imported settings", () => expect(() => parseKeybindingSettings({ schemaVersion: 1, preset: "bad", entries: [] })).toThrow());
});
