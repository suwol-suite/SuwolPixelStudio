import { describe, expect, it } from "vitest";
import {
  createRecoveryMetadata,
  isolateRecoveryEntries,
  recoveryMetadataSchema,
} from "./recovery";

describe("recovery metadata", () => {
  it("creates validated revision metadata", () => {
    expect(
      createRecoveryMetadata("document-1", "Untitled", null, 4, 123),
    ).toEqual({
      documentId: "document-1",
      displayName: "Untitled",
      originalHandleId: null,
      originalDisplayName: null,
      revision: 4,
      timestamp: 123,
      lastSavedTimestamp: null,
      width: 1,
      height: 1,
    });
  });
  it("rejects invalid recovery metadata", () => {
    expect(
      recoveryMetadataSchema.safeParse({
        documentId: "",
        displayName: "",
        revision: -1,
      }).success,
    ).toBe(false);
  });
  it("isolates corrupt records without blocking valid recovery", () => {
    const valid = createRecoveryMetadata(
      "document-1",
      "Untitled",
      null,
      1,
      123,
    );
    expect(isolateRecoveryEntries([valid, { bad: true }, null])).toEqual({
      valid: [valid],
      corrupt: 2,
    });
  });
});
