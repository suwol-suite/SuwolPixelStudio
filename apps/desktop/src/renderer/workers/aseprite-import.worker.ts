/// <reference lib="webworker" />
import { importAseprite, type CompatibilityReport } from "@suwol/file-format";
import type { PixelDocument } from "@suwol/editor-core";

interface StartMessage {
  readonly type: "start";
  readonly jobId: string;
  readonly name: string;
  readonly bytes: ArrayBuffer;
}
export interface AsepriteWorkerResult {
  readonly model: PixelDocument;
  readonly images: readonly (readonly [string, ArrayBuffer])[];
  readonly tilemaps: readonly (readonly [string, ArrayBuffer])[];
  readonly report: CompatibilityReport;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<unknown>) => {
  const input = parseStart(event.data);
  if (input === null) {
    worker.postMessage({ type: "error", jobId: "", code: "INVALID_INPUT" });
    return;
  }
  try {
    const imported = importAseprite(new Uint8Array(input.bytes), {
        name: input.name,
        onProgress: (completed, total) => {
          worker.postMessage({ type: "progress", jobId: input.jobId, completed, total });
        },
      }),
      images: (readonly [string, ArrayBuffer])[] = [...imported.snapshot.images].map(([id, bytes]) => {
        const copy = bytes.slice();
        return [id, copy.buffer] as const;
      }),
      sourceTilemaps = imported.snapshot.tilemaps ?? new Map<string, Uint32Array>(),
      tilemaps: (readonly [string, ArrayBuffer])[] = [...sourceTilemaps].map(([id, cells]) => [
        id,
        cells.slice().buffer,
      ] as const),
      result: AsepriteWorkerResult = {
        model: imported.snapshot.model,
        images,
        tilemaps,
        report: imported.report,
      },
      transfer: Transferable[] = [
        ...images.map(([, bytes]) => bytes),
        ...tilemaps.map(([, bytes]) => bytes),
      ];
    worker.postMessage({ type: "result", jobId: input.jobId, result }, transfer);
  } catch {
    worker.postMessage({ type: "error", jobId: input.jobId, code: "IMPORT_FAILED" });
  }
};

function parseStart(value: unknown): StartMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<StartMessage>;
  return input.type === "start" &&
    typeof input.jobId === "string" &&
    typeof input.name === "string" &&
    input.bytes instanceof ArrayBuffer
    ? input as StartMessage
    : null;
}

export {};
