import os from 'node:os';

const MAX_ENDPOINT_CHARS = 2_048;
const MAX_REMOTE_ROOT_CHARS = 1_024;
const MAX_USERNAME_CHARS = 512;
const MAX_PASSWORD_CHARS = 4_096;
const MAX_DEVICE_NAME_CHARS = 80;

export type NormalizedWebDavLocation = {
  endpoint: string;
  remoteRoot: string;
  remoteRootSegments: string[];
};

export function normalizeWebDavLocation(input: {
  endpoint: string;
  remoteRoot: string;
  allowInsecureHttp?: boolean;
}): NormalizedWebDavLocation {
  const rawEndpoint = input.endpoint.trim();
  if (!rawEndpoint || rawEndpoint.length > MAX_ENDPOINT_CHARS) {
    throw new Error('WebDAV 服务器地址无效。');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error('WebDAV 服务器地址无效。');
  }
  if (!endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('WebDAV 地址不能包含账号、密码、查询参数或片段。');
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('WebDAV 地址必须使用 HTTPS 或 HTTP。');
  }
  if (
    endpoint.protocol === 'http:'
    && !isLoopbackHostname(endpoint.hostname)
    && input.allowInsecureHttp !== true
  ) {
    throw new Error('非本机 WebDAV 默认必须使用 HTTPS。');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, '') || '/';

  const rootText = input.remoteRoot.trim().replaceAll('\\', '/');
  if (!rootText || rootText.length > MAX_REMOTE_ROOT_CHARS) {
    throw new Error('WebDAV 远端目录无效。');
  }
  const remoteRootSegments = rootText
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    !remoteRootSegments.length
    || remoteRootSegments.length > 32
    || remoteRootSegments.some((segment) => (
      segment === '.'
      || segment === '..'
      || segment.length > 255
      || hasAsciiControlCharacter(segment)
    ))
  ) {
    throw new Error('WebDAV 远端目录包含不受支持的路径片段。');
  }
  return {
    endpoint: endpoint.toString().replace(/\/$/u, ''),
    remoteRoot: `/${remoteRootSegments.join('/')}`,
    remoteRootSegments,
  };
}

export function normalizeWebDavUsername(value: string): string {
  const username = value.trim();
  if (!username || username.length > MAX_USERNAME_CHARS || /[:\r\n]/u.test(username)) {
    throw new Error('WebDAV 用户名无效。');
  }
  return username;
}

export function normalizeWebDavPassword(value: string): string {
  if (!value || value.length > MAX_PASSWORD_CHARS || /[\r\n]/u.test(value)) {
    throw new Error('WebDAV 密码无效。');
  }
  return value;
}

export function normalizeWebDavDeviceName(value?: string): string {
  const candidate = value?.trim() || os.hostname().trim() || 'Setsuna device';
  return candidate.slice(0, MAX_DEVICE_NAME_CHARS);
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);
}
