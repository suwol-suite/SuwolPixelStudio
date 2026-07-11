import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __SUWOL_E2E__: JSON.stringify(process.env.SUWOL_E2E_BUILD === "1"),
  },
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ["electron"],
      output: { entryFileNames: "main.js" },
    },
  },
});
