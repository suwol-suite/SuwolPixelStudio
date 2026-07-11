export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(
  source: "main" | "renderer",
  development: boolean,
): Logger {
  const prefix = `[suwol:${source}]`;
  return Object.freeze({
    info(message: string) {
      if (development) console.info(prefix, message);
    },
    warn(message: string) {
      if (development) console.warn(prefix, message);
    },
    error(message: string) {
      console.error(prefix, message);
    },
  });
}
