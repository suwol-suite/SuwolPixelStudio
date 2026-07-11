import { app, dialog, net, protocol, shell } from "electron";
import { promises as fs } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import {
  PLUGIN_LIMITS,
  compareSemanticVersions,
  pluginManifestSchema,
  type InstalledPluginInfo,
  type PluginInspection,
  type PluginManifest,
  type PluginNetworkRequest,
  type PluginNetworkResponse,
  type PluginPackageHandle,
  type PluginPermission,
  type PluginRuntimeDescriptor,
} from "@suwol/plugin-api";
import {
  PLUGIN_PANEL_CSP,
  PLUGIN_RUNTIME_FRAME_CSP,
  PLUGIN_WORKER_CSP,
  PluginError,
  PluginPermissionManager,
  PluginSafeModeController,
  PluginStorageNamespace,
  createPluginRuntimeBootstrap,
  createPluginRuntimeFrameBootstrap,
  sanitizeResponseHeaders,
  validateNetworkRequest,
  validatePluginArchive,
  type ValidatedPluginPackage,
} from "@suwol/plugin-host";
import type { Logger } from "@suwol/shared";

interface PersistedPlugin {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly lastError: Readonly<{ code: string; timestamp: number }> | null;
}
interface PersistedState {
  readonly version: 1;
  readonly safeMode: boolean;
  readonly plugins: readonly PersistedPlugin[];
  readonly permissions: ReturnType<PluginPermissionManager["serialize"]>;
}
interface PackageHandleRecord {
  readonly path: string;
  readonly displayName: string;
  readonly inspection?: ValidatedPluginPackage;
}
interface RuntimeRecord {
  readonly runtimeId: string;
  readonly pluginId: string;
  readonly root: string;
}

const contentTypes: Readonly<Record<string, string>> = Object.freeze({
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
});

export class PluginDesktopService {
  readonly #logger: Logger;
  readonly #root: string;
  readonly #packagesRoot: string;
  readonly #storageRoot: string;
  readonly #logsRoot: string;
  readonly #statePath: string;
  readonly #startupMarker: string;
  readonly #handles = new Map<string, PackageHandleRecord>();
  readonly #runtimes = new Map<string, RuntimeRecord>();
  readonly #plugins = new Map<string, PersistedPlugin>();
  readonly #permissions = new PluginPermissionManager();
  readonly #safeMode = new PluginSafeModeController();
  readonly #storage = new Map<string, PluginStorageNamespace>();
  readonly #commandLineDisabled: boolean;
  readonly #e2eEnabled: boolean;
  readonly #e2eRoot: string;
  #nextPackagePath: string | null = null;

