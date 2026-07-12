import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell } from "electron";
import { promises as fs } from "node:fs";
import {
  IPC_CHANNELS,
  appDiagnosticsSchema,
  clipboardPngRequestSchema,
  commandStateSchema,
  parseExternalHttpsUrl,
  platformSchema,
  pluginIdRequestSchema,
  pluginInstallRequestSchema,
  pluginNetworkRequestSchema,
  pluginPackageHandleSchema,
  pluginRemoveRequestSchema,
  pluginRuntimeRequestSchema,
  pluginSetEnabledRequestSchema,
  pluginSetGrantsRequestSchema,
  pluginStorageGetRequestSchema,
  pluginStorageSetRequestSchema,
  pluginMenuCommandSchema,
  testPluginPackageRequestSchema,
  type IpcResult,
  type AppDiagnostics,
  type Logger,
  type SupportedPlatform,
} from "@suwol/shared";
import { PluginError } from "@suwol/plugin-host";
import type { PluginDesktopService } from "./plugins";
import { installApplicationMenu } from "./menu";

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function internalError<T>(logger: Logger, operation: string): IpcResult<T> {
  logger.error(`IPC operation failed: ${operation}`);
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "The desktop service could not complete the request.",
    },
  };
}

function pluginFailure<T>(logger: Logger, operation: string, error: unknown): IpcResult<T> {
  if (error instanceof PluginError)
    return { ok: false, error: { code: "NOT_ALLOWED", message: error.message } };
  return internalError<T>(logger, operation);
}

