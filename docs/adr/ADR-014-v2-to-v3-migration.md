# ADR-014: Sequential v1 to v2 to v3 migration

Status: Accepted

Readers accept strict v1, v2, and v3 input, but legacy input always passes through the existing v1→v2 step before v2→v3. Each v2 Layer image becomes a Cel on one default Frame; IDs and RGBA bytes are preserved, Tags start empty, and refCount is recomputed. A direct v1→v3 shortcut was rejected because it would duplicate palette migration logic and create divergent compatibility behavior.
