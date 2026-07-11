import { useMemo, useState, type KeyboardEvent } from "react";
import type { CommandRegistry } from "@suwol/command-system";
import type { DitheringMethod, IndexedConversionOptions, QuantizationMethod } from "@suwol/editor-core";
import type { CompatibilityReport } from "@suwol/file-format";
import { findKeybindingConflicts, keybindingWarnings, normalizeShortcut, resolveKeybindingConflict, type BrushPresetSetting, type KeybindingSettings, type WorkspaceLayout } from "@suwol/shared";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

interface CommonProps { readonly t: Translate; readonly onClose: () => void; }

export function IndexedConversionDialog({ t, onClose, onApply }: CommonProps & Readonly<{ onApply(options: IndexedConversionOptions): void }>) {
  const [maxColors, setMaxColors] = useState(256),
    [transparentIndex, setTransparentIndex] = useState(0),
    [alphaThreshold, setAlphaThreshold] = useState(1),
    [quantization, setQuantization] = useState<QuantizationMethod>("median-cut"),
    [dithering, setDithering] = useState<DitheringMethod>("none"),
    valid = maxColors >= 2 && maxColors <= 256 && transparentIndex >= 0 && transparentIndex < maxColors && alphaThreshold >= 0 && alphaThreshold <= 255;
  return <Dialog title={t("indexed.convertTitle")} closeLabel={t("dialog.close")} onClose={onClose} className="form-dialog professional-dialog">
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onApply({ maxColors, transparentIndex, alphaThreshold, quantization, dithering }); }}>
      <div className="field-row">
        <label>{t("indexed.maxPaletteSize")}<input type="number" min="2" max="256" value={maxColors} onChange={(event) => setMaxColors(Number(event.target.value))} /></label>
        <label>{t("indexed.transparentIndex")}<input type="number" min="0" max="255" value={transparentIndex} onChange={(event) => setTransparentIndex(Number(event.target.value))} /></label>
      </div>
      <label>{t("indexed.alphaThreshold")}<input type="range" min="0" max="255" value={alphaThreshold} onChange={(event) => setAlphaThreshold(Number(event.target.value))} /> {alphaThreshold}</label>
      <label>{t("indexed.quantization")}<select value={quantization} onChange={(event) => setQuantization(event.target.value as QuantizationMethod)}><option value="exact">Exact Palette</option><option value="median-cut">{t("indexed.medianCut")}</option><option value="k-means">Deterministic K-Means</option></select></label>
      <label>{t("indexed.dithering")}<select value={dithering} onChange={(event) => setDithering(event.target.value as DitheringMethod)}><option value="none">None</option><option value="floyd-steinberg">{t("indexed.floydSteinberg")}</option><option value="ordered-bayer-4x4">{t("indexed.ordered")}</option></select></label>
      <p className="form-hint">{t("indexed.partialAlphaPolicy")}</p>
      <footer><button type="button" onClick={onClose}>{t("action.cancel")}</button><button type="submit" disabled={!valid}>{t("indexed.convert")}</button></footer>
    </form>
  </Dialog>;
}

interface LayoutManagerProps extends CommonProps {
  readonly layouts: readonly WorkspaceLayout[]; readonly activeId: string;
  readonly onActive: (id: string) => void; readonly onSave: (name: string) => void;
  readonly onDuplicate: (id: string) => void; readonly onDelete: (id: string) => void;
  readonly onImport: () => void; readonly onExport: (id: string) => void;
}
export function LayoutManagerDialog({ t, layouts, activeId, onActive, onSave, onDuplicate, onDelete, onImport, onExport, onClose }: LayoutManagerProps) {
  const [name, setName] = useState("");
  return <Dialog title={t("layout.title")} closeLabel={t("dialog.close")} onClose={onClose} className="professional-dialog">
    <div className="dialog-body"><label>{t("layout.name")}<input value={name} onChange={(event) => setName(event.target.value)} /></label><button type="button" onClick={() => { onSave(name); setName(""); }}>{t("layout.save")}</button>
      <div className="manager-list" role="listbox">{layouts.map((layout) => <div className={layout.id === activeId ? "manager-row active" : "manager-row"} key={layout.id}><button type="button" aria-pressed={layout.id === activeId} onClick={() => onActive(layout.id)}>{layout.name}</button><button type="button" onClick={() => onDuplicate(layout.id)}>{t("layout.duplicate")}</button><button type="button" onClick={() => onExport(layout.id)}>{t("layout.export")}</button><button type="button" disabled={layouts.length <= 1} onClick={() => onDelete(layout.id)}>{t("layout.delete")}</button></div>)}</div>
    </div><footer><button type="button" onClick={onImport}>{t("layout.import")}</button><button type="button" onClick={onClose}>{t("dialog.close")}</button></footer>
  </Dialog>;
}

