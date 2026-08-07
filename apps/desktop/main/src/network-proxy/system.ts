export type DesktopSystemProxyResolver = (targetUrl: string) => Promise<string | null>;

type ProxyResolvingSession = {
  resolveProxy(url: string): Promise<string>;
};

/** Resolves Electron/Chromium PAC output into one upstream understood by our relay. */
export function createDesktopSystemProxyResolver(
  proxySession: ProxyResolvingSession,
): DesktopSystemProxyResolver {
  return async (targetUrl) => systemProxyUrlFromPacResult(await proxySession.resolveProxy(targetUrl));
}

export function systemProxyUrlFromPacResult(value: string): string | null {
  for (const entry of value.split(';')) {
    const directive = entry.trim();
    if (!directive) continue;
    if (/^DIRECT$/iu.test(directive)) return null;
    const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS5)\s+(.+)$/iu.exec(directive);
    if (!match) continue;
    const protocol = proxyProtocol(match[1]);
    const authority = match[2]?.trim();
    if (!protocol || !authority) continue;
    try {
      const url = new URL(`${protocol}//${authority}`);
      if (
        !url.hostname
        || url.username
        || url.password
        || (url.pathname && url.pathname !== '/')
        || url.search
        || url.hash
      ) {
        continue;
      }
      return `${url.protocol}//${url.host}`;
    } catch {
      // PAC can contain unsupported or malformed fallbacks; continue in order.
    }
  }
  throw new Error('系统代理解析结果不包含受支持的代理或 DIRECT 指令。');
}

function proxyProtocol(value: string | undefined): 'http:' | 'https:' | 'socks5:' | null {
  switch (value?.toLocaleUpperCase()) {
    case 'PROXY':
    case 'HTTP':
      return 'http:';
    case 'HTTPS':
      return 'https:';
    case 'SOCKS':
    case 'SOCKS5':
      return 'socks5:';
    default:
      return null;
  }
}
