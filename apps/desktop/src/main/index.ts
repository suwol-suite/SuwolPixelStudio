import { app, BrowserWindow, protocol } from "electron";
import path from "node:path";
import { createLogger } from "@suwol/shared";
import { registerIpcHandlers } from "./ipc";
import { SecureFileService } from "./files";
import { installApplicationMenu } from "./menu";
import { PluginDesktopService } from "./plugins";
import {
  configureSessionSecurity,
  registerRendererProtocol,
  secureWindowNavigation,
} from "./security";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "suwol-pixel",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: "suwol-plugin",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const logger = createLogger("main", !app.isPackaged);
let fileService: SecureFileService | null = null;
let pluginService: PluginDesktopService | null = null;

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "preload.js");
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 560,
    show: false,
    backgroundColor: "#17191d",
    title: "Suwol Pixel Studio",
    ...(process.platform !== "darwin"
      ? {
          icon: app.isPackaged
            ? path.join(process.resourcesPath, process.platform === "win32" ? "icon.ico" : "studio.suwol.pixel.png")
            : path.join(
                app.getAppPath(),
                process.platform === "win32" ? "apps/desktop/assets/icon.ico" : "apps/desktop/assets/linux/studio.suwol.pixel.png",
              ),
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  const developmentUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
  let targetUrl = app.isPackaged
    ? "suwol-pixel://app/index.html"
    : developmentUrl;
  if (__SUWOL_E2E__ && process.argv.includes("--force-canvas2d"))
    targetUrl += "?renderer=canvas2d";
  secureWindowNavigation(window, new URL(targetUrl).origin);
  window.webContents.on("did-fail-load", (_event, errorCode) => {
    logger.error(`Renderer load failed with code ${errorCode}.`);
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(targetUrl);
  installApplicationMenu(window, app.getLocale());
  return window;
}

app
  .whenReady()
  .then(async () => {
    logger.info("Application starting.");
    configureSessionSecurity(app.isPackaged);
    fileService = new SecureFileService(logger, __SUWOL_E2E__);
    fileService.registerHandlers();
    pluginService = new PluginDesktopService(
      logger,
      process.argv.includes("--disable-plugins"),
      __SUWOL_E2E__,
    );
    await pluginService.initialize();
    pluginService.registerProtocol();
    registerIpcHandlers(logger, pluginService);
    if (app.isPackaged) {
      registerRendererProtocol(
        path.join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME),
      );
    }
    try {
      await createMainWindow();
    } catch {
      logger.error("Main window creation failed.");
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  })
  .catch(() => logger.error("Application initialization failed."));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  fileService?.clearHandles();
  pluginService?.clearHandles();
});
