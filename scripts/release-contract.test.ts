import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectedReleaseAssets,
  isPrereleaseVersion,
  validateReleaseTag,
  verifyReleaseChecksums,
  writeReleaseChecksums,
} from "./release-contract";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe("release contract", () => {
  it("requires exact package version tags", () => {
    expect(() => validateReleaseTag("v0.6.0", "0.6.0")).not.toThrow();
    expect(() => validateReleaseTag("v0.6.0-rc.1", "0.6.0-rc.1")).not.toThrow();
    expect(() => validateReleaseTag("main", "0.6.0")).toThrow(/does not match/);
    expect(() => validateReleaseTag("v0.6.1", "0.6.0")).toThrow(/does not match/);
    expect(() => validateReleaseTag("v0.6.0", "not-semver")).toThrow(/Invalid release version/);
    expect(isPrereleaseVersion("0.6.0")).toBe(false);
    expect(isPrereleaseVersion("0.6.0-rc.1")).toBe(true);
    expect(isPrereleaseVersion("0.6.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("0.6.0-alpha.1")).toBe(true);
  });
  it("keeps core and final asset names deterministic", () => {
    expect(expectedReleaseAssets("0.6.0", "core")).toEqual([
      "SuwolPixelStudio-0.6.0-linux-x64.AppImage",
      "SuwolPixelStudio-0.6.0-linux-x64.zip",
      "SuwolPixelStudio-0.6.0-win-x64.zip",
    ]);
    expect(expectedReleaseAssets("0.6.0", "all")).toHaveLength(5);
    expect(expectedReleaseAssets("0.6.0-rc.1", "core")).toContain(
      "SuwolPixelStudio-0.6.0-rc.1-linux-x64.AppImage",
    );
  });
  it("generates sorted checksums and detects a changed asset", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "suwol-release-"));
    temporary.push(directory);
    for (const name of expectedReleaseAssets("0.6.0", "core")) await fs.writeFile(path.join(directory, name), name);
    await writeReleaseChecksums(directory, "0.6.0", "core");
    const text = await fs.readFile(path.join(directory, "checksums.txt"), "utf8");
    expect(text.trimEnd().split("\n").map((line) => line.slice(66))).toEqual(expectedReleaseAssets("0.6.0", "core"));
    await verifyReleaseChecksums(directory, "0.6.0", "core");
    const first = expectedReleaseAssets("0.6.0", "core")[0];
    if (first === undefined) throw new Error("Core release fixture is empty.");
    await fs.appendFile(path.join(directory, first), "changed");
    await expect(verifyReleaseChecksums(directory, "0.6.0", "core")).rejects.toThrow(/failed/);
  });
});
