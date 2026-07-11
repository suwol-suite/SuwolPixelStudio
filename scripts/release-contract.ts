import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReleaseScope = "win" | "linux" | "mac" | "core" | "all";

const VERSION_PATTERN = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const VERSION = new RegExp(`^${VERSION_PATTERN}$`);
const DISTRIBUTION_NAME = new RegExp(
  `^SuwolPixelStudio-(${VERSION_PATTERN})-(win-x64\\.zip|linux-x64\\.(?:zip|AppImage)|mac-arm64\\.(?:dmg|zip))$`,
);

export function isPrereleaseVersion(version: string): boolean {
  if (!VERSION.test(version)) throw new Error(`Invalid release version: ${version}.`);
  return version.includes("-");
}

export function expectedReleaseAssets(version: string, scope: ReleaseScope): string[] {
  const byPlatform = {
    win: [`SuwolPixelStudio-${version}-win-x64.zip`],
    linux: [
      `SuwolPixelStudio-${version}-linux-x64.AppImage`,
      `SuwolPixelStudio-${version}-linux-x64.zip`,
    ],
    mac: [
      `SuwolPixelStudio-${version}-mac-arm64.dmg`,
      `SuwolPixelStudio-${version}-mac-arm64.zip`,
    ],
  } as const;
  if (scope === "core") return [...byPlatform.win, ...byPlatform.linux].sort();
  if (scope === "all") return [...byPlatform.win, ...byPlatform.linux, ...byPlatform.mac].sort();
  return [...byPlatform[scope]].sort();
}

export function validateReleaseTag(tag: string, version: string): void {
  isPrereleaseVersion(version);
  if (tag !== `v${version}`)
    throw new Error(`Release tag ${tag} does not match package version ${version}.`);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

export async function writeReleaseChecksums(directory: string, version: string, scope: ReleaseScope): Promise<string> {
  const names = expectedReleaseAssets(version, scope), lines: string[] = [];
  for (const name of names) lines.push(`${await sha256(path.join(directory, name))}  ${name}`);
  const output = `${lines.join("\n")}\n`, target = path.join(directory, "checksums.txt");
  await writeFile(target, output);
  return target;
}

export async function verifyReleaseChecksums(directory: string, version: string, scope: ReleaseScope): Promise<void> {
  const expectedNames = expectedReleaseAssets(version, scope),
    text = await readFile(path.join(directory, "checksums.txt"), "utf8"),
    lines = text.trimEnd().split("\n");
  if (lines.length !== expectedNames.length) throw new Error("Checksum entry count is invalid.");
  const parsed = lines.map((line) => {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/.exec(line);
    if (match === null) throw new Error(`Invalid checksum line: ${line}`);
    const hash = match[1], name = match[2];
    if (hash === undefined || name === undefined) throw new Error(`Invalid checksum line: ${line}`);
    return { hash, name };
  });
  if (parsed.map(({ name }) => name).join("\n") !== expectedNames.join("\n"))
    throw new Error("Checksum entries are not the expected deterministic asset set.");
  for (const entry of parsed)
    if (await sha256(path.join(directory, entry.name)) !== entry.hash)
      throw new Error(`Checksum verification failed for ${entry.name}.`);
}

interface ZipEntry { readonly name: string; readonly mode: number; }

async function zipEntries(file: string): Promise<readonly ZipEntry[]> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat(), tailLength = Math.min(info.size, 65_557), tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.length, info.size - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1)
      if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    if (eocd < 0) throw new Error(`ZIP end record is missing: ${path.basename(file)}`);
    const count = tail.readUInt16LE(eocd + 10), centralSize = tail.readUInt32LE(eocd + 12),
      centralOffset = tail.readUInt32LE(eocd + 16), central = Buffer.alloc(centralSize);
    await handle.read(central, 0, central.length, centralOffset);
    const entries: ZipEntry[] = [];
    let offset = 0;
    while (offset < central.length) {
      if (central.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP central directory is malformed.");
      const nameLength = central.readUInt16LE(offset + 28), extraLength = central.readUInt16LE(offset + 30),
        commentLength = central.readUInt16LE(offset + 32), external = central.readUInt32LE(offset + 38),
        name = central.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      entries.push({ name, mode: external >>> 16 });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (entries.length !== count) throw new Error("ZIP entry count does not match its end record.");
    return entries;
  } finally { await handle.close(); }
}

