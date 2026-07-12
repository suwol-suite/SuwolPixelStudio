import type { Rgba } from "@suwol/editor-core";

const key = (color: readonly number[]): string => color.join(",");

export function recordRecentColor(
  current: readonly Rgba[],
  color: Rgba,
  limit = 12,
): readonly Rgba[] {
  const seen = new Set<string>();
  return [color, ...current]
    .filter((entry) => {
      const value = key(entry);
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function selectRecentColor(
  current: readonly Rgba[],
  color: Rgba,
): Readonly<{ foreground: Rgba; recentColors: readonly Rgba[] }> {
  return { foreground: color, recentColors: current };
}
