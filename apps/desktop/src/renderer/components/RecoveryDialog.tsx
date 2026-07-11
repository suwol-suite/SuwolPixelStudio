import type { RecoverySnapshotInfo } from "@suwol/shared";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

function thumbnailUrl(bytes: ArrayBuffer | null): string | null {
  if (bytes === null) return null;
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 0x8000)
    binary += String.fromCharCode(
      ...data.subarray(offset, Math.min(data.length, offset + 0x8000)),
    );
  return `data:image/png;base64,${btoa(binary)}`;
}
function time(value: number | null, language: string): string {
  return value === null
    ? "—"
    : new Intl.DateTimeFormat(language, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(value);
}

export function RecoveryDialog({
  items,
  t,
  language,
  onRecover,
  onDelete,
  onDeleteAll,
  onClose,
}: {
  readonly items: readonly RecoverySnapshotInfo[];
  readonly t: Translate;
  readonly language: string;
  readonly onRecover: (item: RecoverySnapshotInfo) => void;
  readonly onDelete: (item: RecoverySnapshotInfo) => void;
  readonly onDeleteAll: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      title={t("recovery.title")}
      closeLabel={t("recovery.later")}
      onClose={onClose}
      className="recovery-dialog"
    >
      <div className="dialog-body recovery-list">
        {items.length === 0 ? (
          <p>{t("recovery.empty")}</p>
        ) : (
          items.map((item) => {
            const thumbnail = thumbnailUrl(item.thumbnail);
            return (
              <article
                className="recovery-item"
                key={item.documentId}
                tabIndex={0}
              >
                <div className="recovery-thumbnail">
                  {thumbnail === null ? (
                    <span aria-label={t("recovery.thumbnailFallback")}>◇</span>
                  ) : (
                    <img src={thumbnail} alt="" />
                  )}
                </div>
                <div>
                  <h3>
                    {item.corrupt ? t("recovery.corrupt") : item.displayName}
                  </h3>
                  <p>{item.originalDisplayName ?? t("recovery.unsaved")}</p>
                  <dl>
                    <dt>{t("recovery.lastSaved")}</dt>
                    <dd>{time(item.lastSavedTimestamp, language)}</dd>
                    <dt>{t("recovery.lastAutoSaved")}</dt>
                    <dd>{time(item.timestamp, language)}</dd>
                    <dt>{t("recovery.canvas")}</dt>
                    <dd>
                      {item.width} × {item.height}
                    </dd>
                    <dt>{t("recovery.revision")}</dt>
                    <dd>{item.revision}</dd>
                  </dl>
                </div>
                <div className="recovery-actions">
                  <button
                    type="button"
                    disabled={item.corrupt}
                    onClick={() => onRecover(item)}
                  >
                    {t("recovery.recover")}
                  </button>
                  <button type="button" onClick={() => onDelete(item)}>
                    {t("recovery.delete")}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
      <footer className="dialog-actions">
        <button
          type="button"
          onClick={onDeleteAll}
          disabled={items.length === 0}
        >
          {t("recovery.deleteAll")}
        </button>
        <button type="button" onClick={onClose}>
          {t("recovery.later")}
        </button>
      </footer>
    </Dialog>
  );
}
