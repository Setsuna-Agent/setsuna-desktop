import { splitDesignColor } from '../../contracts/design-color.js';
import { isDesignShaderUniformName, maxDesignShaderUniforms, type DesignShaderPaint, type DesignShaderSampler, type DesignShaderValue } from '../../contracts/design-shader.js';

type Uniform = Readonly<{ name: string; label: string }>;
export type DesignShaderUniform = Uniform & Readonly<
  { kind: 'time' | 'resolution' }
  | { kind: 'float' | 'int'; initial: number; range?: readonly [number, number]; step?: number }
  | { kind: 'bool'; initial: boolean }
  | { kind: 'color'; initial: string; size: 3 | 4 }
  | { kind: 'vector'; initial: readonly number[]; size: 2 | 3 | 4 }
  | { kind: 'sampler'; initial: DesignShaderSampler }
>;

const colorPattern = /^#[\da-f]{6}(?:[\da-f]{2})?$/iu;
const uniformTokens = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec[234]|sampler2D)\s+([a-z_]\w*)\s*;/giu;

export function readDesignShaderUniforms(source: string): readonly DesignShaderUniform[] {
  const uniforms = new Map<string, DesignShaderUniform>();
  let comment: { text: string; end: number } | undefined;
  for (const match of source.matchAll(uniformTokens)) {
    const [token, type, name] = match;
    if (token.startsWith('/*')) comment = { text: token.slice(2, -2), end: match.index + token.length };
    if (!type || !isDesignShaderUniformName(name)) continue;
    const directives = comment && !source.slice(comment.end, match.index).trim() ? shaderDirectives(comment.text) : new Map<string, string>();
    uniforms.set(name, shaderUniform(type, name, directives));
    if (uniforms.size === maxDesignShaderUniforms) break;
  }
  return [...uniforms.values()];
}

function shaderDirectives(comment: string) {
  return new Map([...comment.matchAll(/@([a-z]+)\b([^@\r\n]*)/giu)].map(([, name, value]) => [name.toLowerCase(), value.trim()]));
}

function shaderUniform(type: string, name: string, directives: ReadonlyMap<string, string>): DesignShaderUniform {
  const base = { name, label: directives.get('label') || name };
  const initial = directives.get('default') ?? '';
  if (type === 'vec2' && (directives.has('resolution') || name === 'u_resolution')) return { ...base, kind: 'resolution' };
  if (type === 'float' && (directives.has('time') || name === 'u_time')) return { ...base, kind: 'time' };
  if (type === 'sampler2D') return { ...base, kind: 'sampler', initial: { kind: directives.has('backdrop') ? 'background' : 'image' } };
  if (type === 'bool') return { ...base, kind: 'bool', initial: initial === 'true' || initial === '1' };
  if (type === 'float' || type === 'int') {
    const [min, max, extra] = components(directives.get('range') ?? '');
    const range = extra === undefined && Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] as const : undefined;
    const step = Number(directives.get('step'));
    const value = Number(initial);
    return { ...base, kind: type, initial: normalizeNumber(Number.isFinite(value) ? value : 0, type, range), range,
      step: Number.isFinite(step) && step > 0 ? step : undefined };
  }
  const size = type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4;
  if (size !== 2 && (directives.has('color') || colorPattern.test(initial))) {
    return { ...base, kind: 'color', initial: colorPattern.test(initial) ? initial : '#000000', size };
  }
  const vector = components(initial);
  return { ...base, kind: 'vector', initial: Array.from({ length: size }, (_, index) => Number.isFinite(vector[index]) ? vector[index] : 0), size };
}

function components(value: string) {
  const text = value.trim().replace(/^\[|\]$/gu, '').trim();
  return text ? text.split(/[,\s]+/u).map(Number) : [];
}

function normalizeNumber(value: number, kind: 'float' | 'int', range?: readonly [number, number]) {
  const number = range ? Math.min(range[1], Math.max(range[0], value)) : value;
  return kind === 'int' ? Math.round(number) : number;
}

type EditableUniform = Exclude<DesignShaderUniform, Readonly<{ kind: 'time' | 'resolution' }>>;

export function designShaderUniformValue<T extends EditableUniform>(uniform: T, paint: DesignShaderPaint): T['initial'] {
  const value = paint.uniforms && Object.hasOwn(paint.uniforms, uniform.name) ? paint.uniforms[uniform.name] : undefined;
  return (matchingValue(uniform, value) ?? uniform.initial) as T['initial'];
}

function matchingValue(uniform: EditableUniform, value: DesignShaderValue | undefined): DesignShaderValue | undefined {
  switch (uniform.kind) {
    case 'float':
    case 'int': return typeof value === 'number' ? normalizeNumber(value, uniform.kind, uniform.range) : undefined;
    case 'bool': return typeof value === 'boolean' ? value : undefined;
    case 'color': return typeof value === 'string' && colorPattern.test(value) ? value : undefined;
    case 'vector': return Array.isArray(value) && value.length === uniform.size ? value : undefined;
    case 'sampler': return value && typeof value === 'object' && 'kind' in value ? value : undefined;
  }
}

export function designShaderColorComponents(value: string, size: 3 | 4): number[] {
  const { color, opacity } = splitDesignColor(value);
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  return size === 3 ? rgb : [...rgb, opacity];
}
