export interface CommandDefinition {
  readonly id: string;
  readonly titleKey: string;
  readonly category: string;
  readonly defaultKeybindings?: readonly string[];
  canExecute(): boolean;
  isChecked?(): boolean;
  execute(context?: unknown): Promise<void> | void;
}

export type CommandExecutionResult =
  | Readonly<{ status: "executed" }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "disabled" }>
  | Readonly<{ status: "error"; message: string }>;

type CommandListener = () => void;

export class CommandRegistry {
  readonly #commands = new Map<string, CommandDefinition>();
  readonly #listeners = new Set<CommandListener>();

  register(definition: CommandDefinition): () => void {
    if (this.#commands.has(definition.id)) {
      throw new Error(`Duplicate command id: ${definition.id}`);
    }
    this.#commands.set(definition.id, definition);
    this.notifyStateChanged();
    return () => this.unregister(definition.id);
  }

  unregister(id: string): void {
    if (this.#commands.delete(id)) this.notifyStateChanged();
  }

  get(id: string): CommandDefinition | undefined {
    return this.#commands.get(id);
  }

  getAll(): readonly CommandDefinition[] {
    return [...this.#commands.values()];
  }

  canExecute(id: string): boolean {
    return this.#commands.get(id)?.canExecute() ?? false;
  }

  async execute(
    id: string,
    context?: unknown,
  ): Promise<CommandExecutionResult> {
    const command = this.#commands.get(id);
    if (command === undefined) return { status: "not-found" };
    if (!command.canExecute()) return { status: "disabled" };
    try {
      await command.execute(context);
      this.notifyStateChanged();
      return { status: "executed" };
    } catch {
      return { status: "error", message: "Command execution failed." };
    }
  }

  subscribe(listener: CommandListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  notifyStateChanged(): void {
    for (const listener of this.#listeners) listener();
  }
}
