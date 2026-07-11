export const PLUGIN_PANEL_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors suwol-pixel:",
].join("; ");

export const PLUGIN_WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

export const PLUGIN_RUNTIME_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors suwol-pixel:",
].join("; ");

export const PLUGIN_PANEL_SANDBOX = "allow-scripts allow-same-origin" as const;

export function createPluginRuntimeBootstrap(): string {
  return `"use strict";
const blocked = () => { throw new Error("Direct capability access is blocked."); };
try { Object.defineProperties(globalThis, {
  fetch: { value: blocked }, XMLHttpRequest: { value: undefined },
  WebSocket: { value: undefined }, EventSource: { value: undefined },
  OffscreenCanvas: { value: undefined }, createImageBitmap: { value: undefined }
}); } catch {}
let port = null;
let deactivate = null;
const pending = new Map();
const handlers = new Map();
const panelHandlers = new Map();
const importerHandlers = new Map();
const exporterHandlers = new Map();
const toolHandlers = new Map();
const progressStates = new Map();
const subscriptions = [];
function request(method, params, transfer = []) {
  if (!port) return Promise.reject(new Error("Plugin runtime is not initialized."));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    port.postMessage({ protocol: 1, kind: "request", requestId, method, params }, transfer);
  });
}
function disposable(dispose) { const value = { dispose }; subscriptions.push(value); return value; }
function context(meta) {
  return Object.freeze({
    plugin: Object.freeze(meta),
    commands: Object.freeze({ register: async (id, handler) => { handlers.set(id, handler); await request("commands.register", { id }); return disposable(() => handlers.delete(id)); } }),
    documents: Object.freeze({ getActive: () => request("documents.getActive", null), listOpen: () => request("documents.listOpen", null), request: (method, params, transfer) => request("documents." + method, params, transfer) }),
    panels: Object.freeze({
      postMessage: (panelId, message) => request("panels.postMessage", { panelId, message }),
      onMessage: (panelId, handler) => { panelHandlers.set(panelId, handler); return disposable(() => panelHandlers.delete(panelId)); }
    }),
    storage: Object.freeze({ get: key => request("storage.get", { key }), set: (key, value) => request("storage.set", { key, value }), delete: key => request("storage.delete", { key }) }),
    network: Object.freeze({ request: options => request("network.request", options, options.body ? [options.body] : []) }),
    progress: Object.freeze({ run: async (options, task) => { const run = await request("progress.start", options); const marker = { aborted: false }; progressStates.set(run.id, marker); const state = { get aborted() { return marker.aborted; }, report: value => { request("progress.report", { id: run.id, value }).catch(() => {}); } }; try { return await task(state); } finally { progressStates.delete(run.id); await request("progress.end", { id: run.id }); } } }),
    notifications: Object.freeze({ info: message => request("notifications.show", { level: "info", message }), warning: message => request("notifications.show", { level: "warning", message }), error: message => request("notifications.show", { level: "error", message }) }),
    importers: Object.freeze({ register: async (id, handler) => { importerHandlers.set(id, handler); await request("importers.register", { id }); return disposable(() => importerHandlers.delete(id)); } }),
    exporters: Object.freeze({ register: async (id, handler) => { exporterHandlers.set(id, handler); await request("exporters.register", { id }); return disposable(() => exporterHandlers.delete(id)); } }),
    tools: Object.freeze({ register: async (id, handler) => { toolHandlers.set(id, handler); await request("tools.register", { id }); return disposable(() => toolHandlers.delete(id)); } }),
    overlays: Object.freeze({ update: update => request("overlays.update", update), clear: overlayId => request("overlays.clear", { overlayId }) }),
    subscriptions: Object.freeze({ add: value => subscriptions.push(value), dispose: () => { for (const item of subscriptions.splice(0)) try { item.dispose(); } catch {} } })
  });
}
globalThis.onmessage = async event => {
  if (event.data?.type !== "suwol-plugin:init" || !event.ports?.[0]) return;
  port = event.ports[0];
  port.onmessage = async messageEvent => {
    const message = messageEvent.data;
    if (message?.kind === "response") {
      const item = pending.get(message.requestId); if (!item) return; pending.delete(message.requestId);
      if (message.ok) item.resolve(message.result); else item.reject(Object.assign(new Error(message.error?.code || "Plugin API error"), { code: message.error?.code }));
    } else if (message?.kind === "event" && message.event === "command.execute") {
      const handler = handlers.get(message.payload?.id);
      try { await handler?.(); port.postMessage({ protocol: 1, kind: "event", event: "command.complete", payload: { id: message.payload?.id, executionId: message.payload?.executionId } }); }
      catch { port.postMessage({ protocol: 1, kind: "event", event: "command.error", payload: { id: message.payload?.id, executionId: message.payload?.executionId } }); }
    } else if (message?.kind === "event" && message.event === "runtime.deactivate") {
      try { await deactivate?.(); } finally { close(); }
    } else if (message?.kind === "event" && message.event === "panel.message") {
      try { panelHandlers.get(message.payload?.panelId)?.(message.payload?.message); } catch {}
    } else if (message?.kind === "event" && message.event === "importer.execute") {
      try { const result = await importerHandlers.get(message.payload?.id)?.(message.payload?.input); port.postMessage({ protocol: 1, kind: "event", event: "importer.complete", payload: { executionId: message.payload?.executionId, result } }); }
      catch { port.postMessage({ protocol: 1, kind: "event", event: "importer.error", payload: { executionId: message.payload?.executionId } }); }
    } else if (message?.kind === "event" && message.event === "exporter.execute") {
      try { const result = await exporterHandlers.get(message.payload?.id)?.(message.payload?.input); port.postMessage({ protocol: 1, kind: "event", event: "exporter.complete", payload: { executionId: message.payload?.executionId, result } }); }
      catch { port.postMessage({ protocol: 1, kind: "event", event: "exporter.error", payload: { executionId: message.payload?.executionId } }); }
    } else if (message?.kind === "event" && message.event === "tool.execute") {
      try { const operations = await toolHandlers.get(message.payload?.id)?.(message.payload?.input); port.postMessage({ protocol: 1, kind: "event", event: "tool.complete", payload: { executionId: message.payload?.executionId, operations } }); }
      catch { port.postMessage({ protocol: 1, kind: "event", event: "tool.error", payload: { executionId: message.payload?.executionId } }); }
    } else if (message?.kind === "event" && message.event === "progress.cancel") {
      const marker = progressStates.get(message.payload?.id); if (marker) marker.aborted = true;
    }
  };
  port.start();
  try {
    const module = await import(event.data.entryUrl);
    deactivate = typeof module.deactivate === "function" ? module.deactivate : null;
    if (typeof module.activate !== "function") throw new Error("Plugin activate export is missing.");
    await module.activate(context(event.data.plugin));
    port.postMessage({ protocol: 1, kind: "event", event: "runtime.ready", payload: null });
  } catch (error) {
    port.postMessage({ protocol: 1, kind: "event", event: "runtime.activationFailed", payload: { message: error instanceof Error ? error.message.slice(0, 200) : "Activation failed" } });
  }
};`;
}

export function createPluginRuntimeFrameBootstrap(): string {
  return `"use strict";
globalThis.addEventListener("message", event => {
  if (event.data?.type !== "suwol-plugin:init" || !event.ports?.[0]) return;
  const runtimeId = event.data.runtimeId;
  try {
    const worker = new Worker("./__runtime.js", { type: "module", name: "suwol-plugin-runtime" });
    worker.onerror = () => parent.postMessage({ type: "suwol-plugin:runtime-error", runtimeId }, "*");
    worker.postMessage(event.data, [event.ports[0]]);
  } catch {
    parent.postMessage({ type: "suwol-plugin:runtime-error", runtimeId }, "*");
  }
}, { once: true });`;
}
