# Plugin platform

M4 separates public contracts (`plugin-api`) from host policy (`plugin-host`). Main owns installation paths, permission persistence, storage files, network, logs and opaque runtime origins. Renderer owns the existing command registry, document capability broker and sandbox lifecycle. A plugin never receives a host object reference.

Activation is all-or-nothing: validate manifest, confirm every requested grant, allocate an opaque origin, start a module Worker, complete the API 1 handshake, then expose contributions. Stop/remove disposes commands, menus, panels, pending work and the MessagePort.
