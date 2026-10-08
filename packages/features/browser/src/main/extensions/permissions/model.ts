import type { Extension } from 'electron';
import type { ExtensionPermissions } from '../../../contracts/extension-api.js';
import { compileMatchPattern } from '../user-scripts/match-pattern.js';

const allSchemes = ['http', 'https', 'file', 'ftp', 'ws', 'wss'];

function originPattern(value: string): { schemes: string[]; host: string } | null {
  if (value === '<all_urls>') return { schemes: allSchemes, host: '*' };
  if (!compileMatchPattern(value)) return null;
  const match = /^(\*|https?|file|ftp|wss?):\/\/([^/]*)(\/.*)$/.exec(value);
  if (!match || /[@?#\s]/.test(match[2])) return null;
  return { schemes: match[1] === '*' ? ['http', 'https'] : [match[1]], host: match[2].toLowerCase() };
}

/** Compare the whole requested host range, never just a representative URL. Paths are ignored. */
export function coversOrigin(granted: string, requested: string): boolean {
  const outer = originPattern(granted); const inner = originPattern(requested);
  if (!outer || !inner || inner.schemes.some(scheme => !outer.schemes.includes(scheme))) return false;
  if (outer.host === '*' || outer.host === inner.host) return true;
  if (!outer.host.startsWith('*.') || inner.host === '*') return false;
  const base = outer.host.slice(2); const host = inner.host.replace(/^\*\./, '');
  return host === base || host.endsWith(`.${base}`);
}

export function parseExtensionPermissions(raw: unknown): ExtensionPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid permissions.');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !['permissions', 'origins'].includes(key))) throw new Error('Invalid permissions.');
  const list = (key: string, valid: (value: string) => boolean): string[] => {
    const values = input[key] ?? [];
    if (!Array.isArray(values) || values.length > 256 || values.some(value => typeof value !== 'string' || !valid(value))) {
      throw new Error('Invalid permissions.');
    }
    return [...new Set(values)] as string[];
  };
  return {
    permissions: list('permissions', value => /^[a-zA-Z][a-zA-Z0-9.]{0,79}$/.test(value)),
    origins: list('origins', value => value.length <= 8192 && Boolean(originPattern(value))),
  };
}

export function manifestPermissions(extension: Extension, {
  optional = false, includeContentScripts = true,
}: { optional?: boolean; includeContentScripts?: boolean } = {}): ExtensionPermissions {
  const manifest = extension.manifest;
  const permissions: string[] = manifest[optional ? 'optional_permissions' : 'permissions'] ?? [];
  const hosts: string[] = manifest[optional ? 'optional_host_permissions' : 'host_permissions'] ?? [];
  return {
    permissions: [...new Set(permissions.filter(value => !originPattern(value)))],
    origins: [...new Set([...hosts, ...permissions.filter(value => Boolean(originPattern(value))),
      ...(!optional && includeContentScripts ? (manifest.content_scripts ?? []).flatMap((script: { matches?: string[] }) => script.matches ?? []) : [])])],
  };
}

export function containsPermissions(granted: ExtensionPermissions, requested: ExtensionPermissions): boolean {
  return requested.permissions.every(value => granted.permissions.includes(value))
    && requested.origins.every(value => granted.origins.some(pattern => coversOrigin(pattern, value)));
}

export function mergePermissions(...sets: ExtensionPermissions[]): ExtensionPermissions {
  return { permissions: [...new Set(sets.flatMap(set => set.permissions))], origins: [...new Set(sets.flatMap(set => set.origins))] };
}
