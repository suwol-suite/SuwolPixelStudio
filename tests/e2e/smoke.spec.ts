import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { unzipSync } from "fflate";
import { decode, encode } from "fast-png";

function asymmetricPngFixture(): { readonly bytes: Uint8Array; readonly rgba: Uint8Array } {
  const width = 16,
    height = 16,
    rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      rgba.set([x * 13, y * 11, (x * 17 + y * 7) % 256, 255], (y * width + x) * 4);
  const mark = (x: number, y: number): void => rgba.set([0, 0, 0, 255], (y * width + x) * 4);
  for (let x = 5; x <= 9; x += 1) mark(x, 1);
  for (let y = 1; y <= 4; y += 1) mark(7, y);
  for (let y = 5; y <= 10; y += 1) mark(1, y);
  for (let x = 1; x <= 4; x += 1) mark(x, 10);
  mark(12, 6);
  rgba.set([255, 0, 0, 255], 0);
  rgba.set([0, 255, 0, 255], (width - 1) * 4);
  rgba.set([0, 0, 255, 255], (height - 1) * width * 4);
  rgba.set([255, 255, 0, 255], (width * height - 1) * 4);
  return {
    rgba,
    bytes: encode({ width, height, data: rgba, depth: 8, channels: 4 }),
  };
}

function findExecutable(directory: string): string | null {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findExecutable(candidate);
      if (nested !== null) return nested;
    } else if (
      (process.platform === "win32" && entry.name === "SuwolPixelStudio.exe") ||
      (process.platform !== "win32" && entry.name === "SuwolPixelStudio")
    )
      return candidate;
  }
  return null;
}
async function pixel(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const canvas = page.getByTestId("pixel-canvas"),
    box = await canvas.boundingBox(),
    viewport = await page.evaluate(
      () => window.suwolTest?.getViewport() ?? null,
    );
  if (box === null || viewport === null)
    throw new Error("Pixel viewport is unavailable.");
  return {
    x: box.x + viewport.panX + (x + 0.5) * viewport.zoom,
    y: box.y + viewport.panY + (y + 0.5) * viewport.zoom,
  };
}
async function dragPixels(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = await pixel(page, from.x, from.y),
    end = await pixel(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}
async function setHex(page: Page, value: string): Promise<void> {
  await page.locator('[data-dock-tab="palette"]').click();
  await page.getByLabel("A", { exact: true }).fill("255");
  const input = page.getByTestId("palette-hex");
  await input.fill(value);
  await input.press("Enter");
}
async function waitForWorkspace(
  app: Awaited<ReturnType<typeof electron.launch>>,
): Promise<Page> {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("renderer page error", error));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("renderer console error", message.text());
  });
  await page.waitForURL(/^suwol-pixel:\/\/app\/index\.html(?:\?.*)?$/);
  await expect(page.getByTestId("workspace-shell")).toBeVisible({
    timeout: 15_000,
  });
  return page;
}
async function executePalette(page: Page, query: string): Promise<void> {
  await page.evaluate(async () => window.suwolTest?.executeCommand("view.commandPalette"));
  const search = page.getByRole("searchbox");
  await search.fill(query);
  await search.press("Enter");
}
async function artifactBytes(page: Page, fileName: string): Promise<Uint8Array | null> {
  const values = await page.evaluate(async (name) => {
    const data = await window.suwolDesktop?.test?.readArtifact(name);
    return data === null || data === undefined ? null : [...new Uint8Array(data)];
  }, fileName);
  return values === null ? null : Uint8Array.from(values);
}

async function expectActivePixel(
  page: Page,
  x: number,
  y: number,
  expected: readonly number[],
): Promise<void> {
  await expect
    .poll(() => page.evaluate(([px, py]) => window.suwolTest?.getActivePixel(px, py) ?? null, [x, y] as const))
    .toEqual(expected);
}

async function expectRenderedPixel(
  page: Page,
  x: number,
  y: number,
  expected: readonly number[],
): Promise<void> {
  const host = page.getByTestId("pixel-canvas-host"),
    box = await host.boundingBox(),
    viewport = await page.evaluate(() => window.suwolTest?.getViewport() ?? null),
    pageSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (box === null || viewport === null)
    throw new Error("Rendered viewport is unavailable.");
  const overlay = page.getByTestId("pixel-canvas"),
    previousVisibility = await overlay.evaluate((element) => element.style.visibility);
  await overlay.evaluate((element) => { element.style.visibility = "hidden"; });
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot();
  } finally {
    await overlay.evaluate((element, visibility) => { element.style.visibility = visibility; }, previousVisibility);
  }
  const shot = decode(screenshot),
    scaleX = shot.width / pageSize.width,
    scaleY = shot.height / pageSize.height,
    sampleX = Math.max(0, Math.min(shot.width - 1, Math.floor((box.x + viewport.panX + (x + 0.5) * viewport.zoom) * scaleX))),
    sampleY = Math.max(0, Math.min(shot.height - 1, Math.floor((box.y + viewport.panY + (y + 0.5) * viewport.zoom) * scaleY))),
    offset = (sampleY * shot.width + sampleX) * shot.channels,
    actual = shot.channels === 4
      ? Array.from(shot.data.slice(offset, offset + 4))
      : [...shot.data.slice(offset, offset + 3), 255];
  expect(actual).toEqual(expected);
}

async function expectCanvas2dPixel(
  page: Page,
  x: number,
  y: number,
  expected: readonly number[],
): Promise<void> {
  await expect.poll(() => page.evaluate(([px, py]) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.pixel-canvas"),
      viewport = window.suwolTest?.getViewport(),
      context = canvas?.getContext("2d");
    if (canvas === null || viewport === null || viewport === undefined || context === null || context === undefined)
      return null;
    const scaleX = canvas.width / Math.max(1, canvas.clientWidth),
      scaleY = canvas.height / Math.max(1, canvas.clientHeight),
      sampleX = Math.max(0, Math.min(canvas.width - 1, Math.floor((viewport.panX + (px + 0.5) * viewport.zoom) * scaleX))),
      sampleY = Math.max(0, Math.min(canvas.height - 1, Math.floor((viewport.panY + (py + 0.5) * viewport.zoom) * scaleY)));
    return Array.from(context.getImageData(sampleX, sampleY, 1, 1).data);
  }, [x, y] as const)).toEqual(expected);
}

async function overlayPixelSet(page: Page, width: number, height: number): Promise<string[]> {
  return await page.evaluate(({ width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="pixel-canvas"]'),
      viewport = window.suwolTest?.getViewport();
    if (canvas === null || viewport === null || viewport === undefined) return [];
    const context = canvas.getContext("2d"),
      scaleX = canvas.width / Math.max(1, canvas.clientWidth),
      scaleY = canvas.height / Math.max(1, canvas.clientHeight),
      points: string[] = [];
    if (context === null) return points;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const sx = Math.max(0, Math.min(canvas.width - 1, Math.floor((viewport.panX + (x + 0.5) * viewport.zoom) * scaleX))),
          sy = Math.max(0, Math.min(canvas.height - 1, Math.floor((viewport.panY + (y + 0.5) * viewport.zoom) * scaleY)));
        if ((context.getImageData(sx, sy, 1, 1).data[3] ?? 0) > 20) points.push(`${x},${y}`);
      }
    return points.sort();
  }, { width, height });
}

async function nonTransparentPixelSet(page: Page, width: number, height: number): Promise<string[]> {
  return await page.evaluate(({ width, height }) => {
    const points: string[] = [];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        if ((window.suwolTest?.getActivePixel(x, y)?.[3] ?? 0) > 0) points.push(`${x},${y}`);
    return points.sort();
  }, { width, height });
}

function minimalAseprite(): Uint8Array {
  const layerPayload = new BinaryWriter(32);
  layerPayload.u16(1); layerPayload.u16(0); layerPayload.u16(0);
  layerPayload.skip(4); layerPayload.u16(0); layerPayload.u8(255);
  layerPayload.skip(3); layerPayload.string("Layer");
  const celPayload = new BinaryWriter(32);
  celPayload.u16(0); celPayload.i16(0); celPayload.i16(0); celPayload.u8(255);
  celPayload.u16(0); celPayload.skip(7); celPayload.u16(1); celPayload.u16(1);
  celPayload.bytes(Uint8Array.from([12, 34, 56, 255]));
  const chunk = (type: number, payload: Uint8Array) => {
    const writer = new BinaryWriter(payload.length + 6);
    writer.u32(payload.length + 6); writer.u16(type); writer.bytes(payload);
    return writer.output;
  };
  const chunks = [chunk(0x2004, layerPayload.used), chunk(0x2005, celPayload.used)],
    frameSize = 16 + chunks.reduce((sum, value) => sum + value.length, 0),
    frame = new BinaryWriter(frameSize);
  frame.u32(frameSize); frame.u16(0xf1fa); frame.u16(chunks.length);
  frame.u16(100); frame.u16(0); frame.u32(chunks.length);
  for (const value of chunks) frame.bytes(value);
  const output = new Uint8Array(128 + frameSize), view = new DataView(output.buffer);
  view.setUint32(0, output.length, true); view.setUint16(4, 0xa5e0, true);
  view.setUint16(6, 1, true); view.setUint16(8, 1, true); view.setUint16(10, 1, true);
  view.setUint16(12, 32, true); output.set(frame.output, 128);
  return output;
}

