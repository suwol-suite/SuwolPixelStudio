import { describe, expect, it } from "vitest";
import { PLUGIN_LIMITS, type PluginManifest } from "@suwol/plugin-api";
import { PluginContributionRegistry } from "./contributions";
import { PluginError } from "./errors";
import { isPrivateIpAddress, sanitizeResponseHeaders, validateNetworkRequest, validateNetworkTarget } from "./network";
import { PluginPermissionManager } from "./permissions";
import { PluginRequestGate, SlidingWindowRateLimiter } from "./protocol";
import { PLUGIN_PANEL_CSP, PLUGIN_PANEL_SANDBOX, createPluginRuntimeBootstrap } from "./runtime";
import { PluginSafeModeController } from "./safe-mode";
import { PluginStorageNamespace, normalizeStorageValue } from "./storage";

const manifest: PluginManifest = {
  manifestVersion: 1,
  id: "com.example.secure",
  name: "Secure",
  version: "1.0.0",
  apiVersion: "^1.0.0",
  engines: { suwolPixelStudio: ">=0.4.0" },
  entry: "dist/main.js",
  permissions: ["document.read", "network:localhost", "network:api.example.com"],
  contributes: { commands: [{ id: "com.example.secure.run", title: "Run" }] },
};

describe("permission manager", () => {
  it("stores only declared grants and supports immediate revoke", () => {
    const manager = new PluginPermissionManager();
    manager.setGrants(manifest, ["document.read", "storage"]);
    expect(manager.grantsFor(manifest.id)).toEqual(["document.read"]);
    manager.revoke(manifest.id, "document.read");
    expect(() => manager.require(manifest.id, "document.read")).toThrow(PluginError);
  });
  it("version-scopes grants", () => {
    const manager = new PluginPermissionManager();
    manager.setGrants(manifest, ["document.read"]);
    expect(manager.grantsFor(manifest.id, "2.0.0")).toEqual([]);
  });
});

describe("storage isolation and validation", () => {
  it("round-trips JSON values", () => {
    const storage = new PluginStorageNamespace();
    storage.set("settings", { enabled: true, values: [1, "x", null] });
    expect(storage.get("settings")).toEqual({ enabled: true, values: [1, "x", null] });
  });
  it.each([() => undefined, Symbol("x"), new Uint8Array(2), new Date()])("rejects non-JSON values", (value) => {
    expect(() => normalizeStorageValue(value)).toThrow(PluginError);
  });
  it("rejects cycles and prototype pollution keys", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => normalizeStorageValue(cycle)).toThrow(PluginError);
    expect(() => normalizeStorageValue(JSON.parse('{"__proto__":{"polluted":true}}') as unknown)).toThrow(PluginError);
    expect(({} as Readonly<Record<string, unknown>>).polluted).toBeUndefined();
  });
  it("enforces plugin quota", () => {
    const storage = new PluginStorageNamespace();
    expect(() => storage.set("large", "x".repeat(PLUGIN_LIMITS.storageBytes))).toThrow(/quota/i);
  });
});

