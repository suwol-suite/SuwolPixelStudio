import { PLUGIN_LIMITS } from "@suwol/plugin-api";
import { PluginError } from "./errors";

export type PluginStorageValue = null | boolean | number | string | readonly PluginStorageValue[] | Readonly<{ [key: string]: PluginStorageValue }>;

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

export function normalizeStorageValue(input: unknown, seen = new Set<object>()): PluginStorageValue {
  if (input === null || typeof input === "boolean" || typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "object")
    throw new PluginError("STORAGE_INVALID", "Plugin storage accepts JSON values only.");
  if (seen.has(input))
    throw new PluginError("STORAGE_INVALID", "Plugin storage value is cyclic.");
  seen.add(input);
  try {
    if (Array.isArray(input)) return input.map((value) => normalizeStorageValue(value, seen));
    const prototype = Object.getPrototypeOf(input) as unknown;
    if (prototype !== Object.prototype && prototype !== null)
      throw new PluginError("STORAGE_INVALID", "Plugin storage objects must be plain objects.");
    const result: Record<string, PluginStorageValue> = Object.create(null) as Record<string, PluginStorageValue>;
    for (const [key, value] of Object.entries(input)) {
      if (forbiddenKeys.has(key) || key.length > 128)
        throw new PluginError("STORAGE_INVALID", "Plugin storage key is unsafe.");
      result[key] = normalizeStorageValue(value, seen);
    }
    return result;
  } finally {
    seen.delete(input);
  }
}

export class PluginStorageNamespace {
  readonly #values = new Map<string, PluginStorageValue>();

  constructor(initial?: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(initial ?? {})) this.set(key, value);
  }

  get(key: string): PluginStorageValue | null {
    this.#validateKey(key);
    return this.#values.get(key) ?? null;
  }

  set(key: string, input: unknown): void {
    this.#validateKey(key);
    const value = normalizeStorageValue(input);
    const next = new Map(this.#values);
    next.set(key, value);
    const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(next))).byteLength;
    if (bytes > PLUGIN_LIMITS.storageBytes)
      throw new PluginError("STORAGE_QUOTA", "Plugin storage quota exceeded.");
    this.#values.set(key, value);
  }

  delete(key: string): void {
    this.#validateKey(key);
    this.#values.delete(key);
  }

  clear(): void {
    this.#values.clear();
  }

  serialize(): Readonly<Record<string, PluginStorageValue>> {
    return Object.fromEntries(this.#values);
  }

  #validateKey(key: string): void {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key) || forbiddenKeys.has(key))
      throw new PluginError("STORAGE_INVALID", "Plugin storage key is invalid.");
  }
}
