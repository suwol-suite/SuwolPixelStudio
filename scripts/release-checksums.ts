import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateReleaseAssets, verifyReleaseChecksums, writeReleaseChecksums, type ReleaseScope } from "./release-contract";

const manifest = JSON.parse(await readFile("package.json", "utf8")) as Readonly<{ version: string }>,
  directory = path.resolve(process.argv.find((value) => value.startsWith("--dir="))?.slice(6) ?? "artifacts/release"),
  scope = (process.argv.find((value) => value.startsWith("--scope="))?.slice(8) ?? "all") as ReleaseScope,
  verify = process.argv.includes("--verify");
await validateReleaseAssets(directory, manifest.version, scope);
if (verify) await verifyReleaseChecksums(directory, manifest.version, scope);
else await writeReleaseChecksums(directory, manifest.version, scope);
console.log(`${verify ? "verified" : "generated"} checksums for ${scope} release assets`);
