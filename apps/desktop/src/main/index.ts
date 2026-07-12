import { app, BrowserWindow, protocol } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createLogger, type Logger } from "@suwol/shared";
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

function createMainLogger(): Logger {
  const consoleLogger = createLogger("main", !app.isPackaged);
  let logFile: string | null = null;
  try {
    app.setAppLogsPath();
    const directory = app.getPath("logs");
    mkdirSync(directory, { recursive: true });
    logFile = path.join(directory, "suwol-pixel-studio.log");
  } catch {
    consoleLogger.error("Application log file initialization failed.");
  }
  const write = (level: "INFO" | "WARN" | "ERROR", message: string): void => {
    if (logFile !== null)
      try {
        appendFileSync(logFile, `${new Date().toISOString()} ${level} ${message}\n`, {
          encoding: "utf8",
        });
      } catch {
        logFile = null;
        consoleLogger.error("Application log file write failed.");
      }
  };
  return Object.freeze({
    info(message: string) {
      consoleLogger.info(message);
      write("INFO", message);
    },
    warn(message: string) {
      consoleLogger.warn(message);
      write("WARN", message);
    },
    error(message: string) {
      consoleLogger.error(message);
      write("ERROR", message);
    },
  });
}

const logger = createMainLogger();
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
  if (__SUWOL_E2E__) {
    const parameters = new URLSearchParams();
    if (process.argv.includes("--force-canvas2d"))
      parameters.set("renderer", "canvas2d");
    if (process.argv.includes("--force-renderer-failure"))
      parameters.set("fatal", "1");
    const query = parameters.toString();
    if (query !== "") targetUrl += `?${query}`;
  }
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
