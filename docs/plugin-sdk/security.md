# Security model

Plugin code runs in a Node-free Chromium module Worker at an opaque, expiring custom origin. Panels run cross-origin in a sandboxed iframe. CSP and bootstrap restrictions block direct fetch, XHR, WebSocket, EventSource, Node, Electron, host preload, DOM, canvas, and GPU access.

Capabilities are async, permission-gated, schema-validated, time/size/rate-limited, and cancellable. File access uses bytes and opaque dialogs, network access uses an exact-host proxy with redirect and private-address checks, and document writes are host-owned transactions. Do not request or store secrets that the host has no credential vault to protect.
