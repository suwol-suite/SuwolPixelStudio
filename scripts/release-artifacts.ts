import { chmod, copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(target)));
    else output.push(target);
  }
  return output;
}
function platformName(): "win" | "mac" | "linux" {
  const requested = process.argv.find((value) => value.startsWith("--platform="))?.slice(11);
  if (requested === "win" || requested === "mac" || requested === "linux") return requested;
  return process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
}
const manifest = JSON.parse(await readFile("package.json", "utf8")) as Readonly<{ version: string }>;
const archArg = process.argv.find((value) => value.startsWith("--arch="))?.slice(7),
  arch = archArg ?? process.arch,
  platform = platformName(),
  platformDirectory = platform === "win" ? "win32" : platform === "mac" ? "darwin" : "linux",
  sourceFiles = (await files(path.resolve("out", "make"))).filter(
    (file) =>
      (file.includes(`${path.sep}${platformDirectory}${path.sep}`) && file.endsWith(".zip")) ||
      (platform === "mac" && file.endsWith(".dmg")) ||
      (platform === "linux" && file.endsWith(".AppImage")),
  ),
  target = path.resolve("artifacts", "release");
if (sourceFiles.length === 0) throw new Error("No Forge release artifacts were found.");
if (platform === "linux" && process.platform === "linux" && !sourceFiles.some((file) => file.endsWith(".AppImage")))
  throw new Error("The required Linux AppImage was not generated.");
await mkdir(target, { recursive: true });
const copied: string[] = [];
for (const source of sourceFiles.sort()) {
  const extension = path.extname(source),
    name = `SuwolPixelStudio-${manifest.version}-${platform}-${arch}${extension}`,
    destination = path.join(target, name);
  await copyFile(source, destination);
  if (extension === ".AppImage") await chmod(destination, 0o755);
  copied.push(destination);
}
console.log(copied.map((file) => path.relative(process.cwd(), file)).join("\n"));
