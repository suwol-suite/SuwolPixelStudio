import { intersectRect, unionRect, type IntRect } from "./types";

export type SelectionOperation = "replace" | "add" | "subtract" | "intersect";

export interface SelectionMask {
  readonly width: number;
  readonly height: number;
  readonly bounds: IntRect | null;
  readonly selectedCount: number;
  contains(x: number, y: number): boolean;
  setRect(rect: IntRect, operation: SelectionOperation): void;
  clear(): void;
  clone(): SelectionMask;
}

/** One bit per canvas pixel, allocated lazily and with a cached exact bounds. */
export class BitSelectionMask implements SelectionMask {
  readonly width: number;
  readonly height: number;
  #bits: Uint8Array | null = null;
  #bounds: IntRect | null = null;
  #selectedCount = 0;

  constructor(width: number, height: number) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    )
      throw new RangeError("Selection dimensions must be positive integers.");
    this.width = width;
    this.height = height;
  }

  get bounds(): IntRect | null {
    return this.#bounds;
  }
  get selectedCount(): number {
    return this.#selectedCount;
  }

  contains(x: number, y: number): boolean {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height ||
      this.#bits === null
    )
      return false;
    const index = y * this.width + x;
    return ((this.#bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
  }

  setRect(input: IntRect, operation: SelectionOperation): void {
    const rect = intersectRect(normalizeRect(input), {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    });
    if (operation === "replace") this.clear();
    if (operation === "intersect") {
      if (this.#bits === null) return;
      this.#forEachSet((x, y) => {
        if (!pointInRect(x, y, rect)) this.#set(x, y, false);
      });
      this.#recalculate();
      return;
    }
    if (rect.width === 0 || rect.height === 0) {
      if (operation === "replace") this.clear();
      return;
    }
    if (operation === "add" || operation === "replace") {
      this.#bits ??= new Uint8Array(Math.ceil((this.width * this.height) / 8));
      for (let y = rect.y; y < rect.y + rect.height; y += 1)
        for (let x = rect.x; x < rect.x + rect.width; x += 1)
          this.#set(x, y, true);
      this.#bounds = unionRect(this.#bounds, rect);
      return;
    }
    if (this.#bits === null) return;
    for (let y = rect.y; y < rect.y + rect.height; y += 1)
      for (let x = rect.x; x < rect.x + rect.width; x += 1)
        this.#set(x, y, false);
    this.#recalculate();
  }

  clear(): void {
    this.#bits = null;
    this.#bounds = null;
    this.#selectedCount = 0;
  }

  clone(): BitSelectionMask {
    const result = new BitSelectionMask(this.width, this.height);
    result.#bits = this.#bits?.slice() ?? null;
    result.#bounds = this.#bounds === null ? null : { ...this.#bounds };
    result.#selectedCount = this.#selectedCount;
    return result;
  }

  translated(
    dx: number,
    dy: number,
    width = this.width,
    height = this.height,
  ): BitSelectionMask {
    const result = new BitSelectionMask(width, height);
    this.#forEachSet((x, y) => {
      const nx = x + Math.round(dx),
        ny = y + Math.round(dy);
      if (nx >= 0 && ny >= 0 && nx < width && ny < height)
        result.#set(nx, ny, true);
    });
    result.#recalculate();
    return result;
  }

  resized(width: number, height: number): BitSelectionMask {
    const result = new BitSelectionMask(width, height);
    this.#forEachSet((x, y) => {
      const nx = Math.min(width - 1, Math.floor((x * width) / this.width)),
        ny = Math.min(height - 1, Math.floor((y * height) / this.height));
      result.#set(nx, ny, true);
    });
    result.#recalculate();
    return result;
  }

  forEachSelected(visitor: (x: number, y: number) => void): void {
    this.#forEachSet(visitor);
  }

  #set(x: number, y: number, selected: boolean): void {
    this.#bits ??= new Uint8Array(Math.ceil((this.width * this.height) / 8));
    const index = y * this.width + x,
      byte = index >> 3,
      bit = 1 << (index & 7),
      current = this.#bits[byte] ?? 0,
      was = (current & bit) !== 0;
    if (was === selected) return;
    if (selected) {
      this.#bits[byte] = current | bit;
      this.#selectedCount += 1;
      this.#bounds = unionRect(this.#bounds, { x, y, width: 1, height: 1 });
    } else {
      this.#bits[byte] = current & ~bit;
      this.#selectedCount -= 1;
    }
  }
  #forEachSet(visitor: (x: number, y: number) => void): void {
    if (this.#bits === null || this.#bounds === null) return;
    const rect = this.#bounds;
    for (let y = rect.y; y < rect.y + rect.height; y += 1)
      for (let x = rect.x; x < rect.x + rect.width; x += 1)
        if (this.contains(x, y)) visitor(x, y);
  }
  #recalculate(): void {
    if (this.#selectedCount === 0) {
      this.clear();
      return;
    }
    let minX = this.width,
      minY = this.height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < this.height; y += 1)
      for (let x = 0; x < this.width; x += 1)
        if (this.contains(x, y)) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
    this.#bounds =
      maxX < 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
}

function normalizeRect(rect: IntRect): IntRect {
  const x2 = rect.x + rect.width,
    y2 = rect.y + rect.height;
  return {
    x: Math.min(rect.x, x2),
    y: Math.min(rect.y, y2),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}
function pointInRect(x: number, y: number, rect: IntRect): boolean {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}