class BinaryWriter {
  readonly output: Uint8Array;
  readonly #view: DataView;
  offset = 0;
  constructor(size: number) { this.output = new Uint8Array(size); this.#view = new DataView(this.output.buffer); }
  get used(): Uint8Array { return this.output.slice(0, this.offset); }
  u8(value: number): void { this.output[this.offset++] = value; }
  u16(value: number): void { this.#view.setUint16(this.offset, value, true); this.offset += 2; }
  i16(value: number): void { this.#view.setInt16(this.offset, value, true); this.offset += 2; }
  u32(value: number): void { this.#view.setUint32(this.offset, value, true); this.offset += 4; }
  skip(length: number): void { this.offset += length; }
  bytes(value: Uint8Array): void { this.output.set(value, this.offset); this.offset += value.length; }
  string(value: string): void { const bytes = new TextEncoder().encode(value); this.u16(bytes.length); this.bytes(bytes); }
}

async function configurePluginPackage(page: Page, packagePath: string): Promise<void> {
  const bytes = [...fs.readFileSync(packagePath)];
  await page.evaluate(async ({ fileName, values }) => {
    const data = Uint8Array.from(values);
    await window.suwolDesktop?.test?.configurePluginPackage(
      fileName,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  }, { fileName: path.basename(packagePath), values: bytes });
}

async function installConfiguredPlugin(page: Page, packagePath: string): Promise<void> {
  await configurePluginPackage(page, packagePath);
  await page.getByRole("button", { name: "Install Plugin…" }).first().click();
  const review = page.locator(".plugin-install-review");
  await expect(review).toBeVisible();
  const checkboxes = review.locator('input[type="checkbox"]');
  for (let index = 0; index < await checkboxes.count(); index += 1)
    await checkboxes.nth(index).check();
  await review.getByRole("button", { name: "Install Plugin…" }).click();
  await expect(review).toBeHidden();
}

test("packaged M2 editor tools, transforms, palette, round-trip and recovery", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null)
    throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const args = [`--user-data-dir=${userData}`];
  let app = await electron.launch({ executablePath, args });
  try {
    let page = await waitForWorkspace(app);
    await expect(page).toHaveTitle("Suwol Pixel Studio");
    expect(page.url()).toBe("suwol-pixel://app/index.html");
    const globals = await page.evaluate(() => ({
      process: typeof (globalThis as { process?: unknown }).process,
      require: typeof (globalThis as { require?: unknown }).require,
      ipc: typeof (globalThis as { ipcRenderer?: unknown }).ipcRenderer,
    }));
    expect(globals).toEqual({
      process: "undefined",
      require: "undefined",
      ipc: "undefined",
    });
    const apiShape = await page.evaluate(() => ({
      app: Object.keys(window.suwolDesktop?.app ?? {}),
      shell: Object.keys(window.suwolDesktop?.shell ?? {}),
      commands: Object.keys(window.suwolDesktop?.commands ?? {}),
      files: Object.keys(window.suwolDesktop?.files ?? {}),
      clipboard: Object.keys(window.suwolDesktop?.clipboard ?? {}),
      recovery: Object.keys(window.suwolDesktop?.recovery ?? {}),
      test: Object.keys(window.suwolDesktop?.test ?? {}),
    }));
    expect(apiShape).toEqual({
      app: [
        "getVersion",
        "getPlatform",
        "getDiagnostics",
        "openLogsFolder",
        "copyDiagnostics",
        "relaunchWithoutPlugins",
        "reportRendererFailure",
      ],
      shell: ["openExternal"],
      commands: ["onInvoke", "updateState"],
      files: [
        "showOpenDialog",
        "showSaveDialog",
        "read",
        "writeAtomic",
        "showExportDirectory",
        "writeExportBatch",
      ],
      clipboard: ["writePng", "readPng"],
      recovery: ["write", "list", "read", "delete", "deleteAll"],
      test: ["configureDialog", "readArtifact", "configurePluginPackage"],
    });
    await page.getByTestId("theme-select").selectOption("dark");
    await page.getByTestId("ui-scale-select").selectOption("2");
    await page.getByTestId("theme-select").selectOption("light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("ui-scale-select")).toHaveValue("2");
    await page.getByTestId("ui-scale-select").selectOption("1");

    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    const initialHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    await setHex(page, "#aa1122");
    await page.getByTestId("tool-pencil").click();
    const base = await pixel(page, 20, 20);
    await page.mouse.click(base.x, base.y);
    const pencilHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    expect(pencilHash).not.toBe(initialHash);
    await page.getByTestId("tool-eraser").click();
    await page.mouse.click(base.x, base.y);
    expect(
      await page.evaluate(
        () => window.suwolTest?.getActiveDocumentHash() ?? null,
      ),
    ).toBe(initialHash);
    await page.keyboard.press("Control+Z");
    await page.keyboard.press("Control+Shift+Z");
    await page.getByTestId("tool-eyedropper").click();
    await page.mouse.click(base.x, base.y);
    await setHex(page, "#cc2233");
    await page.getByTestId("tool-fill").click();
    const fillPoint = await pixel(page, 0, 0);
    await page.mouse.click(fillPoint.x, fillPoint.y);
    const fillHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    expect(fillHash).not.toBe(initialHash);
    await setHex(page, "#2244cc");
    await page.getByTestId("tool-line").click();
    await dragPixels(page, { x: 2, y: 2 }, { x: 12, y: 10 });
    await setHex(page, "#22aa55");
    await page.getByTestId("tool-rectangle").click();
    await dragPixels(page, { x: 15, y: 4 }, { x: 28, y: 16 });
    await setHex(page, "#eeaa22");
    await page.getByTestId("tool-ellipse").click();
    await dragPixels(page, { x: 30, y: 5 }, { x: 45, y: 20 });
    const shapesHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    expect(shapesHash).not.toBe(fillHash);

    await page.getByTestId("tool-selectionRect").click();
    await dragPixels(page, { x: 2, y: 2 }, { x: 12, y: 12 });
    await page.getByTestId("tool-move").click();
    await dragPixels(page, { x: 5, y: 5 }, { x: 9, y: 8 });
    const movedHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    expect(movedHash).not.toBe(shapesHash);
    await page.keyboard.press("Control+C");
    await page.keyboard.press("Control+V");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    const pastedHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );
    expect(pastedHash).not.toBe(movedHash);
    await page.keyboard.press("Control+Z");
    expect(
      await page.evaluate(
        () => window.suwolTest?.getActiveDocumentHash() ?? null,
      ),
    ).toBe(movedHash);
    await page.keyboard.press("Control+Shift+Z");
    expect(
      await page.evaluate(
        () => window.suwolTest?.getActiveDocumentHash() ?? null,
      ),
    ).toBe(pastedHash);

    await page.getByTestId("tool-selectionRect").click();
    await dragPixels(page, { x: 1, y: 1 }, { x: 16, y: 16 });
    await page.locator(".advanced-properties > summary").click();
    await page.getByTestId("crop-selection").click();
    expect(
      await page.evaluate(() => window.suwolTest?.getCanvasSize() ?? null),
    ).toEqual({ width: 16, height: 16 });
    await page.getByTestId("canvas-resize").click();
    await page.getByTestId("resize-width").fill("68");
    await page.getByTestId("resize-height").fill("70");
    await page.getByTestId("resize-apply").click();
    expect(
      await page.evaluate(() => window.suwolTest?.getCanvasSize() ?? null),
    ).toEqual({ width: 68, height: 70 });
    await page.getByTestId("sprite-resize").click();
    await page.getByRole("checkbox").uncheck();
    await page.getByTestId("resize-width").fill("32");
    await page.getByTestId("resize-height").fill("32");
    await page.getByTestId("resize-apply").click();
    expect(
      await page.evaluate(() => window.suwolTest?.getCanvasSize() ?? null),
    ).toEqual({ width: 32, height: 32 });
    await page.getByTestId("palette-add").click();
    expect(
      await page.evaluate(() => window.suwolTest?.getPaletteSize() ?? 0),
    ).toBe(1);
    const savedHash = await page.evaluate(
      () => window.suwolTest?.getActiveDocumentHash() ?? null,
    );

    const primary = process.platform === "darwin" ? "Meta" : "Control";
    await page.evaluate(async () => {
      const api = window.suwolDesktop?.test;
      if (api === undefined) throw new Error("E2E API missing");
      await api.configureDialog({
        operation: "save-suwolpixel",
        fileName: "m2-roundtrip.suwolpixel",
      });
    });
    await page.keyboard.press(`${primary}+S`);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const data = await window.suwolDesktop?.test?.readArtifact(
            "m2-roundtrip.suwolpixel",
          );
          return data?.byteLength ?? 0;
        }),
      )
      .toBeGreaterThan(100);
    await expect(page.locator(".document-tab.active")).not.toContainText("•");
    await page.evaluate(async () => {
      const api = window.suwolDesktop?.test;
      if (api === undefined) throw new Error("E2E API missing");
      await api.configureDialog({
        operation: "save-png",
        fileName: "m2-export.png",
      });
    });
    await executePalette(page, "PNG");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const data =
            await window.suwolDesktop?.test?.readArtifact("m2-export.png");
          return data?.byteLength ?? 0;
        }),
      )
      .toBeGreaterThan(100);
    await page.keyboard.press(`${primary}+W`);
    await page.evaluate(async () => {
      const api = window.suwolDesktop?.test;
      if (api === undefined) throw new Error("E2E API missing");
      await api.configureDialog({
        operation: "open",
        fileName: "m2-export.png",
      });
    });
    await page.keyboard.press(`${primary}+O`);
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    expect(
      await page.evaluate(() => window.suwolTest?.getCanvasSize() ?? null),
    ).toEqual({ width: 32, height: 32 });
    await page.keyboard.press(`${primary}+W`);
    await page.evaluate(async () => {
      const api = window.suwolDesktop?.test;
      if (api === undefined) throw new Error("E2E API missing");
      await api.configureDialog({
        operation: "open",
        fileName: "m2-roundtrip.suwolpixel",
      });
    });
    await page.keyboard.press(`${primary}+O`);
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    expect(
      await page.evaluate(
        () => window.suwolTest?.getActiveDocumentHash() ?? null,
      ),
    ).toBe(savedHash);
    expect(
      await page.evaluate(() => window.suwolTest?.getPaletteSize() ?? 0),
    ).toBe(1);
    await page.getByTestId("tool-pencil").click();
    const recoveryPixel = await pixel(page, 1, 1);
    await page.mouse.click(recoveryPixel.x, recoveryPixel.y);
    await expect(page.locator(".document-tab.active")).toContainText("•");
    await page.waitForTimeout(2300);
    const exited = new Promise<void>((resolve) =>
      app.process().once("exit", () => resolve()),
    );
    app.process().kill();
    await exited;
    app = await electron.launch({ executablePath, args });
    page = await waitForWorkspace(app);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("button", { name: /Recover|복구/ })
      .first()
      .click();
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    await expect(page.locator(".document-tab.active")).toContainText("•");
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("packaged M3 frame/cel animation, exports, v3 round-trip and recovery", async () => {
  test.setTimeout(90_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-m3-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const args = [`--user-data-dir=${userData}`],
    prefix = `m3${process.pid}`;
  let app = await electron.launch({ executablePath, args });
  try {
    let page = await waitForWorkspace(app);
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("animation-timeline")).toBeVisible();
    expect(await page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({ width: 64, height: 64 });

    const colors = ["#ef3340", "#22aa55", "#2244cc", "#f0a020"];
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await page.getByTestId("frame-add").click();
      await setHex(page, colors[index] ?? "#000000");
      await page.getByTestId("tool-pencil").click();
      const point = await pixel(page, index + 1, index + 1);
      await page.mouse.click(point.x, point.y);
    }
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.frameCount)).toBe(4);
    for (const [index, duration] of [80, 120, 160, 200].entries())
      await page.getByTestId(`duration-${index + 1}`).fill(String(duration));
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.durations)).toEqual([80, 120, 160, 200]);

    await page.getByTestId("frame-1").dragTo(page.getByTestId("frame-4"));
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getAnimationState()?.durations)).toEqual([120, 160, 200, 80]);
    await page.getByTestId("frame-2").click();
    await page.getByTestId("frame-duplicate").click();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.frameCount)).toBe(5);
    const independentHash = await page.evaluate(() => window.suwolTest?.getActiveFrameHash());
    await page.getByTestId("frame-linked").click();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.linkedImageCount)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.suwolTest?.getActiveFrameHash())).toBe(independentHash);
    await setHex(page, "#a020f0");
    const linkedPoint = await pixel(page, 10, 10);
    await page.mouse.click(linkedPoint.x, linkedPoint.y);
    const linkedEdited = await page.evaluate(() => window.suwolTest?.getActiveFrameHash());
    await page.keyboard.press("[");
    expect(await page.evaluate(() => window.suwolTest?.getActiveFrameHash())).toBe(linkedEdited);
    await page.keyboard.press("]");
    await executePalette(page, "Unlink Cel");
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.linkedImageCount)).toBe(0);
    await setHex(page, "#12cccc");
    const unlinkedPoint = await pixel(page, 12, 12);
    await page.mouse.click(unlinkedPoint.x, unlinkedPoint.y);
    const unlinkedHash = await page.evaluate(() => window.suwolTest?.getActiveFrameHash());
    await page.keyboard.press("[");
    expect(await page.evaluate(() => window.suwolTest?.getActiveFrameHash())).not.toBe(unlinkedHash);
    await page.keyboard.press("]");

    await page.getByTestId("toggle-onion").click();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.onionSkin)).toBe(true);
    await page.getByLabel("Onion Skin Settings").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByTestId("play-pause").click();
    await page.waitForTimeout(280);
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.isPlaying)).toBe(true);
    await page.getByTestId("play-pause").click();
    await page.getByLabel("Playback Mode").selectOption("pingpong");
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.playbackMode)).toBe("pingpong");

    await executePalette(page, "Add Frame Tag");
    await page.getByTestId("tag-name").fill("walk");
    await page.getByTestId("tag-from").fill("2");
    await page.getByTestId("tag-to").fill("5");
    await page.locator(".tag-dialog select").selectOption("pingpong");
    await page.getByTestId("tag-apply").click();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.tags)).toEqual([
      { name: "walk", playback: "pingpong", from: 1, to: 4 },
    ]);
    await page.getByRole("button", { name: /walk/ }).click();
    await page.getByTestId("play-pause").click();
    await page.waitForTimeout(300);
    await page.getByTestId("play-pause").click();
    const tagFrame = await page.evaluate(() => window.suwolTest?.getAnimationState()?.activeFrameIndex ?? -1);
    expect(tagFrame).toBeGreaterThanOrEqual(1);
    expect(tagFrame).toBeLessThanOrEqual(4);

    const documentName = `${prefix}.suwolpixel`;
    await page.evaluate(async (fileName) => {
      await window.suwolDesktop?.test?.configureDialog({ operation: "save-suwolpixel", fileName });
    }, documentName);
    await page.keyboard.press("Control+S");
    await expect.poll(async () => (await artifactBytes(page, documentName))?.byteLength ?? 0).toBeGreaterThan(100);
    const savedHash = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash()),
      savedState = await page.evaluate(() => window.suwolTest?.getAnimationState()),
      archive = await artifactBytes(page, documentName);
    if (archive === null) throw new Error("M3 archive is missing.");
    const entries = unzipSync(archive),
      documentJson = entries["document.json"];
    if (documentJson === undefined) throw new Error("v4 document entry is missing.");
    expect(JSON.parse(new TextDecoder().decode(documentJson))).toMatchObject({ schemaVersion: 4 });
    await page.keyboard.press("Control+W");
    await page.evaluate(async (fileName) => {
      await window.suwolDesktop?.test?.configureDialog({ operation: "open", fileName });
    }, documentName);
    await page.keyboard.press("Control+O");
    await expect(page.getByTestId("animation-timeline")).toBeVisible();
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(savedHash);
    const reopened = await page.evaluate(() => window.suwolTest?.getAnimationState());
    expect(reopened).toMatchObject({
      frameCount: savedState?.frameCount,
      durations: savedState?.durations,
      celCount: savedState?.celCount,
      tags: savedState?.tags,
    });

    async function exportAnimation(query: string, outputPrefix: string, artifact: string): Promise<Uint8Array> {
      await page.evaluate(async () => {
        await window.suwolDesktop?.test?.configureDialog({ operation: "export-directory", fileName: "export" });
      });
      await executePalette(page, query);
      await page.getByTestId("export-prefix").fill(outputPrefix);
      await page.getByTestId("export-start").click();
      await expect.poll(async () => (await artifactBytes(page, artifact))?.byteLength ?? 0).toBeGreaterThan(10);
      const bytes = await artifactBytes(page, artifact);
      if (bytes === null) throw new Error(`Export artifact ${artifact} is missing.`);
      return bytes;
    }
    const sequenceStem = `${prefix}seq`,
      sheetStem = `${prefix}sheet`,
      gifStem = `${prefix}gif`,
      apngStem = `${prefix}apng`,
      sequence = await exportAnimation("Export PNG Sequence", sequenceStem, `${sequenceStem}_0001.png`),
      sheet = await exportAnimation("Export Sprite Sheet", sheetStem, `${sheetStem}.png`),
      gif = await exportAnimation("Export GIF", gifStem, `${gifStem}.gif`),
      apng = await exportAnimation("Export APNG", apngStem, `${apngStem}.png`),
      sheetJson = await artifactBytes(page, `${sheetStem}.json`);
    expect([...sequence.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([...sheet.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe("GIF89a");
    expect(new TextDecoder().decode(apng)).toContain("acTL");
    if (sheetJson === null) throw new Error("Sprite sheet JSON is missing.");
    expect(JSON.parse(new TextDecoder().decode(sheetJson))).toMatchObject({
      format: "suwol-pixel-studio-spritesheet",
    });
    await expect(page.locator(".document-tab.active")).not.toContainText("•");

    await page.getByTestId("tool-pencil").click();
    const recoveryPoint = await pixel(page, 20, 20);
    await page.mouse.click(recoveryPoint.x, recoveryPoint.y);
    await expect(page.locator(".document-tab.active")).toContainText("•");
    await page.waitForTimeout(2300);
    const exited = new Promise<void>((resolve) => app.process().once("exit", () => resolve()));
    app.process().kill();
    await exited;
    app = await electron.launch({ executablePath, args });
    page = await waitForWorkspace(app);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Recover|복구/ }).first().click();
    if (await page.getByTestId("animation-timeline").count() === 0)
      await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("animation-timeline")).toBeVisible();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.frameCount)).toBe(savedState?.frameCount);
    await expect(page.locator(".document-tab.active")).toContainText("•");
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("packaged M3 export and resize workers cancel without document mutation", async () => {
  test.setTimeout(90_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath).not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-m3-cancel-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
  });
  try {
    const page = await waitForWorkspace(app);
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("empty-new").click();
    await page.getByLabel("Width").fill("256");
    await page.getByLabel("Height").fill("256");
    await page.getByTestId("create-document").click();
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    for (let index = 0; index < 120; index += 1)
      await page.getByTestId("frame-linked").click();
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.frameCount)).toBe(121);
    const before = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash()),
      canceledName = `cancel${process.pid}.png`;
    await page.evaluate(async () => {
      await window.suwolDesktop?.test?.configureDialog({
        operation: "export-directory",
        fileName: "cancel-export",
      });
    });
    await executePalette(page, "Export APNG");
    await page.getByTestId("export-prefix").fill(canceledName.replace(/\.png$/, ""));
    await page.getByTestId("export-start").click();
    await page.getByTestId("cancel-job").click();
    await page.waitForTimeout(300);
    expect(await artifactBytes(page, canceledName)).toBeNull();
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(before);

    await page.locator(".advanced-properties > summary").click();
    await page.getByTestId("sprite-resize").click();
    await page.getByRole("checkbox", { name: "Maintain aspect ratio" }).uncheck();
    await page.getByTestId("resize-width").fill("4096");
    await page.getByTestId("resize-height").fill("4096");
    await page.getByTestId("resize-apply").click();
    await page.getByTestId("cancel-job").click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({
      width: 256,
      height: 256,
    });
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(before);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("packaged M4 plugin install, sandbox capabilities, transactions, network and Safe Mode", async () => {
  test.setTimeout(120_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath).not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const commandPackage = path.resolve("artifacts", "plugins", "example-command.suwolplugin"),
    panelPackage = path.resolve("artifacts", "plugins", "example-panel-network.suwolplugin");
  expect(fs.existsSync(commandPackage)).toBe(true);
  expect(fs.existsSync(panelPackage)).toBe(true);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      width: 2,
      height: 2,
      rgba: [
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Local test server did not start.");
  const endpoint = `http://127.0.0.1:${address.port}/generate`;
  const userData = path.resolve("out", "e2e-m4-plugin-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const normalArgs = [`--user-data-dir=${userData}`];
  let app = await electron.launch({ executablePath, args: normalArgs });
  try {
    let page = await waitForWorkspace(app);
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("theme-select").selectOption("dark");
    await page.getByTestId("ui-scale-select").selectOption("2");
    await page.evaluate(() => window.suwolTest?.openPluginManager());
    await expect(page.getByRole("dialog", { name: "Plugin Manager" })).toBeVisible();

    await installConfiguredPlugin(page, commandPackage);
    await expect(page.locator(".plugin-details")).toContainText("Invert Selection");
    await expect(page.locator(".plugin-details")).toContainText("Unsigned Plugin");
    await expect.poll(async () =>
      (await page.evaluate(() => window.suwolTest?.getPluginState().installed.find((plugin) => plugin.id === "studio.suwol.example-command")?.runtimeStatus))
    ).toBe("running");
    await page.getByRole("dialog", { name: "Plugin Manager" }).getByRole("button", { name: "Close" }).click();

    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await page.getByTestId("ui-scale-select").selectOption("1");
    const point = await pixel(page, 3, 3);
    await page.mouse.click(point.x, point.y);
    const beforeInvert = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    const result = await page.evaluate(async () => await window.suwolTest?.executeCommand("studio.suwol.example-command.invert"));
    expect(result).toMatchObject({ status: "executed" });
    const afterInvert = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    expect(afterInvert).not.toBe(beforeInvert);
    await page.keyboard.press("Control+Z");
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(beforeInvert);
    await page.keyboard.press("Control+Shift+Z");
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(afterInvert);

    await page.evaluate(() => window.suwolTest?.openPluginManager());
    await page.locator(".plugin-list").getByRole("button", { name: /Invert Selection/ }).click();
    await page.locator(".plugin-actions").getByRole("button", { name: "Disable" }).click();
    await expect.poll(async () =>
      (await page.evaluate(() => window.suwolTest?.getPluginState().installed.find((plugin) => plugin.id === "studio.suwol.example-command")?.enabled))
    ).toBe(false);
    await page.locator(".plugin-actions").getByRole("button", { name: "Enable" }).click();

    await installConfiguredPlugin(page, panelPackage);
    await expect(page.locator(".plugin-details")).toContainText("Local Pixel Generator");
    const panel = page.frameLocator(".plugin-panel-host iframe");
    await expect(panel.getByRole("heading", { name: "Local Pixel Generator" })).toBeVisible();
    await panel.getByLabel("Local endpoint").fill(endpoint);
    const beforeNetworkInsert = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    await panel.getByRole("button", { name: "Generate and insert" }).click();
    await expect(panel.getByRole("status")).toContainText("Inserted", { timeout: 15_000 });
    expect(await page.evaluate(() => window.suwolTest?.getLayerCount())).toBe(2);
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).not.toBe(beforeNetworkInsert);
    await page.evaluate(async () => await window.suwolTest?.executeCommand("edit.undo"));
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(beforeNetworkInsert);

    const permissions = page.locator(".plugin-permissions");
    await permissions.getByLabel("Localhost Access").uncheck();
    await permissions.getByRole("button", { name: "Save Permissions" }).click();
    await expect.poll(async () =>
      (await page.evaluate(() => window.suwolTest?.getPluginState().installed.find((plugin) => plugin.id === "studio.suwol.example-panel-network")?.enabled))
    ).toBe(false);
    await expect(page.locator(".plugin-panel-host")).toHaveCount(0);
    await permissions.getByLabel("Localhost Access").check();
    await permissions.getByRole("button", { name: "Save Permissions" }).click();
    await page.locator(".plugin-actions").getByRole("button", { name: "Enable" }).click();
    await expect(page.locator(".plugin-panel-host iframe")).toBeVisible();
    const restartedPanel = page.frameLocator(".plugin-panel-host iframe");
    await restartedPanel.getByRole("button", { name: "Test runtime isolation" }).click();
    await expect(page.locator(".plugin-notice")).toContainText("Runtime Crashed", { timeout: 15_000 });
    await expect.poll(async () =>
      (await page.evaluate(() => window.suwolTest?.getPluginState().installed.find((plugin) => plugin.id === "studio.suwol.example-panel-network")?.runtimeStatus))
    ).toBe("crashed");
    await page.locator(".plugin-actions").getByRole("button", { name: "Restart" }).click();
    await expect(page.locator(".plugin-panel-host iframe")).toBeVisible();

    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.locator(".plugin-actions").getByRole("button", { name: "Clear Plugin Data" }).click();
    await page.getByRole("dialog", { name: "Plugin Manager" }).getByRole("button", { name: "Close" }).click();
    await app.close();

    app = await electron.launch({ executablePath, args: [...normalArgs, "--disable-plugins"] });
    page = await waitForWorkspace(app);
    await page.evaluate(() => window.suwolTest?.openPluginManager());
    await expect(page.getByRole("dialog", { name: /Plugin Manager|플러그인 관리자/ })).toBeVisible();
    const safeState = await page.evaluate(() => window.suwolTest?.getPluginState());
    expect(safeState?.safeMode).toBe(true);
    expect(safeState?.installed).toHaveLength(2);
    expect(safeState?.installed.every((plugin) => !plugin.enabled)).toBe(true);
    await page.getByRole("dialog", { name: /Plugin Manager|플러그인 관리자/ }).getByRole("button", { name: /Close|닫기/ }).click();
    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    await app.close();

    app = await electron.launch({ executablePath, args: normalArgs });
    page = await waitForWorkspace(app);
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.evaluate(() => window.suwolTest?.openPluginManager());
    await expect.poll(async () => (await page.evaluate(() => window.suwolTest?.getPluginState().installed.length))).toBe(2);
    for (const name of ["Local Pixel Generator", "Invert Selection"]) {
      await page.locator(".plugin-list").getByRole("button", { name: new RegExp(name) }).click();
      page.once("dialog", (dialog) => { void dialog.accept(); });
      await page.locator(".plugin-actions").getByRole("button", { name: "Remove" }).click();
      await expect(page.locator(".plugin-list")).not.toContainText(name);
    }
    expect(await page.evaluate(() => window.suwolTest?.getPluginState().installed.length)).toBe(0);
  } finally {
    await app.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("packaged M5 indexed document, Group tree, v4 archive and Plugin API 1.1 sample", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-m5-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
  try {
    const page = await waitForWorkspace(app);
    await page.getByTestId("empty-new").click();
    const newDialog = page.getByRole("dialog");
    await newDialog.locator("select").selectOption("indexed");
    await newDialog.locator('input[type="number"]').nth(1).fill("64");
    await page.getByTestId("create-document").click();
    expect(await page.evaluate(() => window.suwolTest?.getProfessionalState())).toMatchObject({ schemaVersion: 4, colorMode: "indexed", paletteSize: 3 });

    const before = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    await page.getByTestId("tool-pencil").click();
    const point = await pixel(page, 3, 4);
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).not.toBe(before);

    await page.getByTestId("layer-add-group").click();
    expect(await page.evaluate(() => window.suwolTest?.getProfessionalState()?.layerKinds)).toEqual(["pixel", "group"]);
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({ operation: "save-suwolpixel", fileName: "m5-indexed.suwolpixel" }));
    await page.keyboard.press("Control+S");
    await expect.poll(async () => await artifactBytes(page, "m5-indexed.suwolpixel")).not.toBeNull();
    const bytes = await artifactBytes(page, "m5-indexed.suwolpixel");
    if (bytes === null) throw new Error("M5 archive was not written.");
    const entries = unzipSync(bytes), documentBytes = entries["document.json"];
    if (documentBytes === undefined) throw new Error("v4 document entry is missing.");
    expect(JSON.parse(new TextDecoder().decode(documentBytes))).toMatchObject({ schemaVersion: 4, canvas: { colorMode: "indexed" } });
    expect(Object.keys(entries).some((name) => name.endsWith(".idx"))).toBe(true);

    const professionalPackage = path.resolve("artifacts", "plugins", "example-professional.suwolplugin");
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.evaluate(() => window.suwolTest?.openPluginManager());
    await installConfiguredPlugin(page, professionalPackage);
    await expect.poll(async () => (await page.evaluate(() => window.suwolTest?.getPluginState().installed.some((plugin) => plugin.id === "studio.suwol.example-professional")))).toBe(true);
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getPluginState().installed.find((plugin) => plugin.id === "studio.suwol.example-professional")?.runtimeStatus)).toBe("running");
    const runButtons = page.locator(".plugin-contributions").getByRole("button", { name: "Run" });
    await expect(runButtons).toHaveCount(3);
    await page.evaluate(async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ rgba: [12, 34, 56, 255] }));
      await window.suwolDesktop?.test?.configureDialog({ operation: "open", fileName: "sample.pixeljson", data: bytes.buffer });
    });
    await runButtons.nth(0).click();
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({ width: 1, height: 1 });
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({ operation: "export-directory", fileName: "plugin-export" }));
    await runButtons.nth(1).click();
    const beforeTool = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    await runButtons.nth(2).click();
    await expect(page.locator(".plugin-error")).toHaveCount(0);
    await page.getByRole("dialog", { name: "Plugin Manager" }).getByRole("button", { name: "Close" }).click();
    const toolPoint = await pixel(page, 0, 0);
    await page.mouse.move(toolPoint.x, toolPoint.y);
    await page.mouse.down();
    await page.mouse.move(toolPoint.x + 1, toolPoint.y + 1);
    await page.mouse.up();
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).not.toBe(beforeTool);
    await page.evaluate(async () => window.suwolTest?.executeCommand("sprite.convertToIndexed"));
    const conversionDialog = page.getByRole("dialog", { name: "Convert to Indexed Color" });
    await conversionDialog.getByRole("button", { name: "Convert" }).click();
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getProfessionalState()?.colorMode)).toBe("indexed");
  } finally {
    await app.close();
  }
});

