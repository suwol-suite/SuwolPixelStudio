import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("."),
  read = (file: string): string => fs.readFileSync(path.join(root, file), "utf8"),
  canvas = read("apps/desktop/src/renderer/components/PixelCanvas.tsx"),
  pointerInteraction = read("apps/desktop/src/renderer/editor/pointer-interaction.ts"),
  shell = read("apps/desktop/src/renderer/components/EditorShell.tsx"),
  timeline = read("apps/desktop/src/renderer/components/Timeline.tsx"),
  tooltip = read("apps/desktop/src/renderer/components/Tooltip.tsx"),
  styles = read("apps/desktop/src/renderer/styles.css"),
  i18n = read("apps/desktop/src/renderer/i18n.ts");

describe("RC8 workspace UX contracts", () => {
  it("uses pointer capture and temporary Space/middle-button panning without changing tools", () => {
    expect(canvas).toContain('interaction.begin(event.currentTarget, event.pointerId, "pan")');
    expect(pointerInteraction).toContain("target.setPointerCapture(pointerId)");
    expect(pointerInteraction).toContain("target.hasPointerCapture(pointerId)");
    expect(pointerInteraction).toContain("target.releasePointerCapture(pointerId)");
    expect(canvas).toContain('event.button === 1 || (event.button === 0 && spaceRef.current)');
    expect(canvas).toContain('event.code === "Space"');
    expect(canvas).toContain("entry.session.cancelStroke(stroke)");
    expect(canvas).toContain('data-pan-state={panning ? "grabbing" : spacePressed ? "grab" : "idle"}');
    expect(styles).toContain(".pixel-canvas-host.pan-ready .pixel-overlay { cursor: grab; }");
    expect(styles).toContain(".pixel-canvas-host.panning .pixel-overlay { cursor: grabbing; }");
  });

  it("keeps only real document tabs and makes the tool rail fixed-width", () => {
    expect(shell).not.toContain('className="app-brand"');
    expect(shell).toContain("workspace.documents.map");
    expect(shell).toContain("workspace.reorder");
    expect(shell).not.toContain('dimension: "left"');
    expect(styles).toMatch(/\.tool-panel\s*\{[^}]*width:\s*3\.25rem/s);
    expect(styles).toMatch(/\.tool-panel\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("renders Layers as an accessible single-row tree and moves advanced fields to Properties", () => {
    expect(shell).toContain('role="tree"');
    expect(shell).toContain('role="treeitem"');
    expect(shell).toContain("aria-level={depth + 1}");
    expect(shell).toContain("aria-expanded=");
    expect(shell).toContain("aria-selected=");
    expect(styles).toMatch(/\.layer-row\s*\{[^}]*grid-template-columns:[^}]*minmax\(0, 1fr\)[^}]*white-space:\s*nowrap/s);
    const row = shell.slice(shell.indexOf('className={`layer-row'), shell.indexOf("function ToolOptions"));
    expect(row).not.toContain('className="opacity-control"');
    expect(row).not.toContain('className="blend-select"');
    expect(shell).toContain('data-testid="layer-properties"');
    expect(shell).toContain('t("layer.opacity")');
    expect(shell).toContain('t("blend.mode")');
  });

  it("provides a shared delayed, focusable, boundary-safe tooltip service", () => {
    expect(shell).toContain("description: description ?? label");
    expect(timeline).toContain("<Tooltip metadata=");
    expect(tooltip).toContain("window.setTimeout(reveal, 350)");
    expect(tooltip).toContain('event.key === "Escape"');
    expect(tooltip).toContain("onFocusCapture");
    expect(tooltip).toContain("Math.min(window.innerWidth");
    expect(styles).toMatch(/\.tooltip-popup\s*\{[^}]*pointer-events:\s*none/s);
    expect(i18n).toContain('"tooltip.tool.pencil"');
    expect(i18n).toContain('"tooltip.animation.onionSkin"');
    expect(i18n).toContain('"tooltip.disabled.multipleFrames"');
  });

  it("keeps Timeline optional and retains its local animation controls", () => {
    expect(shell).toContain("layout.timelineVisible");
    expect(shell).toContain('testId="timeline-close"');
    expect(timeline).toContain('testId="toggle-onion"');
    expect(timeline).toContain('testId="play-pause"');
    expect(shell.slice(0, shell.indexOf("function StatusBar"))).not.toContain('testId="toggle-onion"');
  });
});
