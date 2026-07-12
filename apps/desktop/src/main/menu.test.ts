import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";

let installed: readonly MenuItemConstructorOptions[] = [];

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: readonly MenuItemConstructorOptions[]) => template,
    setApplicationMenu: (menu: readonly MenuItemConstructorOptions[]) => {
      installed = menu;
    },
  },
}));

import { installApplicationMenu } from "./menu";

const window = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as BrowserWindow;

function submenu(item: MenuItemConstructorOptions | undefined): readonly MenuItemConstructorOptions[] {
  return Array.isArray(item?.submenu) ? item.submenu : [];
}

describe("native application menu", () => {
  beforeEach(() => {
    installed = [];
  });

  it.each(["win32", "linux"] as const)(
    "uses the editor-first %s structure with File > Exit and one Help > About",
    (platform) => {
      installApplicationMenu(window, "en", [], platform);
      expect(installed.map((item) => item.label)).toEqual([
        "File",
        "Edit",
        "Sprite",
        "Layer",
        "Frame",
        "Select",
        "View",
        "Window",
        "Plugins",
        "Help",
      ]);
      expect(submenu(installed[0]).filter((item) => item.label === "Exit")).toHaveLength(1);
      expect(submenu(installed.at(-1))).toMatchObject([
        { label: "About Suwol Pixel Studio" },
      ]);
    },
  );

  it("keeps only the minimal macOS application menu and the Help About entry", () => {
    installApplicationMenu(window, "en", [], "darwin");
    expect(installed[0]?.label).toBe("Suwol Pixel Studio");
    expect(submenu(installed[0]).map((item) => item.role ?? item.type)).toEqual([
      "services",
      "separator",
      "hide",
      "hideOthers",
      "unhide",
      "separator",
      "quit",
    ]);
    expect(submenu(installed[0]).some((item) => item.label?.includes("About"))).toBe(false);
    const help = installed.find((item) => item.label === "Help");
    expect(submenu(help).filter((item) => item.label === "About Suwol Pixel Studio")).toHaveLength(1);
    const file = installed.find((item) => item.label === "File");
    expect(submenu(file).some((item) => item.label === "Exit")).toBe(false);
  });

  it("exposes checked workspace panels and the three layout presets in Window", () => {
    installApplicationMenu(window, "en", [], "linux");
    const windowMenu = submenu(installed.find((item) => item.label === "Window")),
      panelItems = windowMenu.filter((item) => item.type === "checkbox"),
      layouts = submenu(windowMenu.find((item) => item.label === "Layouts"));
    expect(panelItems.map((item) => item.id)).toEqual([
      "window.toggleTools",
      "window.toggleRightDock",
      "window.toggleLayers",
      "window.togglePalette",
      "window.toggleProperties",
      "window.togglePreview",
      "window.toggleTimeline",
    ]);
    expect(panelItems.at(-1)?.checked).toBe(false);
    expect(layouts.filter((item) => item.type === "radio").map((item) => item.id)).toEqual([
      "window.applyStaticLayout",
      "window.applyAnimationLayout",
      "window.applyTilemapLayout",
    ]);
  });
});
