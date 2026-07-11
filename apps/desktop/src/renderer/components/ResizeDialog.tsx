import { useState } from "react";
import type { ResizeAnchor } from "@suwol/editor-core";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

export interface ResizeDialogResult {
  readonly width: number;
  readonly height: number;
  readonly anchor: ResizeAnchor;
  readonly fill: "transparent" | "foreground" | "background";
}
const anchors: readonly ResizeAnchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function ResizeDialog({
  mode,
  width: initialWidth,
  height: initialHeight,
  t,
  onClose,
  onApply,
}: {
  readonly mode: "canvas" | "sprite";
  readonly width: number;
  readonly height: number;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onApply: (result: ResizeDialogResult) => void;
}) {
  const [width, setWidth] = useState(initialWidth),
    [height, setHeight] = useState(initialHeight),
    [anchor, setAnchor] = useState<ResizeAnchor>("center"),
    [fill, setFill] = useState<ResizeDialogResult["fill"]>("transparent"),
    [aspect, setAspect] = useState(true);
  const ratio = initialWidth / initialHeight,
    valid =
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= 1 &&
      height >= 1 &&
      width <= 8192 &&
      height <= 8192;
  function changeWidth(value: number) {
    setWidth(value);
    if (mode === "sprite" && aspect)
      setHeight(Math.max(1, Math.round(value / ratio)));
  }
  function changeHeight(value: number) {
    setHeight(value);
    if (mode === "sprite" && aspect)
      setWidth(Math.max(1, Math.round(value * ratio)));
  }
  return (
    <Dialog
      title={
        mode === "canvas" ? t("resize.canvasTitle") : t("resize.spriteTitle")
      }
      closeLabel={t("action.cancel")}
      onClose={onClose}
      className="resize-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onApply({ width, height, anchor, fill });
        }}
      >
        <div className="dialog-body">
          <div className="resize-fields">
            <label>
              {t("new.width")}
              <input
                data-testid="resize-width"
                type="number"
                min="1"
                max="8192"
                value={width}
                onChange={(event) => changeWidth(Number(event.target.value))}
              />
            </label>
            <label>
              {t("new.height")}
              <input
                data-testid="resize-height"
                type="number"
                min="1"
                max="8192"
                value={height}
                onChange={(event) => changeHeight(Number(event.target.value))}
              />
            </label>
          </div>
          {mode === "canvas" ? (
            <>
              <fieldset>
                <legend>{t("resize.anchor")}</legend>
                <div className="anchor-grid">
                  {anchors.map((value) => (
                    <label key={value} title={t(`anchor.${value}`)}>
                      <input
                        type="radio"
                        name="anchor"
                        value={value}
                        checked={anchor === value}
                        onChange={() => setAnchor(value)}
                      />
                      <span>{t(`anchor.${value}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                {t("resize.fill")}
                <select
                  value={fill}
                  onChange={(event) =>
                    setFill(event.target.value as ResizeDialogResult["fill"])
                  }
                >
                  <option value="transparent">{t("resize.transparent")}</option>
                  <option value="foreground">{t("color.foreground")}</option>
                  <option value="background">{t("color.background")}</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={aspect}
                  onChange={(event) => setAspect(event.target.checked)}
                />
                {t("resize.maintainAspect")}
              </label>
              <p>{t("resize.nearest")}</p>
            </>
          )}
        </div>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button data-testid="resize-apply" type="submit" disabled={!valid}>
            {t("action.apply")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
