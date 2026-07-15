import {
  compositeDocument,
  compositeOnionSkin,
  compositeRegion,
  type CompositedRegion,
  type DirtyRegion,
  type FloatingSelection,
  type IntPoint,
  type IntRect,
  type PixelSource,
  type Rgba,
  type FrameId,
  type OnionSkinSettings,
  type SelectionMask,
} from "@suwol/editor-core";
import type { Viewport } from "./viewport";

export type RendererMode = "webgl2" | "canvas2d";
export const WEBGL_VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position; uniform vec2 u_canvas; uniform vec2 u_origin; uniform vec2 u_size; out vec2 v_uv;
void main(){ vec2 p=u_origin+a_position*u_size; vec2 clip=(p/u_canvas)*2.0-1.0; gl_Position=vec4(clip.x,-clip.y,0,1); v_uv=a_position; }`;

export function configureTextureUpload(gl: WebGL2RenderingContext): void {
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
}

export interface PixelRenderOptions {
  readonly activeFrameId: FrameId;
  readonly activeLayerId?: string;
  readonly onionSkin?: OnionSkinSettings;
}

export class PixelRenderer {
  readonly mode: RendererMode;
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext | null;
  readonly #context2d: CanvasRenderingContext2D | null;
  readonly #offscreen: HTMLCanvasElement;
  #texture: WebGLTexture | null = null;
  #program: WebGLProgram | null = null;
  #vao: WebGLVertexArrayObject | null = null;
  #buffer: WebGLBuffer | null = null;
  #bytes: Uint8Array | null = null;
  #width = 0;
  #height = 0;
  #viewport: Viewport | null = null;
  #frame: number | null = null;
  #disposed = false;
  #uploadReported = false;
  readonly #onContextLost = (event: Event): void => {
    event.preventDefault();
    this.onDiagnostic("WebGL2 context lost; rendering is paused.");
  };
  readonly #onContextRestored = (): void => {
    if (this.#disposed) return;
    this.#initializeGl();
    this.#uploadFull();
    this.requestRender();
  };

  constructor(
    canvas: HTMLCanvasElement,
    readonly onDiagnostic: (message: string) => void = () => undefined,
  ) {
    this.#canvas = canvas;
    this.#offscreen = document.createElement("canvas");
    const forceCanvas2d =
      __SUWOL_E2E__ &&
      new URLSearchParams(globalThis.location.search).get("renderer") ===
        "canvas2d";
    const gl = forceCanvas2d ? null : canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
    });
    if (gl !== null) {
      this.#gl = gl;
      this.#context2d = null;
      this.mode = "webgl2";
      this.#initializeGl();
      canvas.addEventListener("webglcontextlost", this.#onContextLost);
      canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
    } else {
      this.#gl = null;
      this.#context2d = canvas.getContext("2d", { alpha: false });
      if (this.#context2d === null)
        throw new Error("No supported canvas renderer is available.");
      this.#context2d.imageSmoothingEnabled = false;
      this.mode = "canvas2d";
      this.onDiagnostic("WebGL2 unavailable; Canvas 2D fallback is active.");
    }
    if (__SUWOL_E2E__) canvas.dataset.rendererMode = this.mode;
  }

  update(
    source: PixelSource,
    viewport: Viewport,
    dirty: DirtyRegion | null = null,
    options?: PixelRenderOptions,
  ): void {
    const sizeChanged =
      this.#width !== source.model.canvas.width ||
      this.#height !== source.model.canvas.height;
    this.#width = source.model.canvas.width;
    this.#height = source.model.canvas.height;
    this.#viewport = viewport;
    const onionSettings = options?.onionSkin,
      onionEnabled = onionSettings?.enabled === true;
    if (sizeChanged || dirty === null || this.#bytes === null || onionEnabled) {
      this.#bytes =
        onionEnabled && options?.activeFrameId !== undefined
          ? compositeOnionSkin(
              source,
              options.activeFrameId,
              onionSettings,
              options.activeLayerId,
            )
          : compositeDocument(source);
      if (this.#gl !== null) this.#uploadFull();
      else this.#updateOffscreen(null);
    } else {
      const region = compositeRegion(source, dirty);
      this.#writeCompositedRegion(region);
      if (this.#gl !== null) this.#uploadDirty(region);
      else this.#updateOffscreen(region);
    }
    this.requestRender();
  }

  resize(viewport: Viewport): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.#canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.#canvas.clientHeight * ratio));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
      this.onDiagnostic("Viewport backing buffer resized.");
    }
    viewport.resize(this.#canvas.clientWidth, this.#canvas.clientHeight);
    this.#viewport = viewport;
    this.requestRender();
  }

  requestRender(): void {
    if (this.#disposed || this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#render();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    this.#canvas.removeEventListener(
      "webglcontextrestored",
      this.#onContextRestored,
    );
    this.#releaseGl();
    this.#bytes = null;
    this.#viewport = null;
    this.#offscreen.width = 0;
    this.#offscreen.height = 0;
  }

  #initializeGl(): void {
    const gl = this.#gl;
    if (gl === null) return;
    this.#releaseGl();
    const vertex = compileShader(
      gl,
      gl.VERTEX_SHADER,
      WEBGL_VERTEX_SHADER_SOURCE,
    );
    const fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float; uniform sampler2D u_texture; in vec2 v_uv; out vec4 outColor;
      void main(){ vec4 pixel=texture(u_texture,v_uv); float checker=mod(floor(gl_FragCoord.x/10.0)+floor(gl_FragCoord.y/10.0),2.0); vec3 bg=mix(vec3(.68),vec3(.82),checker); outColor=vec4(mix(bg,pixel.rgb,pixel.a),1.0); }`,
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      throw new Error("Unable to link WebGL program.");
    }
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    const location = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    this.#program = program;
    this.#vao = vao;
    this.#buffer = buffer;
    this.#texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.onDiagnostic("WebGL2 renderer initialized.");
  }

  #releaseGl(): void {
    const gl = this.#gl;
    if (gl === null) return;
    if (this.#texture !== null) gl.deleteTexture(this.#texture);
    if (this.#program !== null) gl.deleteProgram(this.#program);
    if (this.#vao !== null) gl.deleteVertexArray(this.#vao);
    if (this.#buffer !== null) gl.deleteBuffer(this.#buffer);
    this.#texture = null;
    this.#program = null;
    this.#vao = null;
    this.#buffer = null;
  }

  #uploadFull(): void {
    const gl = this.#gl;
    if (
      gl === null ||
      this.#texture === null ||
      this.#bytes === null ||
      this.#width === 0
    )
      return;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    configureTextureUpload(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.#width,
      this.#height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.#bytes,
    );
    if (!this.#uploadReported) {
      this.#uploadReported = true;
      this.onDiagnostic("Top-left RGBA texture upload initialized.");
    }
  }
  #writeCompositedRegion(region: CompositedRegion): void {
    if (this.#bytes === null) return;
    for (let row = 0; row < region.rect.height; row += 1) {
      const sourceOffset = row * region.rect.width * 4;
      const targetOffset =
        ((region.rect.y + row) * this.#width + region.rect.x) * 4;
      this.#bytes.set(
        region.pixels.subarray(
          sourceOffset,
          sourceOffset + region.rect.width * 4,
        ),
        targetOffset,
      );
    }
  }
  #uploadDirty(region: CompositedRegion): void {
    const gl = this.#gl;
    if (gl === null || this.#texture === null || this.#bytes === null) return;
    const { rect, pixels } = region;
    if (rect.width === 0 || rect.height === 0) return;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    configureTextureUpload(gl);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
  }
  #updateOffscreen(region: CompositedRegion | null): void {
    if (this.#bytes === null) return;
    if (
      this.#offscreen.width !== this.#width ||
      this.#offscreen.height !== this.#height
    ) {
      this.#offscreen.width = this.#width;
      this.#offscreen.height = this.#height;
      region = null;
    }
    const context = this.#offscreen.getContext("2d");
    if (context === null) return;
    if (region === null) {
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(this.#bytes),
          this.#width,
          this.#height,
        ),
        0,
        0,
      );
    } else if (region.rect.width > 0 && region.rect.height > 0) {
      const image = new ImageData(
        new Uint8ClampedArray(region.pixels),
        region.rect.width,
        region.rect.height,
      );
      context.putImageData(image, region.rect.x, region.rect.y);
    }
  }
  #render(): void {
    const viewport = this.#viewport;
    if (viewport === null) return;
    const ratio = window.devicePixelRatio || 1;
    if (this.#gl !== null && this.#program !== null && this.#vao !== null) {
      const gl = this.#gl;
      gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
      gl.clearColor(0.09, 0.1, 0.12, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.#program);
      gl.bindVertexArray(this.#vao);
      gl.uniform2f(
        gl.getUniformLocation(this.#program, "u_canvas"),
        this.#canvas.width,
        this.#canvas.height,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.#program, "u_origin"),
        viewport.panX * ratio,
        viewport.panY * ratio,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.#program, "u_size"),
        this.#width * viewport.zoom * ratio,
        this.#height * viewport.zoom * ratio,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else if (this.#context2d !== null) {
      const context = this.#context2d;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#17191d";
      context.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
      context.imageSmoothingEnabled = false;
      const originX = viewport.panX * ratio,
        originY = viewport.panY * ratio,
        drawWidth = this.#width * viewport.zoom * ratio,
        drawHeight = this.#height * viewport.zoom * ratio;
      const left = Math.max(0, originX),
        top = Math.max(0, originY),
        right = Math.min(this.#canvas.width, originX + drawWidth),
        bottom = Math.min(this.#canvas.height, originY + drawHeight),
        cell = 10;
      context.save();
      context.beginPath();
      context.rect(originX, originY, drawWidth, drawHeight);
      context.clip();
      context.fillStyle = "#adadad";
      context.fillRect(
        left,
        top,
        Math.max(0, right - left),
        Math.max(0, bottom - top),
      );
      for (let y = Math.floor(top / cell) * cell; y < bottom; y += cell)
        for (let x = Math.floor(left / cell) * cell; x < right; x += cell)
          if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 !== 0) {
            context.fillStyle = "#d1d1d1";
            context.fillRect(x, y, cell, cell);
          }
      context.restore();
      context.drawImage(
        this.#offscreen,
        viewport.panX * ratio,
        viewport.panY * ratio,
        this.#width * viewport.zoom * ratio,
        this.#height * viewport.zoom * ratio,
      );
    }
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Unable to create WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error("Unable to compile WebGL shader.");
  }
  return shader;
}

export interface EditorOverlayState {
  readonly hover: IntPoint | null;
  readonly selection: SelectionMask | null;
  readonly previewPoints: readonly IntPoint[];
  readonly previewColor: Rgba;
  readonly floating: FloatingSelection | null;
  readonly symmetry?: Readonly<{ mode: "off" | "horizontal" | "vertical" | "both"; axisX: number; axisY: number }>;
  readonly brushHoverPoints?: readonly IntPoint[];
  readonly brushPreview?: Readonly<{
    points: readonly IntPoint[];
    color: Rgba;
    mode: "paint" | "erase";
  }> | null;
}

export function drawEditorOverlay(
  canvas: HTMLCanvasElement,
  viewport: Viewport,
  documentWidth: number,
  documentHeight: number,
  state: EditorOverlayState,
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.save();
  context.scale(ratio, ratio);
  if (viewport.zoom >= 8) {
    context.strokeStyle = "rgba(128,128,128,.38)";
    context.lineWidth = 1 / ratio;
    context.beginPath();
    for (let x = 0; x <= documentWidth; x += 1) {
      const sx = viewport.panX + x * viewport.zoom;
      context.moveTo(sx, viewport.panY);
      context.lineTo(sx, viewport.panY + documentHeight * viewport.zoom);
    }
    for (let y = 0; y <= documentHeight; y += 1) {
      const sy = viewport.panY + y * viewport.zoom;
      context.moveTo(viewport.panX, sy);
      context.lineTo(viewport.panX + documentWidth * viewport.zoom, sy);
    }
    context.stroke();
  }
  if (state.symmetry !== undefined && state.symmetry.mode !== "off") {
    context.save();
    context.strokeStyle = "rgba(46, 180, 235, .9)";
    context.lineWidth = Math.max(1, 1 / ratio);
    context.setLineDash([6, 4]);
    context.beginPath();
    if (state.symmetry.mode === "vertical" || state.symmetry.mode === "both") {
      const x = viewport.panX + (state.symmetry.axisX + 0.5) * viewport.zoom;
      context.moveTo(x, viewport.panY); context.lineTo(x, viewport.panY + documentHeight * viewport.zoom);
    }
    if (state.symmetry.mode === "horizontal" || state.symmetry.mode === "both") {
      const y = viewport.panY + (state.symmetry.axisY + 0.5) * viewport.zoom;
      context.moveTo(viewport.panX, y); context.lineTo(viewport.panX + documentWidth * viewport.zoom, y);
    }
    context.stroke(); context.restore();
  }
  if (state.previewPoints.length > 0) {
    const [red, green, blue, alpha] = state.previewColor;
    context.fillStyle = `rgba(${red},${green},${blue},${Math.max(0.35, (alpha / 255) * 0.72)})`;
    for (const point of state.previewPoints)
      if (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x < documentWidth &&
        point.y < documentHeight
      )
        context.fillRect(
          viewport.panX + point.x * viewport.zoom,
          viewport.panY + point.y * viewport.zoom,
          viewport.zoom,
          viewport.zoom,
        );
  }
  if (state.floating !== null) {
    const floating = state.floating,
      offscreen = document.createElement("canvas");
    offscreen.width = floating.sourceWidth;
    offscreen.height = floating.sourceHeight;
    const offscreenContext = offscreen.getContext("2d");
    if (offscreenContext !== null) {
      const rgba = floating.format === "indexed8"
        ? (() => {
            const output = new Uint8ClampedArray(floating.sourceWidth * floating.sourceHeight * 4);
            for (let index = 0; index < floating.pixels.length; index += 1) {
              const paletteIndex = floating.pixels[index] ?? 0;
              if (paletteIndex === (floating.transparentIndex ?? 0)) continue;
              const color = floating.palette?.[paletteIndex] ?? [0, 0, 0, 0];
              output.set(color, index * 4);
            }
            return output;
          })()
        : new Uint8ClampedArray(floating.pixels);
      offscreenContext.putImageData(
        new ImageData(
          rgba,
          floating.sourceWidth,
          floating.sourceHeight,
        ),
        0,
        0,
      );
      context.imageSmoothingEnabled = false;
      context.globalAlpha = 0.78;
      context.drawImage(
        offscreen,
        viewport.panX + floating.x * viewport.zoom,
        viewport.panY + floating.y * viewport.zoom,
        floating.sourceWidth * viewport.zoom,
        floating.sourceHeight * viewport.zoom,
      );
      context.globalAlpha = 1;
    }
  }
  const selection = state.selection,
    bounds = selection?.bounds ?? null;
  if (selection !== null && bounds !== null) {
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(1, 1 / ratio);
    context.setLineDash([4, 4]);
    context.lineDashOffset = -2;
    context.beginPath();
    if (selection.selectedCount === bounds.width * bounds.height) {
      context.rect(
        viewport.panX + bounds.x * viewport.zoom + 0.5,
        viewport.panY + bounds.y * viewport.zoom + 0.5,
        bounds.width * viewport.zoom,
        bounds.height * viewport.zoom,
      );
    } else {
      for (let y = bounds.y; y < bounds.y + bounds.height; y += 1)
        for (let x = bounds.x; x < bounds.x + bounds.width; x += 1)
          if (selection.contains(x, y)) {
            const left = viewport.panX + x * viewport.zoom,
              top = viewport.panY + y * viewport.zoom,
              right = left + viewport.zoom,
              bottom = top + viewport.zoom;
            if (!selection.contains(x - 1, y)) {
              context.moveTo(left, top);
              context.lineTo(left, bottom);
            }
            if (!selection.contains(x + 1, y)) {
              context.moveTo(right, top);
              context.lineTo(right, bottom);
            }
            if (!selection.contains(x, y - 1)) {
              context.moveTo(left, top);
              context.lineTo(right, top);
            }
            if (!selection.contains(x, y + 1)) {
              context.moveTo(left, bottom);
              context.lineTo(right, bottom);
            }
          }
    }
    context.stroke();
    context.setLineDash([]);
  }
  const hover = state.hover,
    brushPreview = state.brushPreview ?? null,
    brushHoverPoints = state.brushHoverPoints ?? [];
  if (brushPreview !== null && brushPreview.points.length > 0) {
    drawBrushPreview(context, viewport, brushPreview, ratio);
  } else if (brushHoverPoints.length > 0) {
    drawBrushPreview(context, viewport, {
      points: brushHoverPoints,
      color: state.previewColor,
      mode: "paint",
    }, ratio);
  } else if (hover !== null) {
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(1, 2 / ratio);
    context.strokeRect(
      viewport.panX + hover.x * viewport.zoom + 0.5,
      viewport.panY + hover.y * viewport.zoom + 0.5,
      viewport.zoom - 1,
      viewport.zoom - 1,
    );
  }
  context.restore();
}

function drawBrushPreview(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  preview: Readonly<{ points: readonly IntPoint[]; color: Rgba; mode: "paint" | "erase" }>,
  ratio: number,
): void {
  const [red, green, blue, alpha] = preview.color,
    zoom = viewport.zoom,
    pointSet = new Set(preview.points.map((point) => `${point.x},${point.y}`));
  context.save();
  if (preview.mode === "paint") {
    context.fillStyle = `rgba(${red},${green},${blue},${Math.max(0.22, (alpha / 255) * 0.46)})`;
    for (const point of preview.points)
      context.fillRect(
        viewport.panX + point.x * zoom,
        viewport.panY + point.y * zoom,
        zoom,
        zoom,
      );
  } else {
    context.fillStyle = "rgba(255,255,255,.16)";
    context.strokeStyle = "rgba(30,30,30,.72)";
    context.lineWidth = Math.max(1, 1 / ratio);
    for (const point of preview.points) {
      const left = viewport.panX + point.x * zoom,
        top = viewport.panY + point.y * zoom;
      context.fillRect(left, top, zoom, zoom);
      if (zoom >= 3) {
        context.beginPath();
        context.moveTo(left, top + zoom);
        context.lineTo(left + zoom, top);
        context.stroke();
      }
    }
  }
  const traceBoundary = (): void => {
    context.beginPath();
    for (const point of preview.points) {
      const left = viewport.panX + point.x * zoom,
        top = viewport.panY + point.y * zoom,
        right = left + zoom,
        bottom = top + zoom;
      if (!pointSet.has(`${point.x - 1},${point.y}`)) { context.moveTo(left, top); context.lineTo(left, bottom); }
      if (!pointSet.has(`${point.x + 1},${point.y}`)) { context.moveTo(right, top); context.lineTo(right, bottom); }
      if (!pointSet.has(`${point.x},${point.y - 1}`)) { context.moveTo(left, top); context.lineTo(right, top); }
      if (!pointSet.has(`${point.x},${point.y + 1}`)) { context.moveTo(left, bottom); context.lineTo(right, bottom); }
    }
  };
  traceBoundary();
  context.strokeStyle = "rgba(0,0,0,.9)";
  context.lineWidth = Math.max(2, 2 / ratio);
  context.stroke();
  traceBoundary();
  context.strokeStyle = "rgba(255,255,255,.96)";
  context.lineWidth = Math.max(1, 1 / ratio);
  context.stroke();
  context.restore();
}

export type DeclarativeOverlayPrimitive =
  | Readonly<{ kind: "rect"; rect: IntRect; style: Readonly<{ color: Rgba; width?: number | undefined; fill?: Rgba | undefined }> }>
  | Readonly<{ kind: "line"; from: IntPoint; to: IntPoint; style: Readonly<{ color: Rgba; width?: number | undefined }> }>
  | Readonly<{ kind: "pixelPreview"; points: readonly IntPoint[]; color: Rgba }>
  | Readonly<{ kind: "text"; position: IntPoint; text: string }>
  | Readonly<{ kind: "imagePreview"; rect: IntRect; pixels: ArrayBuffer }>;

export function drawDeclarativeOverlays(canvas: HTMLCanvasElement, viewport: Viewport, primitives: readonly DeclarativeOverlayPrimitive[]): void {
  const context = canvas.getContext("2d"); if (context === null) return;
  const ratio = window.devicePixelRatio || 1; context.save(); context.scale(ratio, ratio); context.imageSmoothingEnabled = false;
  for (const primitive of primitives) {
    if (primitive.kind === "rect") { const { rect, style } = primitive; context.strokeStyle = cssColor(style.color); context.lineWidth = style.width ?? 1; if (style.fill !== undefined) { context.fillStyle = cssColor(style.fill); context.fillRect(viewport.panX + rect.x * viewport.zoom, viewport.panY + rect.y * viewport.zoom, rect.width * viewport.zoom, rect.height * viewport.zoom); } context.strokeRect(viewport.panX + rect.x * viewport.zoom, viewport.panY + rect.y * viewport.zoom, rect.width * viewport.zoom, rect.height * viewport.zoom); }
    else if (primitive.kind === "line") { context.strokeStyle = cssColor(primitive.style.color); context.lineWidth = primitive.style.width ?? 1; context.beginPath(); context.moveTo(viewport.panX + primitive.from.x * viewport.zoom, viewport.panY + primitive.from.y * viewport.zoom); context.lineTo(viewport.panX + primitive.to.x * viewport.zoom, viewport.panY + primitive.to.y * viewport.zoom); context.stroke(); }
    else if (primitive.kind === "pixelPreview") { context.fillStyle = cssColor(primitive.color); for (const point of primitive.points) context.fillRect(viewport.panX + point.x * viewport.zoom, viewport.panY + point.y * viewport.zoom, viewport.zoom, viewport.zoom); }
    else if (primitive.kind === "text") { context.fillStyle = "#fff"; context.font = "12px system-ui"; context.fillText(primitive.text, viewport.panX + primitive.position.x * viewport.zoom, viewport.panY + primitive.position.y * viewport.zoom); }
    else { const pixels = new Uint8ClampedArray(primitive.pixels); if (pixels.length !== primitive.rect.width * primitive.rect.height * 4) continue; const offscreen = document.createElement("canvas"); offscreen.width = primitive.rect.width; offscreen.height = primitive.rect.height; const offscreenContext = offscreen.getContext("2d"); if (offscreenContext === null) continue; offscreenContext.putImageData(new ImageData(pixels, primitive.rect.width, primitive.rect.height), 0, 0); context.drawImage(offscreen, viewport.panX + primitive.rect.x * viewport.zoom, viewport.panY + primitive.rect.y * viewport.zoom, primitive.rect.width * viewport.zoom, primitive.rect.height * viewport.zoom); }
  }
  context.restore();
}
function cssColor(color: Rgba): string { return `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`; }
