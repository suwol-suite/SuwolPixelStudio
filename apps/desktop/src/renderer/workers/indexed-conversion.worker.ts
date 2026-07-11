/// <reference lib="webworker" />
import { convertRgbaToIndexed, type IndexedConversionOptions } from "@suwol/editor-core";

interface StartMessage {
  readonly type: "start";
  readonly jobId: string;
  readonly revision: number;
  readonly options: IndexedConversionOptions;
  readonly images: readonly (readonly [string, ArrayBuffer])[];
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<unknown>) => {
  const input = parseStart(event.data);
  if (input === null) { worker.postMessage({ type: "error", jobId: "", code: "INVALID_INPUT" }); return; }
  try {
    worker.postMessage({ type: "progress", jobId: input.jobId, completed: 0, total: 2 });
    const sources = input.images.map(([id, buffer]) => [id, new Uint8Array(buffer)] as const), total = sources.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
    if (total < 4 || total % 4 !== 0 || total > 256 * 1024 * 1024) throw new RangeError("Conversion input exceeds its memory budget.");
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const [, bytes] of sources) { if (bytes.byteLength % 4 !== 0) throw new RangeError("RGBA input length is invalid."); combined.set(bytes, offset); offset += bytes.byteLength; }
    const result = convertRgbaToIndexed(combined, combined.byteLength / 4, 1, input.options), outputs: (readonly [string, ArrayBuffer])[] = [];
    offset = 0;
    for (const [id, bytes] of sources) {
      const length = bytes.byteLength / 4, indices = result.indices.slice(offset, offset + length);
      outputs.push([id, indices.buffer]); offset += length;
    }
    worker.postMessage({ type: "progress", jobId: input.jobId, completed: 1, total: 2 });
    worker.postMessage({ type: "result", jobId: input.jobId, revision: input.revision, palette: result.palette, transparentIndex: result.transparentIndex, images: outputs }, outputs.map(([, buffer]) => buffer));
  } catch { worker.postMessage({ type: "error", jobId: input.jobId, code: "CONVERSION_FAILED" }); }
};

function parseStart(value: unknown): StartMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<StartMessage>;
  return input.type === "start" && typeof input.jobId === "string" && Number.isInteger(input.revision) && Array.isArray(input.images) && input.options !== undefined ? input as StartMessage : null;
}

export {};
