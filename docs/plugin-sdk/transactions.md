# Transactions

Every document write supplies the current document ID and revision, a short label, and a bounded declarative operation list. Temporary IDs may connect layers, frames, and Cels created in the same request. The host validates permissions, bounds, locks, formats, sizes, and references before committing one Undo/Redo entry.

Failure, cancellation, timeout, crash, plugin stop, or revision mismatch rolls back the complete operation. Interactive tools use the same rule for the entire pointer-down to pointer-up stroke; writes after pointer-up are rejected.