  constructor(logger: Logger, commandLineDisabled: boolean, e2eEnabled: boolean) {
    this.#logger = logger;
    this.#commandLineDisabled = commandLineDisabled;
    this.#e2eEnabled = e2eEnabled;
    this.#root = path.join(app.getPath("userData"), "plugins-v1");
    this.#packagesRoot = path.join(this.#root, "packages");
    this.#storageRoot = path.join(this.#root, "storage");
    this.#logsRoot = path.join(this.#root, "logs");
    this.#statePath = path.join(this.#root, "state.json");
    this.#startupMarker = path.join(this.#root, "initializing.lock");
    this.#e2eRoot = path.join(app.getPath("temp"), "suwol-pixel-studio-e2e");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.#packagesRoot, { recursive: true }),
      fs.mkdir(this.#storageRoot, { recursive: true }),
      fs.mkdir(this.#logsRoot, { recursive: true }),
    ]);
    const previousInterrupted = await exists(this.#startupMarker);
    await fs.writeFile(this.#startupMarker, String(Date.now()), { encoding: "utf8", flag: "w" });
    const state = await this.#readState();
    this.#permissions.restore(state.permissions);
    this.#safeMode.configure({
      settingEnabled: state.safeMode,
      commandLineDisabled: this.#commandLineDisabled,
      previousInitializationInterrupted: previousInterrupted,
    });
    for (const entry of state.plugins) {
      const parsed = pluginManifestSchema.safeParse(entry.manifest);
      if (!parsed.success) {
        this.#logger.warn("A corrupt installed plugin state entry was isolated.");
        continue;
      }
      this.#plugins.set(parsed.data.id, { ...entry, manifest: parsed.data });
    }
    await fs.rm(this.#startupMarker, { force: true });
  }

  registerProtocol(): void {
    protocol.handle("suwol-plugin", async (request) => await this.#servePluginResource(request));
  }

  async selectPackage(): Promise<PluginPackageHandle | null> {
    let selected = this.#nextPackagePath;
    this.#nextPackagePath = null;
    if (selected === null) {
      const result = await dialog.showOpenDialog({
        title: "Install Plugin",
        properties: ["openFile"],
        filters: [{ name: "Suwol Plugin", extensions: ["suwolplugin"] }],
      });
      selected = result.filePaths[0] ?? null;
      if (result.canceled || selected === null) return null;
    }
    const displayName = path.basename(selected);
    if (!displayName.toLocaleLowerCase("en-US").endsWith(".suwolplugin"))
      throw new PluginError("PACKAGE_CORRUPT", "Only .suwolplugin packages are allowed.");
    const handle = { id: crypto.randomUUID(), displayName };
    this.#handles.set(handle.id, { path: selected, displayName });
    return handle;
  }

  async inspectPackage(handle: PluginPackageHandle): Promise<PluginInspection> {
    const record = this.#requiredHandle(handle);
    const validated = record.inspection ?? validatePluginArchive(
      new Uint8Array(await fs.readFile(record.path)),
      record.displayName,
      app.getVersion(),
    );
    this.#handles.set(handle.id, { ...record, inspection: validated });
    const current = this.#plugins.get(validated.manifest.id);
    const oldPermissions = new Set(current?.manifest.permissions ?? []);
    return {
      handle,
      manifest: validated.manifest,
      unsigned: true,
      compatible: true,
      currentVersion: current?.manifest.version ?? null,
      newPermissions: validated.manifest.permissions.filter((permission) => !oldPermissions.has(permission)),
      downgrade: current === undefined ? false : compareSemanticVersions(validated.manifest.version, current.manifest.version) < 0,
    };
  }

  async install(handle: PluginPackageHandle, grants: readonly PluginPermission[]): Promise<void> {
    const record = this.#requiredHandle(handle);
    const validated = record.inspection ?? validatePluginArchive(
      new Uint8Array(await fs.readFile(record.path)), record.displayName, app.getVersion(),
    );
    const manifest = validated.manifest;
    const requested = new Set(manifest.permissions);
    if (grants.some((grant) => !requested.has(grant)))
      throw new PluginError("PERMISSION_DENIED", "Install grants include undeclared permissions.");
    const target = this.#packagePath(manifest.id);
    const staging = this.#packagePath(`.staging-${crypto.randomUUID()}`);
    const backup = this.#packagePath(`.backup-${crypto.randomUUID()}`);
    let backedUp = false;
    try {
      await fs.mkdir(staging, { recursive: true });
      for (const [relativePath, bytes] of validated.files) {
        const destination = this.#safeChild(staging, relativePath);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes, { flag: "wx" });
      }
      if (await exists(target)) {
        await fs.rename(target, backup);
        backedUp = true;
      }
      await fs.rename(staging, target);
      if (backedUp) await this.#removeTree(backup);
      this.#permissions.setGrants(manifest, grants);
      this.#plugins.set(manifest.id, {
        manifest,
        enabled: grants.length === manifest.permissions.length && !this.#safeMode.active,
        lastError: null,
      });
      await this.#persistState();
      await this.#log(manifest.id, "installed", { version: manifest.version });
      this.#handles.delete(handle.id);
    } catch (error) {
      if (await exists(staging)) await this.#removeTree(staging);
      if (backedUp && !(await exists(target))) await fs.rename(backup, target);
      throw error;
    }
  }

