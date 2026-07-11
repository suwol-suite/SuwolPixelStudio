import { makeId, normalizeRgba, type PaletteEntry, type Rgba } from "./types";

export type PaletteSort = "hue" | "saturation" | "value" | "luminance" | "usage";
export type PaletteFileFormat = "gpl" | "jasc" | "hex" | "suwol-json";

export function nearestPaletteIndex(
  color: Rgba,
  entries: readonly PaletteEntry[],
  transparentIndex: number | null,
): number {
  if (entries.length === 0) throw new Error("Palette is empty.");
  const normalized = normalizeRgba(color);
  if (normalized[3] === 0 && transparentIndex !== null) return transparentIndex;
  let best = entries[0]?.index ?? 0,
    bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (entry.index === transparentIndex && normalized[3] > 0) continue;
    const distance = rgbaDistance(normalized, entry.rgba);
    if (distance < bestDistance || (distance === bestDistance && entry.index < best)) {
      best = entry.index;
      bestDistance = distance;
    }
  }
  return best;
}

export function remapIndices(indices: Uint8Array, mapping: ReadonlyMap<number, number>): Uint8Array {
  const result = new Uint8Array(indices.length);
  for (let offset = 0; offset < indices.length; offset += 1) {
    const source = indices[offset] ?? 0,
      target = mapping.get(source);
    if (target === undefined || target < 0 || target > 255)
      throw new Error(`Palette remap is missing index ${source}.`);
    result[offset] = target;
  }
  return result;
}

/** Returns reordered entries and old->new index mapping while preserving RGBA appearance. */
export function reorderPalettePreservingAppearance(
  entries: readonly PaletteEntry[],
  orderedIds: readonly string[],
): Readonly<{ entries: PaletteEntry[]; mapping: ReadonlyMap<number, number> }> {
  if (orderedIds.length !== entries.length || new Set(orderedIds).size !== entries.length)
    throw new Error("Palette reorder must contain every slot exactly once.");
  const byId = new Map(entries.map((entry) => [entry.id, entry])),
    mapping = new Map<number, number>(),
    reordered = orderedIds.map((id, index) => {
      const entry = byId.get(id);
      if (entry === undefined) throw new Error("Palette reorder contains an unknown slot.");
      mapping.set(entry.index, index);
      return { ...entry, index, rgba: [...entry.rgba] as unknown as Rgba };
    });
  return { entries: reordered, mapping };
}

export function sortPalette(
  entries: readonly PaletteEntry[],
  sort: PaletteSort,
  usage: ReadonlyMap<number, number> = new Map(),
): PaletteEntry[] {
  return [...entries].sort((left, right) => {
    if (left.locked !== right.locked) return left.locked ? -1 : 1;
    const l = colorMetrics(left.rgba), r = colorMetrics(right.rgba);
    const delta = sort === "hue" ? l.hue - r.hue
      : sort === "saturation" ? l.saturation - r.saturation
        : sort === "value" ? l.value - r.value
          : sort === "luminance" ? l.luminance - r.luminance
            : (usage.get(right.index) ?? 0) - (usage.get(left.index) ?? 0);
    return delta || left.index - right.index;
  });
}

export function paletteUsage(buffers: readonly Uint8Array[]): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const buffer of buffers)
    for (const index of buffer) counts.set(index, (counts.get(index) ?? 0) + 1);
  return counts;
}

export function mergeDuplicatePaletteEntries(
  entries: readonly PaletteEntry[],
): Readonly<{ entries: PaletteEntry[]; mapping: ReadonlyMap<number, number> }> {
  const unique: PaletteEntry[] = [], mapping = new Map<number, number>(), byColor = new Map<string, number>();
  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    const key = entry.rgba.join(","), existing = byColor.get(key);
    if (existing !== undefined && !entry.locked) {
      mapping.set(entry.index, existing);
      continue;
    }
    const newIndex = unique.length;
    byColor.set(key, newIndex);
    mapping.set(entry.index, newIndex);
    unique.push({ ...entry, index: newIndex });
  }
  return { entries: unique, mapping };
}

export function removeUnusedPaletteEntries(
  entries: readonly PaletteEntry[],
  used: ReadonlySet<number>,
  transparentIndex: number | null,
): Readonly<{ entries: PaletteEntry[]; mapping: ReadonlyMap<number, number> }> {
  const kept = entries.filter((entry) => entry.locked === true || used.has(entry.index) || entry.index === transparentIndex);
  if (kept.length === 0 && entries[0] !== undefined) kept.push(entries[0]);
  const mapping = new Map<number, number>(), result = kept.map((entry, index) => {
    mapping.set(entry.index, index);
    return { ...entry, index };
  });
  for (const entry of entries)
    if (!mapping.has(entry.index))
      mapping.set(entry.index, nearestPaletteIndex(entry.rgba, result, transparentIndex === null ? null : mapping.get(transparentIndex) ?? 0));
  return { entries: result, mapping };
}

