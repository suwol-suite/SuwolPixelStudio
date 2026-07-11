import { readFile, readdir } from "node:fs/promises";

const core = await readFile(".github/workflows/release-core.yml", "utf8"),
  mac = await readFile(".github/workflows/release-macos.yml", "utf8"),
  ci = await readFile(".github/workflows/ci.yml", "utf8");
const workflowNames = await readdir(".github/workflows");
if (workflowNames.includes("release.yml") || workflowNames.includes("build.yml"))
  throw new Error("Legacy build/release workflows must be removed.");

function requireText(source: string, values: readonly string[], label: string): void {
  for (const value of values) if (!source.includes(value)) throw new Error(`${label} is missing required contract text: ${value}`);
}
requireText(core, [
  "release-core-",
  "GPG_PRIVATE_KEY_B64",
  "GPG_PASSPHRASE",
  "SuwolPixelStudio-${{ steps.version.outputs.version }}-linux-x64.AppImage",
  "gh release create",
  "--prerelease --latest=false",
  "--prerelease=false",
  "Known limitations:",
  "bash scripts/sign-checksums.sh",
  "--clobber",
], "release-core.yml");
requireText(mac, [
  "release-macos-",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "MAC_KEYCHAIN_PASSWORD",
  "gh release view",
  "gh release upload",
  "--clobber",
  "checksums.txt.asc",
  "bash scripts/sign-checksums.sh",
], "release-macos.yml");
requireText(ci, ["pnpm install --frozen-lockfile", "pnpm workflow:check", "pnpm package:smoke"], "ci.yml");
if (core.includes("CSC_LINK") || core.includes("APPLE_ID")) throw new Error("Windows/Linux core release must not require macOS secrets.");
if (mac.includes("gh release create")) throw new Error("macOS workflow must not create a Release.");
console.log("workflow release contracts are consistent");
