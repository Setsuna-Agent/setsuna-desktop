import {
  DESKTOP_NETWORK_PROXY_SCOPES,
  defaultDesktopNetworkProxyRouting,
  normalizeDesktopNetworkProxyRoute,
  normalizeDesktopNetworkProxyUrl,
  type DesktopNetworkProxyGlobalRoute,
  type DesktopNetworkProxyRoutingInput,
  type DesktopNetworkProxyRoutingState,
  type DesktopNetworkProxyServerInput,
  type DesktopNetworkProxyServerState,
  type DesktopNetworkProxyState,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { NetworkProxyCredentialVault, NetworkProxyJsonWriter } from './capabilities.js';

const STORE_VERSION = 1;
const MAX_PROXY_NAME_CHARS = 80;
const MAX_PROXY_USERNAME_CHARS = 256;
const MAX_PROXY_PASSWORD_CHARS = 4096;
const PROXY_ID_PATTERN = /^proxy-[a-z0-9-]{8,80}$/u;
const CREDENTIAL_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type StoredNetworkProxyServer = {
  id: string;
  name: string;
  url: string;
  username?: string;
  passwordCredentialKey?: string;
};

type StoredNetworkProxyConfig = {
  pendingCredentialCleanupKeys: string[];
  version: number;
  servers: StoredNetworkProxyServer[];
  routing: DesktopNetworkProxyRoutingState;
};

type DesktopNetworkProxyStoreOptions = {
  writeConfig: NetworkProxyJsonWriter;
};

export type ResolvedUpstreamProxy = {
  id: string;
  url: string;
};

export type DesktopNetworkProxyUpsertResult = {
  state: DesktopNetworkProxyState;
  transportChanged: boolean;
};

export class DesktopNetworkProxyStore {
  private config: StoredNetworkProxyConfig | null = null;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly configPath: string,
    private readonly credentialVault: NetworkProxyCredentialVault,
    private readonly options: DesktopNetworkProxyStoreOptions,
  ) {}

  async getState(): Promise<DesktopNetworkProxyState> {
    let config = await this.load();
    if (config.pendingCredentialCleanupKeys.length) {
      await this.enqueue(async () => {
        await this.retryPendingCredentialCleanup(await this.load());
      });
      config = await this.load();
    }
    return stateFromStored(this.configPath, config);
  }

  async upsertServer(input: DesktopNetworkProxyServerInput): Promise<DesktopNetworkProxyState> {
    return (await this.upsertServerWithResult(input)).state;
  }

  async upsertServerWithResult(
    input: DesktopNetworkProxyServerInput,
  ): Promise<DesktopNetworkProxyUpsertResult> {
    let transportChanged = false;
    await this.enqueue(async () => {
      let config = await this.load();
      const suppliedId = normalizedProxyId(input.id);
      if (input.id !== undefined && !suppliedId) throw new Error('代理服务器 ID 无效。');
      const id = suppliedId ?? `proxy-${randomUUID()}`;
      const previousIndex = config.servers.findIndex((server) => server.id === id);
      const previous = previousIndex >= 0 ? config.servers[previousIndex] : undefined;
      const name = normalizeProxyName(input.name);
      const url = normalizeDesktopNetworkProxyUrl(input.url);
      if (!url) throw new Error('代理地址必须是无凭据的 HTTP、HTTPS 或 SOCKS5 URL。');
      if (config.servers.some((server) => server.id !== id && server.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error(`代理服务器“${name}”已存在。`);
      }

      const username = input.clearPassword === true ? undefined : normalizeProxyUsername(input.username);
      const password = normalizeNewPassword(input.password);
      const clearPassword = !username;
      if (password && !username) throw new Error('配置代理密码时必须同时填写用户名。');
      if (username && !password && !previous?.passwordCredentialKey) {
        throw new Error('首次配置代理用户名时必须同时填写密码。');
      }
      if (new URL(url).protocol === 'socks5:' && username) {
        const effectivePassword = password ?? (previous?.passwordCredentialKey
          ? await this.credentialVault.get(previous.passwordCredentialKey)
          : undefined);
        if (effectivePassword === undefined) throw new Error(`代理服务器“${name}”的密码不可用。`);
        validateSocks5Credentials(username, effectivePassword);
      }

      let passwordCredentialKey = clearPassword ? undefined : previous?.passwordCredentialKey;
      let stagedCredentialKey: string | undefined;
      if (password) {
        // Journal the new key before writing it so a crash or failed metadata
        // commit cannot leave an untracked credential in secure storage.
        stagedCredentialKey = versionedProxyPasswordCredentialKey(id);
        config = {
          ...config,
          pendingCredentialCleanupKeys: addPendingCredentialCleanupKey(
            config.pendingCredentialCleanupKeys,
            stagedCredentialKey,
          ),
        };
        await this.persist(config);
        await this.credentialVault.set(stagedCredentialKey, password);
        passwordCredentialKey = stagedCredentialKey;
      }
      const credentialToDelete = previous?.passwordCredentialKey !== passwordCredentialKey
        ? previous?.passwordCredentialKey
        : undefined;

      const nextServer: StoredNetworkProxyServer = {
        id,
        name,
        url,
        ...(username ? { username } : {}),
        ...(passwordCredentialKey ? { passwordCredentialKey } : {}),
      };
      const servers = [...config.servers];
      if (previousIndex >= 0) servers[previousIndex] = nextServer;
      else servers.push(nextServer);
      const pendingCredentialCleanupKeys = addPendingCredentialCleanupKey(
        config.pendingCredentialCleanupKeys.filter((key) => key !== stagedCredentialKey),
        credentialToDelete,
      );
      await this.persist({ ...config, pendingCredentialCleanupKeys, servers });
      transportChanged = previous ? (
        previous.url !== nextServer.url
        || previous.username !== nextServer.username
        || previous.passwordCredentialKey !== nextServer.passwordCredentialKey
      ) : false;
      await this.retryPendingCredentialCleanup(await this.load());
    });
    return { state: await this.getState(), transportChanged };
  }

  async deleteServer(proxyServerId: string): Promise<DesktopNetworkProxyState> {
    await this.enqueue(async () => {
      const config = await this.load();
      const id = requireProxyId(proxyServerId);
      const server = config.servers.find((item) => item.id === id);
      if (!server) throw new Error('要删除的代理服务器不存在。');
      const routeLabels = routingReferences(config.routing, id);
      if (routeLabels.length) {
        throw new Error(`代理服务器仍被${routeLabels.join('、')}使用，请先切换为其他代理或直连。`);
      }
      await this.persist({
        ...config,
        pendingCredentialCleanupKeys: addPendingCredentialCleanupKey(
          config.pendingCredentialCleanupKeys,
          server.passwordCredentialKey,
        ),
        servers: config.servers.filter((item) => item.id !== id),
      });
      await this.retryPendingCredentialCleanup(await this.load());
    });
    return this.getState();
  }

  async validateServerReferences(proxyServerIds: readonly string[]): Promise<void> {
    const config = await this.load();
    const availableIds = new Set(config.servers.map((server) => server.id));
    const missingId = proxyServerIds
      .map(requireProxyId)
      .find((proxyServerId) => !availableIds.has(proxyServerId));
    if (missingId) throw new Error(`选择的代理服务器不存在：${missingId}`);
  }

  async setRouting(input: DesktopNetworkProxyRoutingInput): Promise<DesktopNetworkProxyState> {
    await this.enqueue(async () => {
      const config = await this.load();
      const global = input.global === undefined
        ? config.routing.global
        : requireGlobalRoute(input.global);
      const scopes = { ...config.routing.scopes };
      for (const scope of DESKTOP_NETWORK_PROXY_SCOPES) {
        const route = input.scopes?.[scope];
        if (route !== undefined) scopes[scope] = requireRoute(route);
      }
      const routing = { global, scopes };
      validateRoutingReferences(routing, config.servers);
      await this.persist({ ...config, routing });
    });
    return this.getState();
  }

  async resolveUpstream(proxyServerId: string): Promise<ResolvedUpstreamProxy> {
    const config = await this.load();
    const id = requireProxyId(proxyServerId);
    const server = config.servers.find((item) => item.id === id);
    if (!server) throw new Error(`选择的代理服务器不存在：${id}`);
    const upstream = new URL(server.url);
    if (server.username) {
      const password = server.passwordCredentialKey
        ? await this.credentialVault.get(server.passwordCredentialKey)
        : undefined;
      if (password === undefined) throw new Error(`代理服务器“${server.name}”的密码不可用。`);
      upstream.username = server.username;
      upstream.password = password;
    }
    return { id, url: upstream.toString() };
  }

  private async load(): Promise<StoredNetworkProxyConfig> {
    if (this.config) return this.config;
    try {
      const parsed = JSON.parse(await readFile(this.configPath, 'utf8')) as unknown;
      this.config = normalizeStoredConfig(parsed);
    } catch (error) {
      if (isMissingFileError(error)) this.config = defaultStoredConfig();
      else throw new Error(`无法读取代理服务器配置：${error instanceof Error ? error.message : String(error)}`);
    }
    return this.config;
  }

  private async persist(config: StoredNetworkProxyConfig): Promise<void> {
    await this.options.writeConfig(this.configPath, config);
    this.config = config;
  }

  private async retryPendingCredentialCleanup(config: StoredNetworkProxyConfig): Promise<void> {
    if (!config.pendingCredentialCleanupKeys.length) return;
    const deletedKeys = new Set<string>();
    for (const credentialKey of config.pendingCredentialCleanupKeys) {
      try {
        await this.credentialVault.delete(credentialKey);
        deletedKeys.add(credentialKey);
      } catch {
        // The durable cleanup list keeps failed secure-storage deletions retryable.
      }
    }
    if (!deletedKeys.size) return;
    await this.persist({
      ...config,
      pendingCredentialCleanupKeys: config.pendingCredentialCleanupKeys
        .filter((credentialKey) => !deletedKeys.has(credentialKey)),
    }).catch(() => undefined);
  }

  private async enqueue(update: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(update, update);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }
}

function defaultStoredConfig(): StoredNetworkProxyConfig {
  return {
    pendingCredentialCleanupKeys: [],
    version: STORE_VERSION,
    servers: [],
    routing: defaultDesktopNetworkProxyRouting(),
  };
}

function normalizeStoredConfig(value: unknown): StoredNetworkProxyConfig {
  if (!isRecord(value)) throw new Error('代理服务器配置必须是对象。');
  if (value.version !== STORE_VERSION) throw new Error('代理服务器配置版本不受支持。');
  if (!Array.isArray(value.servers)) throw new Error('代理服务器列表无效。');
  const servers = value.servers.map(normalizeStoredServer);
  if (hasDuplicateServers(servers)) throw new Error('代理服务器配置包含重复的 ID 或名称。');
  const pendingCredentialCleanupKeys = normalizePendingCredentialCleanupKeys(
    value.pendingCredentialCleanupKeys,
  );
  const referencedCredentialKeys = new Set(servers.flatMap((server) => (
    server.passwordCredentialKey ? [server.passwordCredentialKey] : []
  )));
  if (pendingCredentialCleanupKeys.some((key) => referencedCredentialKeys.has(key))) {
    throw new Error('代理服务器配置将正在使用的凭据标记为待清理。');
  }
  if (!isRecord(value.routing)) throw new Error('代理路由配置无效。');
  const global = normalizeDesktopNetworkProxyRoute(value.routing.global, { allowInherit: false });
  if (!global || global.mode === 'inherit') throw new Error('全局代理路由配置无效。');
  if (!isRecord(value.routing.scopes)) throw new Error('代理范围路由配置无效。');
  const scopes = {} as DesktopNetworkProxyRoutingState['scopes'];
  const defaultScopes = defaultDesktopNetworkProxyRouting().scopes;
  for (const scope of DESKTOP_NETWORK_PROXY_SCOPES) {
    const storedRoute = value.routing.scopes[scope];
    // New route scopes must not invalidate configurations written by an older
    // app version. Missing scopes inherit the existing global route by default.
    const route = storedRoute === undefined
      ? defaultScopes[scope]
      : normalizeDesktopNetworkProxyRoute(storedRoute);
    if (!route) throw new Error(`代理范围路由配置无效：${scope}`);
    scopes[scope] = route;
  }
  const routing = { global: global as DesktopNetworkProxyGlobalRoute, scopes };
  validateRoutingReferences(routing, servers);
  return { pendingCredentialCleanupKeys, version: STORE_VERSION, servers, routing };
}

function normalizeStoredServer(value: unknown): StoredNetworkProxyServer {
  if (!isRecord(value)) throw new Error('代理服务器条目无效。');
  const id = normalizedProxyId(value.id);
  const url = normalizeDesktopNetworkProxyUrl(value.url);
  if (!id || !url) throw new Error('代理服务器条目的 ID 或地址无效。');
  const name = normalizeProxyName(value.name);
  const username = normalizeProxyUsername(value.username);
  if (url.startsWith('socks5:') && username && Buffer.byteLength(username, 'utf8') > 255) {
    throw new Error(`代理服务器“${name}”的 SOCKS5 用户名超过 255 字节。`);
  }
  const passwordCredentialKey = typeof value.passwordCredentialKey === 'string'
    && isProxyPasswordCredentialKey(id, value.passwordCredentialKey)
    ? value.passwordCredentialKey
    : undefined;
  if (Boolean(username) !== Boolean(passwordCredentialKey)) {
    throw new Error(`代理服务器“${name}”的凭据元数据无效。`);
  }
  return {
    id,
    name,
    url,
    ...(username ? { username } : {}),
    ...(username && passwordCredentialKey ? { passwordCredentialKey } : {}),
  };
}

function stateFromStored(configPath: string, config: StoredNetworkProxyConfig): DesktopNetworkProxyState {
  return {
    configPath,
    servers: config.servers.map((server): DesktopNetworkProxyServerState => ({
      id: server.id,
      name: server.name,
      url: server.url,
      ...(server.username ? { username: server.username } : {}),
      passwordSet: Boolean(server.passwordCredentialKey),
    })),
    routing: cloneRouting(config.routing),
  };
}

function cloneRouting(routing: DesktopNetworkProxyRoutingState): DesktopNetworkProxyRoutingState {
  return {
    global: { ...routing.global },
    scopes: Object.fromEntries(
      DESKTOP_NETWORK_PROXY_SCOPES.map((scope) => [scope, { ...routing.scopes[scope] }]),
    ) as DesktopNetworkProxyRoutingState['scopes'],
  };
}

function requireRoute(value: unknown) {
  const route = normalizeDesktopNetworkProxyRoute(value);
  if (!route) throw new Error('代理路由配置无效。');
  return route;
}

function requireGlobalRoute(value: unknown): DesktopNetworkProxyGlobalRoute {
  const route = normalizeDesktopNetworkProxyRoute(value, { allowInherit: false });
  if (!route || route.mode === 'inherit') throw new Error('全局代理只能选择系统默认、直连或一个代理服务器。');
  return route;
}

function validateRoutingReferences(
  routing: DesktopNetworkProxyRoutingState,
  servers: StoredNetworkProxyServer[],
): void {
  const serverIds = new Set(servers.map((server) => server.id));
  const routes = [routing.global, ...DESKTOP_NETWORK_PROXY_SCOPES.map((scope) => routing.scopes[scope])];
  const missing = routes.find((route) => route.mode === 'proxy' && !serverIds.has(route.proxyServerId));
  if (missing?.mode === 'proxy') throw new Error(`选择的代理服务器不存在：${missing.proxyServerId}`);
}

function routingReferences(routing: DesktopNetworkProxyRoutingState, proxyServerId: string): string[] {
  const labels: string[] = [];
  if (routing.global.mode === 'proxy' && routing.global.proxyServerId === proxyServerId) labels.push('全局默认');
  const scopeLabels: Record<(typeof DESKTOP_NETWORK_PROXY_SCOPES)[number], string> = {
    browser: '内置浏览器',
    terminal: '终端',
    updater: '应用更新',
    runtime: 'Runtime 服务',
    sync: 'WebDAV 同步',
  };
  for (const scope of DESKTOP_NETWORK_PROXY_SCOPES) {
    const route = routing.scopes[scope];
    if (route.mode === 'proxy' && route.proxyServerId === proxyServerId) labels.push(scopeLabels[scope]);
  }
  return labels;
}

function normalizeProxyName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('请输入代理服务器名称。');
  if (Array.from(name).length > MAX_PROXY_NAME_CHARS) throw new Error(`代理服务器名称不能超过 ${MAX_PROXY_NAME_CHARS} 个字符。`);
  return name;
}

