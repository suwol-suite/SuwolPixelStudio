import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  appDiagnosticsSchema,
  applicationCommandIdSchema,
  clipboardPngRequestSchema,
  commandStateSchema,
  fileDialogResultSchema,
  directoryHandleSchema,
  exportBatchRequestSchema,
  platformSchema,
  recoverySnapshotInfoSchema,
  installedPluginInfoSchema,
  pluginInspectionSchema,
  pluginInstallRequestSchema,
  pluginNetworkRequestSchema,
  pluginNetworkResponseSchema,
  pluginMenuCommandSchema,
  testPluginPackageRequestSchema,
  pluginPackageHandleSchema,
  pluginRuntimeDescriptorSchema,
  pluginSetGrantsRequestSchema,
  pluginStorageGetRequestSchema,
  pluginStorageSetRequestSchema,
  type ApplicationCommandId,
  type FileHandle,
  type DirectoryHandle,
  type ExportFileEntry,
  type IpcResult,
  type OpenDialogOptions,
  type RecoveryWriteInput,
  type PluginPackageHandle,
  type PluginPermission,
  type PluginNetworkRequest,
  type PluginMenuCommand,
  type SaveDialogOptions,
  type SuwolDesktopApi,
} from "@suwol/shared";

function unwrap<T>(input: unknown, validate: (value: unknown) => T): T {
  if (typeof input !== "object" || input === null || !("ok" in input)) {
    throw new Error("Invalid desktop response.");
  }
  const result = input as IpcResult<unknown>;
  if (!result.ok) throw new Error(result.error.message);
  return validate(result.value);
}

function parseString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid desktop response.");
  return value;
}

function parseArrayBuffer(value: unknown): ArrayBuffer {
  if (!(value instanceof ArrayBuffer))
    throw new Error("Invalid desktop response.");
  return value;
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new Error("Invalid desktop response.");
}

