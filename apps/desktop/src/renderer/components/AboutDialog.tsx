import type { SupportedPlatform } from "@suwol/shared";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

interface AboutDialogProps {
  readonly t: Translate;
  readonly version: string;
  readonly platform: SupportedPlatform | "unknown";
  readonly onClose: () => void;
}

export function AboutDialog({
  t,
  version,
  platform,
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
          <Icon name="app" />
        </div>
        <p>{t("about.description")}</p>
        <p className="about-scope">{t("about.scope")}</p>
        <dl>
          <div>
            <dt>{t("about.version")}</dt>
            <dd>{version}</dd>
          </div>
          <div>
            <dt>{t("about.platform")}</dt>
            <dd>{platform}</dd>
          </div>
        </dl>
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}
