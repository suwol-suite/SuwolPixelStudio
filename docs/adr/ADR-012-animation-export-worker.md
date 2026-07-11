# ADR-012: Encode animation in a Web Worker

Status: Accepted

Renderer snapshots the document, transfers image buffers to a Node-free Worker, and receives validated binary batch entries. Cancel terminates the Worker. Main only performs authorized atomic filesystem writes through an opaque directory handle. Encoding in Main was rejected because it would block the privileged process; encoding on the React thread was rejected because large GIF/APNG jobs would freeze input and playback.
