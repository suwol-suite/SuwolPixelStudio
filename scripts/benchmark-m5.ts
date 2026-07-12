import { performance } from "node:perf_hooks";
import {
  blendRgba,
  convertRgbaToIndexed,
  pixelPerfectPoints,
  remapIndices,
  spacedBrushStroke,
  visibleTileRange,
  type BrushPreset,
  type Rgba,
} from "@suwol/editor-core";
import { findKeybindingConflicts, parseWorkspaceLayout, type KeybindingSettings } from "@suwol/shared";
import { validateOverlayUpdate } from "@suwol/plugin-host";
import { importAseprite } from "@suwol/file-format";

function measure(name: string, operation: () => void): void { const start = performance.now(); operation(); const elapsed = performance.now() - start; console.log(`${name}: ${elapsed.toFixed(2)} ms`); }
const width = 2048, height = 2048, rgba = new Uint8Array(width * height * 4);
for (let index = 0; index < width * height; index += 1) { rgba[index * 4] = index & 255; rgba[index * 4 + 1] = (index >>> 4) & 255; rgba[index * 4 + 2] = (index >>> 8) & 255; rgba[index * 4 + 3] = index % 31 === 0 ? 0 : 255; }
measure("2048×2048 Median Cut", () => { convertRgbaToIndexed(rgba, width, height, { maxColors: 256, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "none" }); });
measure("2048×2048 Floyd–Steinberg", () => { convertRgbaToIndexed(rgba, width, height, { maxColors: 256, transparentIndex: 0, alphaThreshold: 1, quantization: "median-cut", dithering: "floyd-steinberg" }); });
const frames = Array.from({ length: 100 }, (_, frame) => new Uint8Array(256 * 256).fill(frame % 256)), mapping = new Map(Array.from({ length: 256 }, (_, index) => [index, 255 - index]));
measure("100 Frame Palette remap", () => { for (const frame of frames) remapIndices(frame, mapping); });
measure("20 Layer Blend composite", () => { let result: Rgba = [0, 0, 0, 0]; for (let repeat = 0; repeat < 4096; repeat += 1) for (let layer = 0; layer < 20; layer += 1) result = blendRgba(result, [layer * 11, 255 - layer * 9, layer * 7, 128], layer % 2 === 0 ? "multiply" : "screen"); void result; });
measure("Group depth 16 composite", () => { let result: Rgba = [0, 0, 0, 0]; for (let repeat = 0; repeat < 8192; repeat += 1) for (let depth = 0; depth < 16; depth += 1) result = blendRgba(result, [depth * 15, 90, 180, 160], "normal", .95); void result; });
const brush: BrushPreset = { id: "benchmark", name: "64 square", kind: "square", width: 64, height: 64, opacity: 1, spacing: 64, angle: 0, flipX: false, flipY: false, center: { x: 31, y: 31 } }, points = Array.from({ length: 1000 }, (_, index) => ({ x: index, y: Math.round(Math.sin(index / 20) * 32) + 64 }));
measure("64×64 Brush stroke 1,000 point", () => { spacedBrushStroke(brush, points); });
measure("Pixel-perfect 1,000 point", () => { pixelPerfectPoints(points); });
measure("256×256 Tilemap visible range render", () => { for (let index = 0; index < 100_000; index += 1) visibleTileRange({ x: index % 2048, y: index % 1024, width: 640, height: 480 }, 16, 16, 256, 256); });
measure("Plugin overlay 1,000 primitive validation", () => { validateOverlayUpdate({ overlayId: "com.example.overlay", lifetimeMs: 1000, primitives: Array.from({ length: 1000 }, (_, index) => ({ kind: "rect", rect: { x: index % 64, y: Math.floor(index / 64), width: 1, height: 1 }, style: { color: [255, 255, 255, 255] } })) }, { width: 256, height: 256 }); });
const keybindings: KeybindingSettings = { schemaVersion: 1, preset: "suwol-default", entries: Array.from({ length: 500 }, (_, index) => ({ commandId: `benchmark.command.${index}`, context: "canvas", shortcuts: [`Ctrl+${String.fromCharCode(65 + index % 26)}`] })) };
measure("Keybinding 500 conflict scan", () => { findKeybindingConflicts(keybindings); });
const tabs = (prefix: string, count: number) => ({ panelIds: Array.from({ length: count }, (_, index) => `${prefix}.panel.${index}`), activePanelId: `${prefix}.panel.0` });
measure("Layout 100 panel validation", () => { parseWorkspaceLayout({ schemaVersion: 3, id: "benchmark-layout", name: "Benchmark", toolsVisible: true, rightDockVisible: true, rightDockWidth: 320, upperGroup: tabs("upper", 50), lowerGroup: tabs("lower", 50), rightSplitRatio: .55, timelineVisible: false, timelineHeight: 180 }); });
const asepriteLimitFixture = new Uint8Array(100 * 1024 * 1024);
measure("100 MB boundary Aseprite parse fixture", () => {
  try { importAseprite(asepriteLimitFixture); }
  catch (error) { if (!(error instanceof Error)) throw error; }
});
