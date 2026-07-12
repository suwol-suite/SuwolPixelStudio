import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectedReleaseAssets, validateReleaseTag } from "./release-contract";

interface Manifest {
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const readManifest = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

describe("application release version consistency", () => {
  it("keeps package, workspace, About, serialization and asset versions aligned", () => {
    const root = readManifest("package.json"),
      desktop = readManifest("apps/desktop/package.json"),
      pluginHost = readManifest("packages/plugin-host/package.json"),
      about = readFileSync("apps/desktop/src/renderer/components/AboutDialog.tsx", "utf8"),
      app = readFileSync("apps/desktop/src/renderer/App.tsx", "utf8");

    expect(pluginHost.version).toBe(root.version);
    expect(root.dependencies?.["@suwol/plugin-host"]).toBe(`workspace:${root.version}`);
    expect(desktop.dependencies?.["@suwol/plugin-host"]).toBe(`workspace:${root.version}`);
    expect(about).toContain(`diagnostics?.version ?? "${root.version}"`);
    expect(app.split(`desktopInfo?.version ?? "${root.version}"`)).toHaveLength(3);
    expect(readFileSync("README.md", "utf8")).toContain(`v${root.version} / RC9`);
    expect(() => validateReleaseTag(`v${root.version}`, root.version)).not.toThrow();
    expect(expectedReleaseAssets(root.version, "all")).toEqual([
      `SuwolPixelStudio-${root.version}-linux-x64.AppImage`,
      `SuwolPixelStudio-${root.version}-linux-x64.zip`,
      `SuwolPixelStudio-${root.version}-mac-arm64.dmg`,
      `SuwolPixelStudio-${root.version}-mac-arm64.zip`,
      `SuwolPixelStudio-${root.version}-win-x64.zip`,
    ]);
  });
});
