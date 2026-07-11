import { net, protocol, session, type BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PLUGIN_PANEL_CSP,
  PLUGIN_RUNTIME_FRAME_CSP,
  PLUGIN_WORKER_CSP,
} from "@suwol/plugin-host";

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "worker-src 'self' suwol-plugin:",
  "frame-src suwol-plugin:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' suwol-plugin:",
  "frame-src suwol-plugin:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function configureSessionSecurity(isPackaged: boolean): void {
  const currentSession = session.defaultSession;
  currentSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  currentSession.setPermissionCheckHandler(() => false);
  currentSession.webRequest.onHeadersReceived((details, callback) => {
    let csp = isPackaged ? PRODUCTION_CSP : DEVELOPMENT_CSP;
    if (details.url.startsWith("suwol-plugin://")) {
      try {
        const pathname = new URL(details.url).pathname;
        csp = pathname === "/__runtime.html"
          ? PLUGIN_RUNTIME_FRAME_CSP
          : pathname.endsWith(".html")
            ? PLUGIN_PANEL_CSP
            : PLUGIN_WORKER_CSP;
      } catch {
        csp = PLUGIN_WORKER_CSP;
      }
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

export function secureWindowNavigation(
  window: BrowserWindow,
  allowedOrigin: string,
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin === allowedOrigin) return;
    } catch {
      // Invalid targets are denied below.
    }
    event.preventDefault();
  });
}

export function registerRendererProtocol(rendererRoot: string): void {
  protocol.handle("suwol-pixel", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app")
        return new Response("Not found", { status: 404 });

      const decodedPath = decodeURIComponent(url.pathname);
      if (decodedPath.includes("\\") || decodedPath.includes("\0")) {
        return new Response("Not found", { status: 404 });
      }
      const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
      if (relativePath.split("/").includes(".."))
        return new Response("Not found", { status: 404 });

      const resolvedRoot = path.resolve(rendererRoot);
      const candidate = path.resolve(resolvedRoot, relativePath);
      const relativeCandidate = path.relative(resolvedRoot, candidate);
      if (
        relativeCandidate.startsWith("..") ||
        path.isAbsolute(relativeCandidate)
      ) {
        return new Response("Not found", { status: 404 });
      }
      return await net.fetch(pathToFileURL(candidate).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
