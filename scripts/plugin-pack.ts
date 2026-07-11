import { promises as fs } from "node:fs";
import path from "node:path";
import { buildPluginPackage, samplePluginNames, validatePluginSources } from "./plugin-tools";

const outputRoot = path.resolve("artifacts", "plugins");
await fs.mkdir(outputRoot, { recursive: true });
for (const name of samplePluginNames) {
  await validatePluginSources(name);
  const archive = await buildPluginPackage(name);
  const output = path.join(outputRoot, `${name}.suwolplugin`);
  await fs.writeFile(output, archive);
  console.log(`${output} (${archive.byteLength} bytes)`);
}
