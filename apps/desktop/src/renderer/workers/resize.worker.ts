/// <reference lib="webworker" />
import {
  anchorOffset,
  canvasResizeRgba,
  resizeNearestRgba,
  type ResizeAnchor,
  type Rgba,
} from "@suwol/editor-core";

type ResizeJob =
  | Readonly<{
      kind: "canvas";
      anchor: ResizeAnchor;
      fill: Rgba;
    }>
  | Readonly<{ kind: "sprite" }>;
type StartMessage = Readonly<{
  type: "start";
  jobId: string;
  revision: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  images: readonly (readonly [string, ArrayBuffer])[];
  job: ResizeJob;
}>;

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<unknown>) => {
  const input = parseStart(event.data);
  if (input === null) {
    worker.postMessage({ type: "error", jobId: "", code: "INVALID_INPUT" });
    return;
  }
  try {
    const offset =
        input.job.kind === "canvas"
          ? anchorOffset(
              input.job.anchor,
              input.sourceWidth,
              input.sourceHeight,
              input.width,
              input.height,
            )
          : null,
      results: { imageId: string; data: ArrayBuffer }[] = [];
    input.images.forEach(([imageId, buffer], index) => {
      const source = new Uint8Array(buffer),
        bytes =
          input.job.kind === "canvas" && offset !== null
            ? canvasResizeRgba(
                source,
                input.sourceWidth,
                input.sourceHeight,
                input.width,
                input.height,
                offset.x,
                offset.y,
                input.job.fill,
              )
            : resizeNearestRgba(
                source,
                input.sourceWidth,
                input.sourceHeight,
                input.width,
                input.height,
              ),
        data = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      results.push({ imageId, data });
      worker.postMessage({
        type: "progress",
        jobId: input.jobId,
        completed: index + 1,
        total: input.images.length,
      });
    });
    worker.postMessage(
      {
        type: "result",
        jobId: input.jobId,
        revision: input.revision,
        width: input.width,
        height: input.height,
        images: results,
      },
      results.map((result) => result.data),
    );
  } catch {
    worker.postMessage({ type: "error", jobId: input.jobId, code: "RESIZE_FAILED" });
  }
};

function parseStart(value: unknown): StartMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<StartMessage>;
  if (
    input.type !== "start" ||
    typeof input.jobId !== "string" ||
    !Number.isInteger(input.revision) ||
    !Number.isInteger(input.sourceWidth) ||
    !Number.isInteger(input.sourceHeight) ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    !Array.isArray(input.images) ||
    input.job === undefined
  )
    return null;
  return input as StartMessage;
}

export {};
