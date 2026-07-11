# Security checklist

- Confirm context isolation, Chromium sandbox, web security, disabled Node integration, disabled production DevTools, CSP, navigation/new-window/permission denial, and custom protocol path containment.
- Confirm preload exposes only typed APIs; no raw IPC, raw filesystem path, generic file API, secret, or production test API crosses the boundary.
- Re-run archive traversal, duplicate, expansion, blob length, palette, tree, linked-Cel, Aseprite bounds, plugin message size/rate, redirect, DNS/private-address, storage quota, rollback, and Safe Mode tests.
- Confirm plugin workers and panels have no Node/Electron/host DOM/GPU/direct network capability and are removed with MessagePorts, overlays, pending work, and strokes on stop.
- Run `pnpm audit --prod`, `pnpm license:check`, packaged E2E, workflow contract/YAML checks, and platform signature/checksum verification. Verify GPG signatures after both the core publication and final macOS checksum replacement. Record exceptions instead of suppressing them.
