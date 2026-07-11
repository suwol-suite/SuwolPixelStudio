# Palette remapping

Palette entry identity is its stable ID, not its array position. A reorder builds an old-index → new-index table and rewrites every indexed image in one transaction, preserving appearance across every frame and linked Cel. Changing or deleting a used color requires an explicit mapping; silent visual changes are forbidden.

Import accepts bounded GPL, JASC-PAL, plain HEX, and versioned Suwol JSON. Export is deterministic. Sorts, duplicate merge, compact, reverse, and unused removal operate through the same remap primitive.
