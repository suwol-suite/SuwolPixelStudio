import { access, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(target)));
    else output.push(target);
  }
  return output;
}

const root = path.resolve("out"), all = await files(root).catch(() => []);
const executable = all.find((file) =>
  process.platform === "win32"
    ? file.endsWith("SuwolPixelStudio.exe")
    : process.platform === "darwin"
      ? file.endsWith("Suwol Pixel Studio.app/Contents/MacOS/SuwolPixelStudio")
      : file.endsWith("/SuwolPixelStudio"),
);
if (executable === undefined) throw new Error("Packaged executable was not found.");
const resources =
  process.platform === "darwin"
    ? path.join(executable, "..", "..", "Resources")
    : path.join(path.dirname(executable), "resources");
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "app.asar"])
  await access(path.join(resources, name));
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
if (process.platform === "darwin") {
  const expected = await readFile("apps/desktop/assets/icon.icns"), packaged = await readFile(path.join(resources, "icon.icns"));
  if (digest(expected) !== digest(packaged)) throw new Error("Packaged macOS icon does not match icon.icns.");
  const legacyPackagerIcon = path.join(resources, "electron.icns");
  try {
    const legacy = await readFile(legacyPackagerIcon);
    if (digest(expected) !== digest(legacy)) throw new Error("A user-visible Electron default icon remains in the macOS bundle.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const appBundle = path.resolve(executable, "..", "..", ".."),
    plist = path.join(appBundle, "Contents", "Info.plist"),
    reference = execFileSync("plutil", ["-extract", "CFBundleIconFile", "raw", plist], { encoding: "utf8" }).trim();
  if (reference !== "icon.icns") throw new Error(`macOS Info.plist references an unexpected icon: ${reference}`);
}
if (process.platform === "linux") {
  const expected = await readFile("apps/desktop/assets/linux/studio.suwol.pixel.png"),
    packaged = await readFile(path.join(resources, "studio.suwol.pixel.png"));
  if (digest(expected) !== digest(packaged)) throw new Error("Packaged Linux icon does not match its source PNG.");
  await access(path.join(resources, "application-x-suwol-pixel-studio.png"));
}
const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
  version?: string;
};
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(packageJson.version ?? ""))
  throw new Error("Package version is not a supported release version.");
console.log(`package smoke passed: ${executable}`);
