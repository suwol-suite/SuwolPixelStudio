import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateReleaseAssets, type ReleaseScope } from "./release-contract";

const manifest = JSON.parse(await readFile("package.json", "utf8")) as Readonly<{ version: string }>,
  directory = path.resolve(process.argv.find((value) => value.startsWith("--dir="))?.slice(6) ?? "artifacts/release"),
  scope = (process.argv.find((value) => value.startsWith("--scope="))?.slice(8) ?? "all") as ReleaseScope;
await validateReleaseAssets(directory, manifest.version, scope);
console.log(`validated ${scope} release assets`);
