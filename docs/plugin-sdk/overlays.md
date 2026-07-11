# Declarative overlays

Declare an overlay and `ui.overlay`. Plugins submit bounded lines, rectangles, points, text, or RGBA image primitives. The host validates count, coordinates, payload size, lifetime, and clipping, then renders them above the editor canvas. Overlays cannot read back pixels, access the DOM/GPU, or change the document.
