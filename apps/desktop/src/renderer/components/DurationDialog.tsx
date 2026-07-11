import { useState } from "react";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export function DurationDialog({
  initial,
  t,
  onClose,
  onApply,
}: {
  readonly initial: number;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onApply: (durationMs: number) => void;
}) {
  const [duration, setDuration] = useState(initial),
    valid = Number.isInteger(duration) && duration >= 10 && duration <= 60_000;
  return (
    <Dialog title={t("frame.duration")} closeLabel={t("action.cancel")} onClose={onClose} className="duration-dialog">
      <form onSubmit={(event) => { event.preventDefault(); if (valid) onApply(duration); }}>
        <div className="dialog-body">
          <label>{t("frame.duration")} (ms)<input data-testid="frame-duration" type="number" min="10" max="60000" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
          <p>{(1000 / Math.max(1, duration)).toFixed(2)} FPS</p>
        </div>
        <footer className="dialog-actions"><button type="button" onClick={onClose}>{t("action.cancel")}</button><button data-testid="duration-apply" type="submit" disabled={!valid}>{t("action.apply")}</button></footer>
      </form>
    </Dialog>
  );
}