function normalizeProxyUsername(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const username = value.trim();
  if (!username) return undefined;
  if (Array.from(username).length > MAX_PROXY_USERNAME_CHARS) throw new Error(`代理用户名不能超过 ${MAX_PROXY_USERNAME_CHARS} 个字符。`);
  return username;
}

function normalizeNewPassword(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (Array.from(value).length > MAX_PROXY_PASSWORD_CHARS) throw new Error(`代理密码不能超过 ${MAX_PROXY_PASSWORD_CHARS} 个字符。`);
  return value;
}

function validateSocks5Credentials(username: string, password: string): void {
  if (Buffer.byteLength(username, 'utf8') > 255) {
    throw new Error('SOCKS5 代理用户名不能超过 255 个 UTF-8 字节。');
  }
  if (Buffer.byteLength(password, 'utf8') > 255) {
    throw new Error('SOCKS5 代理密码不能超过 255 个 UTF-8 字节。');
  }
}

function proxyPasswordCredentialKey(id: string): string {
  return `network-proxy.${id}.password`;
}

function versionedProxyPasswordCredentialKey(id: string): string {
  return `${proxyPasswordCredentialKey(id)}.${randomUUID()}`;
}

function isProxyPasswordCredentialKey(id: string, value: string): boolean {
  return proxyIdForPasswordCredentialKey(value) === id;
}

