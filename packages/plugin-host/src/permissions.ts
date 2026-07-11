import type { PluginManifest, PluginPermission } from "@suwol/plugin-api";
import { parsePluginPermission } from "@suwol/plugin-api";
import { PluginError } from "./errors";

export interface PermissionGrantRecord {
  readonly pluginId: string;
  readonly version: string;
  readonly grants: readonly PluginPermission[];
}

export class PluginPermissionManager {
  readonly #records = new Map<string, PermissionGrantRecord>();

  restore(records: readonly PermissionGrantRecord[]): void {
    this.#records.clear();
    for (const record of records) {
      const grants = record.grants
        .map((permission) => parsePluginPermission(permission))
        .filter((permission): permission is PluginPermission => permission !== null);
      this.#records.set(record.pluginId, { ...record, grants });
    }
  }

  setGrants(manifest: PluginManifest, requested: readonly PluginPermission[]): void {
    const declared = new Set<PluginPermission>(manifest.permissions);
    const grants = [...new Set(requested)].filter((grant) => declared.has(grant));
    this.#records.set(manifest.id, { pluginId: manifest.id, version: manifest.version, grants });
  }

  revoke(pluginId: string, permission: PluginPermission): void {
    const record = this.#records.get(pluginId);
    if (record === undefined) return;
    this.#records.set(pluginId, {
      ...record,
      grants: record.grants.filter((grant) => grant !== permission),
    });
  }

  grantsFor(pluginId: string, version?: string): readonly PluginPermission[] {
    const record = this.#records.get(pluginId);
    return record !== undefined && (version === undefined || record.version === version)
      ? [...record.grants]
      : [];
  }

  has(pluginId: string, permission: PluginPermission): boolean {
    return this.grantsFor(pluginId).includes(permission);
  }

  require(pluginId: string, permission: PluginPermission): void {
    if (!this.has(pluginId, permission))
      throw new PluginError("PERMISSION_DENIED", "Plugin permission was not granted.", { permission });
  }

  missingRequired(manifest: PluginManifest): readonly PluginPermission[] {
    const granted = new Set(this.grantsFor(manifest.id, manifest.version));
    return manifest.permissions.filter((permission) => !granted.has(permission));
  }

  serialize(): readonly PermissionGrantRecord[] {
    return [...this.#records.values()].map((record) => ({ ...record, grants: [...record.grants] }));
  }
}
