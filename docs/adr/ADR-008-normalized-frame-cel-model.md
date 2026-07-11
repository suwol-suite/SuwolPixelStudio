# ADR-008: Normalize Frame and Cel records

Status: Accepted

M3 stores Frame, Cel, and image as stable-ID records with explicit order/index maps. Embedding per-Frame pixel copies in Layer would make empty Cel, reordering, migration, and shared images ambiguous. The normalized model makes one Cel per Layer/Frame enforceable and keeps Timeline metadata independent from pixel buffers. The cost is stricter reference validation and migration, handled centrally by EditorSession and `validateDocumentIntegrity`.
