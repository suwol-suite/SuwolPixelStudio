export type PanelLocation = "left" | "right" | "bottom";

export interface PanelDefinition<Id extends string = string> {
  readonly id: Id;
  readonly titleKey: string;
  readonly defaultLocation: PanelLocation;
  readonly defaultVisible: boolean;
}

type PanelListener = () => void;

export class PanelRegistry<Id extends string = string> {
  readonly #definitions = new Map<Id, PanelDefinition<Id>>();
  readonly #visibility = new Map<Id, boolean>();
  readonly #listeners = new Set<PanelListener>();

  register(definition: PanelDefinition<Id>): () => void {
    if (this.#definitions.has(definition.id)) {
      throw new Error(`Duplicate panel id: ${definition.id}`);
    }
    this.#definitions.set(definition.id, definition);
    this.#visibility.set(definition.id, definition.defaultVisible);
    this.#notify();
    return () => this.unregister(definition.id);
  }

  unregister(id: Id): void {
    const removed = this.#definitions.delete(id);
    this.#visibility.delete(id);
    if (removed) this.#notify();
  }

  get(id: Id): PanelDefinition<Id> | undefined {
    return this.#definitions.get(id);
  }

  getAll(): readonly PanelDefinition<Id>[] {
    return [...this.#definitions.values()];
  }

  isVisible(id: Id): boolean {
    return this.#visibility.get(id) ?? false;
  }

  setVisible(id: Id, visible: boolean): boolean {
    if (!this.#definitions.has(id)) return false;
    if (this.#visibility.get(id) !== visible) {
      this.#visibility.set(id, visible);
      this.#notify();
    }
    return true;
  }

  toggle(id: Id): boolean {
    if (!this.#definitions.has(id)) return false;
    return this.setVisible(id, !this.isVisible(id));
  }

  restoreVisibility(visibility: Readonly<Partial<Record<Id, boolean>>>): void {
    for (const definition of this.#definitions.values()) {
      const restored = visibility[definition.id];
      this.#visibility.set(
        definition.id,
        typeof restored === "boolean" ? restored : definition.defaultVisible,
      );
    }
    this.#notify();
  }

  exportVisibility(): Record<Id, boolean> {
    return Object.fromEntries(
      [...this.#definitions.keys()].map((id) => [id, this.isVisible(id)]),
    ) as Record<Id, boolean>;
  }

  reset(): void {
    for (const definition of this.#definitions.values()) {
      this.#visibility.set(definition.id, definition.defaultVisible);
    }
    this.#notify();
  }

  subscribe(listener: PanelListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