function proxyIdForPasswordCredentialKey(value: string): string | undefined {
  const prefix = 'network-proxy.';
  const passwordMarker = '.password';
  if (!value.startsWith(prefix)) return undefined;
  const markerIndex = value.indexOf(passwordMarker, prefix.length);
  if (markerIndex < 0) return undefined;
  const id = value.slice(prefix.length, markerIndex);
  if (normalizedProxyId(id) !== id) return undefined;
  const suffix = value.slice(markerIndex + passwordMarker.length);
  if (!suffix) return id;
  return suffix.startsWith('.') && CREDENTIAL_VERSION_PATTERN.test(suffix.slice(1))
    ? id
    : undefined;
}

function normalizePendingCredentialCleanupKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('待清理的代理凭据列表无效。');
  const keys = value.map((item) => {
    if (typeof item !== 'string' || !proxyIdForPasswordCredentialKey(item)) {
      throw new Error('待清理的代理凭据键无效。');
    }
    return item;
  });
  if (new Set(keys).size !== keys.length) throw new Error('待清理的代理凭据列表包含重复项。');
  return keys;
}

function addPendingCredentialCleanupKey(
  current: readonly string[],
  credentialKey: string | undefined,
): string[] {
  return credentialKey && !current.includes(credentialKey)
    ? [...current, credentialKey]
    : [...current];
}

function normalizedProxyId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim().toLocaleLowerCase();
  return PROXY_ID_PATTERN.test(id) ? id : undefined;
}

function requireProxyId(value: unknown): string {
  const id = normalizedProxyId(value);
  if (!id) throw new Error('代理服务器 ID 无效。');
  return id;
}

function hasDuplicateServers(servers: StoredNetworkProxyServer[]): boolean {
  const ids = new Set<string>();
  const names = new Set<string>();
  return servers.some((server) => {
    const normalizedName = server.name.toLocaleLowerCase();
    if (ids.has(server.id) || names.has(normalizedName)) return true;
    ids.add(server.id);
    names.add(normalizedName);
    return false;
  });
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
