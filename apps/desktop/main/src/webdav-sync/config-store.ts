import {
  DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES,
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
  type DesktopWebDavSyncPreferencesInput,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { writeJsonAtomically } from '../data-root/atomic-json.js';
import type { CredentialVault } from '../security/credential-vault.js';
import {
  normalizeWebDavDeviceName,
  normalizeWebDavLocation,
  normalizeWebDavPassword,
  normalizeWebDavUsername,
} from './normalization.js';
import { normalizeWebDavRecoveryKey } from './crypto.js';
import {
  WEB_DAV_SYNC_STORE_VERSION,
  type ResolvedWebDavSyncConnection,
  type StoredWebDavSyncConfig,
  type StoredWebDavSyncConnection,
} from './model.js';

const CREDENTIAL_KEY_PATTERN = /^webdav-sync\.(?:password|recovery-key)\.[0-9a-f-]{36}$/u;
const REPOSITORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type WebDavSyncConfigStoreOptions = {
  writeConfig?: typeof writeJsonAtomically;
};

export class WebDavSyncConfigStore {
  private config: StoredWebDavSyncConfig | null = null;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly configPath: string,
    private readonly credentialVault: CredentialVault,
    private readonly options: WebDavSyncConfigStoreOptions = {},
  ) {}

  async initialize(): Promise<StoredWebDavSyncConfig> {
    const config = await this.load();
    await this.persist(config);
    await this.retryPendingCredentialCleanup(config);
    return this.clone(await this.load());
  }

  async getConfig(): Promise<StoredWebDavSyncConfig> {
    const config = await this.load();
    if (config.pendingCredentialCleanupKeys.length) {
      await this.enqueue(async () => this.retryPendingCredentialCleanup(await this.load()));
    }
    return this.clone(await this.load());
  }

  async resolveConnection(): Promise<ResolvedWebDavSyncConnection | null> {
    const config = await this.load();
    const connection = config.connection;
    if (!connection) return null;
    const [password, recoveryKey] = await Promise.all([
      this.credentialVault.get(connection.passwordCredentialKey),
      this.credentialVault.get(connection.recoveryKeyCredentialKey),
    ]);
    if (password === undefined || recoveryKey === undefined) {
      throw new Error('WebDAV 安全凭据不可用，请重新连接服务器。');
    }
    return { ...connection, password, recoveryKey };
  }

  async resetDamagedConfig(): Promise<StoredWebDavSyncConfig> {
    await this.enqueue(async () => {
      this.config = null;
      try {
        await this.load();
      } catch {
        // Keep the unreadable metadata for diagnosis. Its opaque credential
        // references cannot safely be enumerated or deleted from the vault.
        const damagedPath = `${this.configPath}.invalid-${Date.now()}-${randomUUID()}`;
        await rename(this.configPath, damagedPath);
        this.config = defaultStoredConfig();
        await this.persist(this.config);
        return;
      }
      throw new Error('WebDAV 同步配置可正常读取，无需重置。');
    });
    return this.getConfig();
  }

  async saveConnection(input: {
    endpoint: string;
    remoteRoot: string;
    username: string;
    allowInsecureHttp: boolean;
    repositoryId: string;
    recoveryKey: string;
    password?: string;
    deviceName?: string;
  }): Promise<StoredWebDavSyncConfig> {
    await this.enqueue(async () => {
      let config = await this.load();
      const location = normalizeWebDavLocation(input);
      const username = normalizeWebDavUsername(input.username);
      const recoveryKey = normalizeWebDavRecoveryKey(input.recoveryKey);
      const repositoryId = normalizeRepositoryId(input.repositoryId);
      const previous = config.connection;
      const password = input.password === undefined
        ? undefined
        : normalizeWebDavPassword(input.password);
      if (!password && !previous?.passwordCredentialKey) {
        throw new Error('首次连接 WebDAV 时必须填写密码。');
      }

      const staged: Array<{ key: string; value: string }> = [];
      const passwordCredentialKey = password
        ? credentialKey('password')
        : previous!.passwordCredentialKey;
      const recoveryKeyCredentialKey = previous
        && await this.sameStoredCredential(previous.recoveryKeyCredentialKey, recoveryKey)
        ? previous.recoveryKeyCredentialKey
        : credentialKey('recovery-key');
      if (password) staged.push({ key: passwordCredentialKey, value: password });
      if (recoveryKeyCredentialKey !== previous?.recoveryKeyCredentialKey) {
        staged.push({ key: recoveryKeyCredentialKey, value: recoveryKey });
      }

      if (staged.length) {
        config = {
          ...config,
          pendingCredentialCleanupKeys: addCleanupKeys(
            config.pendingCredentialCleanupKeys,
            staged.map(({ key }) => key),
          ),
        };
        await this.persist(config);
        for (const item of staged) await this.credentialVault.set(item.key, item.value);
      }

      const connection: StoredWebDavSyncConnection = {
        endpoint: location.endpoint,
        remoteRoot: location.remoteRoot,
        username,
        allowInsecureHttp: input.allowInsecureHttp,
        repositoryId,
        passwordCredentialKey,
        recoveryKeyCredentialKey,
      };
      const replacedCredentials = [
        previous?.passwordCredentialKey !== passwordCredentialKey
          ? previous?.passwordCredentialKey
          : undefined,
        previous?.recoveryKeyCredentialKey !== recoveryKeyCredentialKey
          ? previous?.recoveryKeyCredentialKey
          : undefined,
      ].filter((value): value is string => Boolean(value));
      await this.persist({
        ...config,
        connection,
        deviceName: normalizeWebDavDeviceName(input.deviceName ?? config.deviceName),
        pendingCredentialCleanupKeys: addCleanupKeys(
          config.pendingCredentialCleanupKeys.filter((key) => !staged.some((item) => item.key === key)),
          replacedCredentials,
        ),
      });
      await this.retryPendingCredentialCleanup(await this.load());
    });
    return this.getConfig();
  }

  async updatePreferences(input: DesktopWebDavSyncPreferencesInput): Promise<StoredWebDavSyncConfig> {
    await this.enqueue(async () => {
      const config = await this.load();
      await this.persist({
        ...config,
        automaticBackup: input.automaticBackup ?? config.automaticBackup,
        categories: input.categories === undefined
          ? config.categories
          : normalizeCategories(input.categories),
      });
    });
    return this.getConfig();
  }

  async markBackup(snapshotId: string, createdAt: string): Promise<StoredWebDavSyncConfig> {
    await this.enqueue(async () => {
      const config = await this.load();
      await this.persist({
        ...config,
        lastBackupAt: requireIsoDate(createdAt),
        lastSnapshotId: requireSnapshotId(snapshotId),
      });
    });
    return this.getConfig();
  }

  async disconnect(): Promise<StoredWebDavSyncConfig> {
    await this.enqueue(async () => {
      const config = await this.load();
      const connection = config.connection;
      await this.persist({
        ...config,
        connection: undefined,
        lastBackupAt: undefined,
        lastSnapshotId: undefined,
        pendingCredentialCleanupKeys: addCleanupKeys(
          config.pendingCredentialCleanupKeys,
          connection
            ? [connection.passwordCredentialKey, connection.recoveryKeyCredentialKey]
            : [],
        ),
      });
      await this.retryPendingCredentialCleanup(await this.load());
    });
    return this.getConfig();
  }

  private async sameStoredCredential(key: string, expected: string): Promise<boolean> {
    return this.credentialVault.get(key).then((value) => value === expected).catch(() => false);
  }

  private async load(): Promise<StoredWebDavSyncConfig> {
    if (this.config) return this.config;
    try {
      this.config = normalizeStoredConfig(JSON.parse(await readFile(this.configPath, 'utf8')));
    } catch (error) {
      if (isMissingFileError(error)) this.config = defaultStoredConfig();
      else throw new Error('无法读取 WebDAV 同步配置。', { cause: error });
    }
    return this.config;
  }

  private async persist(config: StoredWebDavSyncConfig): Promise<void> {
    await (this.options.writeConfig ?? writeJsonAtomically)(this.configPath, config);
    this.config = config;
  }

  private async retryPendingCredentialCleanup(config: StoredWebDavSyncConfig): Promise<void> {
    if (!config.pendingCredentialCleanupKeys.length) return;
    const deleted = new Set<string>();
    for (const key of config.pendingCredentialCleanupKeys) {
      try {
        await this.credentialVault.delete(key);
        deleted.add(key);
      } catch {
        // The durable cleanup journal retries unavailable secure-storage operations later.
      }
    }
    if (!deleted.size) return;
    await this.persist({
      ...config,
      pendingCredentialCleanupKeys: config.pendingCredentialCleanupKeys
        .filter((key) => !deleted.has(key)),
    }).catch(() => undefined);
  }

  private async enqueue(update: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(update, update);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }

  private clone(config: StoredWebDavSyncConfig): StoredWebDavSyncConfig {
    return {
      ...config,
      categories: [...config.categories],
      pendingCredentialCleanupKeys: [...config.pendingCredentialCleanupKeys],
      ...(config.connection ? { connection: { ...config.connection } } : {}),
    };
  }
}

