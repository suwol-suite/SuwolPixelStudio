import { BLEND_MODES, normalizeRgba, type BlendMode, type Rgba } from "./types";

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && BLEND_MODES.includes(value as BlendMode);
}

/** Reference straight-alpha compositor. Blend math is evaluated unpremultiplied. */
export function blendRgba(
  backdrop: Rgba,
  source: Rgba,
  mode: BlendMode,
  opacity = 1,
): Rgba {
  const sa = (source[3] / 255) * clamp01(opacity),
    ba = backdrop[3] / 255;
  if (sa <= 0) return backdrop;
  const outputAlpha = sa + ba * (1 - sa);
  if (outputAlpha <= 0) return [0, 0, 0, 0];
  const output = [0, 0, 0, Math.round(outputAlpha * 255)] as number[];
  for (let channel = 0; channel < 3; channel += 1) {
    const backdropChannel = (backdrop[channel] ?? 0) / 255,
      sourceChannel = (source[channel] ?? 0) / 255,
      blended = blendChannel(backdropChannel, sourceChannel, mode),
      premultiplied =
        (1 - sa) * ba * backdropChannel +
        (1 - ba) * sa * sourceChannel +
        ba * sa * blended;
    output[channel] = Math.round(clamp01(premultiplied / outputAlpha) * 255);
  }
  return normalizeRgba(output as unknown as Rgba);
}

export function blendPixelInto(
  target: Uint8Array,
  targetOffset: number,
  source: ArrayLike<number>,
  sourceOffset: number,
  mode: BlendMode,
  opacity = 1,
): void {
  const result = blendRgba(
    [
      target[targetOffset] ?? 0,
      target[targetOffset + 1] ?? 0,
      target[targetOffset + 2] ?? 0,
      target[targetOffset + 3] ?? 0,
    ],
    [
      source[sourceOffset] ?? 0,
      source[sourceOffset + 1] ?? 0,
      source[sourceOffset + 2] ?? 0,
      source[sourceOffset + 3] ?? 0,
    ],
    mode,
    opacity,
  );
  target.set(result, targetOffset);
}

export function blendChannel(backdrop: number, source: number, mode: BlendMode): number {
  const b = clamp01(backdrop), s = clamp01(source);
  switch (mode) {
    case "normal": return s;
    case "multiply": return b * s;
    case "screen": return b + s - b * s;
    case "overlay": return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case "darken": return Math.min(b, s);
    case "lighten": return Math.max(b, s);
    case "color-dodge": return s >= 1 ? 1 : Math.min(1, b / (1 - s));
    case "color-burn": return s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case "addition": return Math.min(1, b + s);
    case "subtract": return Math.max(0, b - s);
    case "difference": return Math.abs(b - s);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
