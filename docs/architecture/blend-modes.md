# Blend modes

M5 supports normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, addition, subtract, and difference. `blend.ts` is the straight-alpha CPU reference. Composition converts to premultiplied form only for the alpha operation and returns canonical straight RGBA.

Canvas rendering, PNG/animation export, thumbnails, onion skin, and recovery previews consume the same compositor so blend behavior does not depend on browser `globalCompositeOperation` support.
