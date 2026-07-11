# Keybindings

Keybindings are versioned settings keyed by the shared command ID. Chords are canonicalized across Ctrl/Command, displayed per platform, and never execute while focus is in a text input. Reserved OS shortcuts, unsafe unmodified characters, and Escape/Enter/Delete context conflicts produce warnings.

Import validates untrusted JSON. Conflict resolution can replace an existing binding or cancel without changing settings. The command palette searches core and plugin commands from the same registry.
