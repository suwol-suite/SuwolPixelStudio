import type { CommandRegistry } from "@suwol/command-system";
import {
  PLUGIN_API_VERSION,
  PLUGIN_LIMITS,
  PLUGIN_PROTOCOL_VERSION,
  rpcEventSchema,
  type InstalledPluginInfo,
  type PluginPanelContribution,
  type PluginImporterContribution,
  type PluginExporterContribution,
  type PluginToolContribution,
  type OverlayUpdate,
  pluginToolOperationSchema,
  type PluginRpcRequest,
  type PluginRuntimeDescriptor,
} from "@suwol/plugin-api";
import {
  PLUGIN_PANEL_SANDBOX,
  PluginContributionRegistry,
  PluginDocumentBroker,
  PluginError,
  PluginRequestGate,
  withTimeout,
  validateOverlayUpdate,
  PluginOverlayUpdateGate,
  validatePluginExportResult,
  validatePluginImportResult,
  type PluginHostDocument,
} from "@suwol/plugin-host";
import type { WorkspaceDocument, WorkspaceStore } from "../editor/workspace";
import { pluginNetworkRequestSchema } from "@suwol/shared";

export interface PluginProgressState {
  readonly id: string;
  readonly pluginId: string;
  readonly title: string;
  readonly cancellable: boolean;
  readonly percent: number | null;
  readonly message: string;
}
export interface PluginRuntimeSnapshot {
  readonly version: number;
  readonly installed: readonly InstalledPluginInfo[];
  readonly panels: readonly Readonly<{ pluginId: string; contribution: PluginPanelContribution; runtimeId: string }>[];
  readonly progress: readonly PluginProgressState[];
  readonly importers: readonly Readonly<{ pluginId: string; contribution: PluginImporterContribution }>[];
  readonly exporters: readonly Readonly<{ pluginId: string; contribution: PluginExporterContribution }>[];
  readonly tools: readonly Readonly<{ pluginId: string; contribution: PluginToolContribution }>[];
  readonly overlays: readonly Readonly<{ pluginId: string; update: OverlayUpdate }>[];
  readonly safeMode: boolean;
  readonly selectedPluginId: string | null;
  readonly lastNotice: Readonly<{ pluginId: string; level: "info" | "warning" | "error"; message: string }> | null;
}

interface RuntimeRecord {
  readonly descriptor: PluginRuntimeDescriptor;
  readonly frame: HTMLIFrameElement;
  readonly port: MessagePort;
  readonly gate: PluginRequestGate;
  readonly disposers: (() => void)[];
  readonly executions: Map<string, Readonly<{ resolve(): void; reject(error: Error): void }>>;
  readonly providerExecutions: Map<string, Readonly<{ resolve(value: unknown): void; reject(error: Error): void }>>;
  readonly panelPorts: Map<string, MessagePort>;
  readonly overlayGate: PluginOverlayUpdateGate;
  ready: boolean;
}

type Listener = () => void;

