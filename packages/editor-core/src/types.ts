export type DocumentId = string;
export type LayerId = string;
export type ImageId = string;
export type TilemapImageId = string;
export type TileSetId = string;
export type SliceId = string;
export type PaletteColorId = string;
export type FrameId = string;
export type CelId = string;
export type TagId = string;

export type Rgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];
export type ColorMode = "rgba" | "indexed";
export type ImageFormat = "rgba8" | "indexed8";
export type LayerKind = "pixel" | "group" | "tilemap";
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "addition",
  "subtract",
  "difference",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface IntPoint {
  readonly x: number;
  readonly y: number;
}
export interface IntRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type DirtyRegion = IntRect;

export interface PixelDocument {
  schemaVersion: 4;
  id: DocumentId;
  name: string;
  canvas: {
    width: number;
    height: number;
    colorMode: ColorMode;
    colorSpace: "srgb";
    transparentIndex?: number;
  };
  rootLayerIds: LayerId[];
  /** In-memory flattened adapter retained while M1-M4 views migrate to the tree. */
  layerOrder: LayerId[];
  layers: Record<LayerId, Layer>;
  frameOrder: FrameId[];
  frames: Record<FrameId, Frame>;
  cels: Record<CelId, Cel>;
  celByLayerAndFrame: Record<string, CelId>;
  images: Record<ImageId, PixelImageMeta>;
  tilemaps: Record<TilemapImageId, TilemapImageMeta>;
  tileSets: Record<TileSetId, TileSet>;
  palette: Palette;
  tags: Record<TagId, FrameTag>;
  slices: Record<SliceId, SliceDefinition>;
  metadata: Record<string, unknown>;
  pluginData?: Record<string, unknown>;
  revision: number;
}

export interface Frame {
  id: FrameId;
  durationMs: number;
}

interface CelBase {
  id: CelId;
  layerId: LayerId;
  frameId: FrameId;
  x: number;
  y: number;
  opacity: number;
}
export interface PixelCel extends CelBase {
  kind: "pixel";
  imageId: ImageId;
  tilemapImageId?: never;
}
export interface TilemapCel extends CelBase {
  kind: "tilemap";
  tilemapImageId: TilemapImageId;
  imageId?: never;
}
export type Cel = PixelCel | TilemapCel;

export type TagPlayback = "forward" | "reverse" | "pingpong";
export interface FrameTag {
  id: TagId;
  name: string;
  fromFrameId: FrameId;
  toFrameId: FrameId;
  playback: TagPlayback;
  color: Rgba;
}

export interface PaletteEntry {
  id: PaletteColorId;
  index: number;
  name?: string;
  rgba: Rgba;
  locked?: boolean;
}
/** Legacy name retained as a source-compatible alias. */
export type PaletteColor = PaletteEntry;
export interface Palette {
  entries: PaletteEntry[];
  /** Same ordered entries as `entries`; maintained by normalizeDocumentModel. */
  colors: PaletteEntry[];
  transparentIndex: number | null;
  maxSize: number;
}

export interface LayerBase {
  id: LayerId;
  kind: LayerKind;
  name: string;
  parentId: LayerId | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
}
export interface PixelLayer extends LayerBase {
  kind: "pixel";
}
export interface GroupLayer extends LayerBase {
  kind: "group";
  childIds: LayerId[];
}
export interface TilemapLayer extends LayerBase {
  kind: "tilemap";
  tileSetId: TileSetId;
}
export type Layer = PixelLayer | GroupLayer | TilemapLayer;

export interface PixelImageMeta {
  id: ImageId;
  width: number;
  height: number;
  format: ImageFormat;
  refCount: number;
}
export interface TilemapImageMeta {
  id: TilemapImageId;
  widthInTiles: number;
  heightInTiles: number;
  format: "tile32";
  refCount: number;
}
export interface TileSet {
  id: TileSetId;
  name: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  atlasImageId: ImageId;
  emptyTileId: number;
  spacing?: number;
  margin?: number;
  tileMetadata?: Record<string, Readonly<{ name?: string; metadata?: unknown }>>;
}
export interface SliceDefinition {
  id: SliceId;
  name: string;
  bounds: IntRect;
  center?: IntRect;
  pivot?: IntPoint;
}

export interface PixelPatch {
  readonly imageId: ImageId;
  readonly format?: ImageFormat;
  readonly rect: IntRect;
  readonly before: Uint8Array;
  readonly after: Uint8Array;
}
export interface TilemapPatch {
  readonly tilemapImageId: TilemapImageId;
  readonly rect: IntRect;
  readonly before: Uint32Array;
  readonly after: Uint32Array;
}

export interface DocumentSnapshot {
  readonly model: PixelDocument;
  readonly images: ReadonlyMap<ImageId, Uint8Array>;
  readonly tilemaps?: ReadonlyMap<TilemapImageId, Uint32Array>;
}

export function isPixelCel(cel: Cel): cel is PixelCel {
  return cel.kind === "pixel";
}
export function isTilemapCel(cel: Cel): cel is TilemapCel {
  return cel.kind === "tilemap";
}

export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function normalizeRgba(color: Rgba): Rgba {
  const values = color.map((value) =>
    Math.min(255, Math.max(0, Math.round(value))),
  ) as unknown as Rgba;
  return values[3] === 0 ? [0, 0, 0, 0] : values;
}

export function intersectRect(rect: IntRect, bounds: IntRect): IntRect {
  const left = Math.max(rect.x, bounds.x);
  const top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function unionRect(
  first: IntRect | null,
  second: IntRect | null,
): IntRect | null {
  if (first === null) return second;
  if (second === null) return first;
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x, y, width: right - x, height: bottom - y };
}
