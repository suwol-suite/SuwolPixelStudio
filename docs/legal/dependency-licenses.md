# Dependency license audit

M6 audits the installed production graph with `pnpm licenses list --prod --json` and locks the expected direct/transitive runtime set with `pnpm license:check`. The reviewed set is `fast-png` 8.0.0, `iobuffer` 6.0.1, `fflate` 0.8.3, React/React DOM 19.2.7, `scheduler` 0.27.0, and Zod 4.4.3; all report MIT.

Electron retains its upstream license and Chromium notices inside the packaged runtime. The Forge configuration additionally places the project `LICENSE` and `THIRD_PARTY_NOTICES.md` in `resources/`. No font package is bundled. The application mark and icon paths are project-owned. GIF/APNG codecs, quantization, blend formulas, and the bounded Aseprite reader are independent project implementations.

The Linux build toolchain uses `@reforged/maker-appimage` 5.2.0 under ISC. It is a development dependency, while the emitted AppImage contains the official MIT-licensed AppImage type-2 runtime and its documented musl, libfuse, squashfuse, libzstd, and zlib components. Their attribution is recorded in `THIRD_PARTY_NOTICES.md`; production JavaScript dependency auditing remains the seven-package set above.

Dependency changes require exact versions, a fresh production-license report, `pnpm audit --prod`, notice updates, and review for copyleft, source-offer, attribution, patent, trademark, and binary redistribution obligations.
