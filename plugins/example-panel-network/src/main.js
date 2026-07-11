const PANEL_ID = "studio.suwol.example-panel-network.panel";

export async function activate(context) {
  const subscription = context.panels.onMessage(PANEL_ID, async (message) => {
    if (message?.type === "crash") {
      queueMicrotask(() => { throw new Error("Intentional sample runtime crash"); });
      return;
    }
    if (!message || message.type !== "generate" || typeof message.endpoint !== "string") return;
    let stage = "document";
    try {
      const document = await context.documents.getActive();
      if (!document) throw new Error("No active document.");
      const selection = await context.documents.request("getSelectionBounds", { documentId: document.id });
      await context.panels.postMessage(PANEL_ID, { type: "document", document, selection });
      stage = "storage";
      await context.storage.set("lastEndpoint", message.endpoint);
      await context.progress.run(
        { title: "Local Pixel Generation", cancellable: true },
        async (progress) => {
          progress.report({ percent: 10, message: "Calling localhost" });
          stage = "network";
          const response = await context.network.request({ method: "POST", url: message.endpoint });
          if (progress.aborted) return;
          stage = "decode";
          const payload = JSON.parse(new TextDecoder().decode(response.body));
          if (!Number.isInteger(payload.width) || !Number.isInteger(payload.height) || !Array.isArray(payload.rgba))
            throw new Error("Endpoint response must contain width, height, and rgba.");
          const width = Math.min(document.width, payload.width);
          const height = Math.min(document.height, payload.height);
          const pixels = Uint8Array.from(payload.rgba);
          if (pixels.byteLength !== width * height * 4) throw new Error("RGBA response length is invalid.");
          progress.report({ percent: 65, message: "Creating layer" });
          if (progress.aborted) return;
          stage = "transaction";
          const info = await context.documents.request("getInfo", { documentId: document.id });
          await context.documents.request(
            "transaction",
            {
              documentId: document.id,
              expectedRevision: document.revision,
              label: "Insert Local Pixel Result",
              operations: [
                { type: "addPixelLayer", temporaryId: "temp:result-layer", name: "Local Pixel Result" },
                {
                  type: "writePixels",
                  options: {
                    layerId: "temp:result-layer",
                    frameId: info.activeFrameId,
                    rect: { x: 0, y: 0, width, height },
                    pixels: pixels.buffer
                  }
                }
              ]
            },
            [pixels.buffer]
          );
          progress.report({ percent: 100, message: "Complete" });
          await context.panels.postMessage(PANEL_ID, { type: "complete" });
        }
      );
    } catch (error) {
      await context.panels.postMessage(PANEL_ID, { type: "error", message: `${stage}: ${error instanceof Error ? error.message : "Request failed"}` });
    }
  });
  context.subscriptions.add(subscription);
}

export async function deactivate() {}
