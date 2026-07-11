import { app, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicBatchWrite } from "./atomic-batch";
import {
  IPC_CHANNELS,
  isSafeExportRelativePath,
  fileHandleSchema,
  exportBatchRequestSchema,
  openDialogOptionsSchema,
  recoveryDeleteRequestSchema,
  recoveryWriteRequestSchema,
  recoverySnapshotInfoSchema,
  saveDialogOptionsSchema,
  testDialogRequestSchema,
  type FileHandle,
  type DirectoryHandle,
  type IpcResult,
  type Logger,
  type OpenDialogResult,
  type RecoverySnapshotInfo,
  type SaveDialogResult,
} from "@suwol/shared";

const MAX_FILE_BYTES = 320 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".suwolpixel", ".png", ".ase", ".aseprite", ".gpl", ".pal", ".hex", ".txt", ".json", ".suwollayout", ".suwolkeys"]);
const MAX_EXPORT_BYTES = 512 * 1024 * 1024;

function openFilter(kind: "document" | "aseprite" | "palette" | "tileset" | "layout" | "keybindings") {
  if (kind === "aseprite") return { name: "Aseprite", extensions: ["ase", "aseprite"] };
  if (kind === "palette") return { name: "Palette", extensions: ["gpl", "pal", "hex", "txt", "json"] };
  if (kind === "tileset") return { name: "PNG Tile Set", extensions: ["png"] };
  if (kind === "layout") return { name: "Suwol Layout", extensions: ["suwollayout", "json"] };
  if (kind === "keybindings") return { name: "Suwol Keybindings", extensions: ["suwolkeys", "json"] };
  return { name: "Suwol Pixel Studio", extensions: ["suwolpixel", "png", "ase", "aseprite"] };
}
function saveExtension(kind: "suwolpixel" | "png" | "palette" | "tilemap-json" | "layout" | "keybindings"): string {
  if (kind === "palette") return "json";
  if (kind === "tilemap-json") return "json";
  if (kind === "layout") return "suwollayout";
  if (kind === "keybindings") return "suwolkeys";
  return kind;
}
function saveFilterName(kind: "suwolpixel" | "png" | "palette" | "tilemap-json" | "layout" | "keybindings"): string {
  if (kind === "png") return "PNG Image";
  if (kind === "suwolpixel") return "Suwol Pixel Studio";
  if (kind === "palette") return "Suwol Palette";
  if (kind === "tilemap-json") return "Tilemap JSON";
  if (kind === "layout") return "Suwol Layout";
  return "Suwol Keybindings";
}

