# Plugin document transactions

Document reads return copied metadata and transferable RGBA buffers. Reads from an empty Cel return transparent bytes without creating a Cel.

Writes are validated operation lists. The broker fixes document ID/revision, resolves temporary Layer/Frame IDs, validates bounds, locks and payload size, then calls `EditorSession.runTransaction`. Existing commands are batched into one host-owned `TransactionCommand` tagged with plugin metadata. Error, cancellation or validation failure undoes every applied command before history commit. Successful work is one Undo/Redo step and contains no runtime function reference.
