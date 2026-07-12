import { describe, expect, it } from "vitest";
import type { Rgba } from "@suwol/editor-core";
import { recordRecentColor, selectRecentColor } from "./recent-colors";

const red: Rgba = [255, 0, 0, 255],
  green: Rgba = [0, 255, 0, 255],
  blue: Rgba = [0, 0, 255, 255];

describe("recent color policy", () => {
  it("records actual use at the front and removes duplicates", () => {
    expect(recordRecentColor([red, green, red], blue)).toEqual([
      blue,
      red,
      green,
    ]);
    expect(recordRecentColor([red, green, blue], green)).toEqual([
      green,
      red,
      blue,
    ]);
  });

  it("caps history without mutating the source", () => {
    const source = Array.from(
      { length: 12 },
      (_, index) => [index, index, index, 255] as Rgba,
    );
    const result = recordRecentColor(source, red);
    expect(result).toHaveLength(12);
    expect(source[0]).toEqual([0, 0, 0, 255]);
  });

  it("selects a recent color without reordering history", () => {
    const history = [red, green, blue];
    const selected = selectRecentColor(history, blue);
    expect(selected.foreground).toBe(blue);
    expect(selected.recentColors).toBe(history);
  });
});
