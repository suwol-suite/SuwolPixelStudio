# Third-Party Notices

Suwol Pixel Studio is licensed under Apache License 2.0. The following production dependencies are distributed with the application. Their copyright notices and license files remain available in their packages and in Electron's bundled license resources.

## Production dependencies

| Package | Version | License | Purpose |
| --- | ---: | --- | --- |
| `fast-png` | 8.0.0 | MIT | PNG encoding and decoding |
| `iobuffer` | 6.0.1 | MIT | Transitive binary buffer support for fast-png |
| `fflate` | 0.8.3 | MIT | ZIP, deflate, GIF/APNG data compression |
| `react` | 19.2.7 | MIT | Renderer user interface |
| `react-dom` | 19.2.7 | MIT | React DOM renderer |
| `scheduler` | 0.27.0 | MIT | Transitive React scheduling runtime |
| `zod` | 4.4.3 | MIT | Validation of IPC, files, settings, and plugins |

Electron 43.1.0 embeds Chromium and Node.js and ships its own `LICENSE`, `LICENSES.chromium.html`, and related notices in the packaged runtime. Those files are retained by Electron Packager.

Linux AppImage packaging uses `@reforged/maker-appimage` 5.2.0 under the ISC License. The resulting file prefixes the application image with the AppImage type-2 runtime under the MIT License. That runtime includes musl libc, libfuse, squashfuse, libzstd, and zlib code under their respective upstream notices and license terms; the authoritative attribution list is maintained in the AppImage type-2 runtime `LICENSE`.

## Project-owned implementations and assets

- GIF/APNG encoding, color quantization, palette remapping, blend formulas, and the Aseprite parser are independently implemented in this repository; no Aseprite source code is included.
- The application uses system fonts and does not bundle a font package.
- The application icon source, generated platform icon files, and UI SVG paths are project assets covered by the repository's Apache-2.0 license.
- Sample plugins under `plugins/` include the same Apache-2.0 license.

The audited production dependency set contains MIT and Apache-2.0-compatible terms only. Run `pnpm license:check` whenever production dependencies change.
