export const DESKTOP_NETWORK_PROXY_SCOPES = [
  'browser',
  'terminal',
  'updater',
  'runtime',
  'sync',
] as const;

export type DesktopNetworkProxyScope = typeof DESKTOP_NETWORK_PROXY_SCOPES[number];

export type DesktopNetworkProxyRoute =
  | { mode: 'inherit' }
  | { mode: 'system' }
  | { mode: 'direct' }
  | { mode: 'proxy'; proxyServerId: string };

export type DesktopNetworkProxyGlobalRoute = Exclude<DesktopNetworkProxyRoute, { mode: 'inherit' }>;

export type DesktopNetworkProxyServerState = {
  id: string;
  name: string;
  /** Canonical URL without credentials, paths, query parameters, or fragments. */
  url: string;
  username?: string;
  passwordSet: boolean;
};

export type DesktopNetworkProxyServerInput = {
  id?: string;
  name: string;
  url: string;
  username?: string;
  /** Omit to retain an existing password. */
  password?: string;
  clearPassword?: boolean;
};

export type DesktopNetworkProxyRoutingState = {
  global: DesktopNetworkProxyGlobalRoute;
  scopes: Record<DesktopNetworkProxyScope, DesktopNetworkProxyRoute>;
};

export type DesktopNetworkProxyRoutingInput = {
  global?: DesktopNetworkProxyGlobalRoute;
  scopes?: Partial<Record<DesktopNetworkProxyScope, DesktopNetworkProxyRoute>>;
};

export type DesktopNetworkProxyState = {
  configPath: string;
  servers: DesktopNetworkProxyServerState[];
  routing: DesktopNetworkProxyRoutingState;
};

/** Runtime-only response. Configured proxies expose only an authenticated loopback relay. */
export type DesktopResolvedNetworkProxy =
  | { mode: 'system' }
  | { mode: 'direct' }
  | { mode: 'proxy'; proxyServerId: string; proxyUrl: string };

export type DesktopResolveNetworkProxyInput = {
  scope: DesktopNetworkProxyScope;
  override?: DesktopNetworkProxyRoute;
};

export const DESKTOP_SYSTEM_PROXY_FETCH_PATH = '/v1/network-proxy/system-fetch';
export const DESKTOP_SANDBOX_NETWORK_ENVIRONMENT_PATH = '/v1/network-proxy/sandbox-environment';
export const DESKTOP_WINDOWS_SANDBOX_PROXY_PORTS = Object.freeze([
  61080,
  61081,
  61082,
  61083,
  61084,
  61085,
  61086,
  61087,
  61088,
  61089,
]);
export const DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER = 'x-setsuna-system-fetch-error';
export const DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES = 4;
export const DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES = 1024 * 1024;

export type DesktopSystemProxyFetchRequest = {
  headers: Array<[string, string]>;
  method: string;
  url: string;
};

/** Runtime-only proxy variables whose credentials are valid for this app launch. */
export type DesktopSandboxNetworkEnvironment = Record<string, string>;

export function defaultDesktopNetworkProxyRouting(): DesktopNetworkProxyRoutingState {
  return {
    global: { mode: 'system' },
    scopes: {
      browser: { mode: 'inherit' },
      terminal: { mode: 'inherit' },
      updater: { mode: 'inherit' },
      runtime: { mode: 'inherit' },
      sync: { mode: 'inherit' },
    },
  };
}

/**
 * Accept only explicit HTTP, HTTPS, and SOCKS5 upstreams. Credentials are kept
 * in the native vault and must never be embedded into the persisted URL.
 */
export function normalizeDesktopNetworkProxyUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (
      !['http:', 'https:', 'socks5:'].includes(url.protocol)
      || !url.hostname
      || url.port === '0'
      || url.username
      || url.password
      || (url.pathname && url.pathname !== '/')
      || url.search
      || url.hash
    ) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function normalizeDesktopNetworkProxyRoute(
  value: unknown,
  options: { allowInherit?: boolean } = {},
): DesktopNetworkProxyRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.mode === 'inherit') {
    return options.allowInherit === false ? null : { mode: 'inherit' };
  }
  if (record.mode === 'system') return { mode: 'system' };
  if (record.mode === 'direct') return { mode: 'direct' };
  if (record.mode !== 'proxy' || typeof record.proxyServerId !== 'string') return null;
  const proxyServerId = record.proxyServerId.trim().toLowerCase();
  return proxyServerId ? { mode: 'proxy', proxyServerId } : null;
}

/** Local model endpoints and native loopback bridges must never leave the host. */
export function isDesktopNetworkProxyLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    if (hostname === '[::1]' || hostname === '::1') return true;
    if (isIpv4Loopback(hostname)) return true;
    const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    const mappedIpv4 = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
    return mappedIpv4 ? (Number.parseInt(mappedIpv4[1]!, 16) >>> 8) === 127 : false;
  } catch {
    return false;
  }
}

function isIpv4Loopback(hostname: string): boolean {
  const ipv4 = hostname.split('.').map(Number);
  return ipv4.length === 4
    && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && ipv4[0] === 127;
}
