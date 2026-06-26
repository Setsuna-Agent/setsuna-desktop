import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProviderConfigInput,
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 68000;

type StoredConfig = Omit<RuntimeConfigState, 'configPath' | 'dataPath' | 'providers'> & {
  providers: Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'>[];
};

type StoredSecrets = {
  providerApiKeys: Record<string, string>;
};

export class FileConfigStore implements ConfigStore {
  private readonly configPath: string;
  private readonly secretsPath: string;

  constructor(private readonly dataDir: string) {
    this.configPath = path.join(dataDir, 'config.json');
    this.secretsPath = path.join(dataDir, 'secrets.json');
  }

  async getConfig(): Promise<RuntimeConfigState> {
    const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
    const secrets = await this.readSecrets();
    return this.toState(stored, secrets);
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
    const secrets = await this.readSecrets();
    const provider =
      stored.providers.find((item) => item.id === stored.activeProviderId) ??
      stored.providers.find((item) => item.enabled) ??
      stored.providers[0];
    if (!provider) return null;
    return {
      ...provider,
      apiKey: secrets.providerApiKeys[provider.id] ?? '',
      activeModel: provider.models.find((model) => model.enabled) ?? provider.models[0],
    };
  }

  async saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState> {
    await mkdir(this.dataDir, { recursive: true });
    const previous = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
    const secrets = await this.readSecrets();
    const providers = normalizeProviders(input.providers ?? previous.providers, previous.providers, secrets);

    const stored: StoredConfig = {
      activeProviderId: input.activeProviderId ?? previous.activeProviderId ?? providers[0]?.id,
      memoryEnabled: input.memoryEnabled ?? previous.memoryEnabled ?? true,
      approvalPolicy: input.approvalPolicy ?? previous.approvalPolicy ?? 'on-request',
      permissionProfile: normalizePermissionProfile(input.permissionProfile ?? previous.permissionProfile),
      providers: providers.map(({ apiKey: _apiKey, ...provider }) => provider),
    };

    await writeJsonFile(this.configPath, stored);
    await this.writeSecrets(secrets);
    return this.toState(stored, secrets);
  }

  private async readSecrets(): Promise<StoredSecrets> {
    try {
      const text = await readFile(this.secretsPath, 'utf8');
      return normalizeSecrets(JSON.parse(text));
    } catch {
      return { providerApiKeys: {} };
    }
  }

  private async writeSecrets(secrets: StoredSecrets): Promise<void> {
    await writeFile(this.secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.secretsPath, 0o600).catch(() => undefined);
  }

  private toState(stored: StoredConfig, secrets: StoredSecrets): RuntimeConfigState {
    return {
      configPath: this.configPath,
      dataPath: this.dataDir,
      activeProviderId: stored.activeProviderId,
      memoryEnabled: stored.memoryEnabled,
      approvalPolicy: stored.approvalPolicy,
      permissionProfile: normalizePermissionProfile(stored.permissionProfile),
      providers: stored.providers.map((provider) => {
        const apiKey = secrets.providerApiKeys[provider.id] ?? '';
        return {
          ...provider,
          apiKeySet: apiKey.length > 0,
          apiKeyPreview: maskApiKey(apiKey),
        };
      }),
    };
  }
}

function defaultConfig(): StoredConfig {
  return {
    activeProviderId: 'local-test',
    memoryEnabled: true,
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    providers: [
      {
        id: 'local-test',
        name: 'Local test provider',
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        enabled: true,
        models: [
          {
            id: 'local-runtime-smoke',
            name: 'Local runtime smoke',
            code: 'local-runtime-smoke',
            enabled: true,
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            thinkingEnabled: false,
            thinkingEfforts: [],
            supportsImages: false,
          },
        ],
      },
    ],
  };
}

function normalizeProviders(
  inputProviders: ProviderConfigInput[] | StoredConfig['providers'],
  previousProviders: StoredConfig['providers'],
  secrets: StoredSecrets,
): Array<StoredConfig['providers'][number] & { apiKey?: string }> {
  const previousById = new Map(previousProviders.map((provider) => [provider.id, provider]));
  return inputProviders.map((provider, index) => {
    const id = nonEmpty(provider.id) ?? `provider-${index + 1}`;
    const previous = previousById.get(id);
    if ('apiKey' in provider && typeof provider.apiKey === 'string' && provider.apiKey.trim()) {
      secrets.providerApiKeys[id] = provider.apiKey.trim();
    }
    if ('clearApiKey' in provider && provider.clearApiKey) {
      delete secrets.providerApiKeys[id];
    }
    return {
      id,
      name: nonEmpty(provider.name) ?? previous?.name ?? 'Local provider',
      provider: provider.provider ?? previous?.provider ?? 'openai-compatible',
      baseUrl: normalizeBaseUrl(provider.baseUrl ?? previous?.baseUrl ?? ''),
      enabled: provider.enabled ?? previous?.enabled ?? true,
      models: normalizeModels(provider.models ?? previous?.models ?? []),
    };
  });
}

function normalizeModels(models: ProviderConfigState['models']): ProviderConfigState['models'] {
  const normalized = models.map((model, index) => {
    const code = nonEmpty(model.code) ?? nonEmpty(model.id) ?? `model-${index + 1}`;
    return {
      id: nonEmpty(model.id) ?? code,
      name: nonEmpty(model.name) ?? code,
      code,
      enabled: model.enabled ?? true,
      maxOutputTokens: positiveInt(model.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
      thinkingEnabled: model.thinkingEnabled ?? false,
      thinkingEfforts: Array.isArray(model.thinkingEfforts) ? model.thinkingEfforts : [],
      defaultThinkingEffort: nonEmpty(model.defaultThinkingEffort),
      supportsImages: model.supportsImages ?? false,
    };
  });
  return normalized.length ? normalized : defaultConfig().providers[0].models;
}

function normalizeSecrets(value: unknown): StoredSecrets {
  if (!value || typeof value !== 'object') return { providerApiKeys: {} };
  const providerApiKeys = (value as { providerApiKeys?: unknown }).providerApiKeys;
  if (!providerApiKeys || typeof providerApiKeys !== 'object') return { providerApiKeys: {} };
  return {
    providerApiKeys: Object.fromEntries(
      Object.entries(providerApiKeys).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizePermissionProfile(value: unknown): RuntimeConfigState['permissionProfile'] {
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  return 'workspace-write';
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••';
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}
