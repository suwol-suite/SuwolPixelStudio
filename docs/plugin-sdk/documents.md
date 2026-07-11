# Documents

Use `documents.getActive()` or `listOpen()` for copied summaries, then request info, layers, frames, selection, palette or RGBA pixels. Pixel buffers are transferable `ArrayBuffer`s and are bounded to 64MB per request.

All writes use a transaction request with the current document ID/revision, a short label and validated operations. Temporary IDs allow a new Layer/Frame to be targeted later in the same transaction. Never cache a document revision across unrelated user work.
