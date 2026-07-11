# Plugin sandbox

External code runs only in a Chromium module Worker loaded from `suwol-plugin://<uuid>/__runtime.js`. The origin maps to one installed package and expires with the runtime. Node integration, Electron, host preload and DOM are absent. CSP blocks direct connection; the bootstrap also replaces fetch and removes XHR, WebSocket and EventSource.

Panels use another document in the plugin-specific package origin inside `<iframe sandbox="allow-scripts allow-same-origin">`. `allow-same-origin` is required so Chromium can load that custom-origin document's external module script; the frame remains cross-origin from `suwol-pixel://app` and the protocol can serve only its own package. Popup, form submission and top-navigation capabilities are not granted. Host and panel exchange a transferred MessagePort only.
