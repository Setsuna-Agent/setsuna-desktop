import type { Cookie, CookiesGetFilter, CookiesSetDetails, Extension, Session } from 'electron';
import type { ExtensionCookie, ExtensionCookieChange, ExtensionSystemEvent } from '../../contracts/extension-api.js';
import { matchesHost } from './user-scripts/match-pattern.js';

const storeId = '0';
type CookieCause = Parameters<Session['cookies']['on']>[1] extends (...args: infer Args) => unknown ? Args[2] : never;

/** Cookie access stays in the browser partition and is filtered before values or events leave main. */
export class BrowserExtensionCookies {
  private readonly removals = new Set<string>();
  constructor(private readonly options: {
    session: Session; resolve(id: string): Extension | null; tabIds(): number[];
    publish(id: string, event: ExtensionSystemEvent): void;
  }) {}

  start(): void { this.options.session.cookies.on('changed', this.changed); }
  dispose(): void { this.options.session.cookies.off('changed', this.changed); this.removals.clear(); }

  async call(extension: Extension, method: string, args: unknown[]): Promise<unknown> {
    if (!extension.manifest.permissions?.includes('cookies')) throw new Error('cookies permission required.');
    if (method === 'getAllCookieStores') return [{ id: storeId, tabIds: this.options.tabIds() }];
    const input = cookieInput(args[0]);
    const cookies = this.options.session.cookies;
    if (method === 'getAll') {
      validateFields(input, ['url', 'name', 'domain', 'path', 'secure', 'session']);
      if (input.url !== undefined && !allowedUrl(extension, input.url)) return [];
      const filter = { ...input }; delete filter.storeId;
      const result = await cookies.get(filter as CookiesGetFilter);
      const current = this.assertCurrent(extension);
      if (input.url !== undefined && !allowedUrl(current, input.url)) return [];
      return sortCookies(result).filter(cookie => input.url !== undefined || canReadCookie(current, cookie))
        .map(extensionCookie);
    }
    if (!['get', 'set', 'remove'].includes(method)) throw new Error(`Unsupported cookies method: ${method}.`);
    const url = allowedUrl(extension, input.url);
    if (!url) throw new Error('Host permission required for this cookie URL.');
    if (method === 'set') {
      validateFields(input, ['url', 'name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expirationDate']);
      if (input.expirationDate !== undefined && (typeof input.expirationDate !== 'number' || !Number.isFinite(input.expirationDate))) throw new Error('Invalid cookie expirationDate.');
      if (input.sameSite !== undefined && !['unspecified', 'no_restriction', 'lax', 'strict'].includes(input.sameSite as string)) throw new Error('Invalid cookie sameSite.');
      if (input.domain !== undefined) {
        const domain = (input.domain as string).replace(/^\./, '').toLowerCase();
        if (!domain || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
          || !matchesHost(`${url.protocol}//${domain}/`, extension.manifest.host_permissions ?? [])) throw new Error('Host permission required for the cookie domain.');
      }
      const { storeId: _storeId, ...fields } = input;
      const details: CookiesSetDetails = { ...fields, url: url.href,
        secure: input.secure as boolean | undefined ?? false, sameSite: input.sameSite as Cookie['sameSite'] | undefined ?? 'unspecified' };
      await cookies.set(details);
      this.assertCurrent(extension);
      const path = input.path ?? defaultCookiePath(url.pathname);
      const domain = (input.domain as string | undefined ?? url.hostname).replace(/^\./, '').toLowerCase();
      // The creation URL need not match the written path (for example / vs /account).
      const result = await cookies.get({ domain, name: input.name as string | undefined ?? '', path: path as string });
      const cookie = result.find(item => item.domain?.replace(/^\./, '') === domain && item.hostOnly === (input.domain === undefined));
      if (!allowedUrl(this.assertCurrent(extension), url.href)) throw new Error('Host permission required for this cookie URL.');
      return cookie ? extensionCookie(cookie) : null;
    }
    validateFields(input, ['url', 'name']);
    if (typeof input.name !== 'string') throw new Error('Cookie name is required.');
    const cookie = sortCookies(await cookies.get({ url: url.href, name: input.name }))[0];
    if (!allowedUrl(this.assertCurrent(extension), url.href)) throw new Error('Host permission required for this cookie URL.');
    if (!cookie) return null;
    if (method === 'get') return extensionCookie(cookie);
    // Electron remove(url, name) deletes every matching path. Expire the selected
    // canonical cookie so Chrome's single-cookie removal cannot erase its siblings.
    const key = cookieKey(cookie);
    this.removals.add(key);
    try {
      await cookies.set({ url: url.href, name: cookie.name, value: cookie.value, path: cookie.path,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }), secure: cookie.secure,
        httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: 1 });
    } catch (error) { this.removals.delete(key); throw error; }
    return { url: url.href, name: input.name, storeId };
  }

  private assertCurrent(extension: Extension): Extension {
    const current = this.options.resolve(extension.id);
    if (!current?.manifest.permissions?.includes('cookies') || current.path !== extension.path || current.version !== extension.version) throw new Error('cookies permission required.');
    return current;
  }

  private readonly changed = (_event: Electron.Event, cookie: Cookie, cause: CookieCause, removed: boolean) => {
    const explicitRemoval = removed && this.removals.delete(cookieKey(cookie));
    const changeInfo: ExtensionCookieChange = {
      cookie: extensionCookie(cookie), removed,
      cause: explicitRemoval || cause.startsWith('inserted') ? 'explicit' : cause === 'expired-overwrite' ? 'expired_overwrite' : cause as ExtensionCookieChange['cause'],
    };
    for (const native of this.options.session.extensions.getAllExtensions()) {
      const extension = this.options.resolve(native.id);
      if (extension?.manifest.permissions?.includes('cookies') && canReadCookie(extension, cookie)) {
        this.options.publish(extension.id, { kind: 'cookieChanged', changeInfo });
      }
    }
  };
}

