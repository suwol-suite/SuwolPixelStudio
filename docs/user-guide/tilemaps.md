# Tilemaps

Import a PNG TileSet into an RGBA document, then create a Tilemap Layer with dimensions in tiles. Tile Pencil, Eraser, Eyedropper, Fill, Selection, and Move operate on tile cells. Cells retain tile ID and flip/rotation flags in a fixed 32-bit encoding.

Generic tilemap JSON export is deterministic. A TileSet atlas, tile size, margin, spacing, and referenced Tilemap Cels are stored in `.suwolpixel` v4. External-engine-specific exporters are not included in M6.
