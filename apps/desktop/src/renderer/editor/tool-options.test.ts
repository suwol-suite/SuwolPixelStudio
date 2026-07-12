import { describe, expect, it } from "vitest";
import { toolOptionIds } from "./tool-options";

describe("contextual tool options", () => {
  it("shows drawing essentials for Pencil and Eraser", () => {
    expect(toolOptionIds("pencil")).toEqual([
      "foreground",
      "background",
      "size",
      "opacity",
      "preset",
      "pixelPerfect",
      "symmetry",
    ]);
    expect(toolOptionIds("eraser")).toEqual(["size", "opacity", "preset"]);
  });

  it("uses concise context-specific groups", () => {
    expect(toolOptionIds("fill")).toContain("tolerance");
    expect(toolOptionIds("rectangle")).toContain("fillMode");
    expect(toolOptionIds("selectionRect")).toEqual(["selectionMode"]);
    expect(toolOptionIds("move")).toEqual(["moveTarget"]);
    expect(toolOptionIds("tilePencil")).toEqual(["tile", "tileTransform"]);
  });
});
