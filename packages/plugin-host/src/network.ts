import {
  PLUGIN_LIMITS,
  type PluginNetworkRequest,
  type PluginPermission,
} from "@suwol/plugin-api";
import { PluginError } from "./errors";

const allowedRequestHeaders = new Set([
  "accept",
  "accept-language",
  "content-type",
  "authorization",
  "x-api-key",
  "x-requested-with",
]);
const hiddenResponseHeaders = new Set(["set-cookie", "set-cookie2", "proxy-authenticate"]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "").toLocaleLowerCase("en-US");
  if (normalized === "::1") return true;
  if (normalized.includes(":"))
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized === "::";
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function validateNetworkTarget(
  input: string,
  grants: readonly PluginPermission[],
  resolvedAddresses: readonly string[] = [],
): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PluginError("NETWORK_BLOCKED", "Network URL is invalid.");
  }
  if (url.username !== "" || url.password !== "")
    throw new PluginError("NETWORK_BLOCKED", "Credential-bearing URLs are blocked.");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new PluginError("NETWORK_BLOCKED", "Network scheme is blocked.");
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  if (isLoopbackHostname(hostname)) {
    if (!grants.includes("network:localhost"))
      throw new PluginError("PERMISSION_DENIED", "Localhost network permission was not granted.");
    return url;
  }
  if (url.protocol !== "https:")
    throw new PluginError("NETWORK_BLOCKED", "External network requests require HTTPS.");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":"))
    throw new PluginError("NETWORK_BLOCKED", "External IP literals are blocked.");
  if (!grants.includes(`network:${hostname}`))
    throw new PluginError("PERMISSION_DENIED", "Network hostname was not granted.", { hostname });
  if (resolvedAddresses.some(isPrivateIpAddress))
    throw new PluginError("NETWORK_BLOCKED", "External hostname resolved to a private address.");
  return url;
}

export function validateNetworkRequest(
  request: PluginNetworkRequest,
  grants: readonly PluginPermission[],
  resolvedAddresses: readonly string[] = [],
): Readonly<{
  url: URL;
  method: PluginNetworkRequest["method"];
  headers: Readonly<Record<string, string>>;
  body: ArrayBuffer | undefined;
  timeoutMs: number;
}> {
  if (!["GET", "POST", "PUT", "DELETE"].includes(request.method))
    throw new PluginError("NETWORK_BLOCKED", "Network method is blocked.");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const normalized = name.toLocaleLowerCase("en-US");
    if (!allowedRequestHeaders.has(normalized) || /[\r\n]/.test(value))
      throw new PluginError("NETWORK_BLOCKED", "Network header is blocked.", { header: normalized });
    if (value.length > 8_192)
      throw new PluginError("NETWORK_BLOCKED", "Network header is too large.");
    headers[normalized] = value;
  }
  if ((request.body?.byteLength ?? 0) > PLUGIN_LIMITS.networkResponseBytes)
    throw new PluginError("NETWORK_BLOCKED", "Network request body is too large.");
  const timeoutMs = Math.min(PLUGIN_LIMITS.requestTimeoutMs, Math.max(100, request.timeoutMs ?? PLUGIN_LIMITS.requestTimeoutMs));
  return {
    url: validateNetworkTarget(request.url, grants, resolvedAddresses),
    method: request.method,
    headers,
    body: request.body,
    timeoutMs,
  };
}

export function sanitizeResponseHeaders(headers: Iterable<readonly [string, string]>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers) {
    const normalized = name.toLocaleLowerCase("en-US");
    if (!hiddenResponseHeaders.has(normalized) && value.length <= 8_192) result[normalized] = value;
  }
  return result;
}
