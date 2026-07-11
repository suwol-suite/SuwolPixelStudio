# Importers

Declare an importer contribution and `file.import`. The host opens an opaque typed file, verifies size and extension, then passes bytes plus an abortable context. Return a declarative, schema-valid v4 document result and warnings. The host performs full integrity validation before creating a new document; failure creates nothing.
