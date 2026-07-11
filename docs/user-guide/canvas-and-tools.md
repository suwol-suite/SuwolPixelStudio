# Canvas and tools

Pencil, Eraser, Eyedropper, Fill, Line, Rectangle, Ellipse, Selection, and Move operate on the active editable Pixel Layer. Pan with Space-drag or the middle button; zoom keeps the pointer's document coordinate fixed. Pixel-perfect and symmetry options affect new strokes only.

Selection is view state. Copy places transparent pixels outside the selection into a tight payload; OS clipboard exchange uses PNG. Paste creates a floating selection: Enter commits it as one undo step and Escape cancels it. Canvas Resize preserves pixel size, while Sprite Resize uses deterministic nearest-neighbor mapping.
