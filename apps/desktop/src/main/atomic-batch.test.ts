import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicBatchWrite } from "./atomic-batch";

const created: string[] = [];
async function directory(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "suwol-atomic-test-"));
  created.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(
    created.splice(0).map((value) =>
      fs.rm(value, { recursive: true, force: true }),
    ),
  );
});

describe("atomic export batch", () => {
  it("replaces all files and removes temporary and backup entries", async () => {
    const target = await directory();
    await fs.writeFile(path.join(target, "walk.json"), "old");
    await atomicBatchWrite(target, [
      { name: "walk.json", bytes: new TextEncoder().encode("new") },
      { name: "walk.png", bytes: Uint8Array.from([1, 2, 3]) },
    ]);
    expect(await fs.readFile(path.join(target, "walk.json"), "utf8")).toBe("new");
    expect(await fs.readFile(path.join(target, "walk.png"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect((await fs.readdir(target)).sort()).toEqual(["walk.json", "walk.png"]);
  });

  it("cleans its temporary directory when staging fails", async () => {
    const target = await directory();
    await expect(
      atomicBatchWrite(target, [
        { name: "same.png", bytes: Uint8Array.from([1]) },
        { name: "same.png", bytes: Uint8Array.from([2]) },
      ]),
    ).rejects.toThrow();
    expect(await fs.readdir(target)).toEqual([]);
  });
});
