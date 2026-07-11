# Suwol Pixel Studio

Suwol Pixel Studio is a byte-exact desktop pixel editor built with Electron, React, and TypeScript. The current implementation is **v0.5.0 / M5 — Professional Editing**.

## M5 highlights

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

Node.js 22.12+ and pnpm 11+ are required.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm benchmark
pnpm plugin:validate
pnpm plugin:pack
pnpm audit --prod
pnpm package
pnpm make
```

`pnpm make` is intentionally configured for unsigned Windows ZIP output only. It does not generate Setup.exe or NUPKG artifacts.

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

Plugins remain unsigned in M5, so installation displays an explicit warning. The release workflow produces only an unsigned Windows ZIP until a future signing policy is introduced.

## Scope

M5 does not include collaboration, AI generation, marketplace/signing infrastructure, scripting languages, vector editing, or external-engine-specific tilemap exporters.
