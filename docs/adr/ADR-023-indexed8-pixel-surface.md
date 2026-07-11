# ADR-023: Indexed8 PixelSurface

Status: Accepted

Indexed documents store one byte per pixel and resolve RGBA through the document palette. This avoids duplicating RGBA data, keeps slot identity authoritative, and makes buffer validation exact. Display and export may materialize RGBA temporarily.
