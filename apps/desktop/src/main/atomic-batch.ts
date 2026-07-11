import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function atomicBatchWrite(
  directory: string,
  entries: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  options: Readonly<{ beforeReplace?: (index: number) => Promise<void> | void }> = {},
): Promise<void> {
  const transactionId = randomUUID(),
    temporaryDirectory = path.join(
      directory,
      `.suwol-export-${transactionId}.tmp`,
    ),
    moved: { target: string; backup: string | null }[] = [];
  await fs.mkdir(temporaryDirectory, { recursive: false });
  try {
    for (const entry of entries) {
      const target = path.join(temporaryDirectory, entry.name),
        file = await fs.open(target, "wx");
      try {
        await file.writeFile(entry.bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    for (const [index, entry] of entries.entries()) {
      const source = path.join(temporaryDirectory, entry.name),
        target = path.join(directory, entry.name),
        backup = path.join(directory, `.${entry.name}.${transactionId}.bak`);
      let backupPath: string | null = null;
      try {
        await fs.rename(target, backup);
        backupPath = backup;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      moved.push({ target, backup: backupPath });
      await options.beforeReplace?.(index);
      await fs.rename(source, target);
    }
    await Promise.all(
      moved.map(({ backup }) =>
        backup === null ? Promise.resolve() : fs.rm(backup, { force: true }),
      ),
    );
  } catch (error) {
    for (const item of moved.reverse()) {
      await fs.rm(item.target, { force: true }).catch(() => undefined);
      if (item.backup !== null)
        await fs.rename(item.backup, item.target).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs
      .rm(temporaryDirectory, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
