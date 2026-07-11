import { promises as fs } from "node:fs";
import path from "node:path";
import { recoverySnapshotInfoSchema, type RecoverySnapshotInfo, type RecoveryWriteInput } from "@suwol/shared";
import { atomicWrite } from "./atomic-file";

type RecoveryWritePart = "snapshot" | "metadata" | "thumbnail";
export interface RecoveryStoreHooks {
  readonly beforeWrite?: (part: RecoveryWritePart, documentId: string) => void | Promise<void>;
}

const encoder = new TextEncoder();
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export class RecoveryStore {
  constructor(
    readonly directory: string,
    readonly maxBytes: number,
    readonly hooks: RecoveryStoreHooks = {},
  ) {}

  async write(input: RecoveryWriteInput): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const snapshot = this.#versioned(input.documentId, input.revision, "suwolpixel"),
      thumbnail = this.#versioned(input.documentId, input.revision, "thumbnail.png"),
      metadata = path.join(this.directory, `${input.documentId}.json`);
    await this.hooks.beforeWrite?.("snapshot", input.documentId);
    await atomicWrite(snapshot, new Uint8Array(input.data));
    let hasThumbnail = false;
    if (input.thumbnail !== undefined) {
      try {
        await this.hooks.beforeWrite?.("thumbnail", input.documentId);
        await atomicWrite(thumbnail, new Uint8Array(input.thumbnail));
        hasThumbnail = true;
      } catch {
        await fs.rm(thumbnail, { force: true }).catch(() => undefined);
      }
    }
    const info: RecoverySnapshotInfo = {
      documentId: input.documentId,
      displayName: input.displayName,
      originalHandleId: input.originalHandleId,
      originalDisplayName: input.originalDisplayName,
      revision: input.revision,
      timestamp: input.timestamp,
      lastSavedTimestamp: input.lastSavedTimestamp,
      width: input.width,
      height: input.height,
      corrupt: false,
      thumbnail: null,
    };
    await this.hooks.beforeWrite?.("metadata", input.documentId);
    await atomicWrite(metadata, encoder.encode(JSON.stringify(info)));
    await this.#removeDocumentFiles(input.documentId, new Set([
      path.basename(metadata),
      path.basename(snapshot),
      ...(hasThumbnail ? [path.basename(thumbnail)] : []),
    ]));
  }

  async list(): Promise<readonly RecoverySnapshotInfo[]> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]), results: RecoverySnapshotInfo[] = [];
    for (const name of names.filter((value) => value.endsWith(".json")).sort().slice(0, 256)) {
      const documentId = name.slice(0, -5);
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(documentId)) continue;
      try {
        const parsed = recoverySnapshotInfoSchema.parse(JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")) as unknown),
          snapshot = await this.#snapshotPath(parsed.documentId, parsed.revision), stat = await fs.stat(snapshot);
        if (!stat.isFile() || stat.size <= 0 || stat.size > this.maxBytes) throw new Error("invalid snapshot");
        const thumbnail = await this.#thumbnailPath(parsed.documentId, parsed.revision)
          .then((file) => fs.readFile(file)).then(toArrayBuffer).catch(() => null);
        results.push({ ...parsed, corrupt: false, thumbnail });
      } catch {
        results.push({
          documentId,
          displayName: "Corrupt recovery",
          originalHandleId: null,
          originalDisplayName: null,
          revision: 0,
          timestamp: Date.now(),
          lastSavedTimestamp: null,
          width: 1,
          height: 1,
          corrupt: true,
          thumbnail: null,
        });
      }
    }
    return results;
  }

  async read(documentId: string): Promise<ArrayBuffer> {
    const metadata = recoverySnapshotInfoSchema.parse(
        JSON.parse(await fs.readFile(path.join(this.directory, `${documentId}.json`), "utf8")) as unknown,
      ), file = await this.#snapshotPath(documentId, metadata.revision), info = await fs.stat(file);
    if (!info.isFile() || info.size <= 0 || info.size > this.maxBytes) throw new Error("Recovery snapshot is invalid.");
    return toArrayBuffer(await fs.readFile(file));
  }

  async delete(documentId: string): Promise<void> {
    await this.#removeDocumentFiles(documentId, new Set());
  }

  async deleteAll(): Promise<void> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]);
    await Promise.all(names.filter((name) =>
      /^[a-zA-Z0-9-]{1,100}(?:\.json|\.suwolpixel|\.thumbnail\.png|\.r\d+\.(?:suwolpixel|thumbnail\.png))$/.test(name),
    ).map((name) => fs.rm(path.join(this.directory, name), { force: true })));
  }

  #versioned(documentId: string, revision: number, extension: string): string {
    return path.join(this.directory, `${documentId}.r${revision}.${extension}`);
  }

  async #snapshotPath(documentId: string, revision: number): Promise<string> {
    const versioned = this.#versioned(documentId, revision, "suwolpixel");
    return (await fs.stat(versioned).then(() => true).catch(() => false))
      ? versioned
      : path.join(this.directory, `${documentId}.suwolpixel`);
  }

  async #thumbnailPath(documentId: string, revision: number): Promise<string> {
    const versioned = this.#versioned(documentId, revision, "thumbnail.png");
    return (await fs.stat(versioned).then(() => true).catch(() => false))
      ? versioned
      : path.join(this.directory, `${documentId}.thumbnail.png`);
  }

  async #removeDocumentFiles(documentId: string, keep: ReadonlySet<string>): Promise<void> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]), prefix = `${documentId}.`;
    await Promise.all(names.filter((name) => name.startsWith(prefix) && !keep.has(name) && (
      name === `${documentId}.json` || name === `${documentId}.suwolpixel` || name === `${documentId}.thumbnail.png` ||
      /^r\d+\.(?:suwolpixel|thumbnail\.png)$/.test(name.slice(prefix.length))
    )).map((name) => fs.rm(path.join(this.directory, name), { force: true })));
  }
}
