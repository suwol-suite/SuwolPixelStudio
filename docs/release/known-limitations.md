# Known limitations

- Release version is 0.6.0-rc.4; 1.0.0, tag, and public stable release require a separate decision.
- Windows artifacts are unsigned ZIP files and may trigger reputation warnings.
- The portable Windows ZIP cannot register a `.suwolpixel` file icon or shell association without an installer/registry mutation; both remain intentionally disabled.
- macOS signing, notarization, stapling, and Gatekeeper verification depend on secrets and must be confirmed on CI output.
- Linux AppImage packaging is configured for the Linux release runner but has no automatic updater; ZIP and AppImage remain manual downloads.
- Plugins are unsigned and have no marketplace or native-module capability.
- Aseprite tilemap content is reported but not imported; review Compatibility Reports.
- Indexed TileSet import requires explicit compatible palette conversion/remapping.
- Dock layout data supports tab-tree persistence and panel moves, but arbitrary free-floating native windows are outside M6.
