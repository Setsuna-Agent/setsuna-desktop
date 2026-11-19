import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';

export const maxDesignShaderBytes = 64 * 1024;
export const maxDesignShaderUniforms = 64;

export type DesignShaderSampler = Readonly<
  { kind: 'image'; assetPath?: string } | { kind: 'background' | 'object' }
>;
export type DesignShaderValue = number | boolean | string | readonly number[] | DesignShaderSampler;
export type DesignShaderPaint = Readonly<{
  assetPath: string;
  uniforms?: Readonly<Record<string, DesignShaderValue>>;
}>;

export function parseDesignShaderPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/\.glsl$/iu.test(value)
    || !value.split('/').every(isValidWorkspaceEntryName)) throw new Error('Expected a project-relative .glsl file.');
  return value;
}

export function parseDesignShaderName(value: unknown): string {
  const name = parseDesignShaderPath(value);
  if (name.includes('/')) throw new Error('Expected a .glsl file name.');
  return name;
}

export function parseDesignShaderSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxDesignShaderBytes || !value.trim() || value.includes('\0')
    || new TextEncoder().encode(value).byteLength > maxDesignShaderBytes) throw new Error('Invalid GLSL source.');
  return value;
}

export function isDesignShaderUniformName(name: string): boolean {
  return /^[a-z_][a-z0-9_]{0,99}$/iu.test(name);
}

export function parseDesignShaderPaint(value: unknown, assetPath: (input: unknown) => string): DesignShaderPaint {
  const { assetPath: source, uniforms } = object(value);
  const path = parseDesignShaderPath(source);
  if (uniforms === undefined) return { assetPath: path };
  const entries = Object.entries(object(uniforms));
  if (entries.length > maxDesignShaderUniforms) throw new Error('Too many shader uniforms.');
  return { assetPath: path, uniforms: Object.fromEntries(entries.map(([name, entry]) => {
    if (!isDesignShaderUniformName(name)) throw new Error('Invalid shader uniform name.');
    return [name, uniformValue(entry, assetPath)];
  })) };
}

function uniformValue(value: unknown, assetPath: (input: unknown) => string): DesignShaderValue {
  if (typeof value === 'boolean' || finite(value)) return value;
  if (typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(value)) return value;
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every(finite)) return value;
  const { kind, assetPath: image } = object(value);
  if (kind === 'image') return image === undefined ? { kind } : { kind, assetPath: assetPath(image) };
  if (kind === 'background' || kind === 'object') return { kind };
  throw new Error('Invalid shader uniform value.');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shader paint.');
  return value as Record<string, unknown>;
}
