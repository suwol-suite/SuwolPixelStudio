import {
  PLUGIN_LIMITS,
  pluginTransactionRequestSchema,
  readPixelsOptionsSchema,
  type PluginDocumentSummary,
  type PluginFrameInfo,
  type PluginIntRect,
  type PluginLayerInfo,
  type PluginPalette,
  type PluginPermission,
  type ReadPixelsOptions,
  type TransactionOperation,
} from "@suwol/plugin-api";
import {
  type EditorSession,
  type IntRect,
} from "@suwol/editor-core";
import { PluginError } from "./errors";
import { normalizeStorageValue } from "./storage";

export interface PluginHostDocument {
  readonly session: EditorSession;
  readonly activeLayerId: string;
  readonly activeFrameId: string;
  readonly selectionBounds: PluginIntRect | null;
}
export interface PluginDocumentProvider {
  getActive(): PluginHostDocument | null;
  listOpen(): readonly PluginHostDocument[];
}

export class PluginDocumentBroker {
  constructor(readonly provider: PluginDocumentProvider) {}

  getActive(pluginId: string, grants: readonly PluginPermission[]): PluginDocumentSummary | null {
    this.#require(grants, "document.read", pluginId);
    const active = this.provider.getActive();
    return active === null ? null : this.#summary(active);
  }
  listOpen(pluginId: string, grants: readonly PluginPermission[]): readonly PluginDocumentSummary[] {
    this.#require(grants, "document.read", pluginId);
    return this.provider.listOpen().map((document) => this.#summary(document));
  }
  getInfo(documentId: string, pluginId: string, grants: readonly PluginPermission[]): Readonly<PluginDocumentSummary & { activeLayerId: string; activeFrameId: string }> {
    this.#require(grants, "document.read", pluginId);
    const document = this.#document(documentId);
    return {
      ...this.#summary(document),
      activeLayerId: document.activeLayerId,
      activeFrameId: document.activeFrameId,
    };
  }
  getLayers(documentId: string, pluginId: string, grants: readonly PluginPermission[]): readonly PluginLayerInfo[] {
    this.#require(grants, "document.read", pluginId);
    const document = this.#document(documentId);
    return document.session.model.layerOrder.map((id) => {
      const layer = document.session.model.layers[id];
      if (layer === undefined) throw new PluginError("TRANSACTION_FAILED", "Document layer is missing.");
      return { id, name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity };
    });
  }
  getFrames(documentId: string, pluginId: string, grants: readonly PluginPermission[]): readonly PluginFrameInfo[] {
    this.#require(grants, "document.read", pluginId);
    const document = this.#document(documentId);
    return document.session.model.frameOrder.map((id) => {
      const frame = document.session.model.frames[id];
      if (frame === undefined) throw new PluginError("TRANSACTION_FAILED", "Document frame is missing.");
      return { id, durationMs: frame.durationMs };
    });
  }
  getSelectionBounds(documentId: string, pluginId: string, grants: readonly PluginPermission[]): PluginIntRect | null {
    this.#require(grants, "selection.read", pluginId);
    return this.#document(documentId).selectionBounds;
  }
  readPalette(documentId: string, pluginId: string, grants: readonly PluginPermission[]): PluginPalette {
    this.#require(grants, "palette.read", pluginId);
    const palette = this.#document(documentId).session.model.palette;
    return {
      colors: palette.colors.map((color) => ({
        id: color.id,
        ...(color.name === undefined ? {} : { name: color.name }),
        rgba: [...color.rgba] as [number, number, number, number],
      })),
    };
  }
  readPixels(
    documentId: string,
    input: unknown,
    pluginId: string,
    grants: readonly PluginPermission[],
  ): ArrayBuffer {
    this.#require(grants, "document.read", pluginId);
    const options = readPixelsOptionsSchema.parse(input);
    const document = this.#document(documentId);
    this.#validateRead(document, options);
    const cel = document.session.getCel(options.layerId, options.frameId);
    const bytes = cel === null
      ? new Uint8Array(options.rect.width * options.rect.height * 4)
      : document.session.getSurface(cel.imageId).readRegion(options.rect);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  transaction(
    input: unknown,
    pluginId: string,
    grants: readonly PluginPermission[],
    signal?: AbortSignal,
  ): Readonly<{ ids: Readonly<Record<string, string>>; revision: number }> {
    this.#require(grants, "document.write", pluginId);
    const request = pluginTransactionRequestSchema.parse(input);
    const document = this.#document(request.documentId);
    if (document.session.model.revision !== request.expectedRevision)
      throw new PluginError("TRANSACTION_FAILED", "Document revision changed before the plugin transaction.");
    const estimatedBytes = request.operations.reduce(
      (sum, operation) => sum + (operation.type === "writePixels" ? operation.options.pixels.byteLength : 512),
      0,
    );
    if (estimatedBytes > PLUGIN_LIMITS.transactionBytes)
      throw new PluginError("TRANSACTION_FAILED", "Plugin transaction exceeds the size limit.");
    const ids: Record<string, string> = {};
    try {
      document.session.runTransaction(
        request.label,
        () => {
          for (const operation of request.operations) {
            if (signal?.aborted === true) throw new DOMException("Operation cancelled.", "AbortError");
            this.#applyOperation(document, operation, ids, pluginId, grants);
          }
        },
        { source: "plugin", pluginId },
      );
    } catch (error) {
      if (error instanceof PluginError || error instanceof DOMException) throw error;
      throw new PluginError("TRANSACTION_FAILED", "Plugin document transaction failed.");
    }
    return { ids, revision: document.session.model.revision };
  }

  #applyOperation(
    document: PluginHostDocument,
    operation: TransactionOperation,
    ids: Record<string, string>,
    pluginId: string,
    grants: readonly PluginPermission[],
  ): void {
    const resolve = (id: string) => ids[id] ?? id;
    switch (operation.type) {
      case "addPixelLayer": {
        if (ids[operation.temporaryId] !== undefined)
          throw new PluginError("TRANSACTION_FAILED", "Duplicate temporary transaction id.");
        ids[operation.temporaryId] = document.session.addLayer(operation.name);
        break;
      }
      case "addFrame": {
        if (ids[operation.temporaryId] !== undefined)
          throw new PluginError("TRANSACTION_FAILED", "Duplicate temporary transaction id.");
        const after = resolve(operation.afterFrameId ?? document.activeFrameId);
        ids[operation.temporaryId] = document.session.addFrame(after, "empty");
        break;
      }
      case "writePixels": {
        this.#writePixels(document, {
          ...operation.options,
          layerId: resolve(operation.options.layerId),
          frameId: resolve(operation.options.frameId),
        });
        break;
      }
      case "clearPixels": {
        const options = {
          ...operation.options,
          layerId: resolve(operation.options.layerId),
          frameId: resolve(operation.options.frameId),
        };
        this.#validateRead(document, options);
        const bytes = new ArrayBuffer(options.rect.width * options.rect.height * 4);
        this.#writePixels(document, { ...options, pixels: bytes });
        break;
      }
      case "setLayerName":
        document.session.renameLayer(resolve(operation.layerId), operation.name);
        break;
      case "setLayerVisibility":
        document.session.setLayerVisible(resolve(operation.layerId), operation.visible);
        break;
      case "setPalette":
        this.#require(grants, "palette.write", pluginId);
        document.session.setPalette(operation.palette.colors);
        break;
      case "setPluginData":
        document.session.setPluginData(pluginId, normalizeStorageValue(operation.value));
        break;
    }
  }

  #writePixels(
    document: PluginHostDocument,
    options: Readonly<ReadPixelsOptions & { pixels: ArrayBuffer }>,
  ): void {
    this.#validateRead(document, options);
    const layer = document.session.model.layers[options.layerId];
    if (layer?.locked === true)
      throw new PluginError("TRANSACTION_FAILED", "Locked layers cannot be modified.");
    const expected = options.rect.width * options.rect.height * 4;
    if (options.pixels.byteLength !== expected || expected > PLUGIN_LIMITS.pixelTransferBytes)
      throw new PluginError("TRANSACTION_FAILED", "Plugin pixel payload length is invalid.");
    document.session.setActiveFrame(options.frameId);
    const before = document.session.getActiveSurfaceForRead(options.layerId).readRegion(options.rect);
    document.session.applyPixelPatch(
      options.layerId,
      options.rect,
      before,
      new Uint8Array(options.pixels.slice(0)),
      "Plugin Pixel Write",
    );
  }

  #validateRead(document: PluginHostDocument, options: ReadPixelsOptions): void {
    if (document.session.model.layers[options.layerId] === undefined || document.session.model.frames[options.frameId] === undefined)
      throw new PluginError("TRANSACTION_FAILED", "Plugin pixel target does not exist.");
    const rect = options.rect as IntRect;
    const canvas = document.session.model.canvas;
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > canvas.width || rect.y + rect.height > canvas.height)
      throw new PluginError("TRANSACTION_FAILED", "Plugin pixel rectangle is outside the canvas.");
    if (rect.width * rect.height * 4 > PLUGIN_LIMITS.pixelTransferBytes)
      throw new PluginError("TRANSACTION_FAILED", "Plugin pixel request exceeds the size limit.");
  }
  #document(documentId: string): PluginHostDocument {
    const document = this.provider.listOpen().find((entry) => entry.session.model.id === documentId);
    if (document === undefined) throw new PluginError("TRANSACTION_FAILED", "Plugin document is not open.");
    return document;
  }
  #summary(document: PluginHostDocument): PluginDocumentSummary {
    const model = document.session.model;
    return { id: model.id, name: model.name, width: model.canvas.width, height: model.canvas.height, revision: model.revision };
  }
  #require(grants: readonly PluginPermission[], permission: PluginPermission, pluginId: string): void {
    if (!grants.includes(permission))
      throw new PluginError("PERMISSION_DENIED", "Plugin capability permission was not granted.", { pluginId, permission });
  }
}
