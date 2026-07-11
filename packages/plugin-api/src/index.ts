import { z } from "zod";

export const PLUGIN_API_VERSION = "1.1.0" as const;
export const PLUGIN_PROTOCOL_VERSION = 1 as const;

export const PLUGIN_LIMITS = Object.freeze({
  archiveFiles: 2_000,
  expandedBytes: 100 * 1024 * 1024,
  singleFileBytes: 20 * 1024 * 1024,
  compressionRatio: 1_000,
  messageBytes: 16 * 1024 * 1024,
  pixelTransferBytes: 64 * 1024 * 1024,
  storageBytes: 5 * 1024 * 1024,
  networkResponseBytes: 32 * 1024 * 1024,
  transactionBytes: 128 * 1024 * 1024,
  transactionTimeoutMs: 60_000,
  requestTimeoutMs: 15_000,
  activationTimeoutMs: 10_000,
  deactivationTimeoutMs: 3_000,
  maxConcurrentRequests: 32,
  requestsPerSecond: 120,
  progressReportsPerSecond: 20,
  notificationsPerMinute: 20,
  maxRedirects: 5,
  maxLogEntries: 1_000,
  importerBytes: 100 * 1024 * 1024,
  exporterFiles: 1_000,
  exporterBytes: 256 * 1024 * 1024,
  toolPixelsPerStroke: 1_000_000,
  toolEventsPerSecond: 120,
  overlayPrimitives: 1_000,
  overlayImageBytes: 4 * 1024 * 1024,
  overlayTextLength: 1_000,
  overlayUpdatesPerSecond: 30,
});

export const STATIC_PLUGIN_PERMISSIONS = [
  "document.read",
  "document.write",
  "selection.read",
  "palette.read",
  "palette.write",
  "ui.command",
  "ui.menu",
  "ui.panel",
  "ui.notification",
  "storage",
  "file.import",
  "file.export",
  "ui.tool",
  "ui.overlay",
] as const;
export type StaticPluginPermission = (typeof STATIC_PLUGIN_PERMISSIONS)[number];
export type NetworkPluginPermission = `network:${string}`;
export type PluginPermission = StaticPluginPermission | NetworkPluginPermission;

export const MENU_LOCATIONS = [
  "plugins",
  "documentContext",
  "layerContext",
  "frameContext",
  "paletteContext",
] as const;
export type PluginMenuLocation = (typeof MENU_LOCATIONS)[number];

export const pluginIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/,
    "Plugin ids must use a lowercase reverse-domain namespace.",
  );
export const contributionIdSchema = z
  .string()
  .min(3)
  .max(180)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
export const semanticVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
export const versionRangeSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => /^(?:\^|>=)?\d+\.\d+\.\d+$/.test(value));

function normalizeHostname(input: string): string | null {
  const hostname = input.toLocaleLowerCase("en-US");
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    hostname.includes("*") ||
    hostname.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      hostname,
    )
  )
    return null;
  return hostname;
}

export function parsePluginPermission(input: unknown): PluginPermission | null {
  if (typeof input !== "string") return null;
  if ((STATIC_PLUGIN_PERMISSIONS as readonly string[]).includes(input))
    return input as StaticPluginPermission;
  if (input === "network:localhost") return input;
  if (!input.startsWith("network:")) return null;
  const hostname = normalizeHostname(input.slice("network:".length));
  return hostname === null ? null : `network:${hostname}`;
}

export const pluginPermissionSchema = z
  .string()
  .transform((value, context): PluginPermission => {
    const parsed = parsePluginPermission(value);
    if (parsed === null) {
      context.addIssue({ code: "custom", message: "Unsupported plugin permission." });
      return z.NEVER;
    }
    return parsed;
  });

const commandContributionSchema = z
  .object({
    id: contributionIdSchema,
    title: z.string().min(1).max(100),
    requiresActiveDocument: z.boolean().optional(),
  })
  .strict();
const menuContributionSchema = z
  .object({
    location: z.enum(MENU_LOCATIONS),
    command: contributionIdSchema,
    group: z.string().regex(/^[a-z0-9.-]{1,40}$/).optional(),
    order: z.number().int().min(-1_000).max(1_000).optional(),
  })
  .strict();
const panelContributionSchema = z
  .object({
    id: contributionIdSchema,
    title: z.string().min(1).max(100),
    entry: z.string().min(1).max(260),
  })
  .strict();
