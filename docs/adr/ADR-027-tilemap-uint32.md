# ADR-027: Tilemap Uint32 encoding

Status: Accepted

Tile cells use a fixed little-endian `Uint32`: 28 bits for tile identity plus empty sentinel, three flip bits, and one reserved bit. Central encode/decode functions prevent format drift and permit compact deterministic archives.
