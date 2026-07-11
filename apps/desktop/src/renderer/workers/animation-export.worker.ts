/// <reference lib="webworker" />
import {
  animationFileStem,
  encodeApngAnimation,
  encodeGifAnimation,
  exportPngSequence,
  exportSpriteSheet,
  renderAnimationFrames,
  type ApngExportOptions,
  type GifExportOptions,
  type PngSequenceOptions,
  type SpriteSheetOptions,
} from "@suwol/file-format";
import type { DocumentSnapshot, PixelDocument } from "@suwol/editor-core";

type SnapshotPayload = Readonly<{
  model: PixelDocument;
  images: readonly (readonly [string, ArrayBuffer])[];
  tilemaps: readonly (readonly [string, ArrayBuffer])[];
}>;
export type AnimationExportJob =
  | Readonly<{ kind: "png-sequence"; options: PngSequenceOptions }>
  | Readonly<{ kind: "sprite-sheet"; options: SpriteSheetOptions }>
  | Readonly<{
      kind: "gif";
      fileName: string;
      frameIds?: readonly string[];
      options: GifExportOptions;
    }>
  | Readonly<{
      kind: "apng";
      fileName: string;
      frameIds?: readonly string[];
      options: ApngExportOptions;
    }>;
type StartMessage = Readonly<{
  type: "start";
  jobId: string;
  revision: number;
  snapshot: SnapshotPayload;
  job: AnimationExportJob;
}>;

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<unknown>) => {
  const input = parseStart(event.data);
  if (input === null) {
    worker.postMessage({ type: "error", jobId: "", code: "INVALID_INPUT" });
    return;
  }
  try {
    worker.postMessage({ type: "progress", jobId: input.jobId, completed: 0, total: 3 });
    const snapshot: DocumentSnapshot = {
      model: input.snapshot.model,
      images: new Map(
        input.snapshot.images.map(([id, buffer]) => [id, new Uint8Array(buffer)]),
      ),
      tilemaps: new Map(
        input.snapshot.tilemaps.map(([id, buffer]) => [id, new Uint32Array(buffer)]),
      ),
    };
    worker.postMessage({ type: "progress", jobId: input.jobId, completed: 1, total: 3 });
    const entries = runJob(snapshot, input.job);
    worker.postMessage({ type: "progress", jobId: input.jobId, completed: 2, total: 3 });
    const payload = entries.map((entry) => ({
      relativePath: entry.relativePath,
      data: entry.data.buffer.slice(
        entry.data.byteOffset,
        entry.data.byteOffset + entry.data.byteLength,
      ) as ArrayBuffer,
    }));
    worker.postMessage(
      {
        type: "result",
        jobId: input.jobId,
        revision: input.revision,
        entries: payload,
      },
      payload.map((entry) => entry.data),
    );
  } catch {
    worker.postMessage({ type: "error", jobId: input.jobId, code: "ENCODE_FAILED" });
  }
};

function runJob(snapshot: DocumentSnapshot, job: AnimationExportJob) {
  if (job.kind === "png-sequence") return exportPngSequence(snapshot, job.options);
  if (job.kind === "sprite-sheet") {
    const result = exportSpriteSheet(snapshot, job.options),
      stem = animationFileStem(job.options.imageName.replace(/\.png$/i, "")),
      entries = [{ relativePath: `${stem}.png`, data: result.png }];
    if (result.json !== null) entries.push({ relativePath: `${stem}.json`, data: result.json });
    return entries;
  }
  const frames = renderAnimationFrames(snapshot, job.frameIds);
  return [
    {
      relativePath: safeOutputName(job.fileName, job.kind === "gif" ? ".gif" : ".png"),
      data:
        job.kind === "gif"
          ? encodeGifAnimation(
              frames,
              snapshot.model.canvas.width,
              snapshot.model.canvas.height,
              job.options,
            )
          : encodeApngAnimation(
              frames,
              snapshot.model.canvas.width,
              snapshot.model.canvas.height,
              job.options,
            ),
    },
  ];
}

function parseStart(value: unknown): StartMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StartMessage>;
  if (
    candidate.type !== "start" ||
    typeof candidate.jobId !== "string" ||
    !Number.isInteger(candidate.revision) ||
    candidate.snapshot === undefined ||
    candidate.job === undefined
  )
    return null;
  return candidate as StartMessage;
}
function safeOutputName(name: string, extension: string): string {
  return `${animationFileStem(name.replace(/\.(?:gif|png)$/i, ""))}${extension}`;
}

export {};
