import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDINGS, findDuplicateKeybindings } from "./commands";

describe("keybinding validation", () => {
  it("finds case-insensitive duplicate keybindings", () => {
    expect(
      findDuplicateKeybindings({ "file.new": "Ctrl+N", "file.open": "ctrl+n" }),
    ).toEqual(["ctrl+n"]);
  });

  it("accepts distinct keybindings", () => {
    expect(
      findDuplicateKeybindings({ "file.new": "Ctrl+N", "file.open": "Ctrl+O" }),
    ).toEqual([]);
  });
  it("keeps every shipped M3 keybinding conflict-free", () => {
    expect(findDuplicateKeybindings(DEFAULT_KEYBINDINGS)).toEqual([]);
  });
});
