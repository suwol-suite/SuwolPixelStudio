# Commands

Declare commands in `contributes.commands`, optionally require an active document, then register exactly that ID during activation. Add declared IDs to allowlisted menu locations through `contributes.menus`.

Handlers are async and cancellable through the progress API. Runtime stop disposes every registration. A plugin cannot replace built-in or another plugin command.
