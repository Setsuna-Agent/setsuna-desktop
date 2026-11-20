import type { DesignShaderPaint, DesignShaderSampler } from '../../contracts/design-shader.js';
import { designShaderColorComponents, designShaderUniformValue, readDesignShaderUniforms, type DesignShaderUniform } from './design-shader-uniforms.js';

export type DesignShaderSources = ReadonlyMap<string, string>;
type ShaderContext = WebGL2RenderingContext | WebGLRenderingContext;
type TextureSource = HTMLCanvasElement | HTMLImageElement;
type DrawShader = Readonly<{
  width: number; height: number; time: number;
  texture(sampler: DesignShaderSampler): TextureSource | undefined;
}>;
type UniformBinding = Readonly<{ uniform: DesignShaderUniform; location: WebGLUniformLocation; unit?: number }>;
type Program = Readonly<{ program: WebGLProgram; bindings: readonly UniformBinding[] }>;

const vertexBody = `
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const vertexSources = {
  100: `attribute vec2 a_position;\nvarying mediump vec2 v_uv;${vertexBody}`,
  300: `#version 300 es\nin vec2 a_position;\nout mediump vec2 v_uv;${vertexBody}`,
} as const;
const version300 = /^[\t ]*#version\s+300\s+es\b/mu;
const maxPrograms = 16;
const maxTextureSize = 1024;

let renderer: ShaderRenderer | undefined;

function getRenderer() {
  if (!renderer) renderer = new ShaderRenderer();
  return renderer;
}

export function validateDesignShader(source: string) {
  getRenderer().program(source);
}

export function drawDesignShader(source: string, paint: DesignShaderPaint, draw: DrawShader): HTMLCanvasElement {
  return getRenderer().draw(source, paint, draw);
}