const api: SuwolDesktopApi = Object.freeze({
  app: Object.freeze({
    async getVersion(): Promise<string> {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.appGetVersion,
      );
      return unwrap(response, parseString);
    },
    async getPlatform() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.appGetPlatform,
      );
      return unwrap(response, (value) => platformSchema.parse(value));
    },
    async getDiagnostics() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.appGetDiagnostics,
      );
      return unwrap(response, (value) => appDiagnosticsSchema.parse(value));
    },
    async openLogsFolder() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.appOpenLogsFolder,
      );
      unwrap(response, parseVoid);
    },
    async copyDiagnostics() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.appCopyDiagnostics,
      );
      unwrap(response, parseVoid);
    },
  }),
  shell: Object.freeze({
    async openExternal(url: string): Promise<void> {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.shellOpenExternal,
        { url },
      );
      unwrap(response, (value) => {
        if (value !== null) throw new Error("Invalid desktop response.");
        return null;
      });
    },
  }),
  commands: Object.freeze({
    onInvoke(listener: (commandId: ApplicationCommandId) => void) {
      const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
        const commandId = applicationCommandIdSchema.safeParse(input);
        if (commandId.success) listener(commandId.data);
      };
      ipcRenderer.on(IPC_CHANNELS.commandInvoke, handler);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.commandInvoke, handler);
    },
    async updateState(
      state: Readonly<Partial<Record<ApplicationCommandId, boolean>>>,
    ) {
      const parsed = commandStateSchema.parse(state);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.commandSetState,
        parsed,
      );
      unwrap(response, parseVoid);
    },
  }),
  files: Object.freeze({
    async showOpenDialog(options: OpenDialogOptions) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesShowOpenDialog,
        options,
      );
      return unwrap(response, (value) => fileDialogResultSchema.parse(value));
    },
    async showSaveDialog(options: SaveDialogOptions) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesShowSaveDialog,
        options,
      );
      return unwrap(response, (value) => fileDialogResultSchema.parse(value));
    },
    async read(handle: FileHandle): Promise<ArrayBuffer> {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesRead,
        handle,
      );
      return unwrap(response, parseArrayBuffer);
    },
    async writeAtomic(handle: FileHandle, data: ArrayBuffer): Promise<void> {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesWriteAtomic,
        { handle, data },
      );
      unwrap(response, parseVoid);
    },
    async showExportDirectory() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesShowExportDirectory,
      );
      return unwrap(response, (value) => {
        if (typeof value !== "object" || value === null || !("canceled" in value))
          throw new Error("Invalid desktop response.");
        if (value.canceled === true) return { canceled: true as const };
        if (!("handle" in value)) throw new Error("Invalid desktop response.");
        return {
          canceled: false as const,
          handle: directoryHandleSchema.parse(value.handle),
        };
      });
    },
    async writeExportBatch(
      handle: DirectoryHandle,
      entries: readonly ExportFileEntry[],
    ): Promise<void> {
      const parsed = exportBatchRequestSchema.parse({ handle, entries });
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.filesWriteExportBatch,
        parsed,
      );
      unwrap(response, parseVoid);
    },
  }),
  clipboard: Object.freeze({
    async writePng(
      input: Readonly<{ width: number; height: number; png: ArrayBuffer }>,
    ) {
      const parsed = clipboardPngRequestSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.clipboardWritePng,
        parsed,
      );
      unwrap(response, parseVoid);
    },
    async readPng() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.clipboardReadPng,
      );
      return unwrap(response, (value) =>
        value === null ? null : parseArrayBuffer(value),
      );
    },
  }),
  plugins: Object.freeze({
    async selectPackage() {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginSelectPackage);
      return unwrap(response, (value) => value === null ? null : pluginPackageHandleSchema.parse(value));
    },
    async inspectPackage(handle: PluginPackageHandle) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.pluginInspectPackage,
        pluginPackageHandleSchema.parse(handle),
      );
      return unwrap(response, (value) => pluginInspectionSchema.parse(value));
    },
    async install(handle: PluginPackageHandle, grants: readonly PluginPermission[]) {
      const request = pluginInstallRequestSchema.parse({ handle, grants });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginInstall, request);
      unwrap(response, parseVoid);
    },
    async list() {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginList);
      return unwrap(response, (value) => installedPluginInfoSchema.array().parse(value));
    },
    async setEnabled(pluginId: string, enabled: boolean) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginSetEnabled, { pluginId, enabled });
      unwrap(response, parseVoid);
    },
    async setGrants(pluginId: string, grants: readonly PluginPermission[]) {
      const request = pluginSetGrantsRequestSchema.parse({ pluginId, grants });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginSetGrants, request);
      unwrap(response, parseVoid);
    },
    async remove(pluginId: string, deleteData: boolean) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginRemove, { pluginId, deleteData });
      unwrap(response, parseVoid);
    },
    async clearStorage(pluginId: string) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginClearStorage, { pluginId });
      unwrap(response, parseVoid);
    },
    async readLogs(pluginId: string) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginReadLogs, { pluginId });
      return unwrap(response, (value) => {
        if (!Array.isArray(value) || value.some((line) => typeof line !== "string"))
          throw new Error("Invalid desktop response.");
        return value as readonly string[];
      });
    },
    async startRuntime(pluginId: string) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginStartRuntime, { pluginId });
      return unwrap(response, (value) => pluginRuntimeDescriptorSchema.parse(value));
    },
    async stopRuntime(runtimeId: string) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginStopRuntime, { runtimeId });
      unwrap(response, parseVoid);
    },
    async storageGet(pluginId: string, key: string) {
      const request = pluginStorageGetRequestSchema.parse({ pluginId, key });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginStorageGet, request);
      return unwrap(response, (value) => value);
    },
    async storageSet(pluginId: string, key: string, value: unknown) {
      const request = pluginStorageSetRequestSchema.parse({ pluginId, key, value });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginStorageSet, request);
      unwrap(response, parseVoid);
    },
    async storageDelete(pluginId: string, key: string) {
      const request = pluginStorageGetRequestSchema.parse({ pluginId, key });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginStorageDelete, request);
      unwrap(response, parseVoid);
    },
    async networkRequest(pluginId: string, request: PluginNetworkRequest) {
      const parsed = pluginNetworkRequestSchema.parse({ pluginId, request });
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginNetworkRequest, parsed);
      return unwrap(response, (value) => pluginNetworkResponseSchema.parse(value));
    },
    async getSafeMode() {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginGetSafeMode);
      return unwrap(response, (value) => {
        if (typeof value !== "object" || value === null || !("active" in value) || !("commandLine" in value) || typeof value.active !== "boolean" || typeof value.commandLine !== "boolean")
          throw new Error("Invalid desktop response.");
        return { active: value.active, commandLine: value.commandLine };
      });
    },
    async setSafeMode(enabled: boolean) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginSetSafeMode, enabled);
      unwrap(response, parseVoid);
    },
    async showFolder(pluginId: string) {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginShowFolder, { pluginId });
      unwrap(response, parseVoid);
    },
    async updateMenuCommands(commands: readonly PluginMenuCommand[]) {
      const parsed = pluginMenuCommandSchema.array().max(200).parse(commands);
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.pluginSetMenuCommands, parsed);
      unwrap(response, parseVoid);
    },
    onCommandInvoke(listener: (commandId: string) => void) {
      const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
        if (typeof input === "string" && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(input)) listener(input);
      };
      ipcRenderer.on(IPC_CHANNELS.pluginCommandInvoke, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginCommandInvoke, handler);
    },
  }),
  recovery: Object.freeze({
    async write(input: RecoveryWriteInput) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryWrite,
        input,
      );
      unwrap(response, parseVoid);
    },
    async list() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryList,
      );
      return unwrap(response, (value) =>
        recoverySnapshotInfoSchema.array().parse(value),
      );
    },
    async read(documentId: string) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryRead,
        { documentId },
      );
      return unwrap(response, parseArrayBuffer);
    },
    async delete(documentId: string) {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryDelete,
        { documentId },
      );
      unwrap(response, parseVoid);
    },
    async deleteAll() {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryDeleteAll,
      );
      unwrap(response, parseVoid);
    },
  }),
  ...(__SUWOL_E2E__
    ? {
        test: Object.freeze({
          async configureDialog(
            input: Readonly<{
              operation: "open" | "save-suwolpixel" | "save-png" | "export-directory";
              fileName: string;
              data?: ArrayBuffer;
            }>,
          ) {
            const response: unknown = await ipcRenderer.invoke(
              IPC_CHANNELS.testConfigureDialog,
              input,
            );
            unwrap(response, parseVoid);
          },
          async readArtifact(fileName: string) {
            const response: unknown = await ipcRenderer.invoke(
              IPC_CHANNELS.testReadArtifact,
              fileName,
            );
            return unwrap(response, (value) =>
              value === null ? null : parseArrayBuffer(value),
            );
          },
          async configurePluginPackage(fileName: string, data: ArrayBuffer) {
            const input = testPluginPackageRequestSchema.parse({ fileName, data });
            const response: unknown = await ipcRenderer.invoke(
              IPC_CHANNELS.testConfigurePluginPackage,
              input,
            );
            unwrap(response, parseVoid);
          },
        }),
      }
    : {}),
});

contextBridge.exposeInMainWorld("suwolDesktop", api);
