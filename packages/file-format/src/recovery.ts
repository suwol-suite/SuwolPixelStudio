import { z } from "zod";

export const recoveryMetadataSchema = z
  .object({
    documentId: z.string().min(1),
    displayName: z.string().min(1).max(256),
    originalHandleId: z.string().nullable(),
    originalDisplayName: z.string().min(1).max(260).nullable(),
    revision: z.number().int().min(0),
    timestamp: z.number().int().positive(),
    lastSavedTimestamp: z.number().int().positive().nullable(),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
  })
  .strict();
export type RecoveryMetadata = z.infer<typeof recoveryMetadataSchema>;

export function createRecoveryMetadata(
  documentId: string,
  displayName: string,
  originalHandleId: string | null,
  revision: number,
  timestamp = Date.now(),
  options: Readonly<{
    originalDisplayName?: string | null;
    lastSavedTimestamp?: number | null;
    width?: number;
    height?: number;
  }> = {},
): RecoveryMetadata {
  return recoveryMetadataSchema.parse({
    documentId,
    displayName,
    originalHandleId,
    originalDisplayName: options.originalDisplayName ?? null,
    revision,
    timestamp,
    lastSavedTimestamp: options.lastSavedTimestamp ?? null,
    width: options.width ?? 1,
    height: options.height ?? 1,
  });
}

export function isolateRecoveryEntries(
  values: readonly unknown[],
): Readonly<{ valid: RecoveryMetadata[]; corrupt: number }> {
  const valid: RecoveryMetadata[] = [];
  let corrupt = 0;
  for (const value of values) {
    const parsed = recoveryMetadataSchema.safeParse(value);
    if (parsed.success) valid.push(parsed.data);
    else corrupt += 1;
  }
  return { valid, corrupt };
}
