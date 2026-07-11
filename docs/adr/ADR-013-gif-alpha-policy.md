# ADR-013: Explicit GIF alpha loss policy

Status: Accepted

GIF output uses a deterministic fixed 256-color palette. Pixels at or below the chosen alpha threshold use transparent index 0; other partially transparent pixels are composited onto the selected opaque background before quantization. This is predictable and reproducible but cannot preserve partial alpha. APNG is the recommended alpha-preserving animation format. Hidden implicit dithering was rejected for M3.
