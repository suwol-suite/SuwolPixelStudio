import type { PixelSurface } from "@suwol/editor-core";

export interface ThumbnailPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export class CelThumbnailService {
  readonly #cache = new Map<string, ThumbnailPixels>();
  constructor(
    readonly maximumEntries = 128,
    readonly maximumSize = 32,
  ) {}

  get(imageId: string, revision: number, surface: PixelSurface): ThumbnailPixels {
    const key = `${imageId}:${revision}`,
      cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    const scale = Math.min(1, this.maximumSize / Math.max(surface.width, surface.height)),
      width = Math.max(1, Math.round(surface.width * scale)),
      height = Math.max(1, Math.round(surface.height * scale)),
      source = surface.getBytes(),
      rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(surface.width - 1, Math.floor(x / scale)),
          sy = Math.min(surface.height - 1, Math.floor(y / scale)),
          sourceOffset = (sy * surface.width + sx) * 4;
        rgba.set(source.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
      }
    const result = { width, height, rgba };
    this.#cache.set(key, result);
    while (this.#cache.size > this.maximumEntries) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    return result;
  }
  clear(): void {
    this.#cache.clear();
  }
}
