import { readFile } from "node:fs/promises";
import { validateReleaseTag } from "./release-contract";

const manifest = JSON.parse(await readFile("package.json", "utf8")) as Readonly<{ version: string }>,
  tag = process.argv.find((value) => value.startsWith("--tag="))?.slice(6);
if (tag === undefined || tag.length === 0) throw new Error("A release tag is required through --tag=v<version>.");
validateReleaseTag(tag, manifest.version);
console.log(`release tag ${tag} matches package version ${manifest.version}`);