const extensionSchema = z.string().regex(/^\.[a-z0-9][a-z0-9._-]{0,15}$/);
const importerContributionSchema = z.object({
  id: contributionIdSchema,
  title: z.string().min(1).max(100),
  extensions: z.array(extensionSchema).min(1).max(32),
  mimeTypes: z.array(z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/)).max(32).optional(),
}).strict();
const exporterContributionSchema = z.object({
  id: contributionIdSchema,
  title: z.string().min(1).max(100),
  extensions: z.array(extensionSchema).min(1).max(32),
  supportsMultipleFiles: z.boolean().optional(),
}).strict();
const toolContributionSchema = z.object({
  id: contributionIdSchema,
  title: z.string().min(1).max(100),
  icon: z.string().min(1).max(260).optional(),
}).strict();
const overlayContributionSchema = z.object({
  id: contributionIdSchema,
  title: z.string().min(1).max(100),
  zOrder: z.enum(["below-selection", "above-document", "above-selection"]),
}).strict();

export const pluginManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: pluginIdSchema,
    name: z.string().min(1).max(100),
    version: semanticVersionSchema,
    apiVersion: versionRangeSchema,
    engines: z
      .object({ suwolPixelStudio: versionRangeSchema })
      .strict(),
    entry: z.string().min(1).max(260),
    publisher: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    permissions: z.array(pluginPermissionSchema).max(64).default([]),
    contributes: z
      .object({
        commands: z.array(commandContributionSchema).max(100).optional(),
        menus: z.array(menuContributionSchema).max(100).optional(),
        panels: z.array(panelContributionSchema).max(20).optional(),
        importers: z.array(importerContributionSchema).max(20).optional(),
        exporters: z.array(exporterContributionSchema).max(20).optional(),
        tools: z.array(toolContributionSchema).max(50).optional(),
        overlays: z.array(overlayContributionSchema).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const permissions = new Set<string>();
    for (const permission of manifest.permissions) {
      if (permissions.has(permission))
        context.addIssue({ code: "custom", path: ["permissions"], message: "Duplicate permission." });
      permissions.add(permission);
    }
    const commandIds = new Set<string>();
    for (const [index, command] of (manifest.contributes?.commands ?? []).entries()) {
      if (!command.id.startsWith(`${manifest.id}.`))
        context.addIssue({ code: "custom", path: ["contributes", "commands", index, "id"], message: "Command is outside the plugin namespace." });
      if (commandIds.has(command.id))
        context.addIssue({ code: "custom", path: ["contributes", "commands", index, "id"], message: "Duplicate command id." });
      commandIds.add(command.id);
    }
    const panelIds = new Set<string>();
    for (const [index, panel] of (manifest.contributes?.panels ?? []).entries()) {
      if (!panel.id.startsWith(`${manifest.id}.`))
        context.addIssue({ code: "custom", path: ["contributes", "panels", index, "id"], message: "Panel is outside the plugin namespace." });
      if (panelIds.has(panel.id) || commandIds.has(panel.id))
        context.addIssue({ code: "custom", path: ["contributes", "panels", index, "id"], message: "Duplicate contribution id." });
      panelIds.add(panel.id);
    }
    const contributionIds = new Set([...commandIds, ...panelIds]);
    const collections = [
      ["importers", manifest.contributes?.importers ?? []],
      ["exporters", manifest.contributes?.exporters ?? []],
      ["tools", manifest.contributes?.tools ?? []],
      ["overlays", manifest.contributes?.overlays ?? []],
    ] as const;
    for (const [collection, items] of collections)
      for (const [index, item] of items.entries()) {
        if (!item.id.startsWith(`${manifest.id}.`))
          context.addIssue({ code: "custom", path: ["contributes", collection, index, "id"], message: "Contribution is outside the plugin namespace." });
        if (contributionIds.has(item.id))
          context.addIssue({ code: "custom", path: ["contributes", collection, index, "id"], message: "Duplicate contribution id." });
        contributionIds.add(item.id);
      }
    const requiredPermissions = [
      ["importers", "file.import"],
      ["exporters", "file.export"],
      ["tools", "ui.tool"],
      ["overlays", "ui.overlay"],
    ] as const;
    for (const [collection, permission] of requiredPermissions)
      if ((manifest.contributes?.[collection]?.length ?? 0) > 0 && !permissions.has(permission))
        context.addIssue({ code: "custom", path: ["permissions"], message: `${permission} is required for ${collection}.` });
    for (const [index, menu] of (manifest.contributes?.menus ?? []).entries())
      if (!commandIds.has(menu.command))
        context.addIssue({ code: "custom", path: ["contributes", "menus", index, "command"], message: "Menu references an undeclared command." });
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginCommandContribution = z.infer<typeof commandContributionSchema>;
export type PluginMenuContribution = z.infer<typeof menuContributionSchema>;
export type PluginPanelContribution = z.infer<typeof panelContributionSchema>;
export type PluginImporterContribution = z.infer<typeof importerContributionSchema>;
export type PluginExporterContribution = z.infer<typeof exporterContributionSchema>;
export type PluginToolContribution = z.infer<typeof toolContributionSchema>;
export type PluginOverlayContribution = z.infer<typeof overlayContributionSchema>;

export interface PluginPackageHandle {
  readonly id: string;
  readonly displayName: string;
}
export interface PluginInspection {
  readonly handle: PluginPackageHandle;
  readonly manifest: PluginManifest;
  readonly unsigned: true;
  readonly compatible: boolean;
  readonly currentVersion: string | null;
  readonly newPermissions: readonly PluginPermission[];
  readonly downgrade: boolean;
}
export type PluginRuntimeStatus = "disabled" | "stopped" | "starting" | "running" | "crashed";
export interface InstalledPluginInfo {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly grants: readonly PluginPermission[];
  readonly compatible: boolean;
  readonly runtimeStatus: PluginRuntimeStatus;
  readonly installSource: "package";
  readonly unsigned: true;
  readonly lastError: Readonly<{ code: string; timestamp: number }> | null;
}
export interface PluginRuntimeDescriptor {
  readonly pluginId: string;
  readonly runtimeId: string;
  readonly entryUrl: string;
  readonly manifest: PluginManifest;
  readonly grants: readonly PluginPermission[];
}

export const intRectSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type PluginIntRect = z.infer<typeof intRectSchema>;
export interface PluginDocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
}
export interface PluginLayerInfo {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
}
export interface PluginFrameInfo {
  readonly id: string;
  readonly durationMs: number;
}
export interface PluginPaletteColor {
  readonly id: string;
  readonly name?: string;
  readonly rgba: readonly [number, number, number, number];
}
export interface PluginPalette {
  readonly colors: readonly PluginPaletteColor[];
}

export const readPixelsOptionsSchema = z
  .object({ layerId: z.string().min(1).max(128), frameId: z.string().min(1).max(128), rect: intRectSchema })
  .strict();
export const writePixelsOptionsSchema = readPixelsOptionsSchema.extend({ pixels: z.instanceof(ArrayBuffer) }).strict();
export const clearPixelsOptionsSchema = readPixelsOptionsSchema;
export type ReadPixelsOptions = z.infer<typeof readPixelsOptionsSchema>;
export type WritePixelsOptions = z.infer<typeof writePixelsOptionsSchema>;

const pluginPaletteColorSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(100).optional(),
  rgba: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]),
}).strict();
export const pluginPaletteSchema = z.object({ colors: z.array(pluginPaletteColorSchema).max(256) }).strict();
export const transactionOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addPixelLayer"), temporaryId: z.string().regex(/^temp:[a-zA-Z0-9._-]{1,80}$/), name: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("addFrame"), temporaryId: z.string().regex(/^temp:[a-zA-Z0-9._-]{1,80}$/), afterFrameId: z.string().min(1).max(128).optional() }).strict(),
  z.object({ type: z.literal("writePixels"), options: writePixelsOptionsSchema }).strict(),
  z.object({ type: z.literal("clearPixels"), options: readPixelsOptionsSchema }).strict(),
  z.object({ type: z.literal("setLayerName"), layerId: z.string().min(1).max(128), name: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("setLayerVisibility"), layerId: z.string().min(1).max(128), visible: z.boolean() }).strict(),
  z.object({ type: z.literal("setPalette"), palette: pluginPaletteSchema }).strict(),
  z.object({ type: z.literal("setPluginData"), value: z.unknown() }).strict(),
]);
export const pluginTransactionRequestSchema = z.object({
  documentId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
  label: z.string().min(1).max(100),
  operations: z.array(transactionOperationSchema).min(1).max(1_000),
}).strict();
export type TransactionOperation = z.infer<typeof transactionOperationSchema>;
export type PluginTransactionRequest = z.infer<typeof pluginTransactionRequestSchema>;

