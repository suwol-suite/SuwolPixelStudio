# ADR-031: Dock layout tree

Status: Accepted

Dock state is a versioned recursive split/tab tree in Preferences. Strict parsing, bounded depth/node count, duplicate prevention, and unknown-panel placeholders allow safe import and plugin uninstall recovery.
