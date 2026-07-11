const importerId = "studio.suwol.example-professional.importer";
const exporterId = "studio.suwol.example-professional.exporter";
const toolId = "studio.suwol.example-professional.tool";
const overlayId = "studio.suwol.example-professional.overlay";

export async function activate(context) {
  context.subscriptions.add(await context.importers.register(importerId, async (input) => {
    const decoded = JSON.parse(new TextDecoder().decode(input.bytes));
    const rgba = Array.isArray(decoded.rgba) && decoded.rgba.length === 4 ? decoded.rgba : [0, 0, 0, 255];
    return { document: { name: input.name, width: 1, height: 1, colorMode: "rgba", palette: [], frames: [{ durationMs: 100 }], layers: [{ id: "temp:layer", name: "Imported" }], cels: [{ layerId: "temp:layer", frameIndex: 0, x: 0, y: 0, width: 1, height: 1, format: "rgba8", pixels: Uint8Array.from(rgba).buffer }] }, warnings: [] };
  }));
  context.subscriptions.add(await context.exporters.register(exporterId, async (input) => ({ files: [{ relativePath: "summary.json", mediaType: "application/json", data: new TextEncoder().encode(JSON.stringify(input.document)).buffer }] })));
  context.subscriptions.add(await context.tools.register(toolId, async (event) => event.type === "pointerMove" ? [{ type: "pixels", points: event.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })), rgba: [54, 160, 218, 255] }] : []));
  await context.overlays.update({ overlayId, lifetimeMs: 60000, primitives: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 16, y: 16 }, style: { color: [54, 160, 218, 180], width: 1 } }] });
}

export async function deactivate() {}