export interface PluginNetworkRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: ArrayBuffer | undefined;
  readonly timeoutMs?: number | undefined;
}
export interface PluginNetworkResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ArrayBuffer;
}

const rgbaSchema = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
export const pluginImportResultSchema = z.object({
  document: z.object({
    name: z.string().min(1).max(256),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    colorMode: z.enum(["rgba", "indexed"]),
    transparentIndex: z.number().int().min(0).max(255).optional(),
    palette: z.array(rgbaSchema).max(256),
    frames: z.array(z.object({ durationMs: z.number().int().min(10).max(60_000) }).strict()).min(1).max(10_000),
    layers: z.array(z.object({ id: z.string().regex(/^temp:[a-zA-Z0-9._-]{1,80}$/), name: z.string().min(1).max(100) }).strict()).min(1).max(10_000),
    cels: z.array(z.object({
      layerId: z.string().regex(/^temp:[a-zA-Z0-9._-]{1,80}$/),
      frameIndex: z.number().int().min(0).max(9_999),
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().min(1).max(8192),
      height: z.number().int().min(1).max(8192),
      format: z.enum(["rgba8", "indexed8"]),
      pixels: z.instanceof(ArrayBuffer),
    }).strict()).max(100_000),
  }).strict(),
  warnings: z.array(z.string().max(500)).max(1_000).default([]),
}).strict();
export type PluginImportResult = z.infer<typeof pluginImportResultSchema>;

