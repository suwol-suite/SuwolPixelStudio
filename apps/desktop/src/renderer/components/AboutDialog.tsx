import type { AppDiagnostics } from "@suwol/shared";
import type { Translate } from "../i18n";
import appIconUrl from "../../../assets/linux/studio.suwol.pixel.png";
import { Dialog } from "./Dialog";

interface AboutDialogProps {
  readonly t: Translate;
  readonly diagnostics: AppDiagnostics | null;
  readonly onOpenRepository: () => void;
  readonly onOpenLicense: () => void;
  readonly onOpenNotices: () => void;
  readonly onOpenLogs: () => void;
  readonly onCopyDiagnostics: () => void;
  readonly onClose: () => void;
}

export function AboutDialog({
  t,
  diagnostics,
  onOpenRepository,
  onOpenLicense,
  onOpenNotices,
  onOpenLogs,
  onCopyDiagnostics,
  onClose,
}: AboutDialogProps) {
  return (
    <Dialog
      title={t("about.title")}
      closeLabel={t("dialog.close")}
      onClose={onClose}
      className="about-dialog"
    >
      <div className="about-content">
        <div className="about-mark">
          <img src={appIconUrl} alt="" aria-hidden="true" />
        </div>
        <p>{t("about.description")}</p>
        <p className="about-scope">{t("about.scope")}</p>
        <dl>
          <div>
            <dt>{t("about.version")}</dt>
            <dd>{diagnostics?.version ?? "0.6.0-rc.6"}</dd>
          </div>
          <div>
            <dt>{t("about.platform")}</dt>
            <dd>
              {diagnostics === null
                ? t("about.unknown")
                : `${diagnostics.platform} · ${diagnostics.architecture}`}
            </dd>
          </div>
          <div>
            <dt>{t("about.runtime")}</dt>
            <dd>
              Electron {diagnostics?.electron ?? "—"} · Chromium{" "}
              {diagnostics?.chromium ?? "—"}
            </dd>
          </div>
          <div>
            <dt>{t("about.formats")}</dt>
            <dd>
              v{diagnostics?.fileFormatVersion ?? 4} · Plugin API{" "}
              {diagnostics?.pluginApiVersion ?? "1.1.0"}
            </dd>
          </div>
          <div>
            <dt>{t("about.license")}</dt>
            <dd>{diagnostics?.license ?? "Apache-2.0"}</dd>
          </div>
        </dl>
        <div className="about-actions">
          <button type="button" onClick={onOpenRepository}>
            {t("about.repository")}
          </button>
          <button type="button" onClick={onOpenLicense}>
            {t("about.license")}
          </button>
          <button type="button" onClick={onOpenNotices}>
            {t("about.notices")}
          </button>
          <button type="button" onClick={onOpenLogs}>
            {t("about.logs")}
          </button>
          <button type="button" onClick={onCopyDiagnostics}>
            {t("about.copyDiagnostics")}
          </button>
        </div>
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}
