# Indexed color

Indexed documents store one palette index per pixel. Palette entries have stable IDs and indices; a transparent slot is explicit. Reorder, duplicate merge, unused-color removal, and import remap every indexed image atomically.

RGBA conversion offers Exact, Median Cut, or seeded K-means quantization and None, Floyd–Steinberg, or Bayer 4×4 dithering. Conversion runs in a Worker and commits only if the source revision is unchanged. Save a backup before reducing colors.
