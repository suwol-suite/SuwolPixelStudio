# Plugin API 1.1

API 1.1 adds Importer, Exporter, Interactive Tool, and Declarative Overlay contributions while retaining the API 1.0 command, menu, panel, storage, network, and document contracts. Plugins must declare each contribution and matching permission. Registration IDs are namespaced and collision-checked.

All messages use the existing versioned protocol. The host validates unknown data, applies time and memory budgets, and owns document commits, file dialogs, output writes, drawing, and cancellation.