export function registerIpcHandlers(
  logger: Logger,
  plugins: PluginDesktopService,
): void {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => success(app.getVersion()));

  ipcMain.handle(IPC_CHANNELS.appGetPlatform, () => {
    const platform = platformSchema.safeParse(process.platform);
    return platform.success
      ? success<SupportedPlatform>(platform.data)
      : internalError<SupportedPlatform>(logger, "app.getPlatform");
  });

  function diagnostics(): AppDiagnostics {
    return appDiagnosticsSchema.parse({
      productName: "Suwol Pixel Studio",
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      fileFormatVersion: 4,
      pluginApiVersion: "1.1.0",
      license: "Apache-2.0",
      repository: "https://github.com/suwol-suite/SuwolPixelStudio",
    });
  }
  ipcMain.handle(IPC_CHANNELS.appGetDiagnostics, () => {
    try {
      return success(diagnostics());
    } catch {
      return internalError<AppDiagnostics>(logger, "app.getDiagnostics");
    }
  });
  ipcMain.handle(IPC_CHANNELS.appOpenLogsFolder, async () => {
    try {
      const logs = app.getPath("logs");
      await fs.mkdir(logs, { recursive: true });
      const result = await shell.openPath(logs);
      return result === ""
        ? success(null)
        : internalError<null>(logger, "app.openLogsFolder");
    } catch {
      return internalError<null>(logger, "app.openLogsFolder");
    }
  });
  ipcMain.handle(IPC_CHANNELS.appCopyDiagnostics, () => {
    try {
      const info = diagnostics();
      clipboard.writeText(
        [
          `${info.productName} ${info.version}`,
          `Electron ${info.electron} / Chromium ${info.chromium} / Node ${info.node}`,
          `${info.platform} ${info.architecture}`,
          `File format v${info.fileFormatVersion} / Plugin API ${info.pluginApiVersion}`,
          `License ${info.license}`,
        ].join("\n"),
      );
      return success(null);
    } catch {
      return internalError<null>(logger, "app.copyDiagnostics");
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.shellOpenExternal,
    async (_event, input: unknown) => {
      const url = parseExternalHttpsUrl(input);
      if (url === null) {
        return {
          ok: false,
          error: {
            code: "NOT_ALLOWED",
            message: "Only credential-free HTTPS URLs can be opened.",
          },
        } satisfies IpcResult<null>;
      }
      try {
        await shell.openExternal(url.toString());
        return success(null);
      } catch {
        return internalError<null>(logger, "shell.openExternal");
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.clipboardWritePng, (_event, input: unknown) => {
    const parsed = clipboardPngRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.png.byteLength > 64 * 1024 * 1024)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Pixel clipboard image is invalid.",
        },
      } satisfies IpcResult<null>;
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(parsed.data.png));
      const size = image.getSize();
      if (
        image.isEmpty() ||
        size.width !== parsed.data.width ||
        size.height !== parsed.data.height
      )
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "Pixel clipboard image dimensions are invalid.",
          },
        } satisfies IpcResult<null>;
      clipboard.writeImage(image);
      return success(null);
    } catch {
      return internalError<null>(logger, "clipboard.writePng");
    }
  });
  ipcMain.handle(IPC_CHANNELS.clipboardReadPng, () => {
    try {
      const image = clipboard.readImage();
      if (image.isEmpty()) return success<ArrayBuffer | null>(null);
      const bytes = image.toPNG();
      if (bytes.byteLength > 64 * 1024 * 1024)
        return success<ArrayBuffer | null>(null);
      return success<ArrayBuffer | null>(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      );
    } catch {
      return internalError<ArrayBuffer | null>(logger, "clipboard.readPng");
    }
  });
  ipcMain.handle(IPC_CHANNELS.commandSetState, (_event, input: unknown) => {
    const parsed = commandStateSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: { code: "INVALID_INPUT", message: "Command state is invalid." },
      } satisfies IpcResult<null>;
    const menu = Menu.getApplicationMenu();
    for (const [id, state] of Object.entries(parsed.data)) {
      const item = menu?.getMenuItemById(id);
      if (item !== undefined && item !== null) {
        item.enabled = typeof state === "boolean" ? state : state.enabled;
        if (typeof state !== "boolean" && state.checked !== undefined) item.checked = state.checked;
      }
    }
    return success(null);
  });

  ipcMain.handle(IPC_CHANNELS.pluginSelectPackage, async () => {
    try { return success(await plugins.selectPackage()); }
    catch (error) { return pluginFailure(logger, "plugin.selectPackage", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginInspectPackage, async (_event, input: unknown) => {
    const parsed = pluginPackageHandleSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin package handle is invalid.");
    try { return success(await plugins.inspectPackage(parsed.data)); }
    catch (error) { return pluginFailure(logger, "plugin.inspectPackage", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginInstall, async (_event, input: unknown) => {
    const parsed = pluginInstallRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin install request is invalid.");
    try { await plugins.install(parsed.data.handle, parsed.data.grants); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.install", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginList, () => success(plugins.list()));
  ipcMain.handle(IPC_CHANNELS.pluginSetEnabled, async (_event, input: unknown) => {
    const parsed = pluginSetEnabledRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin state request is invalid.");
    try { await plugins.setEnabled(parsed.data.pluginId, parsed.data.enabled); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.setEnabled", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginSetGrants, async (_event, input: unknown) => {
    const parsed = pluginSetGrantsRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin permission request is invalid.");
    try { await plugins.setGrants(parsed.data.pluginId, parsed.data.grants); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.setGrants", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginRemove, async (_event, input: unknown) => {
    const parsed = pluginRemoveRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin removal request is invalid.");
    try { await plugins.remove(parsed.data.pluginId, parsed.data.deleteData); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.remove", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginClearStorage, async (_event, input: unknown) => {
    const parsed = pluginIdRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin id is invalid.");
    try { await plugins.clearStorage(parsed.data.pluginId); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.clearStorage", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginReadLogs, async (_event, input: unknown) => {
    const parsed = pluginIdRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin id is invalid.");
    try { return success(await plugins.readLogs(parsed.data.pluginId)); }
    catch (error) { return pluginFailure(logger, "plugin.readLogs", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginStartRuntime, (_event, input: unknown) => {
    const parsed = pluginIdRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin id is invalid.");
    try { return success(plugins.startRuntime(parsed.data.pluginId)); }
    catch (error) { return pluginFailure(logger, "plugin.startRuntime", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginStopRuntime, (_event, input: unknown) => {
    const parsed = pluginRuntimeRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin runtime id is invalid.");
    plugins.stopRuntime(parsed.data.runtimeId);
    return success(null);
  });
  ipcMain.handle(IPC_CHANNELS.pluginStorageGet, async (_event, input: unknown) => {
    const parsed = pluginStorageGetRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin storage request is invalid.");
    try { return success(await plugins.storageGet(parsed.data.pluginId, parsed.data.key)); }
    catch (error) { return pluginFailure(logger, "plugin.storageGet", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginStorageSet, async (_event, input: unknown) => {
    const parsed = pluginStorageSetRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin storage request is invalid.");
    try { await plugins.storageSet(parsed.data.pluginId, parsed.data.key, parsed.data.value); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.storageSet", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginStorageDelete, async (_event, input: unknown) => {
    const parsed = pluginStorageGetRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin storage request is invalid.");
    try { await plugins.storageDelete(parsed.data.pluginId, parsed.data.key); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.storageDelete", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginNetworkRequest, async (_event, input: unknown) => {
    const parsed = pluginNetworkRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin network request is invalid.");
    try { return success(await plugins.networkRequest(parsed.data.pluginId, parsed.data.request)); }
    catch (error) { return pluginFailure(logger, "plugin.networkRequest", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginGetSafeMode, () => success(plugins.getSafeMode()));
  ipcMain.handle(IPC_CHANNELS.pluginSetSafeMode, async (_event, input: unknown) => {
    if (typeof input !== "boolean") return invalidInput("Safe Mode request is invalid.");
    try { await plugins.setSafeMode(input); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.setSafeMode", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginShowFolder, (_event, input: unknown) => {
    const parsed = pluginIdRequestSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Plugin id is invalid.");
    try { plugins.showFolder(parsed.data.pluginId); return success(null); }
    catch (error) { return pluginFailure(logger, "plugin.showFolder", error); }
  });
  ipcMain.handle(IPC_CHANNELS.pluginSetMenuCommands, (event, input: unknown) => {
    const parsed = pluginMenuCommandSchema.array().max(200).safeParse(input);
    if (!parsed.success) return invalidInput("Plugin menu contributions are invalid.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return internalError<null>(logger, "plugin.setMenuCommands");
    installApplicationMenu(window, app.getLocale(), parsed.data);
    return success(null);
  });
  if (__SUWOL_E2E__)
    ipcMain.handle(IPC_CHANNELS.testConfigurePluginPackage, async (_event, input: unknown) => {
      const parsed = testPluginPackageRequestSchema.safeParse(input);
      if (!parsed.success) return invalidInput("Plugin test fixture is invalid.");
      try { await plugins.configureE2ePackage(parsed.data.fileName, parsed.data.data); return success(null); }
      catch (error) { return pluginFailure(logger, "test.configurePluginPackage", error); }
    });
}

function invalidInput(message: string): IpcResult<never> {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}
