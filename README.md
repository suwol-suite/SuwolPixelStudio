# Suwol Pixel Studio

Suwol Pixel Studio is a byte-exact desktop pixel editor built with Electron, React, and TypeScript. The current implementation is **v1.0.1 / Stable — Real-World Blocker Fix Release**.

## v1.0.1 focus

- One CSS-pixel coordinate pipeline for every canvas tool across zoom, pan, UI scale, Dock, Timeline, and DPR changes
- Top-left row-major PNG import, document save/reopen, WebGL2, Canvas2D, and PNG export orientation parity
- Explicit WebGL unpack-state reset with a single screen-space Y-axis policy
- Recoverable renderer boot failures with workspace reset, plugin-disabled restart, and persistent logs
- A document-tab-only top strip and a minimal New/Open empty state
- Packaged E2E coverage for exact pointer positions and asymmetric image round-trips

## M5 editing highlights

- RGBA and indexed-color documents with deterministic Exact, Median Cut, and K-means quantization; None, Floyd–Steinberg, and Bayer 4×4 dithering
- Stable palette-slot semantics, lossless palette reorder/remap, GPL/JASC/HEX/JSON interchange, usage analysis, duplicate merge, and unused-color removal
- Nested isolated groups and 11 CPU-reference blend modes shared by canvas, exports, thumbnails, onion skin, and recovery previews
- Compact custom brush masks, transforms, spacing, pixel-perfect strokes, and horizontal/vertical symmetry
- Document TileSets, `Uint32` tilemap Cels, tile tools, generic JSON export, slices, and 9-slice centers
- Independent bounded `.ase`/`.aseprite` parser with a compatibility report
- Plugin API 1.1 importers, exporters, interactive tools, and declarative overlays under capability and memory limits
- Versioned dock layouts and editable, conflict-checked keybindings
- `.suwolpixel` v4 with sequential v1 → v2 → v3 → v4 migration and recovery support

M1–M4 editing, animation, export, recovery, and Plugin API 1.0 compatibility remain supported.

## Development and verification

Node.js 22.13+ and pnpm 11+ are required.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm benchmark
pnpm plugin:validate
pnpm plugin:pack
pnpm license:check
pnpm audit --prod
pnpm package
pnpm package:smoke
pnpm workflow:check
pnpm make
```

`pnpm make` emits only the makers supported by the current host: unsigned ZIP on Windows, ZIP and AppImage on Linux, and ZIP/DMG on macOS. Windows never generates Setup.exe, Squirrel, NUPKG, or MSI artifacts. Release workflows additionally run `release:prepare`, `release:validate`, and `release:checksums` under an exact version-tag contract.

## Architecture

```text
apps/desktop/          Electron boundary, renderer UI, recovery, plugin runtime
packages/editor-core/  v4 model, indexed surfaces, groups/blends, brushes, tilemaps
packages/file-format/  v1–v4 archive, PNG/animation export, Aseprite import
packages/plugin-api/   public Plugin API 1.1 schemas and contracts
packages/plugin-host/  archive validation, permissions, brokers, sandbox policy
packages/shared/       IPC, settings, dock layouts, and keybindings
plugins/               API 1.0 compatibility and API 1.1 sample plugins
docs/                  architecture, file-format, ADR, and plugin SDK references
tests/e2e/             packaged Electron scenarios
```

## Security and distribution policy

The renderer has no Node integration. Files cross a typed preload boundary as opaque handles and validated byte buffers; raw paths and generic raw IPC are not exposed. Plugins run without Node, direct filesystem, host DOM/GPU, or unrestricted network access. Importer/exporter/tool/overlay results are schema-validated and budgeted by the host.

Plugins remain unsigned, so installation displays an explicit warning. Windows distribution remains an unsigned ZIP. Linux checksums are GPG-signed, and macOS release artifacts require Developer ID signing, notarization, and stapling before upload.

## Scope

v1.0.1 does not add collaboration, AI generation, marketplace/plugin signing infrastructure, scripting languages, vector editing, native floating panels, or external-engine-specific tilemap exporters.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
