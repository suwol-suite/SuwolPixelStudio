# ADR-024: Stable palette index remapping

Status: Accepted

Palette entries have stable IDs. Reordering or removing slots must atomically remap every indexed image; array positions are never treated as durable identity. This preserves or explicitly changes appearance with undoable, deterministic semantics.
