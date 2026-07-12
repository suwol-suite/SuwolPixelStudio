import { z } from "zod";
import { APPLICATION_COMMAND_IDS, type ApplicationCommandId } from "./commands";
import {
  pluginManifestSchema,
  pluginPermissionSchema,
  type InstalledPluginInfo,
  type PluginInspection,
  type PluginNetworkRequest,
  type PluginNetworkResponse,
  type PluginPackageHandle,
  type PluginPermission,
  type PluginRuntimeDescriptor,
} from "@suwol/plugin-api";
export type {
  InstalledPluginInfo,
  PluginInspection,
  PluginNetworkRequest,
  PluginNetworkResponse,
  PluginPackageHandle,
  PluginPermission,
  PluginRuntimeDescriptor,
} from "@suwol/plugin-api";

export const IPC_CHANNELS = Object.freeze({
  appGetVersion: "suwol:app:get-version",
  appGetPlatform: "suwol:app:get-platform",
  appGetDiagnostics: "suwol:app:get-diagnostics",
  appOpenLogsFolder: "suwol:app:open-logs-folder",
  appCopyDiagnostics: "suwol:app:copy-diagnostics",
  shellOpenExternal: "suwol:shell:open-external",
  commandInvoke: "suwol:command:invoke",
  commandSetState: "suwol:command:set-state",
  filesShowOpenDialog: "suwol:files:show-open-dialog",
  filesShowSaveDialog: "suwol:files:show-save-dialog",
  filesRead: "suwol:files:read",
  filesWriteAtomic: "suwol:files:write-atomic",
  filesShowExportDirectory: "suwol:files:show-export-directory",
  filesWriteExportBatch: "suwol:files:write-export-batch",
  clipboardWritePng: "suwol:clipboard:write-png",
  clipboardReadPng: "suwol:clipboard:read-png",
  recoveryWrite: "suwol:recovery:write",
  recoveryList: "suwol:recovery:list",
  recoveryRead: "suwol:recovery:read",
  recoveryDelete: "suwol:recovery:delete",
  recoveryDeleteAll: "suwol:recovery:delete-all",
  pluginSelectPackage: "suwol:plugin:select-package",
  pluginInspectPackage: "suwol:plugin:inspect-package",
  pluginInstall: "suwol:plugin:install",
  pluginList: "suwol:plugin:list",
  pluginSetEnabled: "suwol:plugin:set-enabled",
  pluginSetGrants: "suwol:plugin:set-grants",
  pluginRemove: "suwol:plugin:remove",
  pluginClearStorage: "suwol:plugin:clear-storage",
  pluginReadLogs: "suwol:plugin:read-logs",
  pluginStartRuntime: "suwol:plugin:start-runtime",
  pluginStopRuntime: "suwol:plugin:stop-runtime",
  pluginStorageGet: "suwol:plugin:storage-get",
  pluginStorageSet: "suwol:plugin:storage-set",
  pluginStorageDelete: "suwol:plugin:storage-delete",
  pluginNetworkRequest: "suwol:plugin:network-request",
  pluginGetSafeMode: "suwol:plugin:get-safe-mode",
  pluginSetSafeMode: "suwol:plugin:set-safe-mode",
  pluginShowFolder: "suwol:plugin:show-folder",
  pluginSetMenuCommands: "suwol:plugin:set-menu-commands",
  pluginCommandInvoke: "suwol:plugin:command-invoke",
  testConfigureDialog: "suwol:test:configure-dialog",
  testReadArtifact: "suwol:test:read-artifact",
  testConfigurePluginPackage: "suwol:test:configure-plugin-package",
} as const);

export const platformSchema = z.enum(["win32", "darwin", "linux"]);
export type SupportedPlatform = z.infer<typeof platformSchema>;
export const appDiagnosticsSchema = z
  .object({
    productName: z.literal("Suwol Pixel Studio"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/),
    electron: z.string().min(1).max(40),
    chromium: z.string().min(1).max(40),
    node: z.string().min(1).max(40),
    platform: platformSchema,
    architecture: z.enum(["x64", "arm64", "ia32", "arm"]),
    fileFormatVersion: z.literal(4),
    pluginApiVersion: z.literal("1.1.0"),
    license: z.literal("Apache-2.0"),
    repository: z.literal("https://github.com/suwol-suite/SuwolPixelStudio"),
  })
  .strict();
