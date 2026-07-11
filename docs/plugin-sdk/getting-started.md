# Getting started

Copy `plugins/example-command`, `plugins/example-panel-network`, or the API 1.1 `plugins/example-professional` sample. Choose a lowercase reverse-domain ID, declare API/app ranges, permissions and contributions, then export async `activate(context)` and optional `deactivate()` from `src/main.js`.

Run `pnpm plugin:validate` and `pnpm plugin:pack`. Install the resulting `.suwolplugin` through Plugin Manager and approve its permissions. Source folders are never executed directly.

The SDK documentation and bundled samples are provided under the repository's [Apache License 2.0](../../LICENSE). A third-party plugin may declare its own compatible license and must retain all notices required by its dependencies.
