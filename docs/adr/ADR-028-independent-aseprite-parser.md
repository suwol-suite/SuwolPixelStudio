# ADR-028: Independent Aseprite parser

Status: Accepted

Import uses an independently written checked reader with explicit allocation and decompression budgets. Unsupported chunks become compatibility warnings, while malformed input aborts without exposing a partial document.
