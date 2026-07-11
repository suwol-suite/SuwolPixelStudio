# Plugin permissions

Permissions are exact strings validated from the manifest and stored by plugin ID/version. All M4 manifest permissions are activation requirements; partial approval installs the plugin disabled. Revocation stops the runtime before updating the grant record.

Network permissions are either `network:localhost` or `network:<exact-hostname>`. Wildcards, IP literals for external access and URL credentials are rejected. UI components display grants but policy decisions live in the host managers and brokers.
