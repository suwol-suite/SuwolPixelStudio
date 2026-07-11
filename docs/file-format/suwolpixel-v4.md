# `.suwolpixel` v4

The ZIP manifest declares schema version 4. `document.json` contains canvas color mode, stable palette entries, root/group layer tree, blend modes, pixel/tilemap Cels, TileSets, slices, metadata, and plugin-data references. Pixel payloads are `images/<id>.rgba` or `.idx`; tilemaps are little-endian `tilemaps/<id>.tile32`.

Readers enforce entry count, compressed/uncompressed budgets, safe names, JSON schemas, buffer lengths, palette bounds, tree cycles, references, slice bounds, and document integrity. Writers omit transitional adapters and validate before producing bytes. Loading migrates sequentially v1 → v2 → v3 → v4; older documents remain RGBA with Pixel layers, normal blends, and empty M5 collections.
