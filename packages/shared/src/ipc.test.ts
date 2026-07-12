import { describe, expect, it } from "vitest";
import {
  appDiagnosticsSchema,
  applicationCommandIdSchema,
  commandStateSchema,
  fileHandleSchema,
  openDialogOptionsSchema,
  openExternalRequestSchema,
  parseExternalHttpsUrl,
  recoverySnapshotInfoSchema,
  isSafeExportRelativePath,
  saveDialogOptionsSchema,
  platformSchema,
} from "./ipc";

describe("IPC contracts", () => {
  it.each(["0.6.0", "0.6.0-rc.1", "0.6.0-beta.1", "0.6.0-alpha.1"])(
    "accepts supported application version %s",
    (version) => {
      expect(
        appDiagnosticsSchema.safeParse({
          productName: "Suwol Pixel Studio",
          version,
          electron: "43.1.0",
          chromium: "142.0.0.0",
          node: "22.12.0",
          platform: "darwin",
          architecture: "arm64",
          fileFormatVersion: 4,
          pluginApiVersion: "1.1.0",
          license: "Apache-2.0",
          repository: "https://github.com/suwol-suite/SuwolPixelStudio",
        }).success,
      ).toBe(true);
    },
  );

  it("accepts only supported application command ids", () => {
    expect(
      applicationCommandIdSchema.safeParse("view.commandPalette").success,
    ).toBe(true);
    expect(
      applicationCommandIdSchema.safeParse("plugin.runArbitrary").success,
    ).toBe(false);
  });

  it("validates platform responses", () => {
    expect(platformSchema.safeParse("win32").success).toBe(true);
    expect(platformSchema.safeParse("freebsd").success).toBe(false);
  });

  it("rejects extra IPC request fields", () => {
    expect(
      openExternalRequestSchema.safeParse({
        url: "https://example.com",
        channel: "raw",
      }).success,
    ).toBe(false);
  });

  it("validates opaque file handles and dialog options", () => {
    expect(
      fileHandleSchema.safeParse({
        id: "1389a10b-29c9-4d72-b50d-31aa62aeca89",
        displayName: "art.suwolpixel",
      }).success,
    ).toBe(true);
    expect(
      fileHandleSchema.safeParse({ id: "C:\\secret", displayName: "secret" })
        .success,
    ).toBe(false);
    expect(
      openDialogOptionsSchema.safeParse({ kind: "document" }).success,
    ).toBe(true);
    expect(
      saveDialogOptionsSchema.safeParse({ kind: "exe", suggestedName: "bad" })
        .success,
    ).toBe(false);
  });

  it("validates recovery metadata without accepting file paths", () => {
    const valid = {
      documentId: "document-abc",
      displayName: "Art",
      originalHandleId: null,
      originalDisplayName: null,
      revision: 2,
      timestamp: 123,
      lastSavedTimestamp: null,
      width: 64,
      height: 64,
      corrupt: false,
      thumbnail: null,
    };
    expect(recoverySnapshotInfoSchema.safeParse(valid).success).toBe(true);
    expect(
      recoverySnapshotInfoSchema.safeParse({
        ...valid,
        documentId: "../escape",
      }).success,
    ).toBe(false);
  });
  it("accepts only typed native command state updates", () => {
    expect(
      commandStateSchema.safeParse({
        "edit.copy": { enabled: true, checked: false },
        "sprite.canvasResize": false,
      }).success,
    ).toBe(true);
    expect(commandStateSchema.safeParse({ "shell.raw": true }).success).toBe(
      false,
    );
    expect(commandStateSchema.safeParse({ "window.togglePreview": { enabled: true, checked: true } }).success).toBe(true);
  });

  it("allows credential-free HTTPS URLs", () => {
    expect(
      parseExternalHttpsUrl({ url: "https://example.com/path?q=1" })?.hostname,
    ).toBe("example.com");
  });

  it.each([
    ["walk_0001.png", true],
    ["walk.json", true],
    ["walk.gif", true],
    ["../escape.png", false],
    ["folder/frame.png", false],
    ["folder\\frame.png", false],
    ["frame.apng", false],
    ["frame.png.exe", false],
    [".hidden.png", false],
  ] as const)("validates export relative path %s", (name, expected) => {
    expect(isSafeExportRelativePath(name)).toBe(expected);
  });

  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "not a URL",
  ])("rejects unsafe external URL %s", (url) => {
    expect(parseExternalHttpsUrl({ url })).toBeNull();
  });
});
