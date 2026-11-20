import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';

export const maxDesignScriptBytes = 64 * 1024;
export const maxDesignContextLength = 8_000;
export const designWebZoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5] as const;

export function parseDesignWebDevice(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(value)) throw new Error('Invalid browser device.');
  return value;
}

export function parseDesignWebZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 5) throw new Error('Invalid web page zoom.');
  return value;
}

export function parseDesignLayerContext(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxDesignContextLength) throw new Error('Invalid design layer context.');
  return value;
}

export function parseDesignWebUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\p{C}]/u.test(value)) throw new Error('Invalid web address.');
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('Invalid web address.');
  return url.href;
}

export function parseDesignScriptPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/\.js$/iu.test(value)
    || !value.split('/').every(isValidWorkspaceEntryName)) throw new Error('Expected a project-relative .js file.');
  return value;
}

export function parseDesignScriptName(value: unknown): string {
  const name = parseDesignScriptPath(value);
  if (name.includes('/')) throw new Error('Expected a .js file name.');
  return name;
}

export function parseDesignScriptSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxDesignScriptBytes || !value.trim() || value.includes('\0')
    || new TextEncoder().encode(value).byteLength > maxDesignScriptBytes) {
    throw new Error('Expected a nonempty UTF-8 canvas script within the size limit.');
  }
  return value;
}
