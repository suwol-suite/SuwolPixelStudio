import {
  PLUGIN_LIMITS,
  rpcRequestSchema,
  type PluginRpcRequest,
} from "@suwol/plugin-api";
import { PluginError } from "./errors";

export class SlidingWindowRateLimiter {
  readonly #timestamps: number[] = [];
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  accept(now = Date.now()): boolean {
    while (this.#timestamps[0] !== undefined && this.#timestamps[0] <= now - this.windowMs)
      this.#timestamps.shift();
    if (this.#timestamps.length >= this.limit) return false;
    this.#timestamps.push(now);
    return true;
  }
}

export class PluginRequestGate {
  readonly #rate = new SlidingWindowRateLimiter(PLUGIN_LIMITS.requestsPerSecond, 1_000);
  readonly #active = new Set<string>();

  enter(input: unknown): PluginRpcRequest {
    let encodedBytes: number;
    try {
      encodedBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    } catch {
      throw new PluginError("MESSAGE_INVALID", "Plugin message is not serializable.");
    }
    if (encodedBytes > PLUGIN_LIMITS.messageBytes)
      throw new PluginError("MESSAGE_TOO_LARGE", "Plugin message exceeds the size limit.");
    const parsed = rpcRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new PluginError("MESSAGE_INVALID", "Plugin message schema is invalid.");
    if (!this.#rate.accept())
      throw new PluginError("RATE_LIMITED", "Plugin request rate exceeded.");
    if (this.#active.size >= PLUGIN_LIMITS.maxConcurrentRequests)
      throw new PluginError("RATE_LIMITED", "Plugin has too many concurrent requests.");
    if (this.#active.has(parsed.data.requestId))
      throw new PluginError("MESSAGE_INVALID", "Plugin request id is already active.");
    this.#active.add(parsed.data.requestId);
    return parsed.data;
  }

  leave(requestId: string): void {
    this.#active.delete(requestId);
  }

  clear(): void {
    this.#active.clear();
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new PluginError("REQUEST_TIMEOUT", "Plugin request timed out.")),
      timeoutMs,
    );
    const abort = () => reject(new DOMException("Operation cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); reject(error instanceof Error ? error : new Error("Plugin operation failed.")); },
    );
  });
}
