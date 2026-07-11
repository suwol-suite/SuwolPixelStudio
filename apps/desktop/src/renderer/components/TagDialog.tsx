import { useState } from "react";
import type { FrameTag, TagPlayback } from "@suwol/editor-core";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export interface TagDialogResult {
  readonly name: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly playback: TagPlayback;
}

export function TagDialog({
  frameCount,
  initial,
  t,
  onClose,
  onApply,
}: {
  readonly frameCount: number;
  readonly initial?: Readonly<{ tag: FrameTag; fromIndex: number; toIndex: number }>;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onApply: (result: TagDialogResult) => void;
}) {
  const [name, setName] = useState(initial?.tag.name ?? t("tag.defaultName")),
    [fromIndex, setFromIndex] = useState(initial?.fromIndex ?? 0),
    [toIndex, setToIndex] = useState(initial?.toIndex ?? Math.max(0, frameCount - 1)),
    [playback, setPlayback] = useState<TagPlayback>(initial?.tag.playback ?? "forward");
  return (
    <Dialog title={initial === undefined ? t("tag.add") : t("tag.edit")} closeLabel={t("action.cancel")} onClose={onClose} className="tag-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() !== "") onApply({ name: name.trim(), fromIndex, toIndex, playback });
        }}
      >
        <div className="dialog-body">
          <label>{t("tag.name")}<input data-testid="tag-name" value={name} maxLength={256} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t("tag.from")}<input data-testid="tag-from" type="number" min="1" max={frameCount} value={fromIndex + 1} onChange={(event) => setFromIndex(Math.max(0, Math.min(frameCount - 1, Number(event.target.value) - 1)))} /></label>
          <label>{t("tag.to")}<input data-testid="tag-to" type="number" min="1" max={frameCount} value={toIndex + 1} onChange={(event) => setToIndex(Math.max(0, Math.min(frameCount - 1, Number(event.target.value) - 1)))} /></label>
          <label>{t("tag.playback")}<select value={playback} onChange={(event) => setPlayback(event.target.value as TagPlayback)}><option value="forward">{t("tag.forward")}</option><option value="reverse">{t("tag.reverse")}</option><option value="pingpong">{t("animation.pingpong")}</option></select></label>
        </div>
        <footer className="dialog-actions"><button type="button" onClick={onClose}>{t("action.cancel")}</button><button data-testid="tag-apply" type="submit" disabled={name.trim() === ""}>{t("action.apply")}</button></footer>
      </form>
    </Dialog>
  );
}
