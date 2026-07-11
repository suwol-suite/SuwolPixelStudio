import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  PluginInspection,
  PluginPanelContribution,
  PluginPermission,
} from "@suwol/plugin-api";
import type { Translate } from "../i18n";
import { PluginRuntimeController } from "../plugins/runtime";
import { Dialog } from "./Dialog";

interface PluginManagerProps {
  readonly controller: PluginRuntimeController;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onRunImporter: (pluginId: string, importerId: string, title: string, extensions: readonly string[]) => Promise<void>;
  readonly onRunExporter: (pluginId: string, exporterId: string) => Promise<void>;
  readonly onRunTool: (pluginId: string, toolId: string) => Promise<void>;
}

export function PluginManager({ controller, t, onClose, onRunImporter, onRunExporter, onRunTool }: PluginManagerProps) {
  useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.snapshot.version,
  );
  const snapshot = controller.snapshot;
  const [inspection, setInspection] = useState<PluginInspection | null>(null);
  const [installGrants, setInstallGrants] = useState<Set<PluginPermission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<readonly string[] | null>(null);
  const selected = snapshot.installed.find((plugin) => plugin.manifest.id === snapshot.selectedPluginId) ?? null;

  useEffect(() => {
    if (snapshot.selectedPluginId === null && snapshot.installed[0] !== undefined)
      controller.select(snapshot.installed[0].manifest.id);
  }, [controller, snapshot.installed, snapshot.selectedPluginId]);

  async function run(operation: () => Promise<void>): Promise<void> {
    setError(null);
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("plugin.error.generic")); }
  }
  async function choosePackage(): Promise<void> {
    await run(async () => {
      const handle = await window.suwolDesktop?.plugins.selectPackage();
      if (handle === null || handle === undefined) return;
      const next = await window.suwolDesktop?.plugins.inspectPackage(handle);
      if (next === undefined) return;
      setInspection(next);
      setInstallGrants(new Set());
    });
  }
  function toggleInstallGrant(permission: PluginPermission): void {
    setInstallGrants((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission); else next.add(permission);
      return next;
    });
  }
  async function install(): Promise<void> {
    if (inspection === null) return;
    await run(async () => {
      const checked = document.querySelectorAll<HTMLInputElement>(
        "[data-plugin-install-grant]:checked",
      );
      await window.suwolDesktop?.plugins.install(
        inspection.handle,
        [...checked].map((item) => item.value as PluginPermission),
      );
      setInspection(null);
      await controller.refresh();
      controller.select(inspection.manifest.id);
    });
  }
  async function saveGrants(): Promise<void> {
    if (selected === null) return;
    const checked = document.querySelectorAll<HTMLInputElement>("[data-plugin-grant]:checked");
    await run(async () => {
      await controller.stop(selected.manifest.id);
      await window.suwolDesktop?.plugins.setGrants(selected.manifest.id, [...checked].map((item) => item.value as PluginPermission));
      await controller.refresh();
    });
  }

  return (
    <Dialog
      title={t("plugin.manager")}
      closeLabel={t("dialog.close")}
      onClose={onClose}
      className="plugin-manager-dialog"
    >
      <div className="plugin-manager-toolbar">
        <button type="button" onClick={() => { void choosePackage(); }}>{t("plugin.install")}</button>
        <button
          type="button"
          aria-pressed={snapshot.safeMode}
          onClick={() => { void run(async () => { await window.suwolDesktop?.plugins.setSafeMode(!snapshot.safeMode); await controller.refresh(); }); }}
        >
          {snapshot.safeMode ? t("plugin.exitSafeMode") : t("plugin.enterSafeMode")}
        </button>
        <span role="status">{snapshot.safeMode ? t("plugin.safeModeActive") : t("plugin.safeModeInactive")}</span>
      </div>
      {error !== null && <p className="plugin-error" role="alert">{error}</p>}
      {inspection !== null && (
        <section className="plugin-install-review" aria-label={t("plugin.installReview")}>
          <h3>{inspection.manifest.name} · {inspection.manifest.version}</h3>
          <p className="plugin-warning">{t("plugin.unsignedWarning")}</p>
          {inspection.currentVersion !== null && <p>{t("plugin.currentVersion")}: {inspection.currentVersion}</p>}
          {inspection.downgrade && <p className="plugin-warning">{t("plugin.downgradeWarning")}</p>}
          <fieldset>
            <legend>{t("plugin.permissions")}</legend>
            {inspection.manifest.permissions.map((permission) => (
              <label key={permission}>
                <input data-plugin-install-grant type="checkbox" value={permission} checked={installGrants.has(permission)} onChange={() => toggleInstallGrant(permission)} />
                <span>{permissionLabel(permission, t)}</span>
                {inspection.newPermissions.includes(permission) && <strong>{t("plugin.newPermission")}</strong>}
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button type="button" onClick={() => setInspection(null)}>{t("action.cancel")}</button>
            <button type="button" onClick={() => { void install(); }}>{t("plugin.install")}</button>
          </div>
        </section>
      )}
      <div className="plugin-manager-body">
        <nav className="plugin-list" aria-label={t("plugin.installed")}>
          {snapshot.installed.length === 0 && <p>{t("plugin.noneInstalled")}</p>}
          {snapshot.installed.map((plugin) => (
            <button
              key={plugin.manifest.id}
              type="button"
              className={selected?.manifest.id === plugin.manifest.id ? "selected" : ""}
              aria-pressed={selected?.manifest.id === plugin.manifest.id}
              onClick={() => { controller.select(plugin.manifest.id); setLogs(null); }}
            >
              <strong>{plugin.manifest.name}</strong>
              <span>{plugin.enabled ? t("plugin.enabled") : t("plugin.disabled")} · {plugin.runtimeStatus}</span>
            </button>
          ))}
        </nav>
        {selected !== null && (
          <section className="plugin-details" aria-live="polite">
            <h3>{selected.manifest.name}</h3>
            <dl>
              <div><dt>ID</dt><dd>{selected.manifest.id}</dd></div>
              <div><dt>{t("plugin.version")}</dt><dd>{selected.manifest.version}</dd></div>
              <div><dt>{t("plugin.apiCompatibility")}</dt><dd>{selected.compatible ? "1.0" : t("plugin.incompatible")}</dd></div>
              <div><dt>{t("plugin.installSource")}</dt><dd>{selected.installSource}</dd></div>
              <div><dt>{t("plugin.signature")}</dt><dd>{t("plugin.unsigned")}</dd></div>
              <div><dt>{t("plugin.lastError")}</dt><dd>{selected.lastError?.code ?? t("plugin.none")}</dd></div>
            </dl>
            <div className="plugin-actions">
              <button type="button" onClick={() => { void run(async () => { if (selected.enabled) await controller.stop(selected.manifest.id); await window.suwolDesktop?.plugins.setEnabled(selected.manifest.id, !selected.enabled); await controller.refresh(); }); }}>
                {selected.enabled ? t("plugin.disable") : t("plugin.enable")}
              </button>
              <button type="button" disabled={!selected.enabled} onClick={() => { void run(async () => { await controller.restart(selected.manifest.id); await controller.refresh(); }); }}>{t("plugin.restart")}</button>
              <button type="button" onClick={() => { void run(async () => { setLogs((await window.suwolDesktop?.plugins.readLogs(selected.manifest.id)) ?? []); }); }}>{t("plugin.openLogs")}</button>
              <button type="button" onClick={() => { void run(async () => { await window.suwolDesktop?.plugins.showFolder(selected.manifest.id); }); }}>{t("plugin.showFolder")}</button>
              <button type="button" onClick={() => { if (window.confirm(t("plugin.confirmClearStorage"))) void run(async () => { await window.suwolDesktop?.plugins.clearStorage(selected.manifest.id); }); }}>{t("plugin.clearData")}</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm(t("plugin.confirmRemove"))) void run(async () => { await controller.stop(selected.manifest.id); await window.suwolDesktop?.plugins.remove(selected.manifest.id, false); controller.select(null); await controller.refresh(); }); }}>{t("plugin.remove")}</button>
            </div>
            <fieldset className="plugin-permissions">
              <legend>{t("plugin.permissions")}</legend>
              {selected.manifest.permissions.map((permission) => (
                <label key={permission}>
                  <input data-plugin-grant type="checkbox" value={permission} defaultChecked={selected.grants.includes(permission)} />
                  {permissionLabel(permission, t)}
                </label>
              ))}
              <button type="button" onClick={() => { void saveGrants(); }}>{t("plugin.savePermissions")}</button>
            </fieldset>
            {logs !== null && <pre className="plugin-logs" aria-label={t("plugin.logs")}>{logs.join("\n") || t("plugin.noLogs")}</pre>}
            <section className="plugin-contributions" aria-label={t("plugin.contributions")}>
              <h4>{t("plugin.contributions")}</h4>
              {[...(selected.manifest.contributes?.importers ?? []).map((item) => ({ kind: "importer" as const, label: t("plugin.importer"), id: item.id, title: item.title, extensions: item.extensions })), ...(selected.manifest.contributes?.exporters ?? []).map((item) => ({ kind: "exporter" as const, label: t("plugin.exporter"), id: item.id, title: item.title, extensions: item.extensions })), ...(selected.manifest.contributes?.tools ?? []).map((item) => ({ kind: "tool" as const, label: t("plugin.tool"), id: item.id, title: item.title, extensions: [] })), ...(selected.manifest.contributes?.overlays ?? []).map((item) => ({ kind: "overlay" as const, label: t("plugin.overlay"), id: item.id, title: item.title, extensions: [] }))].map((item) => <div className="manager-row" key={item.id}><strong>{item.label}</strong><span>{item.title}</span><code>{item.id}</code>{item.kind !== "overlay" && <button type="button" onClick={() => { void run(async () => { if (item.kind === "importer") await onRunImporter(selected.manifest.id, item.id, item.title, item.extensions); else if (item.kind === "exporter") await onRunExporter(selected.manifest.id, item.id); else await onRunTool(selected.manifest.id, item.id); }); }}>{t("plugin.run")}</button>}</div>)}
            </section>
            {snapshot.panels.filter((panel) => panel.pluginId === selected.manifest.id).map((panel) => (
              <SandboxedPluginPanel
                key={panel.contribution.id}
                controller={controller}
                pluginId={panel.pluginId}
                runtimeId={panel.runtimeId}
                contribution={panel.contribution}
              />
            ))}
          </section>
        )}
      </div>
      {snapshot.progress.map((progress) => (
        <div className="plugin-progress" key={progress.id} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined}>
          <strong>{progress.title}</strong><span>{progress.message}</span>
          {progress.percent !== null && <progress value={progress.percent} max={100} />}
          {progress.cancellable && <button type="button" onClick={() => controller.cancelProgress(progress.id)}>{t("action.cancel")}</button>}
        </div>
      ))}
      {snapshot.lastNotice !== null && <p className={`plugin-notice ${snapshot.lastNotice.level}`} role="status">{snapshot.lastNotice.pluginId}: {snapshot.lastNotice.message}</p>}
    </Dialog>
  );
}

function SandboxedPluginPanel({
  controller,
  pluginId,
  runtimeId,
  contribution,
}: Readonly<{
  controller: PluginRuntimeController;
  pluginId: string;
  runtimeId: string;
  contribution: PluginPanelContribution;
}>) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => undefined);
  useEffect(() => () => cleanup.current(), []);
  return (
    <section className="plugin-panel-host" aria-label={contribution.title}>
      <header><h4>{contribution.title}</h4><span>{pluginId}</span></header>
      <iframe
        ref={frameRef}
        title={contribution.title}
        src={controller.panelUrl(runtimeId, contribution.entry)}
        sandbox={PluginRuntimeController.panelSandbox}
        referrerPolicy="no-referrer"
        onLoad={() => {
          cleanup.current();
          if (frameRef.current !== null)
            cleanup.current = controller.attachPanel(pluginId, contribution.id, frameRef.current);
        }}
      />
    </section>
  );
}

function permissionLabel(permission: PluginPermission, t: Translate): string {
  if (permission === "network:localhost") return t("plugin.permission.localhost");
  if (permission.startsWith("network:")) return `${t("plugin.permission.network")}: ${permission.slice(8)}`;
  return t(`plugin.permission.${permission}`);
}
