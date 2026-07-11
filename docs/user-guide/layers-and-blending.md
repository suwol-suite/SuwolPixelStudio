# Layers and blending

Pixel, Tilemap, and Group layers form an ordered tree. Visibility, lock, opacity, parent, and blend mode are saved. Groups are isolated: children composite into an intermediate image before group opacity and blending are applied.

Supported blend modes are Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Addition, Subtract, and Difference. Merge or flatten changes document data and is undoable; expand/collapse is workspace state.
