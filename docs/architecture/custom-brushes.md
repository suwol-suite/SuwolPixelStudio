# Custom brushes

Brush presets store a bounded bit mask as base64 plus width, height, origin, and spacing. Presets live in versioned Preferences rather than the document. Rotation and flips transform both mask and origin.

Stroke sampling stamps the mask at deterministic spacing. Pixel-perfect mode removes corner pixels only from the live stroke path; symmetry expands each stamp around workspace axes without writing axes into document pixels. A drag remains one undo transaction.
