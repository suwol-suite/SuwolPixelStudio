import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "SuwolPixelStudio",
    appBundleId: "studio.suwol.pixel",
    appCategoryType: "public.app-category.graphics-design",
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ["win32"])],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "apps/desktop/src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "apps/desktop/src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
