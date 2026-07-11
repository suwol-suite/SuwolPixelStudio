import { useState, type SyntheticEvent } from "react";
import { MAX_CANVAS_DIMENSION, MAX_SURFACE_BYTES } from "@suwol/editor-core";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

interface Props {
  readonly t: Translate;
  readonly onCreate: (name: string, width: number, height: number, colorMode: "rgba" | "indexed", transparentIndex: number, maxPaletteSize: number) => void;
  readonly onClose: () => void;
}

export function NewDocumentDialog({ t, onCreate, onClose }: Props) {
  const [name, setName] = useState(t("document.defaultName"));
  const [width, setWidth] = useState("64");
  const [height, setHeight] = useState("64");
  const [colorMode, setColorMode] = useState<"rgba" | "indexed">("rgba");
  const [transparentIndex, setTransparentIndex] = useState("0");
  const [maxPaletteSize, setMaxPaletteSize] = useState("256");
  const w = Number(width),
    h = Number(height);
  const valid =
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 1 &&
    h >= 1 &&
    w <= MAX_CANVAS_DIMENSION &&
    h <= MAX_CANVAS_DIMENSION &&
    w * h * (colorMode === "rgba" ? 4 : 1) <= MAX_SURFACE_BYTES &&
    Number.isInteger(Number(transparentIndex)) && Number(transparentIndex) >= 0 && Number(transparentIndex) < Number(maxPaletteSize) &&
    Number.isInteger(Number(maxPaletteSize)) && Number(maxPaletteSize) >= 2 && Number(maxPaletteSize) <= 256;
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid) onCreate(name.trim() || t("document.defaultName"), w, h, colorMode, Number(transparentIndex), Number(maxPaletteSize));
  }
  return (
    <Dialog
      title={t("new.title")}
      closeLabel={t("dialog.close")}
      onClose={onClose}
      className="form-dialog"
    >
      <form onSubmit={submit}>
        <label>
          {t("new.name")}
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="field-row">
          <label>
            {t("new.width")}
            <input
              inputMode="numeric"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <label>
            {t("new.height")}
            <input
              inputMode="numeric"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
        </div>
        <label>
          {t("new.colorMode")}
          <select value={colorMode} onChange={(event) => setColorMode(event.target.value as "rgba" | "indexed")}>
            <option value="rgba">{t("colorMode.rgba")}</option>
            <option value="indexed">{t("colorMode.indexed")}</option>
          </select>
        </label>
        {colorMode === "indexed" ? (
          <div className="field-row">
            <label>{t("indexed.transparentIndex")}<input type="number" min="0" max="255" value={transparentIndex} onChange={(event) => setTransparentIndex(event.target.value)} /></label>
            <label>{t("indexed.maxPaletteSize")}<input type="number" min="2" max="256" value={maxPaletteSize} onChange={(event) => setMaxPaletteSize(event.target.value)} /></label>
          </div>
        ) : <p className="form-hint">{t("new.rgbaTransparent")}</p>}
        {!valid && (
          <p className="inline-error" role="alert">
            {t("new.invalidSize")}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button type="submit" disabled={!valid} data-testid="create-document">
            {t("action.create")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
