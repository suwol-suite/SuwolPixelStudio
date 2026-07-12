import { describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "@suwol/shared";
import { resetWorkspacePreferences } from "./ErrorBoundary";

describe("fatal workspace recovery", () => {
  it("resets only persisted workspace preferences", () => {
    const removeItem = vi.fn();
    resetWorkspacePreferences({ removeItem });
    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY);
  });
});
