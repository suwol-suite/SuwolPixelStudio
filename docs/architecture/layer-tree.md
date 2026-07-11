# Layer tree

`rootLayerIds` and each Group's `childIds` form the authoritative ordered tree. `parentId` is checked in both directions, and a transient flattened adapter supports older consumers. Reparenting rejects cycles, duplicate parents, unreachable layers, and non-Group parents.

Groups are isolated: children composite into a temporary RGBA buffer in tree order, then group opacity and blend mode are applied to the parent. Expand/collapse is workspace view state and is not serialized in the document.
