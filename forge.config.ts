import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const prepareDmgNativeDependencies = (): void => {
  if (process.platform !== "darwin") return;

  const dependencies = [
    ["macos-alias", "volume.node"],
    ["fs-xattr", "xattr.node"],
  ] as const;
  const nodeGyp = join(process.cwd(), "node_modules", "@electron", "node-gyp", "bin", "node-gyp.js");

  for (const [packageName, binaryName] of dependencies) {
    const packageDirectory = join(process.cwd(), "node_modules", packageName);
    if (existsSync(join(packageDirectory, "build", "Release", binaryName))) continue;
    try {
      execFileSync(process.execPath, [nodeGyp, "rebuild", "--directory", packageDirectory], {
        stdio: "pipe",
      });
    } catch {
      throw new Error(`Failed to build ${packageName}, required by the macOS DMG maker.`);
    }
  }
};

const macSigningIdentity = process.env.MACOS_SIGNING_IDENTITY;
const macKeychain = process.env.MACOS_KEYCHAIN;
const notarization =
  process.env.APPLE_ID !== undefined &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD !== undefined &&
  process.env.APPLE_TEAM_ID !== undefined
    ? {
        tool: "notarytool" as const,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "apps/desktop/assets/icon",
    executableName: "SuwolPixelStudio",
    appBundleId: "studio.suwol.pixel",
    appCategoryType: "public.app-category.graphics-design",
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: "Suwol Pixel Studio Document",
          CFBundleTypeRole: "Editor",
          CFBundleTypeIconFile: "electron.icns",
          LSHandlerRank: "Owner",
          LSItemContentTypes: ["studio.suwol.pixel.document"],
        },
      ],
      UTExportedTypeDeclarations: [
        {
          UTTypeIdentifier: "studio.suwol.pixel.document",
          UTTypeDescription: "Suwol Pixel Studio Document",
          UTTypeConformsTo: ["public.data"],
          UTTypeTagSpecification: {
            "public.filename-extension": ["suwolpixel"],
            "public.mime-type": "application/x-suwol-pixel-studio",
          },
        },
      ],
    },
    extraResource: [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "apps/desktop/assets/linux/suwol-pixel-studio.desktop",
      "apps/desktop/assets/linux/studio.suwol.pixel.xml",
      "apps/desktop/assets/linux/studio.suwol.pixel.png",
      "apps/desktop/assets/linux/application-x-suwol-pixel-studio.png",
    ],
    ...(macSigningIdentity === undefined
      ? {}
      : {
          osxSign: {
            identity: macSigningIdentity,
            ...(macKeychain === undefined ? {} : { keychain: macKeychain }),
            optionsForFile: () => ({
              hardenedRuntime: true,
              entitlements: "apps/desktop/assets/entitlements.mac.plist",
            }),
          },
        }),
    ...(notarization === undefined ? {} : { osxNotarize: notarization }),
  },
  rebuildConfig: {},
  hooks: {
    preMake: async () => {
      await Promise.resolve();
      prepareDmgNativeDependencies();
    },
  },
  makers: [
    new MakerZIP({}, ["win32", "darwin", "linux"]),
    ...(process.platform === "linux"
      ? [
          {
            name: "@reforged/maker-appimage",
            platforms: ["linux" as const],
            config: {
              options: {
                name: "suwol-pixel-studio",
                productName: "Suwol Pixel Studio",
                bin: "SuwolPixelStudio",
                icon: "apps/desktop/assets/linux/studio.suwol.pixel.png",
                categories: ["Graphics"],
                mimeType: [
                  "application/x-suwol-pixel-studio",
                  "image/png",
                ],
                compressor: "xz",
                ...(process.env.APPIMAGE_RUNTIME === undefined
                  ? {}
                  : { runtime: process.env.APPIMAGE_RUNTIME }),
              },
            },
          },
        ]
      : []),
    new MakerDMG(
      {
        format: "ULFO",
        overwrite: true,
      },
      ["darwin"],
    ),
  ],
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
