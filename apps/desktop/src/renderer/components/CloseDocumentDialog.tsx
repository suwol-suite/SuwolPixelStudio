import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

interface Props {
  readonly t: Translate;
  readonly name: string;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onClose: () => void;
}
export function CloseDocumentDialog({
  t,
  name,
  onSave,
  onDiscard,
  onClose,
}: Props) {
  return (
    <Dialog
      title={t("close.title")}
      closeLabel={t("dialog.close")}
      onClose={onClose}
      className="close-dialog"
    >
      <div className="close-dialog-body">
        <p>{t("close.message").replace("{name}", name)}</p>
        <footer>
          <button type="button" onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button type="button" onClick={onDiscard}>
            {t("close.discard")}
          </button>
          <button type="button" onClick={onSave}>
            {t("action.save")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
