import type { DocumentState } from "./document";
import type { PixelPatch } from "./types";

export interface EditorCommand {
  readonly id: string;
  readonly label: string;
  readonly estimatedMemoryBytes: number;
  readonly metadata?: Readonly<{ source: "plugin"; pluginId: string }> | undefined;
  execute(context: DocumentState): void;
  undo(context: DocumentState): void;
  redo(context: DocumentState): void;
}

export class PixelPatchCommand implements EditorCommand {
  readonly id = "pixel.patch";
  readonly estimatedMemoryBytes: number;
  constructor(
    readonly label: string,
    readonly patch: PixelPatch,
  ) {
    this.estimatedMemoryBytes =
      patch.before.byteLength + patch.after.byteLength;
  }
  execute(context: DocumentState): void {
    this.#write(context, this.patch.after);
  }
  undo(context: DocumentState): void {
    this.#write(context, this.patch.before);
  }
  redo(context: DocumentState): void {
    this.#write(context, this.patch.after);
  }
  #write(context: DocumentState, bytes: Uint8Array): void {
    const surface = context.surfaces.get(this.patch.imageId);
    if (surface === undefined) throw new Error("Patch image is missing.");
    if (this.patch.format !== undefined && surface.format !== this.patch.format)
      throw new Error("Patch format does not match the image surface.");
    surface.writeRegion(this.patch.rect, bytes);
  }
}

export class FunctionalCommand implements EditorCommand {
  readonly #apply: (context: DocumentState) => void;
  readonly #revert: (context: DocumentState) => void;
  constructor(
    readonly id: string,
    readonly label: string,
    readonly estimatedMemoryBytes: number,
    apply: (context: DocumentState) => void,
    revert: (context: DocumentState) => void,
  ) {
    this.#apply = apply;
    this.#revert = revert;
  }
  execute(context: DocumentState): void {
    this.#apply(context);
  }
  undo(context: DocumentState): void {
    this.#revert(context);
  }
  redo(context: DocumentState): void {
    this.#apply(context);
  }
}

export class TransactionCommand implements EditorCommand {
  readonly id = "editor.transaction";
  readonly estimatedMemoryBytes: number;
  constructor(
    readonly label: string,
    readonly commands: readonly EditorCommand[],
    readonly metadata?: Readonly<{ source: "plugin"; pluginId: string }>,
  ) {
    this.estimatedMemoryBytes = commands.reduce(
      (sum, command) => sum + command.estimatedMemoryBytes,
      0,
    );
  }
  execute(context: DocumentState): void {
    const executed: EditorCommand[] = [];
    try {
      for (const command of this.commands) {
        command.execute(context);
        executed.push(command);
      }
    } catch (error) {
      for (const command of executed.reverse()) command.undo(context);
      throw error;
    }
  }
  undo(context: DocumentState): void {
    for (const command of [...this.commands].reverse()) command.undo(context);
  }
  redo(context: DocumentState): void {
    for (const command of this.commands) command.redo(context);
  }
}

export class EditorHistory {
  readonly #undo: EditorCommand[] = [];
  readonly #redo: EditorCommand[] = [];
  #memoryBytes = 0;
  constructor(readonly memoryLimitBytes = 256 * 1024 * 1024) {
    if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1)
      throw new RangeError("History memory limit must be positive.");
  }
  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }
  get undoCount(): number {
    return this.#undo.length;
  }
  get redoCount(): number {
    return this.#redo.length;
  }
  get estimatedMemoryBytes(): number {
    return this.#memoryBytes;
  }

  execute(context: DocumentState, command: EditorCommand): void {
    command.execute(context);
    this.#commit(context, command);
  }

  commitApplied(context: DocumentState, command: EditorCommand): void {
    this.#commit(context, command);
  }

  undo(context: DocumentState): boolean {
    const command = this.#undo.pop();
    if (command === undefined) return false;
    command.undo(context);
    this.#memoryBytes -= command.estimatedMemoryBytes;
    this.#redo.push(command);
    context.model.revision += 1;
    return true;
  }

  redo(context: DocumentState): boolean {
    const command = this.#redo.pop();
    if (command === undefined) return false;
    command.redo(context);
    this.#undo.push(command);
    this.#memoryBytes += command.estimatedMemoryBytes;
    context.model.revision += 1;
    this.#evict();
    return true;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#memoryBytes = 0;
  }

  #commit(context: DocumentState, command: EditorCommand): void {
    this.#redo.length = 0;
    this.#undo.push(command);
    this.#memoryBytes += command.estimatedMemoryBytes;
    context.model.revision += 1;
    this.#evict();
  }
  #evict(): void {
    while (this.#memoryBytes > this.memoryLimitBytes && this.#undo.length > 1) {
      const removed = this.#undo.shift();
      if (removed !== undefined)
        this.#memoryBytes -= removed.estimatedMemoryBytes;
    }
  }
}
