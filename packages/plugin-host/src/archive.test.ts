import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { PluginError } from "./errors";
import { validatePackagePath, validatePluginArchive } from "./archive";

function manifest(extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    manifestVersion: 1,
    id: "com.example.archive",
    name: "Archive",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    engines: { suwolPixelStudio: ">=0.4.0" },
    entry: "dist/main.js",
    permissions: [],
    ...extra,
  });
}
function archive(files: Zippable = {}): Uint8Array {
  return zipSync({ "manifest.json": strToU8(manifest()), "dist/main.js": strToU8("export async function activate(){}"), ...files }, { level: 6 });
}
function errorCode(operation: () => unknown): string {
  try { operation(); return "none"; } catch (error) { return error instanceof PluginError ? error.code : "unknown"; }
}

describe("plugin archive validation", () => {
  it("accepts a valid package", () => {
    expect(validatePluginArchive(archive(), "valid.suwolplugin").manifest.id).toBe("com.example.archive");
  });
  it("requires the extension and ZIP signature", () => {
    expect(errorCode(() => validatePluginArchive(archive(), "valid.zip"))).toBe("PACKAGE_CORRUPT");
    expect(errorCode(() => validatePluginArchive(new Uint8Array([1, 2, 3]), "x.suwolplugin"))).toBe("PACKAGE_CORRUPT");
  });
  it.each(["../evil.js", "/evil.js", "C:/evil.js", "\\\\server\\evil.js", "dist\\evil.js", "unknown/file"])("blocks path %s", (name) => {
    expect(errorCode(() => validatePackagePath(name))).toBe("PACKAGE_UNSAFE_PATH");
  });
  it("requires the runtime entry", () => {
    const bytes = zipSync({ "manifest.json": strToU8(manifest()) });
    expect(errorCode(() => validatePluginArchive(bytes, "x.suwolplugin"))).toBe("MANIFEST_INVALID");
  });
  it("rejects malformed manifest JSON", () => {
    const bytes = zipSync({ "manifest.json": strToU8("{"), "dist/main.js": strToU8("") });
    expect(errorCode(() => validatePluginArchive(bytes, "x.suwolplugin"))).toBe("MANIFEST_INVALID");
  });
  it("rejects incompatible API and app versions", () => {
    const api = zipSync({ "manifest.json": strToU8(manifest({ apiVersion: "^2.0.0" })), "dist/main.js": strToU8("") });
    const app = zipSync({ "manifest.json": strToU8(manifest({ engines: { suwolPixelStudio: ">=9.0.0" } })), "dist/main.js": strToU8("") });
    expect(errorCode(() => validatePluginArchive(api, "x.suwolplugin"))).toBe("INCOMPATIBLE_API");
    expect(errorCode(() => validatePluginArchive(app, "x.suwolplugin"))).toBe("INCOMPATIBLE_APP");
  });
  it("rejects panel inline script", () => {
    const input = zipSync({
      "manifest.json": strToU8(manifest({ contributes: { panels: [{ id: "com.example.archive.panel", title: "Panel", entry: "dist/panel/index.html" }] } })),
      "dist/main.js": strToU8("export async function activate(){}"),
      "dist/panel/index.html": strToU8("<script>alert(1)</script>"),
    });
    expect(errorCode(() => validatePluginArchive(input, "x.suwolplugin"))).toBe("MANIFEST_INVALID");
  });
  it("enforces file count", () => {
    const files: Zippable = {};
    for (let index = 0; index < 2_001; index += 1) files[`dist/${index}.txt`] = strToU8("x");
    expect(errorCode(() => validatePluginArchive(archive(files), "x.suwolplugin"))).toBe("PACKAGE_LIMIT_EXCEEDED");
  });
  it("enforces single-file size", () => {
    expect(errorCode(() => validatePluginArchive(archive({ "dist/large.bin": new Uint8Array(20 * 1024 * 1024 + 1) }), "x.suwolplugin"))).toBe("PACKAGE_LIMIT_EXCEEDED");
  });
  it("enforces compression ratio", () => {
    expect(errorCode(() => validatePluginArchive(archive({ "dist/bomb.bin": new Uint8Array(2 * 1024 * 1024) }), "x.suwolplugin"))).toBe("PACKAGE_LIMIT_EXCEEDED");
  });
});
