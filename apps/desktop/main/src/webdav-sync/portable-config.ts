import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_CONFIG_BYTES = 32 * 1024 * 1024;

const PORTABLE_ROOT_KEYS = [
  'activeProviderId',
  'globalPrompt',
  'memory',
  'memoryEnabled',
  'taskModels',
  'setsunaStyle',
  'visionRecognition',
] as const;

const PORTABLE_PROVIDER_KEYS = [
  'id',
  'name',
  'provider',
  'baseUrl',
  'enabled',
  'icon',
] as const;

const PORTABLE_MODEL_KEYS = [
  'id',
  'name',
  'code',
  'enabled',
  'icon',
  'contextWindowTokens',
  'maxOutputTokens',
  'thinkingEnabled',
  'thinkingEfforts',
  'defaultThinkingEffort',
  'supportsImages',
] as const;

/**
 * Exports only settings that have portable meaning. In particular, permission
 * profiles, Hook trust, developer flags, proxy routes, package sources and
 * workspace dependency settings remain owned by the current device.
 */
export async function createPortableConfigSnapshot(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const portable = portableConfig(await readJsonRecord(sourcePath, '应用配置文件'));
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify(portable, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

/**
 * Materializes a complete runtime config in staging. Portable fields from the
 * backup win, while device-local security and network fields stay local.
 * Providers that exist only on this device are preserved.
 */
export async function mergePortableConfigForRestore(input: {
  localPath: string;
  portablePath: string;
}): Promise<void> {
  const backup = portableConfig(await readJsonRecord(input.portablePath, '备份中的应用配置'));
  const local = await readOptionalJsonRecord(input.localPath, '本地应用配置') ?? {};
  const merged: Record<string, unknown> = { ...local };

  for (const key of PORTABLE_ROOT_KEYS) {
    if (Object.hasOwn(backup, key)) merged[key] = structuredClone(backup[key]);
  }
  delete merged.storagePath;

  const localSchemaVersion = finiteNumber(local.schemaVersion);
  const backupSchemaVersion = finiteNumber(backup.schemaVersion);
  if (localSchemaVersion !== undefined || backupSchemaVersion !== undefined) {
    merged.schemaVersion = Math.max(localSchemaVersion ?? 0, backupSchemaVersion ?? 0);
  }

  merged.providers = mergeProviders(arrayRecords(local.providers), arrayRecords(backup.providers));
  mergeRecordField(merged, local, backup, 'desktopSettings');
  mergeRecordField(merged, local, backup, 'imageGeneration');

  await writeFile(input.portablePath, `${JSON.stringify(merged, null, 2)}\n`, {
    mode: 0o600,
  });
}

function portableConfig(value: Record<string, unknown>): Record<string, unknown> {
  const portable: Record<string, unknown> = {};
  const schemaVersion = finiteNumber(value.schemaVersion);
  if (schemaVersion !== undefined) portable.schemaVersion = schemaVersion;
  for (const key of PORTABLE_ROOT_KEYS) {
    if (Object.hasOwn(value, key)) portable[key] = structuredClone(value[key]);
  }

  if (Array.isArray(value.providers)) {
    portable.providers = value.providers.flatMap((provider) => {
      if (!isRecord(provider)) return [];
      const exported = pick(provider, PORTABLE_PROVIDER_KEYS);
      if (Array.isArray(provider.models)) {
        exported.models = provider.models.flatMap((model) => (
          isRecord(model) ? [pick(model, PORTABLE_MODEL_KEYS)] : []
        ));
      }
      return [exported];
    });
  }

  const desktopSettings = recordValue(value.desktopSettings);
  if (desktopSettings) {
    const exported = pick(desktopSettings, ['interfaceLanguage', 'markdownLinkOpenMode'] as const);
    if (Object.keys(exported).length) portable.desktopSettings = exported;
  }
  const imageGeneration = recordValue(value.imageGeneration);
  if (imageGeneration) {
    portable.imageGeneration = pick(imageGeneration, ['baseUrl', 'model'] as const);
  }
  return portable;
}

function mergeProviders(
  localProviders: Record<string, unknown>[],
  backupProviders: Record<string, unknown>[],
): Record<string, unknown>[] {
  const localById = new Map(localProviders.flatMap((provider) => {
    const id = stringValue(provider.id);
    return id ? [[id, provider] as const] : [];
  }));
  const restoredIds = new Set<string>();
  const restored = backupProviders.flatMap((backupProvider) => {
    const id = stringValue(backupProvider.id);
    if (!id || restoredIds.has(id)) return [];
    restoredIds.add(id);
    const localProvider = localById.get(id);
    return [{
      ...(localProvider ?? {}),
      ...backupProvider,
      ...(localProvider && Object.hasOwn(localProvider, 'proxyRoute')
        ? { proxyRoute: structuredClone(localProvider.proxyRoute) }
        : {}),
    }];
  });
  return [
    ...restored,
    ...localProviders.filter((provider) => {
      const id = stringValue(provider.id);
      return !id || !restoredIds.has(id);
    }),
  ];
}

function mergeRecordField(
  output: Record<string, unknown>,
  local: Record<string, unknown>,
  backup: Record<string, unknown>,
  key: 'desktopSettings' | 'imageGeneration',
): void {
  const localRecord = recordValue(local[key]);
  const backupRecord = recordValue(backup[key]);
  if (!localRecord && !backupRecord) return;
  output[key] = { ...(localRecord ?? {}), ...(backupRecord ?? {}) };
}

function pick<const K extends readonly string[]>(
  source: Record<string, unknown>,
  keys: K,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) result[key] = structuredClone(source[key]);
  }
  return result;
}

async function readJsonRecord(filePath: string, label: string): Promise<Record<string, unknown>> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_CONFIG_BYTES) {
    throw new Error(`${label}不是受支持的普通 JSON 文件。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label}格式无效。`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error(`${label}格式无效。`);
  return parsed;
}

async function readOptionalJsonRecord(
  filePath: string,
  label: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonRecord(filePath, label);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    if (error instanceof Error && isRecord(error.cause) && error.cause.code === 'ENOENT') return null;
    throw error;
  }
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
