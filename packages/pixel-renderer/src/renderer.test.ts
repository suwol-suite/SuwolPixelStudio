import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PixelRenderer,
  WEBGL_VERTEX_SHADER_SOURCE,
  configureTextureUpload,
} from "./renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PixelRenderer resources", () => {
  it("recreates resources after context restore and releases listeners and GPU objects", () => {
    const listeners = new Map<string, EventListener>(), deleted = {
      texture: 0,
      program: 0,
      vao: 0,
      buffer: 0,
      shader: 0,
    };
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
      ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8,
      TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, NEAREST: 11,
      TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14,
      createShader: () => ({}), shaderSource: () => undefined, compileShader: () => undefined,
      getShaderParameter: () => true, deleteShader: () => { deleted.shader += 1; },
      createProgram: () => ({}), attachShader: () => undefined, linkProgram: () => undefined,
      getProgramParameter: () => true, deleteProgram: () => { deleted.program += 1; },
      createVertexArray: () => ({}), deleteVertexArray: () => { deleted.vao += 1; },
      createBuffer: () => ({}), deleteBuffer: () => { deleted.buffer += 1; },
      bindVertexArray: () => undefined, bindBuffer: () => undefined, bufferData: () => undefined,
      getAttribLocation: () => 0, enableVertexAttribArray: () => undefined,
      vertexAttribPointer: () => undefined, createTexture: () => ({}),
      deleteTexture: () => { deleted.texture += 1; }, bindTexture: () => undefined,
      texParameteri: () => undefined,
    };
    const canvas = {
      dataset: {} as Record<string, string>,
      getContext: (kind: string) => kind === "webgl2" ? gl : null,
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("__SUWOL_E2E__", false);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const renderer = new PixelRenderer(canvas as unknown as HTMLCanvasElement);
    expect(renderer.mode).toBe("webgl2");
    expect(deleted.shader).toBe(2);
    listeners.get("webglcontextrestored")?.(new Event("webglcontextrestored"));
    expect(deleted.program).toBe(1);
    renderer.dispose();
    renderer.dispose();
    expect(deleted).toMatchObject({ texture: 2, program: 2, vao: 2, buffer: 2, shader: 4 });
    expect(listeners.size).toBe(0);
  });
});

describe("renderer orientation policy", () => {
  it("keeps UVs row-major while applying one top-left screen-space flip", () => {
    expect(WEBGL_VERTEX_SHADER_SOURCE).toContain(
      "gl_Position=vec4(clip.x,-clip.y,0,1)",
    );
    expect(WEBGL_VERTEX_SHADER_SOURCE).toContain("v_uv=a_position");
    expect(WEBGL_VERTEX_SHADER_SOURCE).not.toContain("1.0-a_position.y");
  });

  it("resets all global unpack state before full and partial uploads", () => {
    const pixelStorei = vi.fn();
    const gl = {
      pixelStorei,
      UNPACK_ALIGNMENT: 1,
      UNPACK_FLIP_Y_WEBGL: 2,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: 3,
      UNPACK_COLORSPACE_CONVERSION_WEBGL: 4,
      NONE: 0,
    } as unknown as WebGL2RenderingContext;
    configureTextureUpload(gl);
    expect(pixelStorei.mock.calls).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });
});
