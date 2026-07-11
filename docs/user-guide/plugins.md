# Plugins

Install `.suwolplugin` packages in Plugin Manager and review every requested permission. M6 plugins are unsigned. Commands, panels, importers, exporters, interactive tools, and overlays run through capability APIs; plugin code receives no Node, Electron, raw path, host DOM, or GPU object.

Safe Mode disables external runtimes while keeping Plugin Manager available. Revoking permissions or disabling a plugin stops its runtime and removes contributions, panels, overlays, pending requests, and active tool strokes. Remove untrusted packages and clear their storage from Plugin Manager.
