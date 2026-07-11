import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface AtomicWriteOptions {
  readonly beforeReplace?: () => Promise<void> | void;
}

/** Writes, flushes, replaces, and restores the previous target on failure. */
export async function atomicWrite(
  targetPath: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
      directory,
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
    ),
    backup = `${targetPath}.bak`;
  const file = await fs.open(temporary, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await fs.rm(backup, { force: true });
    try {
      await fs.rename(targetPath, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await options.beforeReplace?.();
    await fs.rename(temporary, targetPath);
    await syncDirectory(directory);
    await fs.rm(backup, { force: true }).catch(() => undefined);
    await syncDirectory(directory);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    try {
      await fs.stat(backup);
      await fs.rm(targetPath, { force: true });
      await fs.rename(backup, targetPath);
      await syncDirectory(directory);
    } catch {
      /* No backup was available to restore. */
    }
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r").catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}
