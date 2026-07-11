# Permissions

Supported: `document.read`, `document.write`, `selection.read`, `palette.read`, `palette.write`, `ui.command`, `ui.menu`, `ui.panel`, `ui.notification`, `storage`, `file.import`, `file.export`, `ui.tool`, `ui.overlay`, `network:localhost`, and exact `network:<domain>`.

Unsupported: spawn/native modules, unrestricted filesystem, clipboard and wildcard network. New permissions in an update require approval. Removing or revoking a permission immediately removes the related runtime capability.
