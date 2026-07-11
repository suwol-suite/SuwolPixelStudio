import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";
import {
  PLUGIN_API_VERSION,
  PLUGIN_LIMITS,
  pluginManifestSchema,
  satisfiesVersion,
  type PluginManifest,
} from "@suwol/plugin-api";
import { PluginError } from "./errors";

export interface ValidatedPluginPackage {
  readonly manifest: PluginManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly totalExpandedBytes: number;
}

interface ZipEntryInfo {
  readonly name: string;
  readonly compressedSize: number;
  readonly expandedSize: number;
  readonly externalAttributes: number;
}

export function validatePackagePath(name: string): void {
  if (
    name.length < 1 ||
    name.length > 512 ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").includes("..")
  )
    throw new PluginError("PACKAGE_UNSAFE_PATH", "Plugin archive contains an unsafe path.");
  const root = name.split("/")[0];
  if (
    root !== "manifest.json" &&
    root !== "dist" &&
    root !== "icons" &&
    root !== "README.md" &&
    root !== "LICENSE"
  )
    throw new PluginError("PACKAGE_UNSAFE_PATH", "Plugin archive contains an unsupported path.");
}

export function validatePluginArchive(
  archive: Uint8Array,
  displayName: string,
  appVersion = "0.5.0",
): ValidatedPluginPackage {
  if (!displayName.toLocaleLowerCase("en-US").endsWith(".suwolplugin"))
    throw new PluginError("PACKAGE_CORRUPT", "Plugin package extension is invalid.");
  if (
    archive.byteLength < 22 ||
    archive[0] !== 0x50 ||
    archive[1] !== 0x4b ||
    archive[2] !== 0x03 ||
    archive[3] !== 0x04
  )
    throw new PluginError("PACKAGE_CORRUPT", "Plugin package is not a ZIP archive.");

  const entries = inspectZip(archive);
  if (entries.length > PLUGIN_LIMITS.archiveFiles)
    throw new PluginError("PACKAGE_LIMIT_EXCEEDED", "Plugin package has too many files.");
  let totalExpandedBytes = 0;
  for (const entry of entries) {
    validatePackagePath(entry.name);
    if (((entry.externalAttributes >>> 16) & 0xf000) === 0xa000)
      throw new PluginError("PACKAGE_UNSAFE_PATH", "Plugin package symlinks are not allowed.");
    if (entry.expandedSize > PLUGIN_LIMITS.singleFileBytes)
      throw new PluginError("PACKAGE_LIMIT_EXCEEDED", "A plugin file exceeds the size limit.");
    totalExpandedBytes += entry.expandedSize;
    if (totalExpandedBytes > PLUGIN_LIMITS.expandedBytes)
      throw new PluginError("PACKAGE_LIMIT_EXCEEDED", "Plugin package expands beyond the size limit.");
    if (
      entry.expandedSize > 1024 * 1024 &&
      entry.compressedSize > 0 &&
      entry.expandedSize / entry.compressedSize > PLUGIN_LIMITS.compressionRatio
    )
      throw new PluginError("PACKAGE_LIMIT_EXCEEDED", "Plugin compression ratio is unsafe.");
  }

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(archive, {
      filter: (file: UnzipFileInfo) => {
        validatePackagePath(file.name);
        return !file.name.endsWith("/");
      },
    });
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError("PACKAGE_CORRUPT", "Plugin package cannot be extracted.");
  }
  const manifestBytes = unpacked["manifest.json"];
  if (manifestBytes === undefined)
    throw new PluginError("MANIFEST_INVALID", "Plugin manifest is missing.");
  let input: unknown;
  try {
    input = JSON.parse(strFromU8(manifestBytes)) as unknown;
  } catch {
    throw new PluginError("MANIFEST_INVALID", "Plugin manifest JSON is malformed.");
  }
  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success)
    throw new PluginError("MANIFEST_INVALID", "Plugin manifest failed validation.");
  const manifest = parsed.data;
  if (!satisfiesVersion(PLUGIN_API_VERSION, manifest.apiVersion))
    throw new PluginError("INCOMPATIBLE_API", "Plugin API version is not supported.");
  if (!satisfiesVersion(appVersion, manifest.engines.suwolPixelStudio))
    throw new PluginError("INCOMPATIBLE_APP", "Plugin requires a different app version.");
  validateRuntimeEntry(manifest.entry, unpacked);
  for (const panel of manifest.contributes?.panels ?? []) {
    validateRuntimeEntry(panel.entry, unpacked);
    if (!panel.entry.toLocaleLowerCase("en-US").endsWith(".html"))
      throw new PluginError("MANIFEST_INVALID", "Panel entry must be HTML.");
    validatePanelHtml(unpacked[panel.entry]);
  }
  return {
    manifest,
    files: new Map(
      Object.entries(unpacked).map(([name, bytes]) => [name, bytes.slice()]),
    ),
    totalExpandedBytes,
  };
}

function validateRuntimeEntry(
  entry: string,
  files: Readonly<Record<string, Uint8Array>>,
): void {
  validatePackagePath(entry);
  if (!entry.startsWith("dist/") || files[entry] === undefined)
    throw new PluginError("MANIFEST_INVALID", "Plugin entry does not exist in dist.");
}

function validatePanelHtml(bytes: Uint8Array | undefined): void {
  if (bytes === undefined)
    throw new PluginError("MANIFEST_INVALID", "Panel entry is missing.");
  const html = strFromU8(bytes);
  if (/<script(?:\s|>)(?![^>]*\bsrc=)/i.test(html) || /\beval\s*\(/i.test(html))
    throw new PluginError("MANIFEST_INVALID", "Inline panel scripts and eval are not allowed.");
}

function inspectZip(data: Uint8Array): readonly ZipEntryInfo[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (
    let offset = data.byteLength - 22;
    offset >= Math.max(0, data.byteLength - 65_557);
    offset -= 1
  )
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (eocd < 0)
    throw new PluginError("PACKAGE_CORRUPT", "Plugin ZIP end record is missing.");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntryInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > data.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new PluginError("PACKAGE_CORRUPT", "Plugin ZIP directory is malformed.");
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > data.byteLength)
      throw new PluginError("PACKAGE_CORRUPT", "Plugin ZIP name is malformed.");
    const name = new TextDecoder().decode(data.subarray(nameStart, nameEnd));
    entries.push({ name, compressedSize, expandedSize, externalAttributes });
    offset = nameEnd + extraLength + commentLength;
  }
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length)
    throw new PluginError("PACKAGE_CORRUPT", "Plugin ZIP contains duplicate entries.");
  return entries;
}
