import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { validatePluginArchive } from "@suwol/plugin-host";

export const samplePluginNames = ["example-command", "example-panel-network", "example-professional"] as const;

export async function buildPluginPackage(name: (typeof samplePluginNames)[number]): Promise<Uint8Array> {
  const root = path.resolve("plugins", name);
  const manifestPath = path.join(root, "manifest.json");
  const manifestBytes = new Uint8Array(await fs.readFile(manifestPath));
  const files: Zippable = {
    "manifest.json": manifestBytes,
    "dist/main.js": new Uint8Array(await fs.readFile(path.join(root, "src", "main.js"))),
  };
  for (const file of ["README.md", "LICENSE"]) {
    const candidate = path.join(root, file);
    try { files[file] = new Uint8Array(await fs.readFile(candidate)); }
    catch { /* Optional package documentation. */ }
  }
  const panelRoot = path.join(root, "src", "panel");
  try {
    for (const entry of await fs.readdir(panelRoot, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error("Sample panel source must be a flat file set.");
      files[`dist/panel/${entry.name}`] = new Uint8Array(await fs.readFile(path.join(panelRoot, entry.name)));
    }
  } catch (error) {
    if (name === "example-panel-network") throw error;
  }
  const archive = zipSync(files, { level: 6 });
  validatePluginArchive(archive, `${name}.suwolplugin`, "0.5.0");
  return archive;
}

export async function validatePluginSources(name: (typeof samplePluginNames)[number]): Promise<void> {
  const main = await fs.readFile(path.resolve("plugins", name, "src", "main.js"), "utf8");
  const forbidden = [
    /\bprocess\b/,
    /\brequire\s*\(/,
    /\bipcRenderer\b/,
    /\bchild_process\b/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /(?:from|import)\s*\(?\s*["'](?:node:|electron)/,
  ];
  if (forbidden.some((pattern) => pattern.test(main)))
    throw new Error(`${name} main entry contains a forbidden direct capability.`);
  await buildPluginPackage(name);
}
