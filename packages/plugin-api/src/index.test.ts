import { describe, expect, it } from "vitest";
import {
  compareSemanticVersions,
  parsePluginPermission,
  pluginManifestSchema,
  rpcRequestSchema,
  satisfiesVersion,
} from "./index";

function manifest(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    manifestVersion: 1,
    id: "com.example.tools",
    name: "Tools",
    version: "1.2.3",
    apiVersion: "^1.0.0",
    engines: { suwolPixelStudio: ">=0.4.0" },
    entry: "dist/main.js",
    permissions: ["document.read", "ui.command"],
    contributes: {
      commands: [{ id: "com.example.tools.run", title: "Run" }],
      menus: [{ location: "plugins", command: "com.example.tools.run" }],
    },
    ...overrides,
  };
}

describe("plugin manifest", () => {
  it("accepts the API 1 manifest", () => {
    expect(pluginManifestSchema.parse(manifest()).id).toBe("com.example.tools");
  });
  it.each(["Example.Tools", "tools", "com_example_tools", "com.*.tools", "C:\\tools"])("rejects unsafe id %s", (id) => {
    expect(pluginManifestSchema.safeParse(manifest({ id })).success).toBe(false);
  });
  it("rejects command outside the namespace", () => {
    expect(pluginManifestSchema.safeParse(manifest({ contributes: { commands: [{ id: "com.other.run", title: "Run" }] } })).success).toBe(false);
  });
  it("rejects duplicate contribution ids", () => {
    expect(pluginManifestSchema.safeParse(manifest({ contributes: { commands: [{ id: "com.example.tools.run", title: "A" }, { id: "com.example.tools.run", title: "B" }] } })).success).toBe(false);
  });
  it("rejects a menu referencing an undeclared command", () => {
    expect(pluginManifestSchema.safeParse(manifest({ contributes: { menus: [{ location: "plugins", command: "com.example.tools.run" }] } })).success).toBe(false);
  });
  it("rejects unknown fields", () => {
    expect(pluginManifestSchema.safeParse(manifest({ nodeIntegration: true })).success).toBe(false);
  });
});

describe("plugin permissions and versions", () => {
  it.each(["document.read", "palette.write", "network:localhost", "network:api.example.com"])("parses %s", (permission) => {
    expect(parsePluginPermission(permission)).toBe(permission);
  });
  it.each(["network:*", "network:192.168.1.1", "network:https://example.com", "process.spawn", "clipboard.read"])("rejects %s", (permission) => {
    expect(parsePluginPermission(permission)).toBeNull();
  });
  it("compares semantic versions", () => {
    expect(compareSemanticVersions("1.2.3", "1.2.2")).toBeGreaterThan(0);
    expect(compareSemanticVersions("1.2.3", "1.2.3")).toBe(0);
  });
  it("applies caret and minimum ranges", () => {
    expect(satisfiesVersion("1.4.0", "^1.0.0")).toBe(true);
    expect(satisfiesVersion("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesVersion("0.4.0", ">=0.4.0")).toBe(true);
  });
});

describe("protocol schema", () => {
  it("requires protocol version and UUID request id", () => {
    expect(rpcRequestSchema.safeParse({ protocol: 1, kind: "request", requestId: crypto.randomUUID(), method: "storage.get", params: null }).success).toBe(true);
    expect(rpcRequestSchema.safeParse({ protocol: 2, kind: "request", requestId: "x", method: "storage.get", params: null }).success).toBe(false);
  });
});
