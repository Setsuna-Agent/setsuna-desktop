import type { RuntimePluginUiReactApp } from './model.js';

/** Portable project-relative paths shared by the manifest reader and app compiler. */
export function pluginAppRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error(`${label} is invalid.`);
  const normalized = value.replace(/\\/gu, '/');
  if (normalized.startsWith('/') || normalized.includes(':') || /[?#<>*"|]/u.test(normalized) || containsControlCharacters(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..' || ['node_modules', '.setsuna'].includes(part.toLowerCase()))) {
    throw new Error(`${label} must stay inside the application project.`);
  }
  return normalized;
}

export function parsePluginUiReactApp(value: unknown, actions: ReadonlySet<string>): RuntimePluginUiReactApp {
  const record = exactObject(value, ['root', 'entry', 'routes', 'actionIds'], 'Plugin React app');
  const root = pluginAppRelativePath(record.root, 'React app root');
  const entry = modulePath(record.entry);
  const routes = record.routes === undefined ? [] : array(record.routes, 32, 'React app routes').map(value => {
    const route = exactObject(value, ['path', 'entry'], 'React app route');
    if (typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.length > 256
      || /[?#\\]/u.test(route.path) || containsControlCharacters(route.path)) throw new Error('React app route path is invalid.');
    if (route.path === '/*') throw new Error('React app default entry already owns the fallback route.');
    return Object.freeze({ path: route.path, entry: modulePath(route.entry) });
  });
  if (new Set(routes.map(route => route.path)).size !== routes.length) throw new Error('React app route paths must be unique.');
  const actionIds = array(record.actionIds, 32, 'React app actionIds').map(value => {
    if (typeof value !== 'string' || !actions.has(value)) throw new Error('React app references an unknown action.');
    return value;
  });
  if (new Set(actionIds).size !== actionIds.length) throw new Error('React app actionIds must be unique.');
  return Object.freeze({ root, entry, routes: Object.freeze(routes), actionIds: Object.freeze(actionIds) });
}

function modulePath(value: unknown): string {
  const result = pluginAppRelativePath(value, 'React app entry');
  if (!/\.(?:[cm]?[jt]sx?)$/iu.test(result)) throw new Error('React app entries must be JavaScript or TypeScript modules.');
  return result;
}

function array(value: unknown, limit: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} is invalid.`);
  return value;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new Error(`${label} contains an unsupported field.`);
  return record;
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) if (character.charCodeAt(0) < 32) return true;
  return false;
}
