import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BROWSER_PERMISSIONS, DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences, type BrowserPermissionPolicy } from '../../contracts/settings.js';

export function browserSiteOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

const booleans = ['showHomeButton', 'showFullUrl', 'rememberHistory', 'savePasswords', 'autofillPasswords',
  'useExtensionNewTab', 'agentControl', 'spellcheck', 'askDownloadLocation'] as const;
const policy = (value: unknown): value is BrowserPermissionPolicy => ['ask', 'allow', 'block'].includes(value as string);

/** Validate IPC and disk data through the same schema; never accept arbitrary preference keys. */
export function patchBrowserPreferences(current: BrowserPreferences, input: unknown, fromDisk = false): BrowserPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid browser settings.');
  const patch = input as Record<string, unknown>;
  const next = structuredClone(current) as { -readonly [K in keyof BrowserPreferences]: BrowserPreferences[K] };
  const allowed = new Set<string>([...booleans, 'searchEngine', 'homeUrl', 'defaultZoom', 'permissions', 'sitePermissions', ...(fromDisk ? ['downloadDirectory'] : [])]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Unknown browser setting.');
  for (const key of booleans) {
    if (!(key in patch)) continue;
    if (typeof patch[key] !== 'boolean') throw new Error('Invalid browser setting.');
    next[key] = patch[key];
  }
  if ('searchEngine' in patch) {
    if (!['bing', 'google', 'baidu', 'duckduckgo'].includes(patch.searchEngine as string)) throw new Error('Invalid search engine.');
    next.searchEngine = patch.searchEngine as BrowserPreferences['searchEngine'];
  }
  if ('homeUrl' in patch) {
    if (patch.homeUrl !== '' && !browserSiteOrigin(patch.homeUrl)) throw new Error('Invalid home URL.');
    next.homeUrl = patch.homeUrl === '' ? '' : new URL(patch.homeUrl as string).href;
  }
  if ('defaultZoom' in patch) {
    if (typeof patch.defaultZoom !== 'number' || !Number.isFinite(patch.defaultZoom) || patch.defaultZoom < 0.5 || patch.defaultZoom > 3) throw new Error('Invalid zoom.');
    next.defaultZoom = patch.defaultZoom;
  }
  if ('downloadDirectory' in patch) {
    if (typeof patch.downloadDirectory !== 'string' || (patch.downloadDirectory !== '' && !path.isAbsolute(patch.downloadDirectory))) throw new Error('Invalid download directory.');
    next.downloadDirectory = patch.downloadDirectory;
  }
  if ('permissions' in patch) next.permissions = { ...next.permissions, ...parsePermissions(patch.permissions) };
  if ('sitePermissions' in patch) {
    const sites = patch.sitePermissions;
    if (!sites || typeof sites !== 'object' || Array.isArray(sites) || Object.keys(sites).length > 500) throw new Error('Invalid website permissions.');
    next.sitePermissions = Object.fromEntries(Object.entries(sites).map(([origin, rules]) => {
      if (browserSiteOrigin(origin) !== origin) throw new Error('Invalid website origin.');
      return [origin, parsePermissions(rules)];
    }));
  }
  return next;
}

function parsePermissions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid permissions.');
  for (const [key, rule] of Object.entries(value)) {
    if (!BROWSER_PERMISSIONS.includes(key as typeof BROWSER_PERMISSIONS[number]) || !policy(rule)) throw new Error('Invalid permission.');
  }
  return value as Partial<BrowserPreferences['permissions']>;
}

export class BrowserPreferencesStore {
  private value = structuredClone(DEFAULT_BROWSER_PREFERENCES);
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(preferences: BrowserPreferences) => void>();
  constructor(private readonly file: string) {}
  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1) throw new Error('Invalid browser settings version.');
      this.value = patchBrowserPreferences(DEFAULT_BROWSER_PREFERENCES, data.preferences, true);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  get(): BrowserPreferences { return structuredClone(this.value); }
  subscribe(listener: (preferences: BrowserPreferences) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  update(patch: unknown, native = false): Promise<BrowserPreferences> {
    const operation = this.queue.then(async () => {
      const next = patchBrowserPreferences(this.value, patch, native);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(this.file), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, preferences: next }), { mode: 0o600 });
        await rename(temporary, this.file);
      } finally { await rm(temporary, { force: true }); }
      this.value = next;
      for (const listener of this.listeners) listener(this.get());
      return this.get();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
