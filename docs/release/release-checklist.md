# Release checklist

1. Start from a clean, reviewed commit; confirm version consistency and frozen lockfile.
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm benchmark`, `pnpm plugin:validate`, `pnpm plugin:pack`, `pnpm license:check`, and `pnpm audit --prod`.
3. Run `pnpm package`, `pnpm package:smoke`, `pnpm workflow:check`, and platform packaging. Inspect ZIP roots, AppImage executable mode, executable launch, native icons, LICENSE, notices, metadata, and checksums.
4. Perform keyboard, Korean/English, Dark/Light, 200% scale, Canvas2D, recovery, import/export, and Plugin API 1.0/1.1 smoke passes.
5. Confirm `release-core.yml` publishes only Windows ZIP, Linux ZIP/AppImage, and the initial verified GPG checksum/signature. Confirm Windows requests no signing secret and produces no Setup.exe/NUPKG/MSI.
6. Confirm `release-macos.yml` never creates or deletes a Release, uploads only after app/DMG notarization, and replaces checksum/signature after downloading all five distribution assets. Exercise rerun and `--clobber` behavior on a disposable pre-release tag.
7. Record known limitations and benchmark deltas. Only then change to 1.0.0, create the reviewed tag, observe both workflows, and verify every final Release asset manually.