test("packaged M6 Canvas2D, diagnostics, localization and keyboard accessibility", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-m6-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--force-canvas2d"],
  });
  try {
    const page = await waitForWorkspace(app);
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await expect(page.getByTestId("pixel-canvas")).toHaveAttribute("data-renderer-mode", "canvas2d");
    await page.evaluate(async () => window.suwolTest?.executeCommand("help.about"));
    const about = page.getByRole("dialog", { name: "About Suwol Pixel Studio" });
    await expect(about).toContainText("1.0.1-rc.2");
    await expect(about).toContainText("Plugin API 1.1.0");
    await expect(about).toContainText("Apache-2.0");
    const aboutIcon = about.locator(".about-mark img");
    await expect(aboutIcon).toBeVisible();
    expect(await aboutIcon.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 512, height: 512 });
    await about.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    await about.getByRole("button", { name: "Close" }).last().click();
    await page.getByLabel("UI scale").selectOption("2");
    await expect(page.locator("html")).toHaveCSS("font-size", "28px");
    await page.getByLabel("Language").selectOption("ko");
    await expect(page.getByLabel("언어")).toHaveValue("ko");
    await page.getByLabel("테마").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const aseprite = minimalAseprite();
    await page.evaluate(async (values) => {
      const bytes = Uint8Array.from(values);
      await window.suwolDesktop?.test?.configureDialog({
        operation: "open",
        fileName: "m6-worker.ase",
        data: bytes.buffer,
      });
      await window.suwolTest?.executeCommand("file.importAseprite");
    }, [...aseprite]);
    await expect(page.getByRole("dialog", { name: /Aseprite/ })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({ width: 1, height: 1 });
  } finally {
    await app.close();
  }
});

