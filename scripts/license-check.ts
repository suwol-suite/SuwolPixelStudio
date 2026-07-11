import { readFile } from "node:fs/promises";
import path from "node:path";

const expected = Object.freeze({
  "fast-png": ["8.0.0", "MIT"],
  fflate: ["0.8.3", "MIT"],
  iobuffer: ["6.0.1", "MIT"],
  react: ["19.2.7", "MIT"],
  "react-dom": ["19.2.7", "MIT"],
  scheduler: ["0.27.0", "MIT"],
  zod: ["4.4.3", "MIT"],
} as const);

for (const [name, [version, license]] of Object.entries(expected)) {
  const manifest = JSON.parse(
    await readFile(path.join("node_modules", name, "package.json"), "utf8"),
  ) as Readonly<{ version?: string; license?: string }>;
  if (manifest.version !== version || manifest.license !== license)
    throw new Error(
      `${name} license metadata changed: expected ${version} ${license}.`,
    );
}
const root = JSON.parse(await readFile("package.json", "utf8")) as Readonly<{
  license?: string;
}>;
if (root.license !== "Apache-2.0")
  throw new Error("Root SPDX license must be Apache-2.0.");
const appImageMaker = JSON.parse(
  await readFile(path.join("node_modules", "@reforged", "maker-appimage", "package.json"), "utf8"),
) as Readonly<{ version?: string; license?: string }>;
if (appImageMaker.version !== "5.2.0" || appImageMaker.license !== "ISC")
  throw new Error("AppImage maker license metadata changed.");
const license = await readFile("LICENSE", "utf8"),
  notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
if (!license.includes("Apache License") || !license.includes("Version 2.0"))
  throw new Error("Root LICENSE is not Apache License 2.0.");
for (const name of Object.keys(expected))
  if (!notices.includes(`\`${name}\``))
    throw new Error(`THIRD_PARTY_NOTICES.md is missing ${name}.`);
if (!notices.includes("@reforged/maker-appimage") || !notices.includes("AppImage type-2 runtime"))
  throw new Error("THIRD_PARTY_NOTICES.md is missing AppImage packaging attribution.");
console.log(`validated ${Object.keys(expected).length} production dependency licenses and AppImage tooling`);
