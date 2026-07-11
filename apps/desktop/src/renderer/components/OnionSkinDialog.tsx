import { useState } from "react";
import type { OnionSkinSettings, Rgba } from "@suwol/editor-core";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

function colorHex(color: Rgba | null, fallback: string): string {
  if (color === null) return fallback;
  return `#${color
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}
function hexColor(value: string): Rgba {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255,
  ];
}

export function OnionSkinDialog({
  initial,
  t,
  onClose,
  onApply,
}: {
  readonly initial: OnionSkinSettings;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly onApply: (settings: OnionSkinSettings) => void;
}) {
  const [previousFrames, setPreviousFrames] = useState(initial.previousFrames),
    [nextFrames, setNextFrames] = useState(initial.nextFrames),
    [previousOpacity, setPreviousOpacity] = useState(initial.previousOpacity),
    [nextOpacity, setNextOpacity] = useState(initial.nextOpacity),
    [previousTint, setPreviousTint] = useState(
      colorHex(initial.previousTint, "#ff6060"),
    ),
    [nextTint, setNextTint] = useState(
      colorHex(initial.nextTint, "#6090ff"),
    ),
    [previousTintEnabled, setPreviousTintEnabled] = useState(
      initial.previousTint !== null,
    ),
    [nextTintEnabled, setNextTintEnabled] = useState(
      initial.nextTint !== null,
    ),
    [source, setSource] = useState(initial.source);
  return (
    <Dialog
      title={t("animation.onionSettings")}
      closeLabel={t("action.cancel")}
      onClose={onClose}
      className="onion-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply({
            enabled: initial.enabled,
            previousFrames,
            nextFrames,
            previousOpacity,
            nextOpacity,
            previousTint: previousTintEnabled ? hexColor(previousTint) : null,
            nextTint: nextTintEnabled ? hexColor(nextTint) : null,
            source,
          });
        }}
      >
        <div className="dialog-body">
          <label>
            {t("animation.previousFrames")}
            <input
              type="number"
              min="0"
              max="10"
              value={previousFrames}
              onChange={(event) =>
                setPreviousFrames(
                  Math.min(10, Math.max(0, Number(event.target.value))),
                )
              }
            />
          </label>
          <label>
            {t("animation.nextFrames")}
            <input
              type="number"
              min="0"
              max="10"
              value={nextFrames}
              onChange={(event) =>
                setNextFrames(
                  Math.min(10, Math.max(0, Number(event.target.value))),
                )
              }
            />
          </label>
          <label>
            {t("animation.previousOpacity")}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={previousOpacity}
              onChange={(event) =>
                setPreviousOpacity(Number(event.target.value))
              }
            />
          </label>
          <label>
            {t("animation.nextOpacity")}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={nextOpacity}
              onChange={(event) => setNextOpacity(Number(event.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={previousTintEnabled}
              onChange={(event) => setPreviousTintEnabled(event.target.checked)}
            />
            {t("animation.previousFrames")} tint
            <input
              type="color"
              value={previousTint}
              disabled={!previousTintEnabled}
              onChange={(event) => setPreviousTint(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={nextTintEnabled}
              onChange={(event) => setNextTintEnabled(event.target.checked)}
            />
            {t("animation.nextFrames")} tint
            <input
              type="color"
              value={nextTint}
              disabled={!nextTintEnabled}
              onChange={(event) => setNextTint(event.target.value)}
            />
          </label>
          <label>
            {t("animation.source")}
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as OnionSkinSettings["source"])
              }
            >
              <option value="composite">{t("animation.composite")}</option>
              <option value="activeLayer">{t("animation.activeLayer")}</option>
            </select>
          </label>
        </div>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button type="submit">{t("action.apply")}</button>
        </footer>
      </form>
    </Dialog>
  );
}
