import type { LanguageMode } from "./settings";

export type ResolvedLanguage = "ko" | "en";

export function detectSystemLanguage(
  languages: readonly string[],
): ResolvedLanguage {
  const preferred = languages[0]?.toLocaleLowerCase("en-US") ?? "";
  return preferred === "ko" || preferred.startsWith("ko-") ? "ko" : "en";
}

export function resolveLanguage(
  mode: LanguageMode,
  languages: readonly string[],
): ResolvedLanguage {
  return mode === "auto" ? detectSystemLanguage(languages) : mode;
}
