import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("development renderer security", () => {
  it("allows the Vite React Refresh preamble only in development", () => {
    const source = readFileSync("apps/desktop/src/main/security.ts", "utf8"),
      production = source.slice(
        source.indexOf("const PRODUCTION_CSP"),
        source.indexOf("const DEVELOPMENT_CSP"),
      ),
      development = source.slice(
        source.indexOf("const DEVELOPMENT_CSP"),
        source.indexOf("export function configureSessionSecurity"),
      );

    expect(production).toContain('"script-src \'self\'"');
    expect(production).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(development).toContain(
      '"script-src \'self\' \'unsafe-inline\'"',
    );
  });
});