function defaultStoredConfig(): StoredWebDavSyncConfig {
  return {
    version: WEB_DAV_SYNC_STORE_VERSION,
    deviceId: randomUUID(),
    deviceName: normalizeWebDavDeviceName(),
    automaticBackup: false,
    categories: [...DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES],
    pendingCredentialCleanupKeys: [],
  };
}

function normalizeStoredConfig(value: unknown): StoredWebDavSyncConfig {
  if (!isRecord(value) || (value.version !== 1 && value.version !== WEB_DAV_SYNC_STORE_VERSION)) {
    throw new Error('WebDAV 同步配置版本不受支持。');
  }
  const migratedFromImplicitAutomaticBackup = value.version === 1;
  const deviceId = normalizeRepositoryId(value.deviceId);
  const deviceName = normalizeWebDavDeviceName(typeof value.deviceName === 'string' ? value.deviceName : undefined);
  const categories = normalizeCategories(value.categories);
  const pendingCredentialCleanupKeys = normalizeCleanupKeys(value.pendingCredentialCleanupKeys);
  const connection = value.connection === undefined
    ? undefined
    : normalizeStoredConnection(value.connection);
  const referencedKeys = new Set(connection
    ? [connection.passwordCredentialKey, connection.recoveryKeyCredentialKey]
    : []);
  if (pendingCredentialCleanupKeys.some((key) => referencedKeys.has(key))) {
    throw new Error('WebDAV 同步配置将正在使用的凭据标记为待清理。');
  }
  return {
    version: WEB_DAV_SYNC_STORE_VERSION,
    deviceId,
    deviceName,
    // Version 1 enabled automatic backup by default and had no consent step.
    // Migrated installations must explicitly confirm before background uploads resume.
    automaticBackup: !migratedFromImplicitAutomaticBackup && value.automaticBackup === true,
    categories,
    ...(connection ? { connection } : {}),
    ...(typeof value.lastBackupAt === 'string' ? { lastBackupAt: requireIsoDate(value.lastBackupAt) } : {}),
    ...(typeof value.lastSnapshotId === 'string'
      ? { lastSnapshotId: requireSnapshotId(value.lastSnapshotId) }
      : {}),
    pendingCredentialCleanupKeys,
  };
}