function hasSuffix(entries: readonly ZipEntry[], suffix: string): boolean {
  return entries.some(({ name }) => name.endsWith(suffix));
}

export function normalizeZipEntryName(name: string): string {
  const normalized = name.replaceAll("\\", "/"), segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0") ||
    segments.includes("..")
  )
    throw new Error("ZIP contains an unsafe path.");
  return normalized;
}

async function validateZip(file: string, platform: "win" | "linux" | "mac"): Promise<void> {
  const entries = (await zipEntries(file)).map((entry) => ({ ...entry, name: normalizeZipEntryName(entry.name) }));
  if (entries.length === 0) throw new Error(`ZIP is empty: ${path.basename(file)}`);
  if (platform === "win") {
    const executable = entries.find(({ name }) => name.endsWith("/SuwolPixelStudio.exe"));
    if (executable === undefined || !hasSuffix(entries, "/resources/app.asar"))
      throw new Error("Windows ZIP is missing its executable or ASAR.");
    const roots = new Set(entries.map(({ name }) => name.split("/")[0]).filter(Boolean));
    if (roots.size !== 1) throw new Error("Windows ZIP has an unexpected nested root structure.");
  } else if (platform === "linux") {
    const executable = entries.find(({ name }) => name.endsWith("/SuwolPixelStudio"));
    if (executable === undefined || (executable.mode & 0o111) === 0)
      throw new Error("Linux ZIP executable is missing or not executable.");
    for (const suffix of [
      "/resources/app.asar",
      "/resources/studio.suwol.pixel.png",
      "/resources/application-x-suwol-pixel-studio.png",
      "/resources/suwol-pixel-studio.desktop",
      "/resources/studio.suwol.pixel.xml",
    ]) if (!hasSuffix(entries, suffix)) throw new Error(`Linux ZIP is missing ${suffix}.`);
  } else {
    for (const suffix of [
      ".app/Contents/MacOS/SuwolPixelStudio",
      ".app/Contents/Resources/app.asar",
      ".app/Contents/Resources/electron.icns",
    ]) if (!hasSuffix(entries, suffix)) throw new Error(`macOS ZIP is missing ${suffix}.`);
  }
}

export async function validateReleaseAssets(directory: string, version: string, scope: ReleaseScope): Promise<void> {
  const expected = expectedReleaseAssets(version, scope), names = await readdir(directory),
    distribution = names.filter((name) => DISTRIBUTION_NAME.test(name)).sort();
  if ((scope === "core" || scope === "all") && distribution.join("\n") !== expected.join("\n"))
    throw new Error("Release directory contains an unexpected distribution asset set.");
  for (const name of expected) {
    const match = DISTRIBUTION_NAME.exec(name);
    if (match?.[1] !== version) throw new Error(`Artifact version is invalid: ${name}`);
    const file = path.join(directory, name), info = await stat(file);
    if (!info.isFile() || info.size <= 0) throw new Error(`Artifact is empty: ${name}`);
    if (name.endsWith(".zip"))
      await validateZip(file, name.includes("-win-") ? "win" : name.includes("-linux-") ? "linux" : "mac");
    if (name.endsWith(".AppImage")) {
      await access(file, 1);
      const handle = await open(file, "r"), magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error("AppImage is not an ELF executable.");
    }
  }
  if (names.some((name) => /(?:Setup\.exe|\.nupkg|\.msi)$/i.test(name)))
    throw new Error("Forbidden Windows installer artifact was generated.");
}
