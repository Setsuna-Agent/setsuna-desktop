import type { ExtensionSystemEvent } from '../contracts/extension-api.js';

/** Self-contained because Electron executes this function in the extension's world. */
export function installExtensionNavigationEvents(transport: { onEvent(listener: (event: ExtensionSystemEvent) => void): void }): void {
  type Listener = (details: Record<string, unknown>) => void;
  type Matcher = (url: URL) => boolean;
  const navigation = (globalThis as unknown as { chrome?: { webNavigation?: Record<string, unknown> } }).chrome?.webNavigation;
  if (!navigation) return;
  const defaultPorts: Record<string, number> = { 'http:': 80, 'https:': 443, 'ftp:': 21 };
  const events = new Map<string, Map<Listener, Matcher>>();
  for (const [name, kind] of [['onCommitted', 'navigationCommitted'], ['onCreatedNavigationTarget', 'navigationTargetCreated']]) {
    if (navigation[name]) continue;
    const listeners = new Map<Listener, Matcher>(); events.set(kind, listeners);
    navigation[name] = {
      addListener(listener: Listener, filters?: unknown) {
        if (typeof listener !== 'function') throw new TypeError('Expected a listener.');
        if (!listeners.has(listener)) listeners.set(listener, compileFilters(filters));
      },
      removeListener: (listener: Listener) => listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener), hasListeners: () => listeners.size > 0,
    };
  }
  if (!events.size) return;
  transport.onEvent(event => {
    if (event.kind !== 'navigationCommitted' && event.kind !== 'navigationTargetCreated') return;
    let url: URL;
    try { url = new URL(String(event.details.url)); url.hash = ''; }
    catch { return; }
    for (const [listener, matches] of [...(events.get(event.kind) ?? [])]) {
      try { if (matches(url)) listener(event.details); } catch (error) { console.error(error); }
    }
  });

  function compileFilters(input: unknown): Matcher {
    if (input === undefined) return () => true;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => key !== 'url')) throw new TypeError('Invalid navigation filters.');
    const filters = (input as { url?: unknown }).url;
    if (!Array.isArray(filters)) throw new TypeError('Expected URL filters.');
    const alternatives = filters.map(filter => {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new TypeError('Invalid URL filter.');
      const conditions = Object.entries(filter).map(([key, value]): Matcher => {
        if (key === 'schemes') {
          if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new TypeError('Invalid schemes.');
          const schemes = [...value]; return url => schemes.includes(url.protocol.slice(0, -1));
        }
        if (key === 'ports') {
          if (!Array.isArray(value)) throw new TypeError('Invalid ports.');
          const ranges = value.map(item => {
            const range = typeof item === 'number' ? [item, item] : item;
            if (!Array.isArray(range) || range.length !== 2 || !range.every(port => Number.isInteger(port) && port >= 0 && port <= 65_535)
              || range[0] > range[1]) throw new TypeError('Invalid port range.');
            return [range[0], range[1]];
          });
          return url => {
            const port = url.port ? Number(url.port) : defaultPorts[url.protocol];
            return port !== undefined && ranges.some(([first, last]) => port >= first && port <= last);
          };
        }
        if (typeof value !== 'string') throw new TypeError('Invalid URL filter value.');
        if (key === 'urlMatches' || key === 'originAndPathMatches') {
          // RE2 excludes lookarounds and backreferences. Other unsupported syntax
          // fails at registration instead of silently widening the listener.
          if (/\(\?[=!<]|\\[1-9]/.test(value)) throw new TypeError('Unsupported URL regular expression.');
          const expression = new RegExp(value);
          return url => expression.test(key === 'urlMatches' ? url.href : `${url.origin}${url.pathname}`);
        }
        const field = /^(host|path|query|url)(Contains|Equals|Prefix|Suffix)$/.exec(key);
        if (!field) throw new TypeError(`Unsupported URL filter: ${key}.`);
        return url => {
          const source = field[1] === 'host' ? url.hostname : field[1] === 'path' ? url.pathname
            : field[1] === 'query' ? url.search.slice(1) : url.href;
          return field[2] === 'Equals' ? source === value : field[2] === 'Prefix' ? source.startsWith(value)
            : field[2] === 'Suffix' ? source.endsWith(value) : (field[1] === 'host' ? `.${source}` : source).includes(value);
        };
      });
      return (url: URL) => conditions.every(matches => matches(url));
    });
    return url => alternatives.some(matches => matches(url));
  }
}
