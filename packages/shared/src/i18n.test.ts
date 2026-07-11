import { describe, expect, it } from "vitest";
import { detectSystemLanguage, resolveLanguage } from "./i18n";

describe("language resolution", () => {
  it("detects Korean locale variants", () => {
    expect(detectSystemLanguage(["ko-KR", "en-US"])).toBe("ko");
  });

  it("falls back to English for unsupported or empty locales", () => {
    expect(detectSystemLanguage(["ja-JP"])).toBe("en");
    expect(detectSystemLanguage([])).toBe("en");
  });

  it("honors an explicit language selection", () => {
    expect(resolveLanguage("en", ["ko-KR"])).toBe("en");
  });
});
