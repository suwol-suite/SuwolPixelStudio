# Compatibility policy

The host retains Plugin API 1.0 command/menu/panel/document behavior and adds API 1.1 importers, exporters, tools, and overlays. A manifest requests a compatible major and minimum minor/patch; unknown major versions, app engine ranges, permissions, fields, or contributions are rejected.

Backward-compatible additions stay within major 1. Breaking schema, permission, protocol, or semantic changes require a new Plugin API major. Plugins should feature-detect contributions and avoid depending on undocumented bootstrap or panel details.
