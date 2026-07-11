# ADR-009: Share image IDs for Linked Cels

Status: Accepted

Linked Cels reference the same image ID and PixelSurface. Editing any link intentionally updates every referencing Frame. `refCount` is derived from Cel records after each command; unreachable images are collected. Unlink clones bytes into a new image and changes only the selected Cel in one undoable command. Copy-on-write during normal editing was rejected because it would silently break the user-visible linked contract.