interface KeybindingEditorProps extends CommonProps { readonly registry: CommandRegistry; readonly settings: KeybindingSettings; readonly onChange: (settings: KeybindingSettings) => void; readonly onImport: () => void; readonly onExport: () => void; }
export function KeybindingEditorDialog({ t, registry, settings, onChange, onImport, onExport, onClose }: KeybindingEditorProps) {
  const [search, setSearch] = useState(""), [recording, setRecording] = useState<string | null>(null), [pending, setPending] = useState<Readonly<{ commandId: string; shortcut: string }> | null>(null),
    commands = useMemo(() => registry.getAll().filter((command) => `${command.id} ${command.titleKey}`.toLowerCase().includes(search.toLowerCase())), [registry, search, settings]), conflicts = findKeybindingConflicts(settings);
  function record(event: KeyboardEvent<HTMLInputElement>, commandId: string) {
    event.preventDefault(); if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const parts = [event.ctrlKey ? "Ctrl" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.key].filter(Boolean), shortcut = normalizeShortcut(parts.join("+"));
    if (shortcut === "") return;
    const warnings = keybindingWarnings(shortcut, "canvas"), conflict = settings.entries.some((entry) => entry.commandId !== commandId && entry.context === "canvas" && entry.shortcuts.includes(shortcut));
    if (conflict || warnings.length > 0) setPending({ commandId, shortcut }); else onChange(resolveKeybindingConflict(settings, commandId, shortcut, "canvas", "replace"));
    setRecording(null);
  }
  return <Dialog title={t("keybindings.title")} closeLabel={t("dialog.close")} onClose={onClose} className="professional-dialog keybinding-dialog">
    <div className="dialog-body"><label>{t("keybindings.search")}<input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} /></label><p aria-live="polite">{conflicts.length} {t("keybindings.conflict")}</p>
      <div className="keybinding-list">{commands.map((command) => { const entry = settings.entries.find((item) => item.commandId === command.id); return <div className="keybinding-row" key={command.id}><span>{command.titleKey}</span><code>{entry?.shortcuts.join(", ") ?? command.defaultKeybindings?.join(", ") ?? "—"}</code>{recording === command.id ? <input aria-label={t("keybindings.recorderHelp")} onKeyDown={(event) => record(event, command.id)} onBlur={() => setRecording(null)} autoFocus readOnly /> : <button type="button" onClick={() => setRecording(command.id)}>{t("keybindings.record")}</button>}<button type="button" onClick={() => onChange({ ...settings, entries: settings.entries.filter((item) => item.commandId !== command.id) })}>{t("keybindings.remove")}</button></div>; })}</div>
      {pending !== null && <div className="conflict-box" role="alert"><p>{t("keybindings.conflict")}: {pending.shortcut}</p>{keybindingWarnings(pending.shortcut, "canvas").map((warning) => <p key={warning}>{warning}</p>)}<button type="button" onClick={() => { onChange(resolveKeybindingConflict(settings, pending.commandId, pending.shortcut, "canvas", "remove-existing")); setPending(null); }}>{t("keybindings.replace")}</button><button type="button" onClick={() => setPending(null)}>{t("action.cancel")}</button></div>}
    </div><footer><button type="button" onClick={onImport}>{t("keybindings.import")}</button><button type="button" onClick={onExport}>{t("keybindings.export")}</button><button type="button" onClick={onClose}>{t("dialog.close")}</button></footer>
  </Dialog>;
}

interface BrushManagerProps extends CommonProps { readonly presets: readonly BrushPresetSetting[]; readonly activeId: string | null; readonly onSelect: (id: string) => void; readonly onDuplicate: (id: string) => void; readonly onDelete: (id: string) => void; readonly onRotate: (id: string) => void; readonly onFlipX: (id: string) => void; readonly onFlipY: (id: string) => void; }
export function BrushPresetManagerDialog({ t, presets, activeId, onSelect, onDuplicate, onDelete, onRotate, onFlipX, onFlipY, onClose }: BrushManagerProps) {
  return <Dialog title={t("brush.manage")} closeLabel={t("dialog.close")} onClose={onClose} className="professional-dialog"><div className="dialog-body manager-list" role="listbox" aria-label={t("brush.preset")}>{presets.length === 0 ? <p>{t("brush.empty")}</p> : presets.map((preset) => <div className={preset.id === activeId ? "manager-row active" : "manager-row"} key={preset.id}><button type="button" role="option" aria-selected={preset.id === activeId} onClick={() => onSelect(preset.id)}>{preset.name} · {preset.width}×{preset.height}</button><button type="button" onClick={() => onRotate(preset.id)}>↻ 90°</button><button type="button" onClick={() => onFlipX(preset.id)}>↔</button><button type="button" onClick={() => onFlipY(preset.id)}>↕</button><button type="button" onClick={() => onDuplicate(preset.id)}>{t("layout.duplicate")}</button><button type="button" onClick={() => onDelete(preset.id)}>{t("layout.delete")}</button></div>)}</div><footer><button type="button" onClick={onClose}>{t("dialog.close")}</button></footer></Dialog>;
}

export function AsepriteCompatibilityDialog({ t, report, onClose }: CommonProps & Readonly<{ report: CompatibilityReport }>) {
  const groups = [
    [t("aseprite.imported"), report.imported],
    [t("aseprite.converted"), report.converted],
    [t("aseprite.approximated"), report.approximated],
    [t("aseprite.unsupported"), report.unsupported],
    [t("aseprite.warnings"), report.lossWarnings],
  ] as const;
  return <Dialog title={t("aseprite.reportTitle")} closeLabel={t("dialog.close")} onClose={onClose} className="professional-dialog compatibility-report"><div className="dialog-body"><dl><div><dt>{t("frame.title")}</dt><dd>{report.original.frames} → {report.result.frames}</dd></div><div><dt>{t("panel.layers")}</dt><dd>{report.original.layers} → {report.result.layers}</dd></div></dl>{groups.map(([title, items]) => <section key={title}><h4>{title}</h4>{items.length === 0 ? <p>{t("plugin.none")}</p> : <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}</div><footer><button type="button" onClick={onClose}>{t("dialog.close")}</button></footer></Dialog>;
}
