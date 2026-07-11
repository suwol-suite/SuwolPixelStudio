import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RecoveryWriteInput } from "@suwol/shared";
import { RecoveryStore, type RecoveryStoreHooks } from "./recovery-store";

const directories: string[] = [], encoder = new TextEncoder();
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));
async function store(hooks: RecoveryStoreHooks = {}): Promise<RecoveryStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "suwol-recovery-store-"));
  directories.push(directory);
  return new RecoveryStore(directory, 1_024 * 1_024, hooks);
}
function input(documentId: string, revision: number, label = "RGBA", existing = false): RecoveryWriteInput {
  const data = encoder.encode(`${label}:${revision}`), thumbnail = encoder.encode(`thumb:${label}`);
  return {
    documentId,
    displayName: `${label}.suwolpixel`,
    originalHandleId: existing ? "7aa1597f-19ea-4680-aaf2-33d2f2611fd6" : null,
    originalDisplayName: existing ? `${label}.suwolpixel` : null,
    revision,
    timestamp: 1_700_000_000_000 + revision,
    lastSavedTimestamp: existing ? 1_699_999_999_000 : null,
    width: 64,
    height: 64,
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    thumbnail: thumbnail.buffer.slice(thumbnail.byteOffset, thumbnail.byteOffset + thumbnail.byteLength),
  };
}

describe("recovery filesystem failure matrix", () => {
  it("keeps unsaved, existing, RGBA, Indexed, Animation, Tilemap and plugin-data documents independent", async () => {
    const recovery = await store(), labels = ["RGBA", "Indexed", "Animation", "Tilemap", "Plugin Data"];
    for (const [index, label] of labels.entries()) await recovery.write(input(`document-${index}`, index + 1, label, index > 0));
    const listed = await recovery.list();
    expect(listed.map(({ displayName }) => displayName)).toEqual(labels.map((label) => `${label}.suwolpixel`));
    expect(listed[0]?.originalHandleId).toBeNull();
    expect(new TextDecoder().decode(await recovery.read("document-3"))).toBe("Tilemap:4");
  });

  it("leaves the previous revision readable when autosave stops before metadata replacement", async () => {
    const initial = await store();
    await initial.write(input("document", 1));
    const interrupted = new RecoveryStore(initial.directory, initial.maxBytes, {
      beforeWrite: (part) => { if (part === "metadata") throw new Error("simulated termination"); },
    });
    await expect(interrupted.write(input("document", 2))).rejects.toThrow("termination");
    expect((await initial.list())[0]?.revision).toBe(1);
    expect(new TextDecoder().decode(await initial.read("document"))).toBe("RGBA:1");
  });

  it("keeps a valid recovery when thumbnail storage fails", async () => {
    const recovery = await store({ beforeWrite: (part) => { if (part === "thumbnail") throw new Error("thumbnail failed"); } });
    await recovery.write(input("document", 3));
    expect(await recovery.list()).toMatchObject([{ revision: 3, corrupt: false, thumbnail: null }]);
    expect(new TextDecoder().decode(await recovery.read("document"))).toBe("RGBA:3");
  });

  it("isolates one corrupt item and does not consult a moved original file", async () => {
    const recovery = await store();
    await recovery.write(input("valid", 4, "Indexed", true));
    await fs.writeFile(path.join(recovery.directory, "broken.json"), "{");
    const listed = await recovery.list();
    expect(listed).toHaveLength(2);
    expect(listed.find(({ documentId }) => documentId === "valid")).toMatchObject({ corrupt: false, revision: 4 });
    expect(listed.find(({ documentId }) => documentId === "broken")).toMatchObject({ corrupt: true });
    expect(new TextDecoder().decode(await recovery.read("valid"))).toBe("Indexed:4");
  });

  it("replaces revisions deterministically and cleans saved or clean-exit recovery", async () => {
    const recovery = await store();
    await recovery.write(input("first", 1));
    await recovery.write(input("first", 9));
    expect((await recovery.list())[0]?.revision).toBe(9);
    expect((await fs.readdir(recovery.directory)).sort()).toEqual(["first.json", "first.r9.suwolpixel", "first.r9.thumbnail.png"]);
    await recovery.delete("first");
    expect(await recovery.list()).toEqual([]);
    await recovery.write(input("one", 1));
    await recovery.write(input("two", 2));
    await recovery.deleteAll();
    expect(await fs.readdir(recovery.directory)).toEqual([]);
  });

  it("reads legacy fixed-name recovery snapshots", async () => {
    const recovery = await store(), legacy = input("legacy", 2);
    const metadata = {
      documentId: legacy.documentId,
      displayName: legacy.displayName,
      originalHandleId: legacy.originalHandleId,
      originalDisplayName: legacy.originalDisplayName,
      revision: legacy.revision,
      timestamp: legacy.timestamp,
      lastSavedTimestamp: legacy.lastSavedTimestamp,
      width: legacy.width,
      height: legacy.height,
      thumbnail: null,
      corrupt: false,
    };
    await fs.writeFile(path.join(recovery.directory, "legacy.json"), JSON.stringify(metadata));
    await fs.writeFile(path.join(recovery.directory, "legacy.suwolpixel"), new Uint8Array(legacy.data));
    expect((await recovery.list())[0]).toMatchObject({ documentId: "legacy", corrupt: false, revision: 2 });
    expect(new TextDecoder().decode(await recovery.read("legacy"))).toBe("RGBA:2");
  });
});
