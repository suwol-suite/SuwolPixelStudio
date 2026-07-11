# Interactive tools

Declare a tool and `ui.tool`. The host sends normalized pointer/key events in document coordinates. The plugin returns declarative pixel operations only; it receives no DOM, canvas, GPU, Electron, or raw file access. Operations are buffered for the stroke and committed by the host as one transaction on pointer-up. Cancellation and timeout discard the buffer.