describe("network proxy policy", () => {
  it("permits only exact approved external HTTPS hostname", () => {
    expect(validateNetworkTarget("https://api.example.com/v1", ["network:api.example.com"], ["93.184.216.34"]).hostname).toBe("api.example.com");
    expect(() => validateNetworkTarget("https://sub.api.example.com", ["network:api.example.com"], ["93.184.216.34"])).toThrow(PluginError);
  });
  it("separates localhost permission", () => {
    expect(validateNetworkTarget("http://127.0.0.1:3000", ["network:localhost"]).hostname).toBe("127.0.0.1");
    expect(() => validateNetworkTarget("http://localhost", [])).toThrow(PluginError);
  });
  it.each(["file:///etc/passwd", "data:text/plain,x", "ftp://example.com", "https://user:pass@example.com"])("blocks URL %s", (url) => {
    expect(() => validateNetworkTarget(url, ["network:example.com"])).toThrow(PluginError);
  });
  it.each(["10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.1.1", "127.0.0.1", "::1", "fc00::1"])("recognizes private IP %s", (address) => {
    expect(isPrivateIpAddress(address)).toBe(true);
  });
  it("blocks DNS rebinding to private address", () => {
    expect(() => validateNetworkTarget("https://api.example.com", ["network:api.example.com"], ["192.168.0.10"])).toThrow(PluginError);
  });
  it("blocks dangerous request headers", () => {
    expect(() => validateNetworkRequest({ method: "GET", url: "https://api.example.com", headers: { Cookie: "x" } }, ["network:api.example.com"], ["93.184.216.34"])).toThrow(PluginError);
  });
  it("removes credential response headers", () => {
    expect(sanitizeResponseHeaders([["set-cookie", "secret"], ["content-type", "image/png"]])).toEqual({ "content-type": "image/png" });
  });
});

describe("protocol limits", () => {
  it("rejects unknown and duplicate request ids", () => {
    const gate = new PluginRequestGate(), request = { protocol: 1, kind: "request", requestId: crypto.randomUUID(), method: "x", params: null };
    gate.enter(request);
    expect(() => gate.enter(request)).toThrow(PluginError);
  });
  it("rejects oversized messages", () => {
    const gate = new PluginRequestGate();
    expect(() => gate.enter({ protocol: 1, kind: "request", requestId: crypto.randomUUID(), method: "x", params: "x".repeat(PLUGIN_LIMITS.messageBytes) })).toThrow(/size/i);
  });
  it("rate limits a time window", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);
    expect(limiter.accept(1_000)).toBe(true);
    expect(limiter.accept(1_001)).toBe(true);
    expect(limiter.accept(1_002)).toBe(false);
    expect(limiter.accept(2_001)).toBe(true);
  });
});

describe("contribution lifecycle", () => {
  it("tracks and removes all plugin contributions", () => {
    const registry = new PluginContributionRegistry();
    registry.activate(manifest);
    expect(registry.getAll()).toHaveLength(1);
    registry.deactivate(manifest.id);
    expect(registry.getAll()).toHaveLength(0);
  });
  it("blocks built-in collisions", () => {
    const registry = new PluginContributionRegistry(new Set(["com.example.secure.run"]));
    expect(() => registry.activate(manifest)).toThrow(PluginError);
  });
});

describe("sandbox and Safe Mode", () => {
  it("uses a script-only iframe sandbox and network-denying CSP", () => {
    expect(PLUGIN_PANEL_SANDBOX).toBe("allow-scripts allow-same-origin");
    expect(PLUGIN_PANEL_SANDBOX).not.toContain("allow-top-navigation");
    expect(PLUGIN_PANEL_SANDBOX).not.toContain("allow-popups");
    expect(PLUGIN_PANEL_CSP).toContain("connect-src 'none'");
    expect(PLUGIN_PANEL_CSP).toContain("form-action 'none'");
  });
  it("bootstrap removes direct network and has no Node bridge", () => {
    const source = createPluginRuntimeBootstrap();
    expect(source).toContain("fetch: { value: blocked }");
    expect(source).toContain("WebSocket: { value: undefined }");
    expect(source).not.toContain("ipcRenderer");
    expect(source).not.toContain("require(");
    expect(source).not.toContain("process.");
  });
  it("activates setting and command-line Safe Mode", () => {
    const safe = new PluginSafeModeController();
    safe.configure({ settingEnabled: false, commandLineDisabled: true });
    expect(safe.active).toBe(true);
    safe.configure({ settingEnabled: false, commandLineDisabled: false });
    safe.recordCrash("com.example.secure", 100);
    safe.recordCrash("com.example.secure", 200);
    safe.recordCrash("com.example.secure", 300);
    expect(safe.shouldDisable("com.example.secure")).toBe(true);
    expect(safe.shouldSuggest).toBe(true);
  });
});