function allowedUrl(extension: Extension, raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && matchesHost(url.href, extension.manifest.host_permissions ?? []) ? url : null;
  } catch { return null; }
}

export function canReadCookie(extension: Extension, cookie: Cookie): boolean {
  const domain = cookie.domain?.replace(/^\./, '');
  if (!domain) return false;
  const schemes = cookie.secure ? ['https'] : ['http', 'https'];
  const patterns: string[] = extension.manifest.host_permissions ?? [];
  if (schemes.some(scheme => matchesHost(`${scheme}://${domain}/`, patterns))) return true;
  // A domain cookie is also visible on a granted subdomain; host-only cookies are not.
  return !cookie.hostOnly && patterns.some(pattern => {
    const host = /^(\*|https?):\/\/([^/]+)\//.exec(pattern)?.[2].replace(/^\*\./, '');
    return host?.endsWith(`.${domain}`) && schemes.some(scheme => matchesHost(`${scheme}://${host}/`, [pattern]));
  });
}

function extensionCookie(cookie: Cookie): ExtensionCookie {
  return { ...cookie, domain: cookie.domain ?? '', path: cookie.path ?? '/', secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false, hostOnly: cookie.hostOnly ?? false, session: cookie.session ?? true, storeId };
}

function sortCookies(cookies: Cookie[]): Cookie[] { return cookies.sort((left, right) => (right.path?.length ?? 1) - (left.path?.length ?? 1)); }
function cookieKey(cookie: Cookie): string { return JSON.stringify([cookie.domain, cookie.path, cookie.name]); }
function defaultCookiePath(path: string): string { const slash = path.lastIndexOf('/'); return slash > 0 ? path.slice(0, slash) : '/'; }

function cookieInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid cookie details.');
  const input = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  if (input.storeId !== undefined && input.storeId !== storeId) throw new Error('Unknown cookie store.');
  if (input.partitionKey !== undefined) throw new Error('Partitioned cookie operations are not supported by Electron.');
  return input;
}

function validateFields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => key !== 'storeId' && !allowed.includes(key))) throw new Error('Invalid cookie details.');
  for (const [key, value] of Object.entries(input)) {
    if (['url', 'name', 'value', 'domain', 'path'].includes(key) && (typeof value !== 'string' || value.length > 16384)) throw new Error('Invalid cookie details.');
    if (['secure', 'httpOnly', 'session'].includes(key) && typeof value !== 'boolean') throw new Error('Invalid cookie details.');
  }
}
