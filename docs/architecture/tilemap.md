# Tilemap

TileSets reference a color-mode-compatible atlas image and declare tile size, count, columns, margin, spacing, and empty tile. Tilemap Cels reference a `tile32` image with dimensions in tiles.

Each little-endian `Uint32` cell uses bits 0–27 for `tileId + 1` (`0` is empty), bit 28 for horizontal flip, bit 29 for vertical flip, and bit 30 for diagonal flip; bit 31 is reserved and must be zero. Rendering scans only the visible tile range. Generic JSON export sorts IDs and emits deterministic cell integers.
