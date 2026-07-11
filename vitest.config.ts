import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/desktop/src/main/**/*.test.ts"],
    coverage: { enabled: false },
  },
});
