# Import and export

Open `.suwolpixel`, PNG, `.ase`, or `.aseprite`. Aseprite import is an independent bounded parser and displays a Compatibility Report for converted, approximated, ignored, or unsupported content. Review that report before production use.

Document Save writes `.suwolpixel` v4 atomically. PNG export uses the current frame composite. Animation export uses a Worker and an opaque destination-directory handle. Group, blend, indexed, tilemap, linked-Cel, and onion-skin rendering share CPU reference composition; cancellation never marks the document saved.
