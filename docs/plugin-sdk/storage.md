# Storage

Declare `storage` and use the async storage capability for JSON-compatible preferences. Keys are bounded identifiers, dangerous prototype keys and cyclic/non-finite values are rejected, and each plugin namespace has a 5MB quota. Storage is separate from document plugin-data and is never included in diagnostic output.

Revocation removes the runtime capability immediately. Clear Storage is available in Plugin Manager; plugin removal may preserve or delete data according to the user's choice.
