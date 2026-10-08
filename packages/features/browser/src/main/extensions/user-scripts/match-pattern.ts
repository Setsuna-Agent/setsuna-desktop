/** Chrome match patterns, shared by registration validation and host permission checks. */
export function compileMatchPattern(pattern: string, allSchemes = false): { test(url: string): boolean } | null {
  if (pattern === '<all_urls>') return { test: (url) => (allSchemes ? /^[a-z][a-z0-9+.-]*:/i : /^(https?|file|ftp|wss?):/).test(url) };
  const match = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!match) return null;
  const [, scheme, host, pathname] = match;
  // Native tabs.query accepts additional schemes, while script registrations stay restricted.
  if (!allSchemes && !['*', 'http', 'https', 'file', 'ftp', 'ws', 'wss'].includes(scheme)) return null;
  if (scheme !== 'file' && (!host || (host.includes('*') && host !== '*' && !/^\*\.[^*]+$/.test(host)))) return null;
  if (scheme === 'file' && host !== '' && host !== '*') return null;
  const pathPattern = glob(pathname);
  return { test(raw) {
    try {
      const url = new URL(raw);
      if (scheme === '*' ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== `${scheme}:`) return false;
      const expected = host.toLowerCase();
      const name = (expected.includes(':') ? url.host : url.hostname).toLowerCase();
      if (scheme !== 'file' && expected !== '*' && !(expected.startsWith('*.')
        ? name === expected.slice(2) || name.endsWith(expected.slice(1)) : name === expected)) return false;
      return pathPattern.test(url.pathname + url.search);
    } catch { return false; }
  } };
}

function glob(value: string, question = false): RegExp {
  return new RegExp(`^${value.split('').map((character) => character === '*' ? '.*'
    : character === '?' && question ? '.' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
}

export function matchesHost(url: string, patterns: readonly string[]): boolean {
  // Paths do not restrict host permissions; registrations still match their full path.
  return patterns.some((pattern) => compileMatchPattern(pattern.replace(/^(\w+|\*):\/\/([^/]+)\/.*$/, '$1://$2/*'))?.test(url));
}

export function contentScriptAppliesTo(script: {
  matches: string[]; excludeMatches?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; allFrames: boolean;
}, frame: { url: string; isTopFrame: boolean; precursorUrl: string | null }): boolean {
  if (!frame.isTopFrame && !script.allFrames) return false;
  const url = frame.url.split('#')[0];
  return script.matches.some((pattern) => compileMatchPattern(pattern)?.test(url))
    && !script.excludeMatches?.some((pattern) => compileMatchPattern(pattern)?.test(url))
    && (!script.includeGlobs?.length || script.includeGlobs.some((pattern) => glob(pattern, true).test(url)))
    && !script.excludeGlobs?.some((pattern) => glob(pattern, true).test(url));
}
