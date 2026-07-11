import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWrite } from "./atomic-file";

const directories: string[] = [];
async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "suwol-file-"));
  directories.push(directory);
  return path.join(directory, "document.suwolpixel");
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("atomic document write", () => {
  it("replaces an existing file and removes temporary state", async () => {
    const target = await fixture();
    await fs.writeFile(target, "old");
    await atomicWrite(target, new TextEncoder().encode("new"));
    expect(await fs.readFile(target, "utf8")).toBe("new");
    expect(await fs.readdir(path.dirname(target))).toEqual(["document.suwolpixel"]);
  });
  it("restores the original when replacement fails after backup", async () => {
    const target = await fixture();
    await fs.writeFile(target, "original");
    await expect(atomicWrite(target, new TextEncoder().encode("replacement"), {
      beforeReplace: () => {
        throw new Error("injected replacement failure");
      },
    })).rejects.toThrow("injected");
    expect(await fs.readFile(target, "utf8")).toBe("original");
    expect((await fs.readdir(path.dirname(target))).sort()).toEqual(["document.suwolpixel"]);
  });
});