export type AppDiagnostics = z.infer<typeof appDiagnosticsSchema>;

export const applicationCommandIdSchema = z.enum(APPLICATION_COMMAND_IDS);
export const commandMenuStateSchema = z.union([
  z.boolean(),
  z.object({ enabled: z.boolean(), checked: z.boolean().optional() }).strict(),
]);
export type CommandMenuState = z.infer<typeof commandMenuStateSchema>;
export const commandStateSchema = z
  .record(z.string(), commandMenuStateSchema)
  .superRefine((value, context) => {
    for (const key of Object.keys(value))
      if (!applicationCommandIdSchema.safeParse(key).success)
        context.addIssue({ code: "custom", message: "Unknown command id." });
  });

export const openExternalRequestSchema = z
  .object({ url: z.string().min(1).max(2_048) })
  .strict();

export const fileHandleSchema = z
  .object({ id: z.uuid(), displayName: z.string().min(1).max(260) })
  .strict();
export const directoryHandleSchema = z
  .object({ id: z.uuid(), displayName: z.string().min(1).max(260) })
  .strict();
export const exportFileEntrySchema = z
  .object({
    relativePath: z.string().min(1).max(260),
    data: z.instanceof(ArrayBuffer),
  })
  .strict();

const exportExtensions = new Set(["png", "json", "gif"]);
export function isSafeExportRelativePath(input: string): boolean {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,199}$/.test(input) ||
    input.endsWith(".") ||
    input.endsWith(" ") ||
    input.includes("..")
  )
    return false;
  const separator = input.lastIndexOf("."),
    extension = separator < 0 ? "" : input.slice(separator + 1).toLocaleLowerCase("en-US");
  return exportExtensions.has(extension);
}
export const exportBatchRequestSchema = z
  .object({
    handle: directoryHandleSchema,
    entries: z.array(exportFileEntrySchema).min(1).max(10_000),
  })
  .strict();
const pluginExtensionSchema = z.string().regex(/^\.[a-z0-9][a-z0-9.+-]{0,15}$/);
export const openDialogOptionsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["document", "aseprite", "palette", "tileset", "layout", "keybindings"]) }).strict(),
  z.object({ kind: z.literal("plugin-import"), title: z.string().min(1).max(100), extensions: z.array(pluginExtensionSchema).min(1).max(32) }).strict(),
]);
export const saveDialogOptionsSchema = z
  .object({
    kind: z.enum(["suwolpixel", "png", "palette", "tilemap-json", "layout", "keybindings"]),
    suggestedName: z.string().min(1).max(200),
  })
  .strict();
export const fileDialogResultSchema = z.discriminatedUnion("canceled", [
  z.object({ canceled: z.literal(true) }).strict(),
  z.object({ canceled: z.literal(false), handle: fileHandleSchema }).strict(),
]);
export const recoverySnapshotInfoSchema = z
  .object({
    documentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    displayName: z.string().min(1).max(256),
    originalHandleId: z.uuid().nullable(),
    originalDisplayName: z.string().min(1).max(260).nullable(),
    revision: z.number().int().min(0),
    timestamp: z.number().int().positive(),
    lastSavedTimestamp: z.number().int().positive().nullable(),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    corrupt: z.boolean(),
    thumbnail: z.instanceof(ArrayBuffer).nullable(),
  })
  .strict();
export const recoveryWriteRequestSchema = recoverySnapshotInfoSchema
  .omit({ corrupt: true, thumbnail: true })
  .extend({
    data: z.instanceof(ArrayBuffer),
    thumbnail: z.instanceof(ArrayBuffer).optional(),
  })
  .strict();
export const recoveryDeleteRequestSchema = z
  .object({ documentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/) })
  .strict();
export const clipboardPngRequestSchema = z
  .object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    png: z.instanceof(ArrayBuffer),
  })
  .strict();
export const testDialogRequestSchema = z
  .object({
    operation: z.enum(["open", "save-suwolpixel", "save-png", "export-directory"]),
    fileName: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
    data: z.instanceof(ArrayBuffer).optional(),
  })
  .strict();
export const testPluginPackageRequestSchema = z.object({
  fileName: z.string().regex(/^[a-zA-Z0-9._-]{1,100}\.suwolplugin$/),
  data: z.instanceof(ArrayBuffer),
}).strict();

export const pluginPackageHandleSchema = z
  .object({ id: z.uuid(), displayName: z.string().min(1).max(260) })
  .strict();
