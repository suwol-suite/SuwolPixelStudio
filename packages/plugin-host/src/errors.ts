export type PluginErrorCode =
  | "PACKAGE_CORRUPT"
  | "PACKAGE_UNSAFE_PATH"
  | "PACKAGE_LIMIT_EXCEEDED"
  | "MANIFEST_INVALID"
  | "INCOMPATIBLE_API"
  | "INCOMPATIBLE_APP"
  | "PERMISSION_DENIED"
  | "MESSAGE_INVALID"
  | "MESSAGE_TOO_LARGE"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "TRANSACTION_FAILED"
  | "NETWORK_BLOCKED"
  | "STORAGE_INVALID"
  | "STORAGE_QUOTA"
  | "RUNTIME_CRASHED";

export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
    readonly detail?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = "PluginError";
  }
}