export const safeRelativeExportPathSchema = z.string().min(1).max(260).refine((path) =>
  !path.startsWith("/") && !path.startsWith("\\") && !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."),
  "Export path must be a safe relative path.",
);
export const pluginExportResultSchema = z.object({
  files: z.array(z.object({
    relativePath: safeRelativeExportPathSchema,
    data: z.instanceof(ArrayBuffer),
    mediaType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).optional(),
  }).strict()).min(1).max(PLUGIN_LIMITS.exporterFiles),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((result, context) => {
  const paths = new Set<string>();
  let bytes = 0;
  result.files.forEach((file, index) => {
    if (paths.has(file.relativePath)) context.addIssue({ code: "custom", path: ["files", index, "relativePath"], message: "Duplicate export path." });
    paths.add(file.relativePath);
    bytes += file.data.byteLength;
  });
  if (bytes > PLUGIN_LIMITS.exporterBytes) context.addIssue({ code: "custom", path: ["files"], message: "Exporter output exceeds the byte limit." });
});
export type PluginExportResult = z.infer<typeof pluginExportResultSchema>;

export const pluginToolEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pointerDown"), strokeId: z.uuid(), position: z.object({ x: z.number(), y: z.number() }).strict(), pressure: z.number().min(0).max(1), modifiers: z.object({ shift: z.boolean(), alt: z.boolean(), primary: z.boolean() }).strict(), layerId: z.string().min(1), frameId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("pointerMove"), strokeId: z.uuid(), points: z.array(z.object({ x: z.number(), y: z.number(), pressure: z.number().min(0).max(1) }).strict()).min(1).max(256) }).strict(),
  z.object({ type: z.literal("pointerUp"), strokeId: z.uuid() }).strict(),
  z.object({ type: z.literal("cancel"), strokeId: z.uuid(), reason: z.enum(["user", "timeout", "crash", "playback", "deactivated"]) }).strict(),
]);
export type PluginToolEvent = z.infer<typeof pluginToolEventSchema>;
export const pluginToolOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pixels"), points: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()).max(PLUGIN_LIMITS.toolPixelsPerStroke), rgba: rgbaSchema.optional(), paletteIndex: z.number().int().min(0).max(255).optional() }).strict(),
  z.object({ type: z.literal("clear"), points: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()).max(PLUGIN_LIMITS.toolPixelsPerStroke) }).strict(),
]);
export type PluginToolOperation = z.infer<typeof pluginToolOperationSchema>;

const overlayStyleSchema = z.object({ color: rgbaSchema, width: z.number().min(0.25).max(64).optional(), fill: rgbaSchema.optional(), dash: z.array(z.number().positive().max(128)).max(16).optional() }).strict();
export const overlayPrimitiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), rect: intRectSchema, style: overlayStyleSchema }).strict(),
  z.object({ kind: z.literal("line"), from: z.object({ x: z.number(), y: z.number() }).strict(), to: z.object({ x: z.number(), y: z.number() }).strict(), style: overlayStyleSchema }).strict(),
  z.object({ kind: z.literal("pixelPreview"), points: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()).max(PLUGIN_LIMITS.toolPixelsPerStroke), color: rgbaSchema }).strict(),
  z.object({ kind: z.literal("text"), position: z.object({ x: z.number(), y: z.number() }).strict(), text: z.string().max(PLUGIN_LIMITS.overlayTextLength) }).strict(),
  z.object({ kind: z.literal("imagePreview"), rect: intRectSchema, pixels: z.instanceof(ArrayBuffer).refine((buffer) => buffer.byteLength <= PLUGIN_LIMITS.overlayImageBytes) }).strict(),
]);
export const overlayUpdateSchema = z.object({ overlayId: contributionIdSchema, primitives: z.array(overlayPrimitiveSchema).max(PLUGIN_LIMITS.overlayPrimitives), lifetimeMs: z.number().int().min(16).max(60_000) }).strict();
export type OverlayPrimitive = z.infer<typeof overlayPrimitiveSchema>;
export type OverlayUpdate = z.infer<typeof overlayUpdateSchema>;

