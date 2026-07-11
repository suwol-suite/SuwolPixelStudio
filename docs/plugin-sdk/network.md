# Network

Panel and Worker direct fetch are blocked. Use `context.network.request`. M4 supports GET, POST, PUT and DELETE. External endpoints require HTTPS and an exact hostname permission. HTTP is restricted to localhost, 127.0.0.1 and ::1.

Redirect targets and DNS results are rechecked, private-address rebinding is blocked, dangerous headers are removed, and response/timeout limits apply. M4 has no credential vault; do not persist API keys in JSON storage.
