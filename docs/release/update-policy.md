# Update policy

The default update channel is `stable`; metadata may add a `beta` channel later. M6 does not include an automatic installer. Windows unsigned ZIP receives notification-only release information. macOS and Linux also require manual download until a signed, platform-native updater is reviewed.

An update check failure must never block editing. No update flow may restart while any document is dirty; it must request save or explicit discard first. Download, signature verification, installation, rollback, and channel migration require a separate security design before activation.
