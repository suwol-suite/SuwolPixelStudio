import {
  EditorSession,
  compositeFrame,
  compositeOnionSkin,
  timelineVisibleRange,
  validateDocumentIntegrity,
} from "../packages/editor-core/src/index";
import {
  encodeApngAnimation,
  encodeGifAnimation,
  exportSpriteSheet,
  renderAnimationFrames,
} from "../packages/file-format/src/index";

interface BenchmarkResult {
  readonly name: string;
  readonly milliseconds: number;
  readonly heapDelta: number;
  readonly output?: number;
}

function measure(name: string, operation: () => number): BenchmarkResult {
  const before = process.memoryUsage().heapUsed,
    start = performance.now(),
    output = operation();
  return {
    name,
    milliseconds: Number((performance.now() - start).toFixed(2)),
    heapDelta: process.memoryUsage().heapUsed - before,
    output,
  };
}

function animation(frameCount: number, width = 64, height = 64): EditorSession {
  const session = EditorSession.create({ name: "benchmark", width, height, layerName: "Layer 1" }),
    first = session.model.frameOrder[0];
  if (first === undefined) throw new Error("Missing initial frame.");
  const surface = session.getActiveSurface(session.model.layerOrder[0] ?? "");
  surface?.setPixel(0, 0, [255, 0, 0, 255]);
  for (let index = 1; index < frameCount; index += 1)
    session.addFrame(session.model.frameOrder.at(-1), "independent");
  session.setActiveFrame(first);
  return session;
}

const hundredFrames = animation(100),
  exportFrames = animation(120),
  renderedFrames = renderAnimationFrames(exportFrames.snapshot()),
  results: BenchmarkResult[] = [];

results.push(
  measure("100 frame sequential composite", () => {
    let bytes = 0;
    for (const frameId of hundredFrames.model.frameOrder)
      bytes += compositeFrame(hundredFrames, frameId).byteLength;
    return bytes;
  }),
  measure("500 frame timeline visible range", () => {
    let visible = 0;
    for (let scroll = 0; scroll < 500 * 64; scroll += 64)
      visible += timelineVisibleRange(500, scroll, 1024, 64, 3).end;
    return visible;
  }),
  measure("onion skin 3+3 composite", () => {
    const target = hundredFrames.model.frameOrder[50];
    if (target === undefined) throw new Error("Missing onion target.");
    return compositeOnionSkin(hundredFrames, target, {
      enabled: true,
      previousFrames: 3,
      nextFrames: 3,
      previousOpacity: 0.3,
      nextOpacity: 0.3,
      previousTint: [255, 80, 80, 255],
      nextTint: [80, 160, 255, 255],
      source: "composite",
    }).byteLength;
  }),
  measure("120 frame sprite sheet packing", () =>
    exportSpriteSheet(exportFrames.snapshot(), {
      layout: "grid",
      columns: 12,
      spacing: 1,
      padding: 1,
      imageName: "benchmark",
      includeJson: true,
    }).png.byteLength,
  ),
  measure("120 frame GIF encode", () =>
    encodeGifAnimation(renderedFrames, 64, 64, {
      loopCount: 0,
      scale: 1,
      transparentThreshold: 0,
      background: [255, 255, 255, 255],
    }).byteLength,
  ),
  measure("120 frame APNG encode", () =>
    encodeApngAnimation(renderedFrames, 64, 64, { loopCount: 0, scale: 1 }).byteLength,
  ),
  measure("20 layer frame duplicate", () => {
    const session = animation(1);
    for (let index = 1; index < 20; index += 1) session.addLayer(`Layer ${index + 1}`);
    return session.addFrame(session.activeFrameId, "independent").length;
  }),
  measure("500 linked cel reference validation", () => {
    const session = animation(1),
      first = session.activeFrameId;
    for (let index = 1; index < 500; index += 1)
      session.addFrame(session.model.frameOrder.at(-1), "linked");
    session.setActiveFrame(first);
    const result = validateDocumentIntegrity(session.model);
    if (!result.valid) throw new Error(result.errors.join("\n"));
    return Object.keys(session.model.cels).length;
  }),
);

console.log(JSON.stringify({ benchmark: "suwol-pixel-studio-m3", results }, null, 2));