export class PluginRuntimeController {
  readonly #commands: CommandRegistry;
  readonly #workspace: WorkspaceStore;
  readonly #documents: PluginDocumentBroker;
  readonly #contributions: PluginContributionRegistry;
  readonly #runtimes = new Map<string, RuntimeRecord>();
  readonly #listeners = new Set<Listener>();
  readonly #progress = new Map<string, PluginProgressState>();
  readonly #overlays = new Map<string, Readonly<{
    pluginId: string;
    update: OverlayUpdate;
    updatedAt: number;
    documentId: string | null;
    frameId: string | null;
  }>>();
  readonly #runtimeErrors = new Map<string, Readonly<{ code: string; timestamp: number }>>();
  readonly #starting = new Set<string>();
  #installed: readonly InstalledPluginInfo[] = [];
  #safeMode = false;
  #version = 0;
  #selectedPluginId: string | null = null;
  #lastNotice: PluginRuntimeSnapshot["lastNotice"] = null;
  #listening = false;
  readonly #onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (typeof event.data !== "object" || event.data === null) return;
    const message = event.data as Readonly<Record<string, unknown>>;
    if (
      message.type !== "suwol-plugin:runtime-error" ||
      typeof message.runtimeId !== "string"
    )
      return;
    const runtime = [...this.#runtimes.values()].find(
      (entry) => entry.descriptor.runtimeId === message.runtimeId,
    );
    if (runtime?.frame.contentWindow === event.source) void this.#crash(runtime);
  };

  constructor(commands: CommandRegistry, workspace: WorkspaceStore) {
    this.#commands = commands;
    this.#workspace = workspace;
    this.#contributions = new PluginContributionRegistry(
      new Set(commands.getAll().map((command) => command.id)),
    );
    this.#documents = new PluginDocumentBroker({
      getActive: () => this.#hostDocument(workspace.active),
      listOpen: () => workspace.documents.map((entry) => this.#requiredHostDocument(entry)),
    });
    this.#listen();
  }

  get snapshot(): PluginRuntimeSnapshot {
    const now = Date.now(), active = this.#workspace.active,
      activeId = active?.id ?? null,
      activeFrameId = active?.view.activeFrameId ?? null;
    for (const [key, entry] of this.#overlays)
      if (now - entry.updatedAt > entry.update.lifetimeMs)
        this.#overlays.delete(key);
    const panels = [...this.#runtimes.values()].flatMap((runtime) =>
      (runtime.descriptor.manifest.contributes?.panels ?? []).map((contribution) => ({
        pluginId: runtime.descriptor.pluginId,
        contribution,
        runtimeId: runtime.descriptor.runtimeId,
      })),
    );
    const contributions = this.#contributions.getAll();
    return {
      version: this.#version,
      installed: this.#installed.map((plugin) => {
        const error = this.#runtimeErrors.get(plugin.manifest.id);
        if (error !== undefined)
          return { ...plugin, runtimeStatus: "crashed" as const, lastError: error };
        if (this.#runtimes.has(plugin.manifest.id))
          return { ...plugin, runtimeStatus: "running" as const };
        return plugin;
      }),
      panels,
      progress: [...this.#progress.values()],
      importers: contributions.flatMap((entry) => entry.importers.map((contribution) => ({ pluginId: entry.pluginId, contribution }))),
      exporters: contributions.flatMap((entry) => entry.exporters.map((contribution) => ({ pluginId: entry.pluginId, contribution }))),
      tools: contributions.flatMap((entry) => entry.tools.map((contribution) => ({ pluginId: entry.pluginId, contribution }))),
      overlays: [...this.#overlays.values()]
        .filter(
          (entry) =>
            entry.documentId === activeId &&
            entry.frameId === activeFrameId,
        )
        .map(({ pluginId, update }) => ({ pluginId, update })),
      safeMode: this.#safeMode,
      selectedPluginId: this.#selectedPluginId,
      lastNotice: this.#lastNotice,
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  select(pluginId: string | null): void {
    this.#selectedPluginId = pluginId;
    this.#touch();
  }

  async refresh(): Promise<void> {
    this.#listen();
    const api = window.suwolDesktop?.plugins;
    if (api === undefined) return;
    const [installed, safeMode] = await Promise.all([api.list(), api.getSafeMode()]);
    this.#installed = installed;
    this.#safeMode = safeMode.active;
    const enabled = new Set(installed.filter((plugin) => plugin.enabled).map((plugin) => plugin.manifest.id));
    for (const pluginId of [...this.#runtimes.keys()])
      if (!enabled.has(pluginId)) await this.stop(pluginId);
    if (!this.#safeMode)
      for (const plugin of installed)
        if (plugin.enabled && !this.#runtimes.has(plugin.manifest.id) && !this.#runtimeErrors.has(plugin.manifest.id))
          try { await this.start(plugin.manifest.id); }
          catch (error) {
            console.error("Plugin start failed:", error instanceof Error ? error.message : "Unknown error");
            this.#runtimeErrors.set(plugin.manifest.id, { code: "ACTIVATION_FAILED", timestamp: Date.now() });
            this.#notice(plugin.manifest.id, "error", error instanceof Error ? error.message : "Activation Failed");
          }
    await this.#syncNativeMenu();
    this.#touch();
  }

  async start(pluginId: string): Promise<void> {
    if (this.#runtimes.has(pluginId) || this.#starting.has(pluginId)) return;
    this.#starting.add(pluginId);
    try {
      await this.#startRuntime(pluginId);
    } catch (error) {
      await this.stop(pluginId);
      throw error;
    } finally {
      this.#starting.delete(pluginId);
    }
  }

  async #startRuntime(pluginId: string): Promise<void> {
    const api = window.suwolDesktop?.plugins;
    if (api === undefined) throw new Error("Plugin desktop API is unavailable.");
    const descriptor = await api.startRuntime(pluginId);
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.src = `suwol-plugin://${descriptor.runtimeId}/__runtime.html`;
    document.body.append(frame);
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.addEventListener("error", () => reject(new Error("Plugin runtime frame failed to load.")), { once: true });
      }), PLUGIN_LIMITS.activationTimeoutMs);
    } catch (error) {
      frame.remove();
      await api.stopRuntime(descriptor.runtimeId);
      throw error;
    }
    const channel = new MessageChannel();
    const record: RuntimeRecord = {
      descriptor,
      frame,
      port: channel.port1,
      gate: new PluginRequestGate(),
      disposers: [],
      executions: new Map(),
      providerExecutions: new Map(),
      panelPorts: new Map(),
      overlayGate: new PluginOverlayUpdateGate(),
      ready: false,
    };
    this.#runtimes.set(pluginId, record);
    this.#contributions.activate(descriptor.manifest);
    record.port.onmessage = (event) => { void this.#onMessage(record, event.data); };
    record.port.start();
    frame.contentWindow?.postMessage(
      {
        type: "suwol-plugin:init",
        runtimeId: descriptor.runtimeId,
        entryUrl: descriptor.entryUrl,
        plugin: { id: pluginId, version: descriptor.manifest.version, apiVersion: PLUGIN_API_VERSION },
      },
      "*",
      [channel.port2],
    );
    await withTimeout(
        new Promise<void>((resolve, reject) => {
          const listener = (event: MessageEvent<unknown>) => {
            const parsed = rpcEventSchema.safeParse(event.data);
            if (!parsed.success) return;
            if (parsed.data.event === "runtime.ready") {
              record.port.removeEventListener("message", listener);
              resolve();
            } else if (parsed.data.event === "runtime.activationFailed") {
              record.port.removeEventListener("message", listener);
              const payload = typeof parsed.data.payload === "object" && parsed.data.payload !== null
                ? parsed.data.payload as Readonly<Record<string, unknown>>
                : {};
              const message = typeof payload.message === "string" ? payload.message : "Plugin activation failed.";
              console.error("Plugin activation failed:", message.slice(0, 200));
              reject(new PluginError("RUNTIME_CRASHED", message.slice(0, 200)));
            }
          };
          record.port.addEventListener("message", listener);
        }),
        PLUGIN_LIMITS.activationTimeoutMs,
      );
    record.ready = true;
    this.#runtimeErrors.delete(pluginId);
    await this.#syncNativeMenu();
    this.#touch();
  }

  async stop(pluginId: string): Promise<void> {
    const record = this.#runtimes.get(pluginId);
    if (record === undefined) return;
    this.#runtimes.delete(pluginId);
    this.#contributions.deactivate(pluginId);
    for (const dispose of record.disposers.splice(0)) dispose();
    for (const progress of [...this.#progress.values()])
      if (progress.pluginId === pluginId) this.#progress.delete(progress.id);
    for (const execution of record.executions.values())
      execution.reject(new Error("Plugin runtime stopped."));
    record.executions.clear();
    for (const execution of record.providerExecutions.values())
      execution.reject(new Error("Plugin runtime stopped."));
    record.providerExecutions.clear();
    for (const [key, overlay] of [...this.#overlays])
      if (overlay.pluginId === pluginId) this.#overlays.delete(key);
    record.gate.clear();
    record.overlayGate.clear();
    try {
      record.port.postMessage({ protocol: PLUGIN_PROTOCOL_VERSION, kind: "event", event: "runtime.deactivate", payload: null });
    } catch { /* Runtime is already gone. */ }
    record.port.close();
    for (const port of record.panelPorts.values()) port.close();
    record.frame.remove();
    await window.suwolDesktop?.plugins.stopRuntime(record.descriptor.runtimeId);
    await this.#syncNativeMenu();
    this.#touch();
  }

  async restart(pluginId: string): Promise<void> {
    await this.stop(pluginId);
    this.#runtimeErrors.delete(pluginId);
    await this.start(pluginId);
  }

  panelUrl(runtimeId: string, entry: string): string {
    return `suwol-plugin://${runtimeId}/${entry}`;
  }
  attachPanel(pluginId: string, panelId: string, frame: HTMLIFrameElement): () => void {
    const runtime = this.#runtimes.get(pluginId);
    if (runtime === undefined || frame.contentWindow === null) return () => undefined;
    const channel = new MessageChannel();
    runtime.panelPorts.get(panelId)?.close();
    runtime.panelPorts.set(panelId, channel.port1);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => runtime.port.postMessage({
      protocol: PLUGIN_PROTOCOL_VERSION,
      kind: "event",
      event: "panel.message",
      payload: { panelId, message: event.data },
    });
    channel.port1.start();
    frame.contentWindow.postMessage({ type: "suwol-panel:init", panelId }, "*", [channel.port2]);
    return () => {
      channel.port1.close();
      runtime.panelPorts.delete(panelId);
    };
  }
  static readonly panelSandbox = PLUGIN_PANEL_SANDBOX;
  cancelProgress(id: string): void {
    const progress = this.#progress.get(id);
    if (!progress?.cancellable) return;
    const runtime = this.#runtimes.get(progress.pluginId);
    runtime?.port.postMessage({
      protocol: PLUGIN_PROTOCOL_VERSION,
      kind: "event",
      event: "progress.cancel",
      payload: { id },
    });
  }

  async runImporter(pluginId: string, importerId: string, input: Readonly<{ name: string; mediaType: string | null; bytes: ArrayBuffer }>): Promise<ReturnType<typeof validatePluginImportResult>> {
    const result = await this.#runProvider(pluginId, "importer", importerId, input, PLUGIN_LIMITS.transactionTimeoutMs);
    return validatePluginImportResult(result);
  }
  async runExporter(pluginId: string, exporterId: string, input: unknown): Promise<ReturnType<typeof validatePluginExportResult>> {
    const result = await this.#runProvider(pluginId, "exporter", exporterId, input, PLUGIN_LIMITS.transactionTimeoutMs);
    return validatePluginExportResult(result);
  }
  async runToolEvent(pluginId: string, toolId: string, input: unknown): Promise<readonly ReturnType<typeof pluginToolOperationSchema.parse>[]> {
    const result = await this.#runProvider(pluginId, "tool", toolId, input, PLUGIN_LIMITS.requestTimeoutMs);
    if (!Array.isArray(result)) throw new PluginError("MESSAGE_INVALID", "Plugin tool result must be an operation array.");
    return result.map((operation) => pluginToolOperationSchema.parse(operation));
  }

  async #onMessage(runtime: RuntimeRecord, input: unknown): Promise<void> {
    const event = rpcEventSchema.safeParse(input);
    if (event.success) {
      this.#onEvent(runtime, event.data.event, event.data.payload);
      return;
    }
    let request: PluginRpcRequest;
    try { request = runtime.gate.enter(input); }
    catch { return; }
    try {
      const result = await withTimeout(
        this.#dispatch(runtime, request.method, request.params),
        request.method === "documents.transaction" ? PLUGIN_LIMITS.transactionTimeoutMs : PLUGIN_LIMITS.requestTimeoutMs,
      );
      const transfer = transferableResults(result);
      runtime.port.postMessage(
        { protocol: PLUGIN_PROTOCOL_VERSION, kind: "response", requestId: request.requestId, ok: true, result },
        transfer,
      );
    } catch (error) {
      const code = error instanceof PluginError ? error.code : error instanceof DOMException && error.name === "AbortError" ? "CANCELLED" : "API_ERROR";
      runtime.port.postMessage({
        protocol: PLUGIN_PROTOCOL_VERSION,
        kind: "response",
        requestId: request.requestId,
        ok: false,
        error: { code },
      });
    } finally {
      runtime.gate.leave(request.requestId);
    }
  }

  async #dispatch(runtime: RuntimeRecord, method: string, params: unknown): Promise<unknown> {
    const pluginId = runtime.descriptor.pluginId;
    const grants = runtime.descriptor.grants;
    if (method === "commands.register") {
      requireGrant(grants, "ui.command");
      const id = stringProperty(params, "id");
      const contribution = runtime.descriptor.manifest.contributes?.commands?.find((command) => command.id === id);
      if (contribution === undefined) throw new PluginError("PERMISSION_DENIED", "Plugin command was not declared.");
      if (runtime.disposers.some((dispose) => Object.is(dispose, id)))
        throw new PluginError("MESSAGE_INVALID", "Plugin command is already registered.");
      const dispose = this.#commands.register({
        id,
        titleKey: contribution.title,
        category: "category.plugins",
        canExecute: () => contribution.requiresActiveDocument !== true || this.#workspace.active !== null,
        execute: async () => await this.#executePluginCommand(runtime, id),
      });
      runtime.disposers.push(dispose);
      this.#commands.notifyStateChanged();
      return null;
    }
    if (method === "documents.getActive") return this.#documents.getActive(pluginId, grants);
    if (method === "documents.listOpen") return this.#documents.listOpen(pluginId, grants);
    if (method === "documents.getInfo") return this.#documents.getInfo(stringProperty(params, "documentId"), pluginId, grants);
    if (method === "documents.getLayers") return this.#documents.getLayers(stringProperty(params, "documentId"), pluginId, grants);
    if (method === "documents.getFrames") return this.#documents.getFrames(stringProperty(params, "documentId"), pluginId, grants);
    if (method === "documents.getSelectionBounds") return this.#documents.getSelectionBounds(stringProperty(params, "documentId"), pluginId, grants);
    if (method === "documents.readPalette") return this.#documents.readPalette(stringProperty(params, "documentId"), pluginId, grants);
    if (method === "documents.readPixels") {
      const record = objectValue(params);
      return this.#documents.readPixels(stringProperty(record, "documentId"), record.options, pluginId, grants);
    }
    if (method === "documents.transaction") {
      const result = this.#documents.transaction(params, pluginId, grants);
      const entry = this.#workspace.documents.find((document) => document.id === stringProperty(params, "documentId"));
      if (entry !== undefined) this.#workspace.invalidateCanvas(entry.id);
      return result;
    }
    if (method === "storage.get") return await window.suwolDesktop?.plugins.storageGet(pluginId, stringProperty(params, "key"));
    if (method === "storage.set") {
      const record = objectValue(params);
      await window.suwolDesktop?.plugins.storageSet(pluginId, stringProperty(record, "key"), record.value);
      return null;
    }
    if (method === "storage.delete") { await window.suwolDesktop?.plugins.storageDelete(pluginId, stringProperty(params, "key")); return null; }
    if (method === "network.request") {
      const parsed = pluginNetworkRequestSchema.parse({ pluginId, request: params });
      return await window.suwolDesktop?.plugins.networkRequest(pluginId, parsed.request);
    }
    if (method === "progress.start") {
      const id = crypto.randomUUID();
      const record = objectValue(params);
      this.#progress.set(id, {
        id,
        pluginId,
        title: stringProperty(record, "title").slice(0, 100),
        cancellable: record.cancellable === true,
        percent: null,
        message: "",
      });
      this.#touch();
      return { id };
    }
    if (method === "progress.report") {
      const record = objectValue(params), id = stringProperty(record, "id"), current = this.#progress.get(id);
      const value = objectValue(record.value);
      if (current?.pluginId === pluginId) {
        const percent = typeof value.percent === "number" ? Math.min(100, Math.max(0, value.percent)) : null;
        this.#progress.set(id, { ...current, percent, message: typeof value.message === "string" ? value.message.slice(0, 200) : "" });
        this.#touch();
      }
      return null;
    }
    if (method === "progress.end") { this.#progress.delete(stringProperty(params, "id")); this.#touch(); return null; }
    if (method === "notifications.show") {
      requireGrant(grants, "ui.notification");
      const record = objectValue(params), level = record.level;
      if (level !== "info" && level !== "warning" && level !== "error") throw new PluginError("MESSAGE_INVALID", "Notification level is invalid.");
      this.#notice(pluginId, level, stringProperty(record, "message").slice(0, 500));
      return null;
    }
    if (method === "panels.postMessage") {
      requireGrant(grants, "ui.panel");
      const record = objectValue(params), panelId = stringProperty(record, "panelId");
      runtime.panelPorts.get(panelId)?.postMessage(record.message);
      return null;
    }
    if (method === "importers.register") {
      requireGrant(grants, "file.import");
      const id = stringProperty(params, "id");
      if (!runtime.descriptor.manifest.contributes?.importers?.some((entry) => entry.id === id))
        throw new PluginError("PERMISSION_DENIED", "Plugin importer was not declared.");
      return null;
    }
    if (method === "exporters.register") {
      requireGrant(grants, "file.export");
      const id = stringProperty(params, "id");
      if (!runtime.descriptor.manifest.contributes?.exporters?.some((entry) => entry.id === id))
        throw new PluginError("PERMISSION_DENIED", "Plugin exporter was not declared.");
      return null;
    }
    if (method === "tools.register") {
      requireGrant(grants, "ui.tool");
      const id = stringProperty(params, "id");
      if (!runtime.descriptor.manifest.contributes?.tools?.some((entry) => entry.id === id))
        throw new PluginError("PERMISSION_DENIED", "Plugin tool was not declared.");
      return null;
    }
    if (method === "overlays.update") {
      requireGrant(grants, "ui.overlay");
      runtime.overlayGate.enter();
      const update = validateOverlayUpdate(params, this.#workspace.active?.session.model.canvas ?? { width: 1, height: 1 });
      if (!runtime.descriptor.manifest.contributes?.overlays?.some((entry) => entry.id === update.overlayId))
        throw new PluginError("PERMISSION_DENIED", "Plugin overlay was not declared.");
      this.#overlays.set(`${pluginId}:${update.overlayId}`, {
        pluginId,
        update,
        updatedAt: Date.now(),
        documentId: this.#workspace.active?.id ?? null,
        frameId: this.#workspace.active?.view.activeFrameId ?? null,
      });
      this.#touch();
      return null;
    }
    if (method === "overlays.clear") {
      requireGrant(grants, "ui.overlay");
      this.#overlays.delete(`${pluginId}:${stringProperty(params, "overlayId")}`);
      this.#touch();
      return null;
    }
    throw new PluginError("MESSAGE_INVALID", "Unknown plugin protocol method.");
  }

  async #executePluginCommand(runtime: RuntimeRecord, id: string): Promise<void> {
    const executionId = crypto.randomUUID();
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        runtime.executions.set(executionId, { resolve, reject });
        runtime.port.postMessage({ protocol: PLUGIN_PROTOCOL_VERSION, kind: "event", event: "command.execute", payload: { id, executionId } });
      }),
      PLUGIN_LIMITS.transactionTimeoutMs,
    );
  }
  #onEvent(runtime: RuntimeRecord, event: string, payload: unknown): void {
    if (event === "command.complete" || event === "command.error") {
      const executionId = stringProperty(payload, "executionId");
      const execution = runtime.executions.get(executionId);
      runtime.executions.delete(executionId);
      if (event === "command.complete") execution?.resolve();
      else execution?.reject(new Error("Plugin command failed."));
      return;
    }
    if (/^(?:importer|exporter|tool)\.(?:complete|error)$/.test(event)) {
      const record = objectValue(payload), executionId = stringProperty(record, "executionId"), execution = runtime.providerExecutions.get(executionId);
      runtime.providerExecutions.delete(executionId);
      if (event.endsWith(".complete")) execution?.resolve(event.startsWith("tool.") ? record.operations : record.result);
      else execution?.reject(new Error("Plugin provider failed."));
    }
  }
  async #runProvider(pluginId: string, kind: "importer" | "exporter" | "tool", id: string, input: unknown, timeoutMs: number): Promise<unknown> {
    const runtime = this.#runtimes.get(pluginId);
    if (!runtime?.ready) throw new PluginError("RUNTIME_CRASHED", "Plugin runtime is unavailable.");
    const declared = kind === "importer" ? runtime.descriptor.manifest.contributes?.importers : kind === "exporter" ? runtime.descriptor.manifest.contributes?.exporters : runtime.descriptor.manifest.contributes?.tools;
    if (!declared?.some((entry) => entry.id === id)) throw new PluginError("PERMISSION_DENIED", "Plugin provider was not declared.");
    const executionId = crypto.randomUUID();
    try {
      return await withTimeout(new Promise<unknown>((resolve, reject) => {
        runtime.providerExecutions.set(executionId, { resolve, reject });
        runtime.port.postMessage({ protocol: PLUGIN_PROTOCOL_VERSION, kind: "event", event: `${kind}.execute`, payload: { id, executionId, input } });
      }), timeoutMs);
    } finally {
      runtime.providerExecutions.delete(executionId);
    }
  }
  async #crash(runtime: RuntimeRecord): Promise<void> {
    const pluginId = runtime.descriptor.pluginId;
    this.#runtimeErrors.set(pluginId, { code: "RUNTIME_CRASHED", timestamp: Date.now() });
    this.#notice(pluginId, "error", "Runtime Crashed");
    await this.stop(pluginId);
  }
  #hostDocument(entry: WorkspaceStore["active"]): PluginHostDocument | null {
    if (entry === null) return null;
    return {
      session: entry.session,
      activeLayerId: entry.view.activeLayerId,
      activeFrameId: entry.view.activeFrameId,
      selectionBounds: entry.view.selection.bounds,
    };
  }
  #requiredHostDocument(entry: WorkspaceDocument): PluginHostDocument {
    const document = this.#hostDocument(entry);
    if (document === null) throw new Error("Workspace document is unavailable.");
    return document;
  }
  #notice(pluginId: string, level: "info" | "warning" | "error", message: string): void {
    this.#lastNotice = { pluginId, level, message };
    this.#touch();
  }
  async #syncNativeMenu(): Promise<void> {
    const commands = [...this.#runtimes.values()].flatMap((runtime) => {
      const manifest = runtime.descriptor.manifest;
      const declared = new Map((manifest.contributes?.commands ?? []).map((command) => [command.id, command]));
      return (manifest.contributes?.menus ?? [])
        .filter((menu) => menu.location === "plugins")
        .flatMap((menu) => {
          const command = declared.get(menu.command);
          return command === undefined ? [] : [{ id: command.id, title: command.title, pluginName: manifest.name }];
        });
    });
    await window.suwolDesktop?.plugins.updateMenuCommands(commands);
  }
  #touch(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
  #listen(): void {
    if (this.#listening) return;
    window.addEventListener("message", this.#onWindowMessage);
    this.#listening = true;
  }
  async dispose(): Promise<void> {
    if (this.#listening) {
      window.removeEventListener("message", this.#onWindowMessage);
      this.#listening = false;
    }
    for (const pluginId of [...this.#runtimes.keys()]) await this.stop(pluginId);
    this.#progress.clear();
    this.#overlays.clear();
  }
}

function objectValue(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new PluginError("MESSAGE_INVALID", "Plugin request parameters are invalid.");
  return input as Readonly<Record<string, unknown>>;
}
function stringProperty(input: unknown, key: string): string {
  const value = objectValue(input)[key];
  if (typeof value !== "string" || value.length < 1 || value.length > 256)
    throw new PluginError("MESSAGE_INVALID", "Plugin request string is invalid.");
  return value;
}
function requireGrant(grants: readonly string[], permission: string): void {
  if (!grants.includes(permission)) throw new PluginError("PERMISSION_DENIED", "Plugin permission was not granted.");
}
function transferableResults(input: unknown): Transferable[] {
  if (input instanceof ArrayBuffer) return [input];
  if (typeof input !== "object" || input === null) return [];
  const result: Transferable[] = [];
  for (const value of Object.values(input)) if (value instanceof ArrayBuffer) result.push(value);
  return result;
}
