# API versioning

`manifestVersion` describes package metadata and remains 1. `apiVersion` describes capability contracts; M6 supports API 1.0 and 1.1 over protocol version 1. `engines.suwolPixelStudio` separately constrains application versions.

Use exact released plugin versions and semantic compatibility ranges such as `^1.0.0` or `^1.1.0`. Adding a permission or contribution in an update requires user review. Document data namespaces should carry their own schema version because plugin installation and document lifetime are independent.
