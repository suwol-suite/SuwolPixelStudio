import {
  IndexedPixelSurface,
  RgbaPixelSurface,
  type PixelSurface,
} from "./surface";
import { assertDocumentIntegrity, celKey, recountImageReferences } from "./animation";
import {
  makeId,
  type DocumentSnapshot,
  type ImageId,
  type PixelDocument,
} from "./types";

export interface CreateDocumentOptions {
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly layerName: string;
  readonly colorMode?: "rgba" | "indexed";
  readonly palette?: readonly (readonly [number, number, number, number])[];
  readonly maxPaletteSize?: number;
  readonly transparentIndex?: number;
}

export interface DocumentState {
  readonly model: PixelDocument;
  readonly surfaces: Map<ImageId, PixelSurface>;
  readonly tilemapSurfaces: Map<string, Uint32Array>;
}

export function cloneDocumentModel(model: PixelDocument): PixelDocument {
  const cloned: PixelDocument = {
    ...model,
    canvas: { ...model.canvas },
    rootLayerIds: [...model.rootLayerIds],
    layerOrder: [...model.layerOrder],
    layers: Object.fromEntries(
      Object.entries(model.layers).map(([id, layer]) => [
        id,
        layer.kind === "group"
          ? { ...layer, childIds: [...layer.childIds] }
          : { ...layer },
      ]),
    ),
    frameOrder: [...model.frameOrder],
    frames: Object.fromEntries(
      Object.entries(model.frames).map(([id, frame]) => [id, { ...frame }]),
    ),
    cels: Object.fromEntries(
      Object.entries(model.cels).map(([id, cel]) => [id, { ...cel }]),
    ),
    celByLayerAndFrame: { ...model.celByLayerAndFrame },
    images: Object.fromEntries(
      Object.entries(model.images).map(([id, image]) => [id, { ...image }]),
    ),
    tilemaps: Object.fromEntries(
      Object.entries(model.tilemaps).map(([id, image]) => [id, { ...image }]),
    ),
    tileSets: structuredClone(model.tileSets),
    palette: {
      entries: model.palette.entries.map((color) => ({
        ...color,
        rgba: [...color.rgba] as unknown as typeof color.rgba,
      })),
      colors: [],
      transparentIndex: model.palette.transparentIndex,
      maxSize: model.palette.maxSize,
    },
    tags: Object.fromEntries(
      Object.entries(model.tags).map(([id, tag]) => [id, { ...tag, color: [...tag.color] as unknown as typeof tag.color }]),
    ),
    slices: structuredClone(model.slices),
    metadata: structuredClone(model.metadata),
    ...(model.pluginData === undefined
      ? {}
      : { pluginData: structuredClone(model.pluginData) }),
  };
  cloned.palette.colors = cloned.palette.entries;
  return cloned;
}

export function createDocument(options: CreateDocumentOptions): DocumentState {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const colorMode = options.colorMode ?? "rgba",
    transparentIndex = options.transparentIndex ?? 0,
    sourcePalette = options.palette ?? [
      [0, 0, 0, 0],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ],
    entries = sourcePalette.slice(0, options.maxPaletteSize ?? 256).map((rgba, index) => ({
      id: makeId("palette"),
      index,
      rgba,
    })),
    surface = colorMode === "indexed"
      ? new IndexedPixelSurface(width, height, undefined, entries.map((entry) => entry.rgba), transparentIndex)
      : new RgbaPixelSurface(width, height);
  const documentId = makeId("document");
  const layerId = makeId("layer");
  const frameId = makeId("frame");
  const celId = makeId("cel");
  const imageId = makeId("image");
  const model: PixelDocument = {
    schemaVersion: 4,
    id: documentId,
    name: options.name,
    canvas: {
      width,
      height,
      colorMode,
      colorSpace: "srgb",
      ...(colorMode === "indexed" ? { transparentIndex } : {}),
    },
    rootLayerIds: [layerId],
    layerOrder: [layerId],
    layers: {
      [layerId]: {
        id: layerId,
        kind: "pixel",
        name: options.layerName,
        parentId: null,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
      },
    },
    frameOrder: [frameId],
    frames: { [frameId]: { id: frameId, durationMs: 100 } },
    cels: {
      [celId]: {
        kind: "pixel",
        id: celId,
        layerId,
        frameId,
        imageId,
        x: 0,
        y: 0,
        opacity: 1,
      },
    },
    celByLayerAndFrame: { [celKey(layerId, frameId)]: celId },
    images: {
      [imageId]: {
        id: imageId,
        width,
        height,
        format: colorMode === "indexed" ? "indexed8" : "rgba8",
        refCount: 1,
      },
    },
    tilemaps: {},
    tileSets: {},
    palette: {
      entries: colorMode === "indexed" ? entries : [],
      colors: colorMode === "indexed" ? entries : [],
      transparentIndex: colorMode === "indexed" ? transparentIndex : null,
      maxSize: options.maxPaletteSize ?? 256,
    },
    tags: {},
    slices: {},
    metadata: {},
    pluginData: {},
    revision: 0,
  };
  return {
    model,
    surfaces: new Map([[imageId, surface]]),
    tilemapSurfaces: new Map(),
  };
}

export function stateFromSnapshot(snapshot: DocumentSnapshot): DocumentState {
  const model = cloneDocumentModel(snapshot.model);
  recountImageReferences(model);
  assertDocumentIntegrity(model);
  const surfaces = new Map<ImageId, PixelSurface>();
  for (const [imageId, meta] of Object.entries(model.images)) {
    const bytes = snapshot.images.get(imageId);
    if (bytes === undefined)
      throw new Error(`Missing image bytes for ${imageId}.`);
    surfaces.set(
      imageId,
      meta.format === "indexed8"
        ? new IndexedPixelSurface(
            meta.width,
            meta.height,
            bytes,
            model.palette.entries.map((entry) => entry.rgba),
            model.palette.transparentIndex ?? 0,
          )
        : new RgbaPixelSurface(meta.width, meta.height, bytes),
    );
  }
  const tilemapSurfaces = new Map<string, Uint32Array>();
  for (const [id, meta] of Object.entries(model.tilemaps)) {
    const cells = snapshot.tilemaps?.get(id);
    if (cells?.length !== meta.widthInTiles * meta.heightInTiles)
      throw new Error(`Missing tilemap cells for ${id}.`);
    tilemapSurfaces.set(id, cells.slice());
  }
  const state = { model, surfaces, tilemapSurfaces };
  for (const imageId of Object.keys(model.images))
    if (!surfaces.has(imageId)) throw new Error(`Missing image surface for ${imageId}.`);
  return state;
}

export function snapshotDocument(state: DocumentState): DocumentSnapshot {
  recountImageReferences(state.model);
  assertDocumentIntegrity(state.model);
  return {
    model: cloneDocumentModel(state.model),
    images: new Map(
      [...state.surfaces.entries()].map(([id, surface]) => [
        id,
        surface.getBytes(),
      ]),
    ),
    tilemaps: new Map(
      [...state.tilemapSurfaces.entries()].map(([id, cells]) => [id, cells.slice()]),
    ),
  };
}
