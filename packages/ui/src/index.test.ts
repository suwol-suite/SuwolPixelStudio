import { describe, expect, it } from "vitest";
import { PanelRegistry } from "./index";

type TestPanel = "tools" | "layers";

function registry(): PanelRegistry<TestPanel> {
  const panels = new PanelRegistry<TestPanel>();
  panels.register({
    id: "tools",
    titleKey: "panel.tools",
    defaultLocation: "left",
    defaultVisible: true,
  });
  panels.register({
    id: "layers",
    titleKey: "panel.layers",
    defaultLocation: "right",
    defaultVisible: false,
  });
  return panels;
}

describe("PanelRegistry", () => {
  it("registers definitions and controls visibility", () => {
    const panels = registry();
    expect(panels.get("tools")?.defaultLocation).toBe("left");
    expect(panels.isVisible("tools")).toBe(true);
    expect(panels.toggle("tools")).toBe(true);
    expect(panels.isVisible("tools")).toBe(false);
  });

  it("rejects duplicate panel ids", () => {
    const panels = registry();
    expect(() =>
      panels.register({
        id: "tools",
        titleKey: "duplicate",
        defaultLocation: "left",
        defaultVisible: true,
      }),
    ).toThrow("Duplicate panel id");
  });

  it("handles invalid ids without changing state", () => {
    const panels = registry();
    expect(panels.setVisible("missing" as TestPanel, true)).toBe(false);
    expect(panels.toggle("missing" as TestPanel)).toBe(false);
  });

  it("exports, restores, and resets layout visibility", () => {
    const panels = registry();
    panels.restoreVisibility({ tools: false, layers: true });
    expect(panels.exportVisibility()).toEqual({ tools: false, layers: true });
    panels.reset();
    expect(panels.exportVisibility()).toEqual({ tools: true, layers: false });
  });
});
