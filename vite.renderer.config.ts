import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __SUWOL_E2E__: JSON.stringify(process.env.SUWOL_E2E_BUILD === "1"),
  },
  root: "apps/desktop",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../.vite/renderer/main_window",
    sourcemap: true,
  },
});