export const pluginInspectionSchema = z
  .object({
    handle: pluginPackageHandleSchema,
    manifest: pluginManifestSchema,
    unsigned: z.literal(true),
    compatible: z.boolean(),
    currentVersion: z.string().nullable(),
    newPermissions: z.array(pluginPermissionSchema),
    downgrade: z.boolean(),
  })
  .strict();
export const installedPluginInfoSchema = z
  .object({
    manifest: pluginManifestSchema,
    enabled: z.boolean(),
    grants: z.array(pluginPermissionSchema),
    compatible: z.boolean(),
    runtimeStatus: z.enum(["disabled", "stopped", "starting", "running", "crashed"]),
    installSource: z.literal("package"),
    unsigned: z.literal(true),
    lastError: z.object({ code: z.string().min(1).max(80), timestamp: z.number().int().positive() }).strict().nullable(),
  })
  .strict();
export const pluginRuntimeDescriptorSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    runtimeId: z.uuid(),
    entryUrl: z.url(),
    manifest: pluginManifestSchema,
    grants: z.array(pluginPermissionSchema),
  })
  .strict();
export const pluginIdRequestSchema = z.object({ pluginId: z.string().min(3).max(128) }).strict();
export const pluginSetEnabledRequestSchema = pluginIdRequestSchema.extend({ enabled: z.boolean() }).strict();
export const pluginSetGrantsRequestSchema = pluginIdRequestSchema.extend({ grants: z.array(pluginPermissionSchema).max(64) }).strict();
export const pluginInstallRequestSchema = z.object({ handle: pluginPackageHandleSchema, grants: z.array(pluginPermissionSchema).max(64) }).strict();
export const pluginRemoveRequestSchema = pluginIdRequestSchema.extend({ deleteData: z.boolean() }).strict();
export const pluginRuntimeRequestSchema = z.object({ runtimeId: z.uuid() }).strict();
export const pluginStorageKeySchema = z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/);
export const pluginStorageGetRequestSchema = pluginIdRequestSchema.extend({ key: pluginStorageKeySchema }).strict();
export const pluginStorageSetRequestSchema = pluginStorageGetRequestSchema.extend({ value: z.unknown() }).strict();
export const pluginNetworkRequestSchema = pluginIdRequestSchema.extend({
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    url: z.string().min(1).max(4_096),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.instanceof(ArrayBuffer).optional(),
    timeoutMs: z.number().int().min(100).max(15_000).optional(),
  }).strict(),
}).strict();
export const pluginNetworkResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.instanceof(ArrayBuffer),
}).strict();
export const pluginMenuCommandSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(180),
  title: z.string().min(1).max(100).refine((value) => !/[<>]/.test(value)),
  pluginName: z.string().min(1).max(100).refine((value) => !/[<>]/.test(value)),
}).strict();
export type PluginMenuCommand = z.infer<typeof pluginMenuCommandSchema>;

export interface FileHandle {
  readonly id: string;
  readonly displayName: string;
}
export interface DirectoryHandle {
  readonly id: string;
  readonly displayName: string;
}
export interface ExportFileEntry {
  readonly relativePath: string;
  readonly data: ArrayBuffer;
}
export type OpenDialogOptions =
  | Readonly<{ kind: "document" | "aseprite" | "palette" | "tileset" | "layout" | "keybindings" }>
  | Readonly<{ kind: "plugin-import"; title: string; extensions: readonly string[] }>;
export type SaveDialogOptions = Readonly<{
  kind: "suwolpixel" | "png" | "palette" | "tilemap-json" | "layout" | "keybindings";
  suggestedName: string;
}>;
export type OpenDialogResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; handle: FileHandle }>;
export type SaveDialogResult = OpenDialogResult;
export interface RecoverySnapshotInfo {
  readonly documentId: string;
  readonly displayName: string;
  readonly originalHandleId: string | null;
  readonly originalDisplayName: string | null;
  readonly revision: number;
  readonly timestamp: number;
  readonly lastSavedTimestamp: number | null;
  readonly width: number;
  readonly height: number;
  readonly corrupt: boolean;
  readonly thumbnail: ArrayBuffer | null;
}
export interface RecoveryWriteInput extends Omit<
  RecoverySnapshotInfo,
  "corrupt" | "thumbnail"
> {
  readonly data: ArrayBuffer;
  readonly thumbnail?: ArrayBuffer;
}

