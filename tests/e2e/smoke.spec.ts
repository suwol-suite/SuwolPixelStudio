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
  await page.getByLabel("A", { exact: true }).fill("255");
  const input = page.getByLabel("HEX");
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
  await page.waitForURL("suwol-pixel://app/index.html");
  await expect(page.getByTestId("workspace-shell")).toBeVisible({
    timeout: 15_000,
  });
  return page;
}
async function executePalette(page: Page, query: string): Promise<void> {
  await page.getByTestId("open-command-palette").click();
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
  for (const checkbox of await review.locator('input[type="checkbox"]').all())
    await checkbox.check();
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
      app: ["getVersion", "getPlatform"],
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
    await page.getByTestId("open-command-palette").click();
    await page.getByRole("searchbox").fill("PNG");
    await page.getByRole("searchbox").press("Enter");
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
    expect(await page.evaluate(() => window.suwolTest?.getAnimationState()?.durations)).toEqual([120, 160, 200, 80]);
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
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getActiveDocumentHash())).not.toBe(beforeTool);
    await page.getByRole("dialog", { name: "Plugin Manager" }).getByRole("button", { name: "Close" }).click();
    await page.evaluate(async () => window.suwolTest?.executeCommand("sprite.convertToIndexed"));
    const conversionDialog = page.getByRole("dialog", { name: "Convert to Indexed Color" });
    await conversionDialog.getByRole("button", { name: "Convert" }).click();
    await expect.poll(async () => await page.evaluate(() => window.suwolTest?.getProfessionalState()?.colorMode)).toBe("indexed");
  } finally {
    await app.close();
  }
});
