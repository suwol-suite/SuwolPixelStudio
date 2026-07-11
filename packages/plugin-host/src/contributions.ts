import type {
  PluginCommandContribution,
  PluginManifest,
  PluginMenuContribution,
  PluginPanelContribution,
  PluginImporterContribution,
  PluginExporterContribution,
  PluginToolContribution,
  PluginOverlayContribution,
} from "@suwol/plugin-api";
import { PluginError } from "./errors";

export interface ActivePluginContributions {
  readonly pluginId: string;
  readonly commands: readonly PluginCommandContribution[];
  readonly menus: readonly PluginMenuContribution[];
  readonly panels: readonly PluginPanelContribution[];
  readonly importers: readonly PluginImporterContribution[];
  readonly exporters: readonly PluginExporterContribution[];
  readonly tools: readonly PluginToolContribution[];
  readonly overlays: readonly PluginOverlayContribution[];
}

type ContributionListener = () => void;

export class PluginContributionRegistry {
  readonly #active = new Map<string, ActivePluginContributions>();
  readonly #builtInIds: ReadonlySet<string>;
  readonly #listeners = new Set<ContributionListener>();

  constructor(builtInIds: ReadonlySet<string> = new Set()) {
    this.#builtInIds = builtInIds;
  }

  activate(manifest: PluginManifest): ActivePluginContributions {
    const ids = new Set<string>();
    for (const existing of this.#active.values()) {
      for (const command of existing.commands) ids.add(command.id);
      for (const panel of existing.panels) ids.add(panel.id);
      for (const importer of existing.importers) ids.add(importer.id);
      for (const exporter of existing.exporters) ids.add(exporter.id);
      for (const tool of existing.tools) ids.add(tool.id);
      for (const overlay of existing.overlays) ids.add(overlay.id);
    }
    const commands = [...(manifest.contributes?.commands ?? [])];
    const menus = [...(manifest.contributes?.menus ?? [])];
    const panels = [...(manifest.contributes?.panels ?? [])];
    const importers = [...(manifest.contributes?.importers ?? [])];
    const exporters = [...(manifest.contributes?.exporters ?? [])];
    const tools = [...(manifest.contributes?.tools ?? [])];
    const overlays = [...(manifest.contributes?.overlays ?? [])];
    for (const id of [...commands, ...panels, ...importers, ...exporters, ...tools, ...overlays].map((item) => item.id))
      if (ids.has(id) || this.#builtInIds.has(id))
        throw new PluginError("MANIFEST_INVALID", "Plugin contribution collides with an existing id.", { id });
    const active = { pluginId: manifest.id, commands, menus, panels, importers, exporters, tools, overlays };
    this.#active.set(manifest.id, active);
    this.#notify();
    return active;
  }

  deactivate(pluginId: string): void {
    if (this.#active.delete(pluginId)) this.#notify();
  }

  get(pluginId: string): ActivePluginContributions | null {
    return this.#active.get(pluginId) ?? null;
  }

  getAll(): readonly ActivePluginContributions[] {
    return [...this.#active.values()];
  }

  subscribe(listener: ContributionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
