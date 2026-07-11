# Panels

Panel HTML, JS and CSS live under `dist/panel/` and must not contain inline script or eval. The host embeds the cross-origin package frame with `allow-scripts allow-same-origin` and a network-denying CSP; popup, form and top-navigation permissions remain absent. Wait for `suwol-panel:init`, take the transferred port, and communicate with the main plugin through messages.

Panels cannot see the host DOM, preload or CSS. They receive only messages and safe theme/language information as the host protocol evolves.
