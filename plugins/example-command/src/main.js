const COMMAND_ID = "studio.suwol.example-command.invert";

export async function activate(context) {
  const registration = await context.commands.register(COMMAND_ID, async () => {
    await context.progress.run(
      { title: "Invert Pixels", cancellable: true },
      async (progress) => {
        const document = await context.documents.getActive();
        if (!document) throw new Error("No active document.");
        const info = await context.documents.request("getInfo", { documentId: document.id });
        const layers = await context.documents.request("getLayers", { documentId: document.id });
        const activeLayer = layers.find((layer) => layer.id === info.activeLayerId);
        if (!activeLayer || activeLayer.locked) throw new Error("The active layer is locked or missing.");
        const selection = await context.documents.request("getSelectionBounds", { documentId: document.id });
        const rect = selection || { x: 0, y: 0, width: document.width, height: document.height };
        progress.report({ percent: 10, message: "Reading pixels" });
        const pixels = await context.documents.request("readPixels", {
          documentId: document.id,
          options: { layerId: info.activeLayerId, frameId: info.activeFrameId, rect }
        });
        const bytes = new Uint8Array(pixels);
        for (let offset = 0; offset < bytes.length; offset += 4) {
          if (progress.aborted) return;
          bytes[offset] = 255 - bytes[offset];
          bytes[offset + 1] = 255 - bytes[offset + 1];
          bytes[offset + 2] = 255 - bytes[offset + 2];
        }
        progress.report({ percent: 75, message: "Writing transaction" });
        if (progress.aborted) return;
        await context.documents.request(
          "transaction",
          {
            documentId: document.id,
            expectedRevision: document.revision,
            label: "Invert Pixels",
            operations: [
              {
                type: "writePixels",
                options: {
                  layerId: info.activeLayerId,
                  frameId: info.activeFrameId,
                  rect,
                  pixels: bytes.buffer
                }
              }
            ]
          },
          [bytes.buffer]
        );
        progress.report({ percent: 100, message: "Complete" });
      }
    );
  });
  context.subscriptions.add(registration);
}

export async function deactivate() {}