test("packaged RC9 dock workspace, RC8 canvas UX and responsive layouts", async () => {
  test.setTimeout(90_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-rc9-user-data"),
    screenshotDirectory = path.resolve("test-results", "rc9-visual");
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(screenshotDirectory, { recursive: true, force: true });
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  let app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
  });
  try {
    let page = await waitForWorkspace(app);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByLabel(/Language|언어/).selectOption("en");

    const tabs = page.getByRole("tablist", { name: "Open documents" });
    await expect(tabs.getByRole("tab")).toHaveCount(0);
    await expect(page.locator(".app-brand")).toHaveCount(0);
    await expect(page.getByTestId("panel-timeline")).toHaveCount(0);
    await page.getByTestId("empty-new").click();
    await page.getByTestId("create-document").click();
    await expect(page.getByTestId("pixel-canvas")).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(tabs.getByRole("tab")).toContainText("Untitled");

    const upperGroup = page.getByTestId("right-upper-group"),
      lowerGroup = page.getByTestId("right-lower-group"),
      rightDock = page.getByTestId("right-dock");
    await expect(upperGroup.getByRole("tab")).toHaveCount(2);
    await expect(lowerGroup.getByRole("tab")).toHaveCount(2);
    await expect(upperGroup.getByRole("tab", { name: /Layers/ })).toHaveAttribute("aria-selected", "true");
    await expect(lowerGroup.getByRole("tab", { name: /Properties/ })).toHaveAttribute("aria-selected", "true");
    await page.locator('[data-dock-tab="palette"]').click();
    await expect(page.getByTestId("panel-palette")).toBeVisible();
    await expect(page.getByTestId("panel-layers")).toHaveCount(0);
    await page.locator('[data-dock-tab="layers"]').click();
    await page.locator('[data-dock-tab="preview"]').click();
    await expect(page.getByTestId("panel-preview")).toBeVisible();
    await expect(page.getByTestId("panel-properties")).toHaveCount(0);
    await page.locator('[data-dock-tab="properties"]').click();

    const initialDockWidth = (await rightDock.boundingBox())?.width ?? 0,
      dockSplitter = page.getByRole("separator", { name: "Resize Right Dock" }),
      groupSplitter = page.getByRole("separator", { name: "Resize panel groups" });
    await dockSplitter.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect((await rightDock.boundingBox())?.width ?? 0).toBeGreaterThan(initialDockWidth);
    const resizedDockWidth = (await rightDock.boundingBox())?.width ?? 0,
      initialSplit = Number(await groupSplitter.getAttribute("aria-valuenow"));
    await groupSplitter.focus();
    await page.keyboard.press("ArrowDown");
    expect(Number(await groupSplitter.getAttribute("aria-valuenow"))).toBeGreaterThan(initialSplit);

    await page.locator('[data-dock-tab="palette"]').dragTo(page.locator('[data-dock-tab="preview"]'));
    await expect(lowerGroup.locator('[data-dock-tab="palette"]')).toHaveCount(1);
    await page.locator('[data-dock-tab="preview"]').click();
    await page.locator('[data-dock-tab="preview"] .dock-tab-close').click();
    await expect(page.locator('[data-dock-tab="preview"]')).toHaveCount(0);
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.togglePreview"));
    await expect(lowerGroup.locator('[data-dock-tab="preview"]')).toHaveCount(1);

    const expandedBefore = (await page.getByTestId("pixel-canvas-host").boundingBox())?.width ?? 0;
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleRightDock"));
    await expect(rightDock).toHaveCount(0);
    expect((await page.getByTestId("pixel-canvas-host").boundingBox())?.width ?? 0).toBeGreaterThan(expandedBefore + 200);
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleRightDock"));
    await expect(rightDock).toBeVisible();
    expect((await rightDock.boundingBox())?.width ?? 0).toBeCloseTo(resizedDockWidth, 0);
    await page.locator('[data-dock-tab="layers"]').click();
    await page.locator('[data-dock-tab="properties"]').click();

    const toolRail = page.getByTestId("panel-tools"),
      railWidth = (await toolRail.boundingBox())?.width ?? 0;
    expect(railWidth).toBeGreaterThanOrEqual(40);
    expect(railWidth).toBeLessThanOrEqual(55);
    await expect(page.locator('[data-testid="panel-tools"] + [role="separator"]')).toHaveCount(0);

    const overlay = page.getByTestId("pixel-canvas"),
      host = page.getByTestId("pixel-canvas-host"),
      canvasBox = await overlay.boundingBox();
    if (canvasBox === null) throw new Error("Canvas bounds are unavailable.");
    const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 },
      originalHash = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash()),
      originalViewport = await page.evaluate(() => window.suwolTest?.getViewport());
    await page.mouse.move(center.x, center.y);
    await page.keyboard.down("Space");
    await expect(host).toHaveAttribute("data-pan-state", "grab");
    await expect(overlay).toHaveCSS("cursor", "grab");
    await page.mouse.down();
    await page.mouse.move(center.x + 90, center.y + 55, { steps: 5 });
    await expect(host).toHaveAttribute("data-pan-state", "grabbing");
    await expect(overlay).toHaveCSS("cursor", "grabbing");
    await page.mouse.up();
    await page.keyboard.up("Space");
    const spaceViewport = await page.evaluate(() => window.suwolTest?.getViewport());
    expect((spaceViewport?.panX ?? 0) - (originalViewport?.panX ?? 0)).toBeCloseTo(90, 0);
    expect((spaceViewport?.panY ?? 0) - (originalViewport?.panY ?? 0)).toBeCloseTo(55, 0);
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(originalHash);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(center.x - 45, center.y + 30, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    const middleViewport = await page.evaluate(() => window.suwolTest?.getViewport());
    expect((middleViewport?.panX ?? 0) - (spaceViewport?.panX ?? 0)).toBeCloseTo(-45, 0);
    expect((middleViewport?.panY ?? 0) - (spaceViewport?.panY ?? 0)).toBeCloseTo(30, 0);
    expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(originalHash);

    await page.getByTestId("tool-pencil").click();
    const editPoint = await pixel(page, 32, 32);
    await page.mouse.click(editPoint.x, editPoint.y);
    const editedHash = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
    expect(editedHash).not.toBe(originalHash);

    const anchor = { x: canvasBox.x + canvasBox.width * 0.42, y: canvasBox.y + canvasBox.height * 0.37 },
      beforeWheel = await page.evaluate(() => window.suwolTest?.getViewport());
    if (beforeWheel === null || beforeWheel === undefined) throw new Error("Viewport is unavailable.");
    const documentAnchor = {
      x: (anchor.x - canvasBox.x - beforeWheel.panX) / beforeWheel.zoom,
      y: (anchor.y - canvasBox.y - beforeWheel.panY) / beforeWheel.zoom,
    };
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await page.evaluate(() => window.suwolTest?.getViewport()?.zoom)) ?? 0).toBeGreaterThan(beforeWheel.zoom);
    const afterWheel = await page.evaluate(() => window.suwolTest?.getViewport());
    if (afterWheel === null || afterWheel === undefined) throw new Error("Zoomed viewport is unavailable.");
    expect((anchor.x - canvasBox.x - afterWheel.panX) / afterWheel.zoom).toBeCloseTo(documentAnchor.x, 1);
    expect((anchor.y - canvasBox.y - afterWheel.panY) / afterWheel.zoom).toBeCloseTo(documentAnchor.y, 1);

    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomIn"));
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomFit"));
    const fitViewport = await page.evaluate(() => window.suwolTest?.getViewport());
    expect(fitViewport?.zoom).toBeGreaterThan(1);
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.centerCanvas"));
    const centered = await page.evaluate(() => window.suwolTest?.getViewport());
    expect(centered).not.toBeNull();
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoom100"));
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getViewport()?.zoom)).toBe(1);

    const hiddenCanvasHeight = (await host.boundingBox())?.height ?? 0;
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    const timelinePanel = page.getByTestId("panel-timeline");
    await expect(timelinePanel).toBeVisible();
    const timelineHeight = (await timelinePanel.boundingBox())?.height ?? 0,
      visibleCanvasHeight = (await host.boundingBox())?.height ?? 0;
    expect(timelineHeight).toBeGreaterThan(100);
    expect(visibleCanvasHeight).toBeLessThan(hiddenCanvasHeight - 80);
    await page.getByTestId("timeline-close").click();
    await expect(timelinePanel).toHaveCount(0);
    expect((await host.boundingBox())?.height ?? 0).toBeGreaterThan(visibleCanvasHeight + 80);
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(timelinePanel).toBeVisible();
    expect((await timelinePanel.boundingBox())?.height ?? 0).toBeCloseTo(timelineHeight, 0);

    const layerRow = page.getByTestId("layer-row").first();
    await expect(layerRow).toHaveAttribute("role", "treeitem");
    await expect(layerRow).toHaveAttribute("aria-level", "1");
    await expect(layerRow.locator('input[type="range"], select')).toHaveCount(0);
    const properties = page.getByTestId("layer-properties");
    await expect(properties.getByLabel("Layer opacity")).toBeVisible();
    await expect(properties.getByLabel("Blend Mode")).toBeVisible();
    expect(await layerRow.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");

    await page.mouse.move(center.x, center.y);
    await page.getByTestId("tool-pencil").focus();
    const tooltip = page.getByRole("tooltip", { name: /Pencil/ });
    await expect(tooltip).toContainText("Pencil");
    await expect(tooltip).toContainText("Draw the current color");
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await page.getByTestId("toggle-onion").hover();
    const onionTooltip = page.getByRole("tooltip", { name: /Onion Skin/ });
    await expect(onionTooltip).toContainText("Onion Skin", { timeout: 2_000 });
    await expect(onionTooltip).toContainText("at least two frames");
    const iconMetadata = await page.locator("button.icon-button:visible").evaluateAll((buttons) =>
      buttons.map((button) => ({
        label: button.getAttribute("aria-label"),
        description: button.getAttribute("aria-describedby"),
      })),
    );
    expect(iconMetadata.length).toBeGreaterThan(10);
    expect(iconMetadata.every(({ label, description }) => Boolean(label && description))).toBe(true);
    await page.keyboard.press("Escape");
    await page.locator(".dock-tab-close:visible").last().focus();
    const edgeTooltip = page.getByRole("tooltip", { name: /Close Panel/ }).last();
    await expect(edgeTooltip).toBeVisible();
    const edgeBox = await edgeTooltip.boundingBox();
    expect(edgeBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((edgeBox?.x ?? 0) + (edgeBox?.width ?? 0)).toBeLessThanOrEqual(1280);
    await page.keyboard.press("Escape");

    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyAnimationLayout"));
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    await expect(page.getByTestId("panel-preview")).toBeVisible();
    expect((await page.evaluate(() => window.suwolTest?.getWorkspaceLayout()))?.id).toBe("animation");
    await page.screenshot({ path: path.join(screenshotDirectory, "preset-animation.png") });
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyTilemapLayout"));
    await expect(page.locator('[data-dock-tab="tilesets"]')).toBeVisible();
    await expect(page.getByTestId("panel-timeline")).toHaveCount(0);
    expect((await page.evaluate(() => window.suwolTest?.getWorkspaceLayout()))?.id).toBe("tilemap");
    await page.screenshot({ path: path.join(screenshotDirectory, "preset-tilemap.png") });
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyStaticLayout"));
    const restoredStatic = await page.evaluate(() => window.suwolTest?.getWorkspaceLayout());
    expect(restoredStatic?.lowerGroup?.panelIds).toContain("palette");
    expect(restoredStatic?.rightDockWidth).toBeCloseTo(resizedDockWidth, 0);
    expect(restoredStatic?.timelineVisible).toBe(true);
    await page.locator('[data-dock-tab="layers"]').click();
    await page.locator('[data-dock-tab="properties"]').click();
    await page.screenshot({ path: path.join(screenshotDirectory, "preset-static-restored.png") });

    await page.evaluate(async () => window.suwolTest?.executeCommand("help.about"));
    const aboutIcon = page.locator(".about-mark img");
    await expect(aboutIcon).toBeVisible();
    expect(await aboutIcon.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight, source: image.currentSrc }))).toMatchObject({ width: 512, height: 512 });
    expect(await aboutIcon.getAttribute("src")).not.toMatch(/electron/i);
    await page.screenshot({ path: path.join(screenshotDirectory, "about-icon.png") });
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();

    const visualCases = [
      { width: 1280, height: 720, scale: "1", theme: "dark" },
      { width: 1280, height: 720, scale: "1.25", theme: "light" },
      { width: 1280, height: 720, scale: "2", theme: "dark" },
      { width: 1920, height: 1080, scale: "1", theme: "light" },
      { width: 1920, height: 1080, scale: "1.25", theme: "dark" },
      { width: 1920, height: 1080, scale: "2", theme: "light" },
    ] as const;
    for (const visual of visualCases) {
      await page.setViewportSize({ width: visual.width, height: visual.height });
      await page.getByTestId("ui-scale-select").selectOption(visual.scale);
      await page.getByTestId("theme-select").selectOption(visual.theme);
      await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomFit"));
      await page.screenshot({
        path: path.join(screenshotDirectory, `${visual.width}x${visual.height}-${Number(visual.scale) * 100}-${visual.theme}.png`),
      });
      const rowMetrics = await layerRow.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
      }));
      expect(rowMetrics.scrollHeight).toBeLessThanOrEqual(rowMetrics.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(visual.width + 4);
      const timelineControls = await page.locator(".playback-toolbar > *").evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }));
      for (let index = 1; index < timelineControls.length; index += 1)
        expect(timelineControls[index - 1]?.right ?? 0).toBeLessThanOrEqual((timelineControls[index]?.left ?? 0) + 1);
      for (const [name, control] of [["layer-delete", page.getByTestId("layer-delete")], ["ui-scale-select", page.getByTestId("ui-scale-select")]] as const) {
        const bounds = await control.boundingBox();
        expect(bounds?.x ?? -1, `${name} left edge at ${visual.width}×${visual.height}/${visual.scale}`).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0), `${name} right edge at ${visual.width}×${visual.height}/${visual.scale}`).toBeLessThanOrEqual(visual.width);
      }
    }

    for (const command of ["window.toggleProperties", "window.togglePalette", "window.togglePreview"])
      await page.evaluate(async (id) => window.suwolTest?.executeCommand(id), command);
    await expect(page.getByTestId("right-lower-group")).toHaveCount(0);
    await expect(page.getByTestId("right-upper-group")).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDirectory, "upper-group-only.png") });
    for (const command of ["window.toggleProperties", "window.togglePalette", "window.togglePreview"])
      await page.evaluate(async (id) => window.suwolTest?.executeCommand(id), command);
    await page.locator('[data-dock-tab="layers"]').focus();
    await page.keyboard.press("Delete");
    await page.locator('[data-dock-tab="palette"]').focus();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("right-upper-group")).toHaveCount(0);
    await expect(page.getByTestId("right-lower-group")).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDirectory, "lower-group-only.png") });
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleLayers"));
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.togglePalette"));
    await page.locator('[data-dock-tab="palette"]').focus();
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+ArrowDown`);
    await expect(page.getByTestId("right-upper-group")).toBeVisible();
    await expect(page.getByTestId("right-lower-group")).toBeVisible();

    await page.getByTestId("ui-scale-select").selectOption("1");
    await page.getByTestId("theme-select").selectOption("dark");
    await page.waitForTimeout(300);
    const persistedLayout = await page.evaluate(() => window.suwolTest?.getWorkspaceLayout());
    await app.close();
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
    page = await waitForWorkspace(app);
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    expect((await page.getByTestId("panel-timeline").boundingBox())?.height ?? 0).toBeCloseTo(timelineHeight, 0);
    await expect(page.getByTestId("theme-select")).toHaveValue("dark");
    expect(await page.evaluate(() => window.suwolTest?.getWorkspaceLayout())).toEqual(persistedLayout);
  } finally {
    await app.close();
  }
});

test("packaged RC10 exact pointer coordinates and asymmetric PNG round-trip", async () => {
  test.setTimeout(90_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-rc10-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
  });
  try {
    const page = await waitForWorkspace(app);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByLabel(/Language|언어/).selectOption("en");
    await expect(page.locator(".workspace-actions")).toHaveCount(0);
    await expect(page.getByTestId("open-command-palette")).toHaveCount(0);
    await expect(page.getByTestId("toggle-right-dock")).toHaveCount(0);
    const empty = page.locator(".empty-state");
    await expect(empty.locator("h1, p, .empty-state-icon")).toHaveCount(0);
    await expect(empty.getByRole("button")).toHaveCount(2);

    await page.getByTestId("empty-new").click();
    await page.getByLabel("Width").fill("32");
    await page.getByLabel("Height").fill("32");
    await page.getByTestId("create-document").click();
    await expect(page.getByTestId("pixel-canvas")).toHaveAttribute("data-renderer-mode", "webgl2");

    const zoomCases = [
      { zoom: 1, color: "#d20f39" },
      { zoom: 2, color: "#16a34a" },
      { zoom: 4, color: "#2563eb" },
      { zoom: 8, color: "#e8790c" },
    ] as const;
    const verificationPoints = [[0, 0], [31, 0], [0, 31], [31, 31], [15, 15]] as const;
    for (const entry of zoomCases) {
      await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoom100"));
      while ((await page.evaluate(() => window.suwolTest?.getViewport()?.zoom ?? 0)) < entry.zoom)
        await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomIn"));
      await expect.poll(() => page.evaluate(() => window.suwolTest?.getViewport()?.zoom ?? 0)).toBe(entry.zoom);
      await setHex(page, entry.color);
      const rgb = [
        Number.parseInt(entry.color.slice(1, 3), 16),
        Number.parseInt(entry.color.slice(3, 5), 16),
        Number.parseInt(entry.color.slice(5, 7), 16),
        255,
      ];
      for (const [x, y] of verificationPoints) {
        const target = await pixel(page, x, y);
        await page.mouse.click(target.x, target.y);
        await expectActivePixel(page, x, y, rgb);
      }
    }

    const host = page.getByTestId("pixel-canvas-host");
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    const timelineSplitter = page.getByRole("separator", { name: "Timeline" });
    await timelineSplitter.focus();
    let resizedHostBox = await host.boundingBox();
    if (resizedHostBox === null) throw new Error("Canvas size is unavailable.");
    while (resizedHostBox.height > 411.75) {
      await page.keyboard.press("ArrowUp");
      resizedHostBox = await host.boundingBox();
      if (resizedHostBox === null) throw new Error("Resized canvas is unavailable.");
    }
    expect(Math.abs(resizedHostBox.height - 407.75)).toBeLessThanOrEqual(4);
    await expect.poll(() => page.evaluate(() => window.suwolTest?.getViewport()?.viewportHeight ?? 0)).toBeCloseTo(resizedHostBox.height, 0);
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomFit"));
    const fitZoom = await page.evaluate(() => window.suwolTest?.getViewport()?.zoom ?? 0);
    expect(fitZoom).toBeCloseTo(10.7421875, 0);
    expect(Number.isInteger(fitZoom)).toBe(false);
    await setHex(page, "#7c3aed");
    for (const [x, y] of verificationPoints) {
      const fitTarget = await pixel(page, x, y);
      await page.mouse.click(fitTarget.x, fitTarget.y);
      await expectActivePixel(page, x, y, [124, 58, 237, 255]);
    }

    await page.getByLabel("UI scale").selectOption("2");
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomFit"));
    const scaledTarget = await pixel(page, 24, 7);
    await page.mouse.click(scaledTarget.x, scaledTarget.y);
    await expectActivePixel(page, 24, 7, [124, 58, 237, 255]);
    await page.getByLabel("UI scale").selectOption("1");

    const dockSplitter = page.getByRole("separator", { name: "Resize Right Dock" });
    await dockSplitter.focus();
    await page.keyboard.press("ArrowLeft");
    const resizedTarget = await pixel(page, 27, 19);
    await page.mouse.click(resizedTarget.x, resizedTarget.y);
    await expectActivePixel(page, 27, 19, [124, 58, 237, 255]);
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    const timelineTarget = await pixel(page, 5, 25);
    await page.mouse.click(timelineTarget.x, timelineTarget.y);
    await expectActivePixel(page, 5, 25, [124, 58, 237, 255]);

    const panAndVerify = async (
      mode: "space" | "middle",
      deltaX: number,
      deltaY: number,
      documentPoint: readonly [number, number],
    ): Promise<void> => {
      const beforePan = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash()),
        centerBox = await page.getByTestId("pixel-canvas").boundingBox();
      if (centerBox === null) throw new Error("Canvas bounds are unavailable.");
      const center = {
        x: centerBox.x + centerBox.width / 2,
        y: centerBox.y + centerBox.height / 2,
      };
      await page.mouse.move(center.x, center.y);
      if (mode === "space") await page.keyboard.down("Space");
      await page.mouse.down(mode === "middle" ? { button: "middle" } : undefined);
      await page.mouse.move(center.x + deltaX, center.y + deltaY, { steps: 4 });
      await page.mouse.up(mode === "middle" ? { button: "middle" } : undefined);
      if (mode === "space") await page.keyboard.up("Space");
      expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(beforePan);
      const target = await pixel(page, documentPoint[0], documentPoint[1]);
      await page.mouse.click(target.x, target.y);
      await expectActivePixel(page, documentPoint[0], documentPoint[1], [124, 58, 237, 255]);
    };
    await panAndVerify("space", 40, 25, [29, 28]);
    await panAndVerify("middle", -20, 10, [28, 27]);
    await panAndVerify("space", -120, -80, [15, 15]);
    await panAndVerify("middle", 220, 140, [16, 16]);
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("panel-timeline")).toHaveCount(0);
    await panAndVerify("space", -45, 30, [12, 20]);
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyAnimationLayout"));
    await panAndVerify("middle", 35, -20, [18, 12]);

    const fixture = asymmetricPngFixture();
    await page.evaluate(async (values) => {
      const bytes = Uint8Array.from(values);
      await window.suwolDesktop?.test?.configureDialog({
        operation: "open",
        fileName: "rc10-asymmetric.png",
        data: bytes.buffer,
      });
    }, [...fixture.bytes]);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+O" : "Control+O");
    await expect.poll(() => page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({ width: 16, height: 16 });
    await expectActivePixel(page, 0, 0, [255, 0, 0, 255]);
    await expectActivePixel(page, 15, 0, [0, 255, 0, 255]);
    await expectActivePixel(page, 0, 15, [0, 0, 255, 255]);
    await expectActivePixel(page, 15, 15, [255, 255, 0, 255]);
    await expectRenderedPixel(page, 0, 0, [255, 0, 0, 255]);
    await expectRenderedPixel(page, 0, 15, [0, 0, 255, 255]);

    await setHex(page, "#c026d3");
    const importedEdit = await pixel(page, 6, 9);
    await page.mouse.click(importedEdit.x, importedEdit.y);
    fixture.rgba.set([192, 38, 211, 255], (9 * 16 + 6) * 4);
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({
      operation: "save-suwolpixel",
      fileName: "rc10-roundtrip.suwolpixel",
    }));
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.saveAs"));
    await expect.poll(async () => (await artifactBytes(page, "rc10-roundtrip.suwolpixel"))?.byteLength ?? 0).toBeGreaterThan(100);
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.close"));
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({
      operation: "open",
      fileName: "rc10-roundtrip.suwolpixel",
    }));
    await page.keyboard.press(process.platform === "darwin" ? "Meta+O" : "Control+O");
    await expectActivePixel(page, 6, 9, [192, 38, 211, 255]);
    await expectActivePixel(page, 0, 0, [255, 0, 0, 255]);
    await expectActivePixel(page, 0, 15, [0, 0, 255, 255]);
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({
      operation: "save-png",
      fileName: "rc10-export.png",
    }));
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.exportPng"));
    await expect.poll(async () => await artifactBytes(page, "rc10-export.png")).not.toBeNull();
    const exportedBytes = await artifactBytes(page, "rc10-export.png");
    if (exportedBytes === null) throw new Error("PNG export was not written.");
    const decoded = decode(exportedBytes);
    expect(decoded).toMatchObject({ width: 16, height: 16, channels: 4 });
    expect(Uint8Array.from(decoded.data)).toEqual(fixture.rgba);
  } finally {
    await app.close();
  }
});

test("packaged RC10 Canvas2D keeps top-left PNG orientation", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-rc10-canvas2d-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--force-canvas2d"],
  });
  try {
    const page = await waitForWorkspace(app),
      fixture = asymmetricPngFixture();
    await page.evaluate(async (values) => {
      const bytes = Uint8Array.from(values);
      await window.suwolDesktop?.test?.configureDialog({
        operation: "open",
        fileName: "rc10-canvas2d.png",
        data: bytes.buffer,
      });
    }, [...fixture.bytes]);
    await page.getByTestId("empty-open").click();
    await expect(page.getByTestId("pixel-canvas")).toHaveAttribute("data-renderer-mode", "canvas2d");
    await expectActivePixel(page, 0, 0, [255, 0, 0, 255]);
    await expectActivePixel(page, 0, 15, [0, 0, 255, 255]);
    await expectCanvas2dPixel(page, 0, 0, [255, 0, 0, 255]);
    await expectCanvas2dPixel(page, 0, 15, [0, 0, 255, 255]);
  } finally {
    await app.close();
  }
});

test("packaged RC10 renderer failure shows recovery actions", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-rc10-fatal-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--force-renderer-failure"],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).not.toContainText(/Error:| at |stack/i);
    await expect(page.getByRole("button", { name: /Reset workspace|작업 공간 초기화/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart without plugins|플러그인 없이/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open logs folder|로그 폴더/ })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("packaged RC10 boots legacy, corrupt, panel-free and plugin-disabled workspaces", async () => {
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-rc10-boot-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  let app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
  });
  try {
    let page = await waitForWorkspace(app);
    for (const stored of [
      "{broken",
      JSON.stringify({ version: 1, theme: "dark" }),
      JSON.stringify({ version: 2, language: "en" }),
      JSON.stringify({ version: 3, uiScale: 1.25 }),
    ]) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
        "suwol.pixel-studio.settings",
        stored,
      ] as const);
      await page.reload();
      await expect(page.getByTestId("workspace-shell")).toBeVisible();
    }
    for (const command of [
      "window.toggleLayers",
      "window.togglePalette",
      "window.toggleProperties",
      "window.togglePreview",
    ])
      await page.evaluate(async (id) => window.suwolTest?.executeCommand(id), command);
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await app.close();
    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userData}`, "--disable-plugins"],
    });
    page = await waitForWorkspace(app);
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("packaged basic editing UX exposes color, brush, palette, layer and export flow", async () => {
  test.setTimeout(90_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-basic-editing-user-data"),
    screenshots = path.resolve("test-results", "basic-editing-ux");
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(screenshots, { recursive: true, force: true });
  fs.mkdirSync(screenshots, { recursive: true });
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
  try {
    const page = await waitForWorkspace(app);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("empty-new").click();
    await page.getByLabel("Width").fill("32");
    await page.getByLabel("Height").fill("32");
    await page.getByTestId("create-document").click();

    await expect(page.getByTestId("tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("current-tool")).toContainText("Pencil");
    await expect(page.getByTestId("status-current-tool")).toContainText("Pencil · 1 px");
    await expect(page.getByTestId("tool-options-bar")).toHaveAttribute("data-options", /foreground.*size.*opacity/);
    await expect(page.getByTestId("editing-hint")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss editing hint" }).click();
    await expect(page.getByTestId("editing-hint")).toHaveCount(0);

    await page.getByTestId("foreground-color").fill("#ff0000");
    await expect(page.getByTestId("foreground-color")).toHaveValue("#ff0000");
    await page.getByTestId("brush-size").fill("3");
    await expect(page.getByTestId("properties-brush-size")).toHaveValue("3");
    const redPoint = await pixel(page, 10, 10);
    await page.mouse.click(redPoint.x, redPoint.y);
    for (let y = 9; y <= 11; y += 1)
      for (let x = 9; x <= 11; x += 1)
        await expectActivePixel(page, x, y, [255, 0, 0, 255]);
    await expectActivePixel(page, 8, 10, [0, 0, 0, 0]);

    await page.locator('[data-dock-tab="palette"]').click();
    await expect(page.getByTestId("recent-colors").getByRole("button")).toHaveCount(1);
    await setHex(page, "#0000ff");
    const bluePoint = await pixel(page, 20, 20);
    await page.mouse.click(bluePoint.x, bluePoint.y);
    await expectActivePixel(page, 20, 20, [0, 0, 255, 255]);
    const recentBefore = await page.getByTestId("recent-colors").getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(recentBefore).toEqual(["Set as foreground: #0000ff", "Set as foreground: #ff0000"]);
    await page.getByRole("button", { name: "Set as foreground: #ff0000" }).click();
    const recentAfter = await page.getByTestId("recent-colors").getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(recentAfter).toEqual(recentBefore);

    await page.getByTestId("palette-add").click();
    await setHex(page, "#0000ff");
    await page.getByTestId("palette-add").click();
    const palette = page.getByTestId("document-palette"),
      swatches = palette.locator(".palette-swatch"),
      paletteOrder = await swatches.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    await expect(swatches).toHaveCount(2);
    await swatches.first().click();
    await swatches.nth(1).click({ button: "right" });
    expect(await swatches.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(paletteOrder);
    await page.getByTestId("swap-colors").click();
    await expect(page.getByTestId("foreground-color")).toHaveValue("#0000ff");
    await expect(page.getByTestId("background-color")).toHaveValue("#ff0000");
    expect(await swatches.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(paletteOrder);
    await expect(palette.locator("input[type='text'], input:not([type])")).toHaveCount(0);

    await page.getByTestId("tool-eraser").click();
    await expect(page.getByTestId("current-tool")).toContainText("Eraser");
    await page.getByTestId("brush-size").fill("3");
    await page.mouse.click(redPoint.x, redPoint.y);
    for (let y = 9; y <= 11; y += 1)
      for (let x = 9; x <= 11; x += 1)
        await expectActivePixel(page, x, y, [0, 0, 0, 0]);

    await page.locator('[data-dock-tab="layers"]').click();
    await page.getByTestId("layer-add").click();
    await expect(page.getByTestId("layer-row")).toHaveCount(2);
    await page.locator('[data-dock-tab="properties"]').click();
    await page.getByTestId("layer-properties").getByLabel("Layer opacity").fill("75");
    await expect(page.getByTestId("layer-properties")).toContainText("75%");

    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({ operation: "save-suwolpixel", fileName: "basic-editing.suwolpixel" }));
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.saveAs"));
    await expect.poll(async () => (await artifactBytes(page, "basic-editing.suwolpixel"))?.byteLength ?? 0).toBeGreaterThan(100);
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.close"));
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({ operation: "open", fileName: "basic-editing.suwolpixel" }));
    await page.keyboard.press(process.platform === "darwin" ? "Meta+O" : "Control+O");
    await expect.poll(() => page.evaluate(() => window.suwolTest?.getCanvasSize())).toEqual({ width: 32, height: 32 });
    await page.evaluate(async () => window.suwolDesktop?.test?.configureDialog({ operation: "save-png", fileName: "basic-editing.png" }));
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.exportPng"));
    await expect.poll(async () => (await artifactBytes(page, "basic-editing.png"))?.byteLength ?? 0).toBeGreaterThan(50);
    const exportedPng = await artifactBytes(page, "basic-editing.png");
    if (exportedPng === null) throw new Error("Basic editing PNG was not exported.");
    fs.writeFileSync(path.join(screenshots, "basic-editing.png"), exportedPng);

    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyAnimationLayout"));
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    await page.getByTestId("toggle-onion").hover();
    await expect(page.getByRole("tooltip", { name: /Onion Skin/ })).toContainText("requires at least two frames");
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.applyStaticLayout"));
    await expect(page.getByTestId("panel-timeline")).toHaveCount(0);
    await page.locator('[data-dock-tab="palette"]').click();
    await expect(page.getByTestId("panel-palette")).toBeVisible();

    for (const visual of [
      { width: 1280, height: 720, scale: "1", theme: "dark" },
      { width: 1920, height: 1080, scale: "1.25", theme: "light" },
      { width: 1280, height: 720, scale: "2", theme: "dark" },
    ] as const) {
      await page.setViewportSize({ width: visual.width, height: visual.height });
      await page.getByTestId("ui-scale-select").selectOption(visual.scale);
      await page.getByTestId("theme-select").selectOption(visual.theme);
      const toolbar = page.getByTestId("tool-options-bar"),
        metrics = await toolbar.evaluate((element) => ({ height: element.getBoundingClientRect().height, scrollHeight: element.scrollHeight }));
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.height + 1);
      await page.screenshot({ path: path.join(screenshots, `${visual.width}x${visual.height}-${visual.scale}-${visual.theme}.png`) });
    }
  } finally {
    await app.close();
  }
});

test("packaged brush footprint preview and Eyedropper lifecycle never lock tools", async () => {
  test.setTimeout(240_000);
  const executablePath = findExecutable(path.resolve("out"));
  expect(executablePath, "packaged Electron executable").not.toBeNull();
  if (executablePath === null) throw new Error("Packaged executable was not found.");
  const userData = path.resolve("out", "e2e-pointer-lifecycle-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
  try {
    const page = await waitForWorkspace(app);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByLabel(/Language|언어/).selectOption("en");
    await page.getByTestId("empty-new").click();
    await page.getByLabel("Name", { exact: true }).fill("First");
    await page.getByTestId("create-document").click();
    const toolbarBox = await page.getByTestId("tool-options-bar").boundingBox(),
      tabsBox = await page.locator(".document-tabs").boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(tabsBox).not.toBeNull();
    expect((toolbarBox?.y ?? 1_000) + (toolbarBox?.height ?? 0)).toBeLessThanOrEqual(tabsBox?.y ?? 0);

    await page.getByTestId("brush-size").fill("5");
    const center = await pixel(page, 20, 20),
      expectedFive = Array.from({ length: 5 }, (_, dy) =>
        Array.from({ length: 5 }, (_, dx) => `${18 + dx},${18 + dy}`),
      ).flat().sort();
    await page.mouse.move(center.x, center.y);
    await expect.poll(() => overlayPixelSet(page, 64, 64)).toEqual(expectedFive);
    await page.mouse.click(center.x, center.y);
    await expect.poll(() => nonTransparentPixelSet(page, 64, 64)).toEqual(expectedFive);

    await page.getByTestId("tool-eraser").click();
    await expect(page.getByTestId("tool-options-bar")).toHaveAttribute("data-options", "size opacity preset");
    await page.mouse.move(center.x, center.y);
    await expect.poll(() => overlayPixelSet(page, 64, 64)).toEqual(expectedFive);
    await page.mouse.click(center.x, center.y);
    await expect.poll(() => nonTransparentPixelSet(page, 64, 64)).toEqual([]);

    await page.getByTestId("tool-pencil").click();
    await page.evaluate(async () => window.suwolTest?.executeCommand("symmetry.vertical"));
    const symmetryCenter = await pixel(page, 10, 25),
      symmetryExpected = [10, 53].flatMap((centerX) =>
        Array.from({ length: 5 }, (_, dy) =>
          Array.from({ length: 5 }, (_, dx) => `${centerX - 2 + dx},${23 + dy}`),
        ).flat(),
      ).sort();
    await page.mouse.move(symmetryCenter.x, symmetryCenter.y);
    await expect.poll(() => overlayPixelSet(page, 64, 64)).toEqual(symmetryExpected);
    await page.mouse.click(symmetryCenter.x, symmetryCenter.y);
    await expect.poll(() => nonTransparentPixelSet(page, 64, 64)).toEqual(symmetryExpected);
    await page.evaluate(async () => window.suwolTest?.executeCommand("symmetry.off"));

    await page.getByTestId("foreground-color").fill("#ff0000");
    const red = await pixel(page, 8, 8),
      blue = await pixel(page, 12, 8);
    await page.mouse.click(red.x, red.y);
    await page.getByTestId("foreground-color").fill("#0000ff");
    await page.mouse.click(blue.x, blue.y);
    await page.getByTestId("tool-eyedropper").click();
    await expect(page.getByTestId("eyedropper-options")).toContainText("Left click");
    await page.mouse.click(red.x, red.y);
    await expect(page.getByTestId("tool-eyedropper")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(blue.x, blue.y, { button: "right" });
    await expect(page.getByTestId("tool-eyedropper")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tool-pencil").click();
    await expect(page.getByTestId("foreground-color")).toHaveValue("#ff0000");
    await expect(page.getByTestId("background-color")).toHaveValue("#0000ff");

    await page.keyboard.down("Alt");
    await expect(page.getByTestId("current-tool")).toContainText("Eyedropper");
    await expect(page.getByTestId("status-current-tool")).toContainText("temporary");
    await page.mouse.click(red.x, red.y);
    await page.keyboard.up("Alt");
    await expect(page.getByTestId("current-tool")).toContainText("Pencil");

    const outside = await page.getByTestId("right-dock").boundingBox();
    if (outside === null) throw new Error("Right Dock bounds unavailable.");
    const outsideStart = await pixel(page, 30, 30);
    await page.mouse.move(outsideStart.x, outsideStart.y);
    await page.mouse.down();
    await page.mouse.move(outside.x + 30, outside.y + 80, { steps: 4 });
    await page.mouse.up();
    await page.getByTestId("tool-eraser").click();
    await page.getByTestId("tool-pencil").click();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.bringToFront();
    await page.getByTestId("tool-pencil").click();

    await page.getByTestId("brush-size").fill("1");
    for (let index = 0; index < 100; index += 1) {
      await page.getByTestId("tool-pencil").click();
      await page.getByTestId("tool-eyedropper").click();
      const beforeSample = await page.evaluate(() => window.suwolTest?.getActiveDocumentHash());
      await page.mouse.click(red.x, red.y);
      expect(await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).toBe(beforeSample);
      await page.getByTestId("tool-eraser").click();
      await page.getByTestId("tool-pencil").click();
      await page.keyboard.down("Alt");
      await page.mouse.click(red.x, red.y);
      await page.keyboard.up("Alt");
      await page.getByTestId("tool-pencil").click();
      await page.getByTestId("tool-selectionRect").click();
      await page.keyboard.press("Escape");
      await page.getByTestId("tool-pencil").click();
      const target = await pixel(page, 40 + index % 10, 40 + Math.floor(index / 10));
      await page.mouse.click(target.x, target.y);
      await expectActivePixel(page, 40 + index % 10, 40 + Math.floor(index / 10), [255, 0, 0, 255]);
      await expect(page.getByTestId("current-tool")).toContainText("Pencil");
    }

    const held = await pixel(page, 25, 25);
    await page.mouse.move(held.x, held.y);
    await page.mouse.down();
    await page.evaluate(async () => window.suwolTest?.executeCommand("file.new"));
    const newDocumentDialog = page.getByRole("dialog");
    await expect(newDocumentDialog).toBeVisible();
    await page.mouse.up();
    await newDocumentDialog.getByLabel("Name", { exact: true }).fill("Indexed");
    await newDocumentDialog.getByRole("combobox").selectOption("indexed");
    await newDocumentDialog.getByLabel("Width").fill("32");
    await newDocumentDialog.getByLabel("Height").fill("32");
    await page.getByTestId("create-document").click();
    await expect(newDocumentDialog).toHaveCount(0);
    await page.evaluate(async () => window.suwolTest?.executeCommand("view.zoomFit"));
    await page.getByTestId("brush-size").fill("5");
    const indexedCenter = await pixel(page, 10, 10),
      indexedExpected = Array.from({ length: 5 }, (_, dy) =>
        Array.from({ length: 5 }, (_, dx) => `${8 + dx},${8 + dy}`),
      ).flat().sort();
    await page.mouse.move(indexedCenter.x, indexedCenter.y);
    await expect.poll(() => overlayPixelSet(page, 32, 32)).toEqual(indexedExpected);
    await page.mouse.click(indexedCenter.x, indexedCenter.y);
    await expect.poll(() => nonTransparentPixelSet(page, 32, 32)).toEqual(indexedExpected);

    await page.getByRole("tab", { name: /First/ }).click();
    await page.getByRole("separator", { name: "Resize Right Dock" }).dragTo(page.getByTestId("right-dock"), { targetPosition: { x: 40, y: 100 } });
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("panel-timeline")).toBeVisible();
    await page.evaluate(async () => window.suwolTest?.executeCommand("window.toggleTimeline"));
    await expect(page.getByTestId("panel-timeline")).toHaveCount(0);
    await page.getByTestId("tool-pencil").click();
    const finalPoint = await pixel(page, 55, 55);
    await page.mouse.click(finalPoint.x, finalPoint.y);
    await expectActivePixel(page, 55, 55, [255, 0, 0, 255]);
  } finally {
    await app.close();
  }
});
