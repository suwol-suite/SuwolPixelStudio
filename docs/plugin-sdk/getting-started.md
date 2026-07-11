# Getting started

Copy one of `plugins/example-command` or `plugins/example-panel-network`. Choose a lowercase reverse-domain ID, declare API/app ranges, permissions and contributions, then export async `activate(context)` and optional `deactivate()` from `src/main.js`.

Run `pnpm plugin:validate` and `pnpm plugin:pack`. Install the resulting `.suwolplugin` through Plugin Manager and approve its permissions. Source folders are never executed directly.
