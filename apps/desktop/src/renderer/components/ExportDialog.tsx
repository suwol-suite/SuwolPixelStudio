import { useState } from "react";
import type { FrameId } from "@suwol/editor-core";
import type { AnimationExportJob } from "../workers/animation-export.worker";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export type AnimationExportKind = AnimationExportJob["kind"];

export function ExportDialog({
  kind,
  documentName,
  allFrameIds,
  tagFrameIds,
  t,
  onClose,
  onApply,
}: {
  readonly kind: AnimationExportKind;
  readonly documentName: string;
  readonly allFrameIds: readonly FrameId[];
  readonly tagFrameIds: readonly FrameId[] | null;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onApply: (job: AnimationExportJob) => void;
}) {
  const [prefix, setPrefix] = useState(documentName),
    [range, setRange] = useState<"all" | "tag">(tagFrameIds === null ? "all" : "tag"),
    [digits, setDigits] = useState(4),
    [layout, setLayout] = useState<"horizontal" | "vertical" | "grid">("grid"),
    [columns, setColumns] = useState(8),
    [spacing, setSpacing] = useState(0),
    [padding, setPadding] = useState(0),
    [loopCount, setLoopCount] = useState(0),
    [scale, setScale] = useState<1 | 2 | 4>(1),
    [threshold, setThreshold] = useState(0);
  const frameIds = range === "tag" && tagFrameIds !== null ? tagFrameIds : allFrameIds;
  function submit(): void {
    if (kind === "png-sequence")
      onApply({ kind, options: { prefix, digits, startNumber: 1, frameIds } });
    else if (kind === "sprite-sheet")
      onApply({ kind, options: { layout, columns, spacing, padding, imageName: prefix, includeJson: true, frameIds } });
    else if (kind === "gif")
      onApply({ kind, fileName: prefix, frameIds, options: { loopCount, scale, transparentThreshold: threshold, background: [255, 255, 255, 255] } });
    else onApply({ kind, fileName: prefix, frameIds, options: { loopCount, scale } });
  }
  return (
    <Dialog title={t(`export.${kind}`)} closeLabel={t("action.cancel")} onClose={onClose} className="export-dialog">
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="dialog-body">
          <label>{t("export.filePrefix")}<input data-testid="export-prefix" value={prefix} maxLength={100} onChange={(event) => setPrefix(event.target.value)} /></label>
          <label>{t("export.frameRange")}<select data-testid="export-range" value={range} onChange={(event) => setRange(event.target.value as "all" | "tag")}><option value="all">{t("export.allFrames")}</option>{tagFrameIds !== null && <option value="tag">{t("export.activeTag")}</option>}</select></label>
          {kind === "png-sequence" && <label>{t("export.digits")}<input type="number" min="1" max="12" value={digits} onChange={(event) => setDigits(Number(event.target.value))} /></label>}
          {kind === "sprite-sheet" && <>
            <label>{t("export.layout")}<select value={layout} onChange={(event) => setLayout(event.target.value as typeof layout)}><option value="horizontal">{t("export.horizontal")}</option><option value="vertical">{t("export.vertical")}</option><option value="grid">{t("export.grid")}</option></select></label>
            <label>{t("export.columns")}<input type="number" min="1" max="1000" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></label>
            <label>{t("export.spacing")}<input type="number" min="0" max="1024" value={spacing} onChange={(event) => setSpacing(Number(event.target.value))} /></label>
            <label>{t("export.padding")}<input type="number" min="0" max="1024" value={padding} onChange={(event) => setPadding(Number(event.target.value))} /></label>
          </>}
          {(kind === "gif" || kind === "apng") && <>
            <label>{t("export.loopCount")}<input type="number" min="0" max="65535" value={loopCount} onChange={(event) => setLoopCount(Number(event.target.value))} /></label>
            <label>{t("export.scale")}<select value={scale} onChange={(event) => setScale(Number(event.target.value) as 1 | 2 | 4)}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
          </>}
          {kind === "gif" && <><label>{t("export.alphaThreshold")}<input type="number" min="0" max="255" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label><p className="inline-warning">{t("export.gifAlpha")}</p></>}
        </div>
        <footer className="dialog-actions"><button type="button" onClick={onClose}>{t("action.cancel")}</button><button data-testid="export-start" type="submit" disabled={prefix.trim() === "" || frameIds.length === 0}>{t("export.start")}</button></footer>
      </form>
    </Dialog>
  );
}