  list(): readonly InstalledPluginInfo[] {
    return [...this.#plugins.values()].map((entry) => {
      const grants = this.#permissions.grantsFor(entry.manifest.id, entry.manifest.version);
      const enabled = entry.enabled && !this.#safeMode.active;
      return {
        manifest: entry.manifest,
        enabled,
        grants,
        compatible: true,
        runtimeStatus: enabled ? this.#runtimeStatus(entry.manifest.id) : "disabled",
        installSource: "package",
        unsigned: true,
        lastError: entry.lastError,
      };
    });
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const entry = this.#requiredPlugin(pluginId);
    if (enabled && this.#permissions.missingRequired(entry.manifest).length > 0)
      throw new PluginError("PERMISSION_DENIED", "All requested permissions must be granted before activation.");
    if (enabled && this.#safeMode.active)
      throw new PluginError("PERMISSION_DENIED", "Plugins are disabled in Safe Mode.");
    if (!enabled) this.stopPluginRuntimes(pluginId);
    this.#plugins.set(pluginId, { ...entry, enabled });
    await this.#persistState();
    await this.#log(pluginId, enabled ? "enabled" : "disabled");
  }

  async setGrants(pluginId: string, grants: readonly PluginPermission[]): Promise<void> {
    const entry = this.#requiredPlugin(pluginId);
    this.#permissions.setGrants(entry.manifest, grants);
    const missing = this.#permissions.missingRequired(entry.manifest);
    if (missing.length > 0) {
      this.stopPluginRuntimes(pluginId);
      this.#plugins.set(pluginId, { ...entry, enabled: false });
    }
    await this.#persistState();
    await this.#log(pluginId, "permissions-changed", { grantCount: grants.length });
  }

  async remove(pluginId: string, deleteData: boolean): Promise<void> {
    this.#requiredPlugin(pluginId);
    this.stopPluginRuntimes(pluginId);
    await this.#removeTree(this.#packagePath(pluginId));
    this.#plugins.delete(pluginId);
    if (deleteData) await this.clearStorage(pluginId);
    await this.#persistState();
    await this.#log(pluginId, "removed", { dataDeleted: deleteData });
  }

  async clearStorage(pluginId: string): Promise<void> {
    this.#storage.delete(pluginId);
    await fs.rm(this.#storagePath(pluginId), { force: true });
    await this.#log(pluginId, "storage-cleared");
  }

  async readLogs(pluginId: string): Promise<readonly string[]> {
    this.#requiredPlugin(pluginId);
    try {
      const text = await fs.readFile(this.#logPath(pluginId), "utf8");
      return text.split(/\r?\n/).filter(Boolean).slice(-PLUGIN_LIMITS.maxLogEntries);
    } catch {
      return [];
    }
  }
  showFolder(pluginId: string): void {
    this.#requiredPlugin(pluginId);
    shell.showItemInFolder(this.#safeChild(this.#packagePath(pluginId), "manifest.json"));
  }

  startRuntime(pluginId: string): PluginRuntimeDescriptor {
    const entry = this.#requiredPlugin(pluginId);
    if (!entry.enabled || this.#safeMode.active)
      throw new PluginError("PERMISSION_DENIED", "Plugin is disabled.");
    if (this.#permissions.missingRequired(entry.manifest).length > 0)
      throw new PluginError("PERMISSION_DENIED", "Plugin permissions are incomplete.");
    const runtimeId = crypto.randomUUID();
    this.#runtimes.set(runtimeId, {
      runtimeId,
      pluginId,
      root: this.#packagePath(pluginId),
    });
    void this.#log(pluginId, "runtime-started");
    return {
      pluginId,
      runtimeId,
      entryUrl: `suwol-plugin://${runtimeId}/${entry.manifest.entry}`,
      manifest: entry.manifest,
      grants: this.#permissions.grantsFor(pluginId, entry.manifest.version),
    };
  }

  stopRuntime(runtimeId: string): void {
    const runtime = this.#runtimes.get(runtimeId);
    if (runtime !== undefined) {
      this.#runtimes.delete(runtimeId);
      void this.#log(runtime.pluginId, "runtime-stopped");
    }
  }

  stopPluginRuntimes(pluginId: string): void {
    for (const runtime of [...this.#runtimes.values()])
      if (runtime.pluginId === pluginId) this.stopRuntime(runtime.runtimeId);
  }

  async storageGet(pluginId: string, key: string): Promise<unknown> {
    this.#permissions.require(pluginId, "storage");
    return (await this.#storageFor(pluginId)).get(key);
  }
  async storageSet(pluginId: string, key: string, value: unknown): Promise<void> {
    this.#permissions.require(pluginId, "storage");
    const storage = await this.#storageFor(pluginId);
    storage.set(key, value);
    await this.#writeJsonAtomic(this.#storagePath(pluginId), storage.serialize());
  }
  async storageDelete(pluginId: string, key: string): Promise<void> {
    this.#permissions.require(pluginId, "storage");
    const storage = await this.#storageFor(pluginId);
    storage.delete(key);
    await this.#writeJsonAtomic(this.#storagePath(pluginId), storage.serialize());
  }

  async networkRequest(pluginId: string, input: PluginNetworkRequest): Promise<PluginNetworkResponse> {
    this.#requiredPlugin(pluginId);
    const grants = this.#permissions.grantsFor(pluginId);
    let current = input.url;
    for (let redirect = 0; redirect <= PLUGIN_LIMITS.maxRedirects; redirect += 1) {
      const preliminary = new URL(current);
      const addresses = preliminary.hostname === "localhost" || preliminary.hostname === "127.0.0.1" || preliminary.hostname === "[::1]"
        ? []
        : (await lookup(preliminary.hostname, { all: true })).map((entry) => entry.address);
      const request = validateNetworkRequest({ ...input, url: current }, grants, addresses);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
          redirect: "manual",
          signal: controller.signal,
          ...(request.body === undefined ? {} : { body: new Uint8Array(request.body) }),
        };
        const response = await net.fetch(request.url.toString(), init);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location === null || redirect === PLUGIN_LIMITS.maxRedirects)
            throw new PluginError("NETWORK_BLOCKED", "Network redirect is invalid.");
          current = new URL(location, request.url).toString();
          continue;
        }
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > PLUGIN_LIMITS.networkResponseBytes)
          throw new PluginError("NETWORK_BLOCKED", "Network response is too large.");
        const body = await response.arrayBuffer();
        if (body.byteLength > PLUGIN_LIMITS.networkResponseBytes)
          throw new PluginError("NETWORK_BLOCKED", "Network response is too large.");
        await this.#log(pluginId, "network", { hostname: request.url.hostname, status: response.status });
        return { status: response.status, headers: sanitizeResponseHeaders(response.headers.entries()), body };
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new PluginError("NETWORK_BLOCKED", "Network redirect limit exceeded.");
  }

  getSafeMode(): Readonly<{ active: boolean; commandLine: boolean; suggested: boolean }> {
    return { active: this.#safeMode.active, commandLine: this.#commandLineDisabled, suggested: this.#safeMode.shouldSuggest };
  }
  async setSafeMode(enabled: boolean): Promise<void> {
    if (this.#commandLineDisabled && !enabled)
      throw new PluginError("PERMISSION_DENIED", "Command-line Safe Mode cannot be disabled at runtime.");
    this.#safeMode.setSetting(enabled);
    if (enabled) for (const runtime of [...this.#runtimes.keys()]) this.stopRuntime(runtime);
    await this.#persistState();
  }

  clearHandles(): void {
    this.#handles.clear();
    this.#runtimes.clear();
  }
  async configureE2ePackage(fileName: string, data: ArrayBuffer): Promise<void> {
    if (!this.#e2eEnabled) throw new PluginError("PERMISSION_DENIED", "Plugin test fixture API is disabled.");
    await fs.mkdir(this.#e2eRoot, { recursive: true });
    const target = this.#safeChild(this.#e2eRoot, fileName);
    await fs.writeFile(target, new Uint8Array(data));
    this.#nextPackagePath = target;
  }

  #requiredHandle(handle: PluginPackageHandle): PackageHandleRecord {
    const record = this.#handles.get(handle.id);
    if (record?.displayName !== handle.displayName)
      throw new PluginError("PACKAGE_CORRUPT", "Plugin package handle is invalid or expired.");
    return record;
  }
  #requiredPlugin(pluginId: string): PersistedPlugin {
    const plugin = this.#plugins.get(pluginId);
    if (plugin === undefined) throw new PluginError("PACKAGE_CORRUPT", "Plugin is not installed.");
    return plugin;
  }
  #runtimeStatus(pluginId: string): "stopped" | "running" {
    return [...this.#runtimes.values()].some((runtime) => runtime.pluginId === pluginId) ? "running" : "stopped";
  }

  async #servePluginResource(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const runtime = this.#runtimes.get(url.hostname);
      if (runtime === undefined) return new Response("Not found", { status: 404 });
      const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (decoded === "__runtime.js")
        return new Response(createPluginRuntimeBootstrap(), {
          headers: { "content-type": contentTypes[".js"] ?? "text/javascript", "content-security-policy": PLUGIN_WORKER_CSP, "cache-control": "no-store" },
        });
      if (decoded === "__runtime.html")
        return new Response('<!doctype html><meta charset="utf-8"><script type="module" src="./__runtime-frame.js"></script>', {
          headers: { "content-type": contentTypes[".html"] ?? "text/html", "content-security-policy": PLUGIN_RUNTIME_FRAME_CSP, "cache-control": "no-store" },
        });
      if (decoded === "__runtime-frame.js")
        return new Response(createPluginRuntimeFrameBootstrap(), {
          headers: { "content-type": contentTypes[".js"] ?? "text/javascript", "content-security-policy": PLUGIN_RUNTIME_FRAME_CSP, "cache-control": "no-store" },
        });
      const candidate = this.#safeChild(runtime.root, decoded);
      const [rootReal, candidateReal, stat] = await Promise.all([
        fs.realpath(runtime.root), fs.realpath(candidate), fs.lstat(candidate),
      ]);
      if (stat.isSymbolicLink() || !stat.isFile() || !isPathInside(rootReal, candidateReal))
        return new Response("Not found", { status: 404 });
      const bytes = await fs.readFile(candidateReal);
      const extension = path.extname(candidateReal).toLocaleLowerCase("en-US");
      const csp = extension === ".html" ? PLUGIN_PANEL_CSP : PLUGIN_WORKER_CSP;
      return new Response(bytes, {
        headers: {
          "content-type": contentTypes[extension] ?? "application/octet-stream",
          "content-security-policy": csp,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  async #storageFor(pluginId: string): Promise<PluginStorageNamespace> {
    this.#requiredPlugin(pluginId);
    const cached = this.#storage.get(pluginId);
    if (cached !== undefined) return cached;
    let initial: Readonly<Record<string, unknown>> = {};
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.#storagePath(pluginId), "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
        initial = parsed as Readonly<Record<string, unknown>>;
    } catch {
      initial = {};
    }
    const storage = new PluginStorageNamespace(initial);
    this.#storage.set(pluginId, storage);
    return storage;
  }

  async #readState(): Promise<PersistedState> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.#statePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) throw new Error("invalid");
      const input = parsed as Partial<PersistedState>;
      return {
        version: 1,
        safeMode: input.safeMode === true,
        plugins: Array.isArray(input.plugins) ? input.plugins : [],
        permissions: Array.isArray(input.permissions) ? input.permissions : [],
      };
    } catch {
      return { version: 1, safeMode: false, plugins: [], permissions: [] };
    }
  }
  async #persistState(): Promise<void> {
    await this.#writeJsonAtomic(this.#statePath, {
      version: 1,
      safeMode: this.#safeMode.active && !this.#commandLineDisabled,
      plugins: [...this.#plugins.values()],
      permissions: this.#permissions.serialize(),
    } satisfies PersistedState);
  }
  async #writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, filePath);
  }
  async #log(pluginId: string, event: string, detail: Readonly<Record<string, string | number | boolean>> = {}): Promise<void> {
    const line = JSON.stringify({ timestamp: Date.now(), event, detail });
    await fs.appendFile(this.#logPath(pluginId), `${line}\n`, { encoding: "utf8" });
  }
  #packagePath(pluginId: string): string {
    return this.#safeChild(this.#packagesRoot, pluginId);
  }
  #storagePath(pluginId: string): string {
    return this.#safeChild(this.#storageRoot, `${pluginId}.json`);
  }
  #logPath(pluginId: string): string {
    return this.#safeChild(this.#logsRoot, `${pluginId}.jsonl`);
  }
  #safeChild(root: string, relativePath: string): string {
    const candidate = path.resolve(root, relativePath);
    if (!isPathInside(path.resolve(root), candidate))
      throw new PluginError("PACKAGE_UNSAFE_PATH", "Resolved plugin path escaped its root.");
    return candidate;
  }
  async #removeTree(target: string): Promise<void> {
    const resolved = path.resolve(target);
    if (!isPathInside(path.resolve(this.#root), resolved))
      throw new PluginError("PACKAGE_UNSAFE_PATH", "Plugin delete target escaped its root.");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}