interface HandleEntry {
  readonly path: string;
  readonly displayName: string;
}

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}
function failure<T>(
  code: "INVALID_INPUT" | "NOT_ALLOWED" | "INTERNAL_ERROR",
  message: string,
): IpcResult<T> {
  return { ok: false, error: { code, message } };
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export class SecureFileService {
  readonly #handles = new Map<string, HandleEntry>();
  readonly #directories = new Map<string, HandleEntry>();
  readonly #e2eRoot = path.join(app.getPath("temp"), "suwol-pixel-studio-e2e");
  #nextOpenPath: string | null = null;
  #nextSavePath: string | null = null;
  #nextDirectoryPath: string | null = null;
  constructor(
    readonly logger: Logger,
    readonly e2eEnabled: boolean,
  ) {}

  registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.filesShowOpenDialog,
      async (_event, input: unknown) => {
        const parsedOptions = openDialogOptionsSchema.safeParse(input);
        if (!parsedOptions.success)
          return failure<OpenDialogResult>(
            "INVALID_INPUT",
            "Open dialog options are invalid.",
          );
        try {
          const filter = parsedOptions.data.kind === "plugin-import"
            ? { name: parsedOptions.data.title, extensions: parsedOptions.data.extensions.map((extension) => extension.slice(1)) }
            : openFilter(parsedOptions.data.kind),
            allowedExtensions = parsedOptions.data.kind === "plugin-import"
              ? new Set(parsedOptions.data.extensions)
              : ALLOWED_EXTENSIONS;
          const selectedPath =
            this.#nextOpenPath ??
            (
              await dialog.showOpenDialog({
                properties: ["openFile"],
                filters: [filter],
              })
            ).filePaths[0];
          this.#nextOpenPath = null;
          if (selectedPath === undefined)
            return success<OpenDialogResult>({ canceled: true });
          return success<OpenDialogResult>({
            canceled: false,
            handle: this.#approvePath(selectedPath, allowedExtensions),
          });
        } catch {
          this.logger.error("Open file dialog failed.");
          return failure<OpenDialogResult>(
            "INTERNAL_ERROR",
            "The file could not be opened.",
          );
        }
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.filesShowSaveDialog,
      async (_event, input: unknown) => {
        const parsed = saveDialogOptionsSchema.safeParse(input);
        if (!parsed.success)
          return failure<SaveDialogResult>(
            "INVALID_INPUT",
            "Save dialog options are invalid.",
          );
        try {
          const extension = saveExtension(parsed.data.kind);
          let selectedPath = this.#nextSavePath;
          this.#nextSavePath = null;
          if (selectedPath === null) {
            const result = await dialog.showSaveDialog({
              defaultPath: ensureExtension(
                parsed.data.suggestedName,
                extension,
              ),
              filters: [
                {
                  name:
                    saveFilterName(parsed.data.kind),
                  extensions: [extension],
                },
              ],
            });
            if (result.canceled)
              return success<SaveDialogResult>({ canceled: true });
            selectedPath = result.filePath;
          }
          const normalized = ensureExtension(selectedPath, extension);
          return success<SaveDialogResult>({
            canceled: false,
            handle: this.#approvePath(normalized),
          });
        } catch {
          this.logger.error("Save file dialog failed.");
          return failure<SaveDialogResult>(
            "INTERNAL_ERROR",
            "The save destination could not be selected.",
          );
        }
      },
    );

    ipcMain.handle(IPC_CHANNELS.filesRead, async (_event, input: unknown) => {
      const parsed = fileHandleSchema.safeParse(input);
      if (!parsed.success)
        return failure<ArrayBuffer>("INVALID_INPUT", "File handle is invalid.");
      const entry = this.#handles.get(parsed.data.id);
      if (entry?.displayName !== parsed.data.displayName)
        return failure<ArrayBuffer>(
          "NOT_ALLOWED",
          "File handle is unknown or expired.",
        );
      try {
        const stat = await fs.stat(entry.path);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
          return failure<ArrayBuffer>(
            "NOT_ALLOWED",
            "File size exceeds the supported limit.",
          );
        return success(toArrayBuffer(await fs.readFile(entry.path)));
      } catch {
        this.logger.error("Approved file read failed.");
        return failure<ArrayBuffer>(
          "INTERNAL_ERROR",
          "The approved file could not be read.",
        );
      }
    });

    ipcMain.handle(
      IPC_CHANNELS.filesWriteAtomic,
      async (_event, input: unknown) => {
        if (
          typeof input !== "object" ||
          input === null ||
          !("handle" in input) ||
          !("data" in input)
        )
          return failure<null>(
            "INVALID_INPUT",
            "File write request is invalid.",
          );
        const parsedHandle = fileHandleSchema.safeParse(input.handle);
        if (
          !parsedHandle.success ||
          !(input.data instanceof ArrayBuffer) ||
          input.data.byteLength > MAX_FILE_BYTES
        )
          return failure<null>(
            "INVALID_INPUT",
            "File write request is invalid.",
          );
        const entry = this.#handles.get(parsedHandle.data.id);
        if (entry?.displayName !== parsedHandle.data.displayName)
          return failure<null>(
            "NOT_ALLOWED",
            "File handle is unknown or expired.",
          );
        try {
          await atomicWrite(entry.path, new Uint8Array(input.data));
          return success(null);
        } catch {
          this.logger.error("Atomic file write failed.");
          return failure<null>(
            "INTERNAL_ERROR",
            "The file could not be saved safely.",
          );
        }
      },
    );

    ipcMain.handle(IPC_CHANNELS.filesShowExportDirectory, async () => {
      try {
        const selectedPath =
          this.#nextDirectoryPath ??
          (
            await dialog.showOpenDialog({
              properties: ["openDirectory", "createDirectory"],
              title: "Select animation export directory",
            })
          ).filePaths[0];
        this.#nextDirectoryPath = null;
        if (selectedPath === undefined)
          return success<{ canceled: true }>({ canceled: true });
        return success<{ canceled: false; handle: DirectoryHandle }>({
          canceled: false,
          handle: await this.#approveDirectory(selectedPath),
        });
      } catch {
        this.logger.error("Export directory dialog failed.");
        return failure("INTERNAL_ERROR", "The export directory could not be selected.");
      }
    });

    ipcMain.handle(
      IPC_CHANNELS.filesWriteExportBatch,
      async (_event, input: unknown) => {
        const parsed = exportBatchRequestSchema.safeParse(input);
        if (!parsed.success)
          return failure<null>("INVALID_INPUT", "Export batch is invalid.");
        const approved = this.#directories.get(parsed.data.handle.id);
        if (approved?.displayName !== parsed.data.handle.displayName)
          return failure<null>("NOT_ALLOWED", "Directory handle is unknown or expired.");
        let total = 0;
        const names = new Set<string>();
        for (const entry of parsed.data.entries) {
          total += entry.data.byteLength;
          if (
            total > MAX_EXPORT_BYTES ||
            !isSafeExportRelativePath(entry.relativePath) ||
            names.has(entry.relativePath.toLocaleLowerCase("en-US"))
          )
            return failure<null>("NOT_ALLOWED", "Export file set is not allowed.");
          names.add(entry.relativePath.toLocaleLowerCase("en-US"));
        }
        try {
          await atomicBatchWrite(
            approved.path,
            parsed.data.entries.map((entry) => ({
              name: entry.relativePath,
              bytes: new Uint8Array(entry.data),
            })),
          );
          return success(null);
        } catch {
          this.logger.error("Atomic export batch failed.");
          return failure<null>("INTERNAL_ERROR", "Animation export could not be saved safely.");
        }
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.recoveryWrite,
      async (_event, input: unknown) => {
        const parsed = recoveryWriteRequestSchema.safeParse(input);
        if (!parsed.success || parsed.data.data.byteLength > MAX_FILE_BYTES)
          return failure<null>(
            "INVALID_INPUT",
            "Recovery snapshot is invalid.",
          );
        try {
          const directory = path.join(app.getPath("userData"), "recovery");
          await fs.mkdir(directory, { recursive: true });
          const metadata: RecoverySnapshotInfo = {
            documentId: parsed.data.documentId,
            displayName: parsed.data.displayName,
            originalHandleId: parsed.data.originalHandleId,
            originalDisplayName: parsed.data.originalDisplayName,
            revision: parsed.data.revision,
            timestamp: parsed.data.timestamp,
            lastSavedTimestamp: parsed.data.lastSavedTimestamp,
            width: parsed.data.width,
            height: parsed.data.height,
            corrupt: false,
            thumbnail: null,
          };
          await atomicWrite(
            path.join(directory, `${parsed.data.documentId}.suwolpixel`),
            new Uint8Array(parsed.data.data),
          );
          await atomicWrite(
            path.join(directory, `${parsed.data.documentId}.json`),
            new TextEncoder().encode(JSON.stringify(metadata)),
          );
          if (parsed.data.thumbnail !== undefined)
            await atomicWrite(
              path.join(directory, `${parsed.data.documentId}.thumbnail.png`),
              new Uint8Array(parsed.data.thumbnail),
            );
          return success(null);
        } catch {
          this.logger.error("Recovery snapshot write failed.");
          return failure<null>(
            "INTERNAL_ERROR",
            "Recovery snapshot could not be written.",
          );
        }
      },
    );

    ipcMain.handle(IPC_CHANNELS.recoveryList, async () => {
      try {
        const directory = path.join(app.getPath("userData"), "recovery");
        const names = await fs.readdir(directory).catch(() => [] as string[]);
        const results: RecoverySnapshotInfo[] = [];
        for (const name of names
          .filter((value) => value.endsWith(".json"))
          .slice(0, 256)) {
          try {
            const value = JSON.parse(
              await fs.readFile(path.join(directory, name), "utf8"),
            ) as unknown;
            const parsed = recoverySnapshotInfoSchema.safeParse(value);
            if (parsed.success) {
              const thumbnail = await fs
                .readFile(
                  path.join(
                    directory,
                    `${parsed.data.documentId}.thumbnail.png`,
                  ),
                )
                .then(toArrayBuffer)
                .catch(() => null);
              results.push({ ...parsed.data, thumbnail });
            } else throw new Error("invalid");
          } catch {
            const documentId = name.slice(0, -5);
            if (/^[a-zA-Z0-9-]{1,100}$/.test(documentId))
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
        return success<readonly RecoverySnapshotInfo[]>(results);
      } catch {
        return success<readonly RecoverySnapshotInfo[]>([]);
      }
    });

    ipcMain.handle(
      IPC_CHANNELS.recoveryRead,
      async (_event, input: unknown) => {
        const parsed = recoveryDeleteRequestSchema.safeParse(input);
        if (!parsed.success)
          return failure<ArrayBuffer>(
            "INVALID_INPUT",
            "Recovery id is invalid.",
          );
        try {
          const filePath = path.join(
              app.getPath("userData"),
              "recovery",
              `${parsed.data.documentId}.suwolpixel`,
            ),
            stat = await fs.stat(filePath);
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
            return failure<ArrayBuffer>(
              "NOT_ALLOWED",
              "Recovery snapshot is invalid.",
            );
          return success(toArrayBuffer(await fs.readFile(filePath)));
        } catch {
          return failure<ArrayBuffer>(
            "INTERNAL_ERROR",
            "Recovery snapshot could not be read.",
          );
        }
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.recoveryDelete,
      async (_event, input: unknown) => {
        const parsed = recoveryDeleteRequestSchema.safeParse(input);
        if (!parsed.success)
          return failure<null>("INVALID_INPUT", "Recovery id is invalid.");
        const directory = path.join(app.getPath("userData"), "recovery");
        await Promise.all([
          fs.rm(path.join(directory, `${parsed.data.documentId}.suwolpixel`), {
            force: true,
          }),
          fs.rm(path.join(directory, `${parsed.data.documentId}.json`), {
            force: true,
          }),
          fs.rm(
            path.join(directory, `${parsed.data.documentId}.thumbnail.png`),
            { force: true },
          ),
        ]).catch(() => undefined);
        return success(null);
      },
    );

    ipcMain.handle(IPC_CHANNELS.recoveryDeleteAll, async () => {
      const directory = path.join(app.getPath("userData"), "recovery");
      try {
        const names = await fs.readdir(directory).catch(() => [] as string[]);
        await Promise.all(
          names
            .filter((name) =>
              /^[a-zA-Z0-9-]{1,100}\.(?:json|suwolpixel|thumbnail\.png)$/.test(
                name,
              ),
            )
            .map((name) => fs.rm(path.join(directory, name), { force: true })),
        );
        return success(null);
      } catch {
        return failure<null>(
          "INTERNAL_ERROR",
          "Recovery snapshots could not be deleted.",
        );
      }
    });

    if (this.e2eEnabled) this.#registerE2eHandlers();
  }

  clearHandles(): void {
    this.#handles.clear();
    this.#directories.clear();
  }

  #approvePath(filePath: string, allowedExtensions: ReadonlySet<string> = ALLOWED_EXTENSIONS): FileHandle {
    const resolved = path.resolve(filePath);
    const extension = path.extname(resolved).toLocaleLowerCase("en-US");
    if (!allowedExtensions.has(extension))
      throw new Error("File extension is not allowed.");
    const handle = { id: randomUUID(), displayName: path.basename(resolved) };
    this.#handles.set(handle.id, {
      path: resolved,
      displayName: handle.displayName,
    });
    return handle;
  }
  async #approveDirectory(directoryPath: string): Promise<DirectoryHandle> {
    const resolved = await fs.realpath(path.resolve(directoryPath));
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error("Export target is not a directory.");
    const handle = { id: randomUUID(), displayName: path.basename(resolved) };
    this.#directories.set(handle.id, { path: resolved, displayName: handle.displayName });
    return handle;
  }
  #registerE2eHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.testConfigureDialog,
      async (_event, input: unknown) => {
        const parsed = testDialogRequestSchema.safeParse(input);
        if (!parsed.success)
          return failure<null>(
            "INVALID_INPUT",
            "Test fixture request is invalid.",
          );
        await fs.mkdir(this.#e2eRoot, { recursive: true });
        const fixturePath = path.join(this.#e2eRoot, parsed.data.fileName);
        if (parsed.data.operation === "open") {
          if (parsed.data.data !== undefined)
            await atomicWrite(fixturePath, new Uint8Array(parsed.data.data));
          this.#nextOpenPath = fixturePath;
        } else if (parsed.data.operation === "export-directory") {
          this.#nextDirectoryPath = this.#e2eRoot;
        } else {
          await fs.rm(fixturePath, { force: true });
          this.#nextSavePath = fixturePath;
        }
        return success(null);
      },
    );
    ipcMain.handle(
      IPC_CHANNELS.testReadArtifact,
      async (_event, input: unknown) => {
        if (typeof input !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(input))
          return failure<ArrayBuffer | null>(
            "INVALID_INPUT",
            "Test artifact name is invalid.",
          );
        try {
          return success<ArrayBuffer | null>(
            toArrayBuffer(await fs.readFile(path.join(this.#e2eRoot, input))),
          );
        } catch {
          return success<ArrayBuffer | null>(null);
        }
      },
    );
  }
}

function ensureExtension(filePath: string, extension: string): string {
  return filePath.toLocaleLowerCase("en-US").endsWith(`.${extension}`)
    ? filePath
    : `${filePath}.${extension}`;
}

async function atomicWrite(
  targetPath: string,
  bytes: Uint8Array,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  const backup = `${targetPath}.bak`;
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
    await fs.rename(temporary, targetPath);
    await fs.rm(backup, { force: true }).catch(() => undefined);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    try {
      await fs.stat(backup);
      await fs.rm(targetPath, { force: true });
      await fs.rename(backup, targetPath);
    } catch {
      /* No backup was available to restore. */
    }
    throw error;
  }
}
