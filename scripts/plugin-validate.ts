import { samplePluginNames, validatePluginSources } from "./plugin-tools";

for (const name of samplePluginNames) {
  await validatePluginSources(name);
  console.log(`validated ${name}`);
}
