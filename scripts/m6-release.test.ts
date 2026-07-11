import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appDiagnosticsSchema } from "@suwol/shared";

const root = JSON.parse(readFileSync("package.json", "utf8")) as Readonly<{
  version: string;
  license: string;
  scripts: Readonly<Record<string, string>>;
}>;

describe("M6 release metadata", () => {
  it("keeps version, license and release scripts consistent", () => {
    expect(root.version).toBe("0.6.0-rc.5");
    expect(root.license).toBe("Apache-2.0");
    expect(typeof root.scripts["package:smoke"]).toBe("string");
    expect(typeof root.scripts["release:prepare"]).toBe("string");
    expect(typeof root.scripts["release:checksums"]).toBe("string");
    expect(typeof root.scripts["release:verify-tag"]).toBe("string");
    expect(typeof root.scripts["workflow:check"]).toBe("string");
    expect(typeof root.scripts["license:check"]).toBe("string");
    expect(readFileSync("README.md", "utf8")).toContain("v0.6.0-rc.5 / M6");
  });
  it("validates privacy-safe diagnostic metadata", () => {
    const info = appDiagnosticsSchema.parse({
      productName: "Suwol Pixel Studio",
      version: "0.6.0-rc.5",
      electron: "43.1.0",
      chromium: "142.0.0.0",
      node: "22.12.0",
      platform: "linux",
      architecture: "x64",
      fileFormatVersion: 4,
      pluginApiVersion: "1.1.0",
      license: "Apache-2.0",
      repository: "https://github.com/suwol-suite/SuwolPixelStudio",
    });
    expect(Object.keys(info)).not.toContain("path");
    expect(JSON.stringify(info)).not.toMatch(/user|pixelData|storageValue/i);
  });
  it("ships license and third-party notices as package resources", () => {
    const forge = readFileSync("forge.config.ts", "utf8");
    expect(forge).toContain('"LICENSE"');
    expect(forge).toContain('"THIRD_PARTY_NOTICES.md"');
    expect(forge).toContain("prepareDmgNativeDependencies");
    expect(readFileSync("LICENSE", "utf8")).toContain("Apache License");
    expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("Production dependencies");
    expect(readFileSync("THIRD_PARTY_NOTICES.md", "utf8")).toContain("AppImage type-2 runtime");
  });
  it("provides native application icons for every packaged platform", () => {
    const forge = readFileSync("forge.config.ts", "utf8"),
      icns = readFileSync("apps/desktop/assets/icon.icns"),
      ico = readFileSync("apps/desktop/assets/icon.ico"),
      linuxPng = readFileSync("apps/desktop/assets/linux/studio.suwol.pixel.png");
    expect(forge).toContain('icon: "apps/desktop/assets/icon"');
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);
    expect(linuxPng.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(linuxPng.readUInt32BE(16)).toBe(512);
    expect(linuxPng.readUInt32BE(20)).toBe(512);
    expect(readFileSync("forge.config.ts", "utf8")).toContain("studio.suwol.pixel.document");
    expect(readFileSync("apps/desktop/assets/linux/application-x-suwol-pixel-studio.png").readUInt32BE(16)).toBe(512);
    expect(forge).toContain('name: "@reforged/maker-appimage"');
    expect(forge).toContain('compressor: "zstd"');
    expect(readFileSync("apps/desktop/src/renderer/components/AboutDialog.tsx", "utf8")).toContain("studio.suwol.pixel.png");
  });
  it("separates core publication from the macOS follow-up", () => {
    const core = readFileSync(".github/workflows/release-core.yml", "utf8"),
      mac = readFileSync(".github/workflows/release-macos.yml", "utf8");
    expect(core).toContain("needs: [windows, linux]");
    expect(core).toContain("GPG_PRIVATE_KEY_B64");
    expect(core).toContain("--prerelease --latest=false");
    expect(core).toContain("--prerelease=false");
    expect(core).toContain("Known limitations:");
    expect(core).not.toContain("CSC_LINK");
    expect(mac).not.toContain("gh release create");
    expect(mac).toContain("Timed out waiting for release-core");
    expect(mac).toContain("--scope=all");
    expect(mac).toContain("checksums.txt.asc --clobber");
  });
});
