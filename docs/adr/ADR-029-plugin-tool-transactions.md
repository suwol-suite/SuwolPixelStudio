# ADR-029: Plugin interactive tool transactions

Status: Accepted

Plugin tools return declarative operations. The host buffers a stroke and owns the single history commit; cancel, crash, timeout, or invalid output discards all buffered changes. Plugins receive no mutable document or DOM/GPU handle.
