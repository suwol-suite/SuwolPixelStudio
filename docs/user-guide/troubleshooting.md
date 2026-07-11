# Troubleshooting

- If the canvas is blank, verify layer visibility, lock state, active frame/Cel, and zoom-to-fit. Canvas2D fallback is used automatically when WebGL2 is unavailable.
- If a plugin crashes, enter Safe Mode, inspect its bounded logs, disable or remove it, then restart normally.
- If a file will not open, keep the original unchanged and check whether the format, size, palette index, archive, or Aseprite compatibility limit was rejected.
- If startup offers recovery, recover each useful item into a new dirty document before deleting it.
- About provides runtime versions, file-format and Plugin API versions, a log-folder action, and privacy-safe diagnostic text. Diagnostics exclude paths, document contents, pixels, keys, and plugin storage values.
