import {
  computeFloodFillBytes,
  type FloodFillComputation,
  type Rgba,
} from "@suwol/editor-core";

interface FillWorkerInput {
  readonly bytes: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly color: Rgba;
  readonly revision: number;
}
interface FillWorkerOutput {
  readonly revision: number;
  readonly result: FloodFillComputation | null;
}
interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: FillWorkerOutput, transfer: Transferable[]): void;
}
const port = globalThis as unknown as WorkerPort;
port.onmessage = (event) => {
  const value = event.data;
  if (!isInput(value)) {
    port.postMessage({ revision: -1, result: null }, []);
    return;
  }
  const result = computeFloodFillBytes(
    new Uint8Array(value.bytes),
    value.width,
    value.height,
    { x: value.x, y: value.y },
    value.color,
  );
  port.postMessage(
    { revision: value.revision, result },
    result === null ? [] : [result.pixels.buffer],
  );
};
function isInput(value: unknown): value is FillWorkerInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>,
    color = input.color;
  return (
    input.bytes instanceof ArrayBuffer &&
    Number.isInteger(input.width) &&
    Number.isInteger(input.height) &&
    Number.isInteger(input.x) &&
    Number.isInteger(input.y) &&
    Number.isInteger(input.revision) &&
    Array.isArray(color) &&
    color.length === 4 &&
    color.every((channel) => typeof channel === "number")
  );
}
