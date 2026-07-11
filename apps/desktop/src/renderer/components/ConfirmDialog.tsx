import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export function ConfirmDialog({
  title,
  message,
  t,
  onConfirm,
  onClose,
}: Readonly<{
  title: string;
  message: string;
  t: Translate;
  onConfirm: () => void;
  onClose: () => void;
}>) {
  return (
    <Dialog title={title} closeLabel={t("action.cancel")} onClose={onClose} className="confirm-dialog">
      <div className="dialog-body">
        <p>{message}</p>
      </div>
      <footer className="dialog-actions">
        <button type="button" onClick={onClose}>{t("action.cancel")}</button>
        <button type="button" className="danger" onClick={onConfirm}>{t("action.confirm")}</button>
      </footer>
    </Dialog>
  );
}