export function designShaderRasterSize(width: number, height: number) {
  const scale = Math.min(1, maxTextureSize / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

class ShaderRenderer {
  readonly canvas = document.createElement('canvas');
  readonly gl = this.createContext();
  readonly programs = new Map<string, Program | Error>();
  readonly textures: WebGLTexture[] = [];
  readonly uploadedImages: (HTMLImageElement | undefined)[] = [];
  readonly imageTile = document.createElement('canvas');
  readonly vertices: Partial<Record<100 | 300, WebGLShader>> = {};
  buffer: WebGLBuffer | null = null;

  constructor() {
    this.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.programs.clear();
      this.textures.length = 0;
      this.uploadedImages.length = 0;
      delete this.vertices[100];
      delete this.vertices[300];
      this.buffer = null;
    });
  }

  createContext(): ShaderContext | null {
    const options: WebGLContextAttributes = { alpha: true, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
    const modern = this.canvas.getContext('webgl2', options);
    return modern ?? this.canvas.getContext('webgl', options);
  }

  context() {
    if (!this.gl || this.gl.isContextLost()) throw new Error('WebGL is unavailable.');
    return this.gl;
  }

  program(source: string): Program {
    const gl = this.context();
    let result = this.programs.get(source);
    this.programs.delete(source);
    if (!result) {
      try { result = this.link(gl, source); }
      catch (error) { result = error instanceof Error ? error : new Error('GLSL compilation failed.'); }
    }
    this.programs.set(source, result);
    if (this.programs.size > maxPrograms) {
      const [oldest, entry] = this.programs.entries().next().value!;
      if (!(entry instanceof Error)) gl.deleteProgram(entry.program);
      this.programs.delete(oldest);
    }
    if (result instanceof Error) throw result;
    return result;
  }

  link(gl: ShaderContext, source: string): Program {
    const { fragment, version } = compileFragment(gl, source.replace(/^\uFEFF/u, ''));
    const program = gl.createProgram();
    try {
      if (!program) throw new Error('WebGL could not allocate a program.');
      const vertex = this.vertices[version] ??= compile(gl, gl.VERTEX_SHADER, vertexSources[version]);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.bindAttribLocation(program, 0, 'a_position');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'GLSL linking failed.');
      let unit = 0;
      const bindings = readDesignShaderUniforms(source).flatMap((uniform) => {
        const location = gl.getUniformLocation(program, uniform.name);
        return location ? [{ uniform, location, unit: uniform.kind === 'sampler' ? unit++ : undefined }] : [];
      });
      if (unit > gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) throw new Error('The shader uses too many textures.');
      gl.detachShader(program, fragment);
      return { program, bindings };
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(fragment);
    }
  }

  draw(source: string, paint: DesignShaderPaint, draw: DrawShader) {
    const gl = this.context();
    const { program, bindings } = this.program(source);
    if (this.canvas.width !== draw.width) this.canvas.width = draw.width;
    if (this.canvas.height !== draw.height) this.canvas.height = draw.height;
    gl.viewport(0, 0, draw.width, draw.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    if (!this.buffer) {
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    for (const { uniform, location, unit } of bindings) {
      switch (uniform.kind) {
        case 'resolution': gl.uniform2f(location, draw.width, draw.height); break;
        case 'time': gl.uniform1f(location, draw.time); break;
        case 'float': gl.uniform1f(location, designShaderUniformValue(uniform, paint)); break;
        case 'int': gl.uniform1i(location, designShaderUniformValue(uniform, paint)); break;
        case 'bool': gl.uniform1i(location, Number(designShaderUniformValue(uniform, paint))); break;
        case 'color': vector(gl, location, designShaderColorComponents(designShaderUniformValue(uniform, paint), uniform.size)); break;
        case 'vector': vector(gl, location, designShaderUniformValue(uniform, paint)); break;
        case 'sampler':
          this.bindTexture(gl, unit!, draw.texture(designShaderUniformValue(uniform, paint)));
          gl.uniform1i(location, unit!);
          break;
      }
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  bindTexture(gl: ShaderContext, unit: number, source: TextureSource | undefined) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    let texture = this.textures[unit];
    if (!texture) {
      const created = gl.createTexture();
      if (!created) throw new Error('WebGL could not allocate a texture.');
      this.textures[unit] = texture = created;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    } else gl.bindTexture(gl.TEXTURE_2D, texture);
    const image = source instanceof HTMLImageElement ? source : undefined;
    if (image && this.uploadedImages[unit] === image) return;
    if (image && Math.max(image.naturalWidth, image.naturalHeight) > maxTextureSize) {
      const size = designShaderRasterSize(image.naturalWidth, image.naturalHeight);
      const tile = this.imageTile;
      tile.width = size.width;
      tile.height = size.height;
      tile.getContext('2d')?.drawImage(image, 0, 0, size.width, size.height);
      source = tile;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.uploadedImages[unit] = image;
  }
}

function compileFragment(gl: ShaderContext, source: string): { fragment: WebGLShader; version: 100 | 300 } {
  const version = version300.test(source) ? 300 : 100;
  try {
    return { fragment: compile(gl, gl.FRAGMENT_SHADER, source), version };
  } catch (error) {
    if (version === 300 || gl.getParameter(gl.VERSION).startsWith('WebGL 1')) throw error;
    // Some shaders use modern texture functions with the original GLSL output and sampler names.
    const names: Record<string, string> = { varying: 'in', gl_FragColor: 'setsuna_fragmentColor',
      texture2D: 'texture', textureCube: 'texture', texture2DProj: 'textureProj',
      texture2DLod: 'textureLod', textureCubeLod: 'textureLod', texture2DProjLod: 'textureProjLod' };
    const converted = source.replace(/^[\t ]*#version[^\r\n]*/mu, '')
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\b(?:varying|gl_FragColor|texture2D(?:Proj)?(?:Lod)?|textureCube(?:Lod)?)\b/gu,
        (token) => names[token] ?? token);
    try {
      const upgraded = `#version 300 es\nout highp vec4 setsuna_fragmentColor;\n#line 1\n${converted}`;
      return { fragment: compile(gl, gl.FRAGMENT_SHADER, upgraded), version: 300 };
    } catch { throw error; }
  }
}

function compile(gl: ShaderContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not allocate a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const error = gl.getShaderInfoLog(shader)?.replace(/\0/gu, '').trim();
  gl.deleteShader(shader);
  throw new Error(error || 'GLSL compilation failed.');
}

function vector(gl: ShaderContext, location: WebGLUniformLocation, value: readonly number[]) {
  if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
  if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
  if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
}