export const rpcRequestSchema = z
  .object({
    protocol: z.literal(PLUGIN_PROTOCOL_VERSION),
    kind: z.literal("request"),
    requestId: z.uuid(),
    method: z.string().min(1).max(100),
    params: z.unknown(),
  })
  .strict();
export const rpcResponseSchema = z
  .object({
    protocol: z.literal(PLUGIN_PROTOCOL_VERSION),
    kind: z.literal("response"),
    requestId: z.uuid(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.object({ code: z.string().min(1).max(80), detail: z.unknown().optional() }).strict().optional(),
  })
  .strict();
export const rpcEventSchema = z
  .object({
    protocol: z.literal(PLUGIN_PROTOCOL_VERSION),
    kind: z.literal("event"),
    event: z.string().min(1).max(100),
    payload: z.unknown(),
  })
  .strict();
export type PluginRpcRequest = z.infer<typeof rpcRequestSchema>;
export type PluginRpcResponse = z.infer<typeof rpcResponseSchema>;
export type PluginRpcEvent = z.infer<typeof rpcEventSchema>;

export interface Disposable { dispose(): void; }
export interface DisposableStore extends Disposable { add(disposable: Disposable): void; }
export interface PluginContext {
  readonly plugin: Readonly<{ id: string; version: string; apiVersion: string }>;
  readonly commands: Readonly<{ register(commandId: string, handler: () => Promise<void> | void): Promise<Disposable> }>;
  readonly documents: Readonly<{ getActive(): Promise<PluginDocumentSummary | null>; listOpen(): Promise<readonly PluginDocumentSummary[]> }>;
  readonly panels: Readonly<{
    postMessage(panelId: string, message: unknown): Promise<void>;
    onMessage(panelId: string, handler: (message: unknown) => void): Disposable;
  }>;
  readonly storage: Readonly<{ get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }>;
  readonly network: Readonly<{ request(options: PluginNetworkRequest): Promise<PluginNetworkResponse> }>;
  readonly progress: Readonly<{ run<T>(options: Readonly<{ title: string; cancellable: boolean }>, task: (progress: Readonly<{ report(value: Readonly<{ percent?: number; message?: string }>): void; readonly aborted: boolean }>) => Promise<T>): Promise<T> }>;
  readonly notifications: Readonly<{ info(message: string): Promise<void>; warning(message: string): Promise<void>; error(message: string): Promise<void> }>;
  readonly importers: Readonly<{ register(importerId: string, handler: (input: Readonly<{ name: string; mediaType: string | null; bytes: ArrayBuffer }>) => Promise<PluginImportResult>): Promise<Disposable> }>;
  readonly exporters: Readonly<{ register(exporterId: string, handler: (input: Readonly<{ document: PluginDocumentSummary; options: unknown }>) => Promise<PluginExportResult>): Promise<Disposable> }>;
  readonly tools: Readonly<{ register(toolId: string, handler: (event: PluginToolEvent) => Promise<readonly PluginToolOperation[]>): Promise<Disposable> }>;
  readonly overlays: Readonly<{ update(update: OverlayUpdate): Promise<void>; clear(overlayId: string): Promise<void> }>;
  readonly subscriptions: DisposableStore;
}

interface ParsedVersion { readonly major: number; readonly minor: number; readonly patch: number; }
export function parseSemanticVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
export function compareSemanticVersions(first: string, second: string): number {
  const a = parseSemanticVersion(first), b = parseSemanticVersion(second);
  if (a === null || b === null) throw new Error("Invalid semantic version.");
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
export function satisfiesVersion(version: string, range: string): boolean {
  const parsed = parseSemanticVersion(version), target = parseSemanticVersion(range.replace(/^(?:\^|>=)/, ""));
  if (parsed === null || target === null) return false;
  if (range.startsWith("^"))
    return parsed.major === target.major && compareSemanticVersions(version, `${target.major}.${target.minor}.${target.patch}`) >= 0;
  if (range.startsWith(">="))
    return compareSemanticVersions(version, `${target.major}.${target.minor}.${target.patch}`) >= 0;
  return compareSemanticVersions(version, range) === 0;
}
