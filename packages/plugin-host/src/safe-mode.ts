export interface PluginCrashRecord {
  readonly pluginId: string;
  readonly timestamps: readonly number[];
  readonly activationFailures: number;
  readonly timeouts: number;
}

export class PluginSafeModeController {
  #settingEnabled = false;
  #commandLineDisabled = false;
  #previousInitializationInterrupted = false;
  readonly #crashes = new Map<string, PluginCrashRecord>();

  get active(): boolean {
    return this.#settingEnabled || this.#commandLineDisabled;
  }
  get shouldSuggest(): boolean {
    return this.#previousInitializationInterrupted || [...this.#crashes.values()].some((record) => this.shouldDisable(record.pluginId));
  }

  configure(input: Readonly<{ settingEnabled: boolean; commandLineDisabled: boolean; previousInitializationInterrupted?: boolean }>): void {
    this.#settingEnabled = input.settingEnabled;
    this.#commandLineDisabled = input.commandLineDisabled;
    this.#previousInitializationInterrupted = input.previousInitializationInterrupted ?? false;
  }

  setSetting(enabled: boolean): void {
    this.#settingEnabled = enabled;
  }

  recordCrash(pluginId: string, now = Date.now()): void {
    const current = this.#crashes.get(pluginId) ?? { pluginId, timestamps: [], activationFailures: 0, timeouts: 0 };
    this.#crashes.set(pluginId, { ...current, timestamps: [...current.timestamps.filter((timestamp) => timestamp > now - 5 * 60_000), now] });
  }
  recordActivationFailure(pluginId: string): void {
    const current = this.#crashes.get(pluginId) ?? { pluginId, timestamps: [], activationFailures: 0, timeouts: 0 };
    this.#crashes.set(pluginId, { ...current, activationFailures: current.activationFailures + 1 });
  }
  recordTimeout(pluginId: string): void {
    const current = this.#crashes.get(pluginId) ?? { pluginId, timestamps: [], activationFailures: 0, timeouts: 0 };
    this.#crashes.set(pluginId, { ...current, timeouts: current.timeouts + 1 });
  }
  shouldDisable(pluginId: string): boolean {
    const record = this.#crashes.get(pluginId);
    return record !== undefined && (record.timestamps.length >= 3 || record.activationFailures >= 2 || record.timeouts >= 3);
  }
  clear(pluginId: string): void {
    this.#crashes.delete(pluginId);
  }
  records(): readonly PluginCrashRecord[] {
    return [...this.#crashes.values()];
  }
}
