# Packaging

A `.suwolplugin` is ZIP with `manifest.json`, `dist/main.js`, optional `dist/panel/`, icons, README and LICENSE. Validation rejects traversal, absolute/drive/UNC paths, symlinks, duplicate names, missing entries, unsupported roots and archive bombs.

Limits: 2,000 files, 20MB per file, 100MB expanded, 1,000:1 compression ratio. Installation extracts to staging, validates completely, backs up an existing version, atomically renames, and restores the backup on failure.
