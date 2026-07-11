import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

function findExecutable(directory: string): string | null {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findExecutable(target);
      if (nested !== null) return nested;
    } else if (entry.name === "SuwolPixelStudio.exe") return target;
  }
  return null;
}
const executable = process.argv[2] ?? findExecutable(path.resolve("out"));
if (executable === null || !existsSync(executable)) throw new Error("Packaged Windows executable was not found.");
const source = Data.IconFile.from(readFileSync("apps/desktop/assets/icon.ico")),
  binary = NtExecutable.from(readFileSync(executable)), resources = NtExecutableResource.from(binary),
  groups = Resource.IconGroupEntry.fromEntries(resources.entries), group = groups[0];
if (groups.length !== 1 || group === undefined)
  throw new Error("Packaged Windows executable has an unexpected icon group count.");
const embedded = group.getIconItemsFromEntries(resources.entries),
  hash = (value: ArrayBuffer): string => createHash("sha256").update(new Uint8Array(value)).digest("hex"),
  sourceHashes = source.icons.map(({ data }) => hash(data.isRaw() ? data.bin : data.generate())),
  embeddedHashes = embedded.map((item) => hash(item.isRaw() ? item.bin : item.generate()));
if (sourceHashes.join("\n") !== embeddedHashes.join("\n"))
  throw new Error("Packaged Windows executable still has a default or mismatched icon.");
console.log(`validated ${embedded.length} embedded Windows icon sizes in ${executable}`);
