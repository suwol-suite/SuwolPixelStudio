# Layout system

Layouts are versioned recursive split/tab trees. Parsing treats imported JSON as unknown, validates ratios, panel IDs, duplicate placement, depth, and node count, and preserves unknown plugin panel IDs as unavailable placeholders. Missing core panels are recoverable through Reset Layout.

Named layouts are stored in Preferences and can be exported/imported without document data. Panel visibility, sizes, and tab selection are workspace UI state.