function normalizeStoredConnection(value: unknown): StoredWebDavSyncConnection {
  if (!isRecord(value)) throw new Error('WebDAV 连接配置无效。');
  const location = normalizeWebDavLocation({
    endpoint: stringValue(value.endpoint),
    remoteRoot: stringValue(value.remoteRoot),
    allowInsecureHttp: value.allowInsecureHttp === true,
  });
  const passwordCredentialKey = requireCredentialKey(value.passwordCredentialKey);
  const recoveryKeyCredentialKey = requireCredentialKey(value.recoveryKeyCredentialKey);
  return {
    endpoint: location.endpoint,
    remoteRoot: location.remoteRoot,
    username: normalizeWebDavUsername(stringValue(value.username)),
    allowInsecureHttp: value.allowInsecureHttp === true,
    repositoryId: normalizeRepositoryId(value.repositoryId),
    passwordCredentialKey,
    recoveryKeyCredentialKey,
  };
}

export function normalizeCategories(value: unknown): DesktopWebDavSyncCategoryId[] {
  if (!Array.isArray(value)) throw new Error('请选择至少一种需要同步的数据。');
  if (!value.length) throw new Error('请选择至少一种需要同步的数据。');
  const allowed = new Set<string>(DESKTOP_WEBDAV_SYNC_CATEGORY_IDS);
  const categories = [...new Set(value.map((item) => String(item)))]
    .filter((item): item is DesktopWebDavSyncCategoryId => allowed.has(item));
  if (categories.length !== value.length) {
    throw new Error('同步数据类型无效。');
  }
  return DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.filter((category) => categories.includes(category));
}

function normalizeRepositoryId(value: unknown): string {
  const id = stringValue(value).toLowerCase();
  if (!REPOSITORY_ID_PATTERN.test(id)) throw new Error('WebDAV 仓库标识无效。');
  return id;
}

function requireSnapshotId(value: string): string {
  const id = value.trim();
  if (!/^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/u.test(id)) throw new Error('WebDAV 快照标识无效。');
  return id;
}

function requireIsoDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('WebDAV 同步时间无效。');
  return new Date(parsed).toISOString();
}

function credentialKey(kind: 'password' | 'recovery-key'): string {
  return `webdav-sync.${kind}.${randomUUID()}`;
}

function requireCredentialKey(value: unknown): string {
  const key = stringValue(value);
  if (!CREDENTIAL_KEY_PATTERN.test(key)) throw new Error('WebDAV 安全凭据引用无效。');
  return key;
}

function normalizeCleanupKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('WebDAV 待清理凭据列表无效。');
  const keys = value.map(requireCredentialKey);
  if (new Set(keys).size !== keys.length) throw new Error('WebDAV 待清理凭据列表包含重复项。');
  return keys;
}

function addCleanupKeys(current: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...current, ...additions])];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
