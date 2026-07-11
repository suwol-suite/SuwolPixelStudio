# Indexed color

Indexed documents store one palette slot per pixel in `IndexedPixelSurface`; RGBA is resolved only for display or export. The document owns one palette of 1–256 stable entries and one transparent index. Every Pixel image and TileSet atlas matches the document color mode. Bounds, byte lengths, palette indices, and transparent-index consistency are validated before state is accepted or saved.

Conversion is deterministic. Exact colors are retained when possible; Median Cut and seeded K-means cover larger inputs. Alpha below the selected threshold maps to transparency. None, Floyd–Steinberg, and Bayer 4×4 dithering share the same nearest-color policy. A completed conversion is committed as one snapshot command, while cancellation or failure leaves the source revision unchanged.
