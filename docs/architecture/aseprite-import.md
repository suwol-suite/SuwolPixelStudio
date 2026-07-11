# Aseprite import

The importer is an independent bounded binary parser; no Aseprite code is copied. It checks file, frame, chunk, decompression, layer, Cel, palette, tag, and slice limits before allocation. Supported data includes RGBA/indexed sprites, groups, raw/zlib/linked Cels, opacity, supported blends, tags, slices, and 9-slice centers.

Unsupported or approximated features are reported in a separate compatibility report. Import creates a new v4 document and never mutates another document's history. Partial results are discarded on failure or cancellation.
