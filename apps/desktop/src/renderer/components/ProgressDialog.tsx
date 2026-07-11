import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export function ProgressDialog({
  title,
  completed,
  total,
  t,
  onCancel,
}: {
  readonly title: string;
  readonly completed: number;
  readonly total: number;
  readonly t: Translate;
  readonly onCancel: () => void;
}) {
  return (
    <Dialog title={title} closeLabel={t("export.cancel")} onClose={onCancel} className="progress-dialog">
      <div className="dialog-body" aria-live="polite">
        <progress data-testid="export-progress" max={Math.max(1, total)} value={completed} />
        <p>{completed} / {total}</p>
      </div>
      <footer className="dialog-actions"><button data-testid="cancel-job" type="button" onClick={onCancel}>{t("export.cancel")}</button></footer>
    </Dialog>
  );
}
