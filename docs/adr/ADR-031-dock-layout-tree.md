# ADR-031: Dock layout tree

Status: Accepted

The original recursive split/tab representation served arbitrary M5 layouts but encouraged every panel to remain visible. RC9 replaces it with layout schema v3: a fixed-width tool rail, an optional bottom Timeline, and explicit upper/lower right-Dock tab groups. This matches the supported desktop workspace while keeping resizing and tab placement deterministic.

Strict parsing bounds the right Dock to 220–720 px, the upper/lower ratio to 25–75%, and Timeline height to 112–420 px. A panel ID can occur only once. Empty groups normalize to `null`; unknown plugin panel IDs remain in place and render an unavailable placeholder until the plugin returns. Recursive schema v1/v2 named layouts migrate into v3, preserving right/bottom sizes and unknown IDs where possible.