export type SafeIpcError = Readonly<{
  code: "INVALID_INPUT" | "NOT_ALLOWED" | "INTERNAL_ERROR";
  message: string;
}>;

export type IpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SafeIpcError }>;

export interface SuwolDesktopApi {
  readonly app: Readonly<{
    getVersion(): Promise<string>;
    getPlatform(): Promise<SupportedPlatform>;
    getDiagnostics(): Promise<AppDiagnostics>;
    openLogsFolder(): Promise<void>;
    copyDiagnostics(): Promise<void>;
  }>;
  readonly shell: Readonly<{
    openExternal(url: string): Promise<void>;
  }>;
  readonly commands: Readonly<{
    onInvoke(listener: (commandId: ApplicationCommandId) => void): () => void;
    updateState(
      state: Readonly<Partial<Record<ApplicationCommandId, CommandMenuState>>>,
    ): Promise<void>;
  }>;
  readonly files: Readonly<{
    showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>;
    showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>;
    read(handle: FileHandle): Promise<ArrayBuffer>;
    writeAtomic(handle: FileHandle, data: ArrayBuffer): Promise<void>;
    showExportDirectory(): Promise<
      | Readonly<{ canceled: true }>
      | Readonly<{ canceled: false; handle: DirectoryHandle }>
    >;
    writeExportBatch(
      handle: DirectoryHandle,
      entries: readonly ExportFileEntry[],
    ): Promise<void>;
  }>;
  readonly clipboard: Readonly<{
    writePng(
      input: Readonly<{ width: number; height: number; png: ArrayBuffer }>,
    ): Promise<void>;
    readPng(): Promise<ArrayBuffer | null>;
  }>;
  readonly recovery: Readonly<{
    write(input: RecoveryWriteInput): Promise<void>;
    list(): Promise<readonly RecoverySnapshotInfo[]>;
    read(documentId: string): Promise<ArrayBuffer>;
    delete(documentId: string): Promise<void>;
    deleteAll(): Promise<void>;
  }>;
  readonly plugins: Readonly<{
    selectPackage(): Promise<PluginPackageHandle | null>;
    inspectPackage(handle: PluginPackageHandle): Promise<PluginInspection>;
    install(handle: PluginPackageHandle, grants: readonly PluginPermission[]): Promise<void>;
    list(): Promise<readonly InstalledPluginInfo[]>;
    setEnabled(pluginId: string, enabled: boolean): Promise<void>;
    setGrants(pluginId: string, grants: readonly PluginPermission[]): Promise<void>;
    remove(pluginId: string, deleteData: boolean): Promise<void>;
    clearStorage(pluginId: string): Promise<void>;
    readLogs(pluginId: string): Promise<readonly string[]>;
    startRuntime(pluginId: string): Promise<PluginRuntimeDescriptor>;
    stopRuntime(runtimeId: string): Promise<void>;
    storageGet(pluginId: string, key: string): Promise<unknown>;
    storageSet(pluginId: string, key: string, value: unknown): Promise<void>;
    storageDelete(pluginId: string, key: string): Promise<void>;
    networkRequest(pluginId: string, request: PluginNetworkRequest): Promise<PluginNetworkResponse>;
    getSafeMode(): Promise<Readonly<{ active: boolean; commandLine: boolean }>>;
    setSafeMode(enabled: boolean): Promise<void>;
    showFolder(pluginId: string): Promise<void>;
    updateMenuCommands(commands: readonly PluginMenuCommand[]): Promise<void>;
    onCommandInvoke(listener: (commandId: string) => void): () => void;
  }>;
  readonly test?: Readonly<{
    configureDialog(
      input: Readonly<{
        operation: "open" | "save-suwolpixel" | "save-png" | "export-directory";
        fileName: string;
        data?: ArrayBuffer;
      }>,
    ): Promise<void>;
    readArtifact(fileName: string): Promise<ArrayBuffer | null>;
    configurePluginPackage(fileName: string, data: ArrayBuffer): Promise<void>;
  }>;
}

export function parseExternalHttpsUrl(input: unknown): URL | null {
  const parsedRequest = openExternalRequestSchema.safeParse(input);
  if (!parsedRequest.success) return null;

  try {
    const url = new URL(parsedRequest.data.url);
    if (url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    if (url.hostname === "") return null;
    return url;
  } catch {
    return null;
  }
}
