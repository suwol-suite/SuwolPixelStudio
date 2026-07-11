# Manifest

`manifestVersion` is 1 and M6 supports Plugin API 1.0 and 1.1. IDs use lowercase letters, digits, dots and hyphens and must contain a reverse-domain separator. Every contribution ID must start with `<plugin-id>.`. Entries must exist under `dist/` in the archive.

API compatibility accepts the supported major and a requested minimum minor/patch. `engines.suwolPixelStudio` independently constrains the app version. Unknown manifest fields and contribution types are rejected.
