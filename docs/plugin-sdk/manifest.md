# Manifest

`manifestVersion` is 1 and Plugin API is 1.0.0. IDs use lowercase letters, digits, dots and hyphens and must contain a reverse-domain separator. Command and panel IDs must start with `<plugin-id>.`. Entries must exist under `dist/` in the archive.

API compatibility accepts the supported major and a requested minimum minor/patch. `engines.suwolPixelStudio` independently constrains the app version. Unknown manifest fields and contribution types are rejected.