export function parsePaletteFile(bytes: Uint8Array, format: PaletteFileFormat): PaletteEntry[] {
  if (bytes.byteLength > 1024 * 1024) throw new Error("Palette file exceeds 1 MB.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), colors: Rgba[] = [];
  if (format === "gpl") {
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines[0]?.trim() !== "GIMP Palette") throw new Error("Invalid GIMP palette header.");
    for (const line of lines.slice(1)) {
      if (/^\s*(?:#|Name:|Columns:|$)/.test(line)) continue;
      const match = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/.exec(line);
      if (match === null) throw new Error("Malformed GIMP palette row.");
      colors.push(parseRgb(match.slice(1, 4)));
    }
  } else if (format === "jasc") {
    const lines = text.trim().replace(/\r/g, "").split("\n");
    if (lines[0] !== "JASC-PAL" || lines[1] !== "0100") throw new Error("Invalid JASC palette header.");
    const count = Number(lines[2]);
    if (!Number.isInteger(count) || count < 0 || count > 256 || lines.length !== count + 3)
      throw new Error("Invalid JASC palette count.");
    for (const line of lines.slice(3)) colors.push(parseRgb(line.trim().split(/\s+/)));
  } else if (format === "hex") {
    for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
      const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(token);
      if (match?.[1] === undefined) throw new Error("Malformed HEX palette color.");
      const hex = match[1], alpha = match[2] === undefined ? 255 : Number.parseInt(match[2], 16);
      colors.push([Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), alpha]);
    }
  } else {
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { throw new Error("Palette JSON is malformed."); }
    if (typeof value !== "object" || value === null || !("colors" in value) || !Array.isArray(value.colors))
      throw new Error("Palette JSON schema is invalid.");
    for (const color of value.colors) {
      if (!Array.isArray(color) || color.length !== 4 || !color.every((part) => Number.isInteger(part) && part >= 0 && part <= 255))
        throw new Error("Palette JSON contains an invalid color.");
      colors.push(color as unknown as Rgba);
    }
  }
  if (colors.length < 1 || colors.length > 256) throw new Error("Palette must contain 1 to 256 colors.");
  return colors.map((rgba, index) => ({ id: makeId("palette"), index, rgba: normalizeRgba(rgba) }));
}

export function exportPaletteFile(entries: readonly PaletteEntry[], format: PaletteFileFormat): Uint8Array {
  if (entries.length < 1 || entries.length > 256) throw new Error("Palette must contain 1 to 256 colors.");
  const ordered = [...entries].sort((a, b) => a.index - b.index);
  const text = format === "gpl"
    ? `GIMP Palette\nName: Suwol Palette\nColumns: 16\n${ordered.map((entry) => `${entry.rgba[0]} ${entry.rgba[1]} ${entry.rgba[2]} ${entry.name ?? ""}`.trim()).join("\n")}\n`
    : format === "jasc"
      ? `JASC-PAL\n0100\n${ordered.length}\n${ordered.map((entry) => entry.rgba.slice(0, 3).join(" ")).join("\n")}\n`
      : format === "hex"
        ? `${ordered.map((entry) => `#${entry.rgba.map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`).join("\n")}\n`
        : JSON.stringify({ schemaVersion: 1, colors: ordered.map((entry) => entry.rgba), names: ordered.map((entry) => entry.name ?? null) }, null, 2);
  return new TextEncoder().encode(text);
}

function parseRgb(parts: readonly string[]): Rgba {
  if (parts.length !== 3) throw new Error("Palette row must contain RGB components.");
  const values = parts.map(Number);
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255))
    throw new Error("Palette RGB component is invalid.");
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, 255];
}
function rgbaDistance(left: Rgba, right: Rgba): number {
  const dr = left[0] - right[0], dg = left[1] - right[1], db = left[2] - right[2], da = left[3] - right[3];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db + da * da;
}
function colorMetrics(color: Rgba): Readonly<{ hue: number; saturation: number; value: number; luminance: number }> {
  const r = color[0] / 255, g = color[1] / 255, b = color[2] / 255,
    max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation: max === 0 ? 0 : delta / max, value: max, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}
