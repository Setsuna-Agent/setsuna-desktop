import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
  type DesktopWebDavSyncCategorySummary,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { desktopDataLayout } from '../data-root/layout.js';
import { sha256Buffer } from './crypto.js';
import { createPortableConfigSnapshot } from './portable-config.js';
import { createPortableSkillStateSnapshot } from './portable-skill-state.js';
import { portableProjectCatalogSource } from './portable-projects.js';
import type {
  LocalSnapshotInventoryItem,
  LocalSnapshotSource,
  WebDavSnapshotItemKind,
} from './model.js';
import {
  isPortablePathComponent,
  portablePathComparisonKey,
} from './portable-path.js';

const MAX_SECRETS_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_CREDENTIALS = 256;
const MAX_MODEL_CREDENTIAL_BYTES = 64 * 1024;

type SnapshotSourceInput = {
  dataRoot: string;
  categories: readonly DesktopWebDavSyncCategoryId[];
  stagingRoot: string;
  signal?: AbortSignal;
};

type StoredModelSecrets = {
  providerApiKeys: Record<string, string>;
  imageGenerationApiKey?: string;
};

export async function prepareLocalSnapshotSources(
  input: SnapshotSourceInput,
): Promise<LocalSnapshotSource[]> {
  const sources = await collectLocalSnapshotSources(input, true);
  try {
    const materialized = await materializeFileSources(sources, input.stagingRoot, input.signal);
    if (input.categories.includes('conversations')) {
      await removeDeviceLocalAttachmentLinks(materialized);
    }
    return materialized;
  } catch (error) {
    for (const source of sources) source.data?.fill(0);
    throw error;
  }
}

async function removeDeviceLocalAttachmentLinks(sources: readonly LocalSnapshotSource[]): Promise<void> {
  const indexSource = sources.find((source) => source.logicalPath === 'runtime/attachments/index.json');
  if (!indexSource?.sourcePath) return;
  const index = JSON.parse(await readFile(indexSource.sourcePath, 'utf8')) as unknown;
  if (!isRecord(index) || !Array.isArray(index.attachments)) {
    throw new Error('本地附件索引格式无效，无法生成可移植快照。');
  }
  const attachments = index.attachments.filter((record) => (
    !isRecord(record) || record.storage !== 'linked'
  ));
  if (attachments.length === index.attachments.length) return;
  await writeFile(
    indexSource.sourcePath,
    `${JSON.stringify({ ...index, attachments }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

export async function summarizeLocalSnapshotCategories(
  input: SnapshotSourceInput,
): Promise<DesktopWebDavSyncCategorySummary[]> {
  const sources = await collectLocalSnapshotSources(input, false);
  const summaries = new Map<DesktopWebDavSyncCategoryId, DesktopWebDavSyncCategorySummary>();
  for (const category of DESKTOP_WEBDAV_SYNC_CATEGORY_IDS) {
    if (input.categories.includes(category)) {
      summaries.set(category, { id: category, itemCount: 0, totalBytes: 0 });
    }
  }
  try {
    for (const source of sources) {
      await throwIfAborted(input.signal);
      const summary = summaries.get(source.category);
      if (!summary) continue;
      summary.totalBytes += await localSourceSize(source, input.dataRoot);
      if (source.kind !== 'project-catalog') summary.itemCount += 1;
    }
    return DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.flatMap((category) => {
      const summary = summaries.get(category);
      return summary ? [{ ...summary }] : [];
    });
  } finally {
    for (const source of sources) source.data?.fill(0);
  }
}

async function collectLocalSnapshotSources(
  input: SnapshotSourceInput,
  snapshotDatabase: boolean,
): Promise<LocalSnapshotSource[]> {
  const layout = desktopDataLayout(input.dataRoot);
  const categories = new Set(input.categories);
  const sources: LocalSnapshotSource[] = [];
  if (categories.has('conversations')) {
    if (await isRegularFile(layout.runtimeDatabasePath)) {
      await throwIfAborted(input.signal);
      const databaseSourcePath = snapshotDatabase
        ? path.join(input.stagingRoot, 'runtime', 'threads.sqlite')
        : layout.runtimeDatabasePath;
      if (snapshotDatabase) {
        await createSqliteSnapshot(layout.runtimeDatabasePath, databaseSourcePath, {
          signal: input.signal,
        });
      }
      sources.push(fileSource('conversations', databaseSourcePath, 'runtime/threads.sqlite', '会话数据库'));
    }
    await appendDirectorySources(sources, {
      category: 'conversations',
      root: path.join(layout.runtimeRoot, 'attachments'),
      logicalRoot: 'runtime/attachments',
      labelPrefix: '附件',
      signal: input.signal,
    });
    await appendDirectorySources(sources, {
      category: 'conversations',
      root: layout.generatedImagesRoot,
      logicalRoot: 'runtime/generated-images',
      labelPrefix: '生成图片',
      signal: input.signal,
    });
    await appendDirectorySources(sources, {
      category: 'conversations',
      root: layout.toolResultsRoot,
      logicalRoot: 'runtime/tool-results',
      labelPrefix: '工具结果',
      signal: input.signal,
    });
  }
  if (categories.has('memories')) {
    await appendDirectorySources(sources, {
      category: 'memories',
      root: layout.memoriesRoot,
      logicalRoot: 'runtime/memories',
      labelPrefix: '记忆',
      signal: input.signal,
    });
  }
  if (categories.has('conversations') || categories.has('memories')) {
    sources.push(await portableProjectCatalogSource(
      input.dataRoot,
      categories.has('conversations') ? 'conversations' : 'memories',
    ));
  }
  if (categories.has('preferences') && await isRegularFile(layout.runtimeConfigPath)) {
    const portableConfigPath = path.join(input.stagingRoot, 'runtime', 'config.json');
    await createPortableConfigSnapshot(layout.runtimeConfigPath, portableConfigPath);
    sources.push(fileSource(
      'preferences',
      portableConfigPath,
      'runtime/config.json',
      '应用与模型配置',
    ));
  }
  if (categories.has('model_credentials')) {
    sources.push(...await modelCredentialSources(layout.runtimeRoot));
  }
  if (categories.has('user_skills')) {
    const skillStatePath = path.join(layout.runtimeRoot, 'skills.json');
    const portableSkillStatePath = path.join(input.stagingRoot, 'runtime', 'skills.json');
    await createPortableSkillStateSnapshot({
      sourcePath: skillStatePath,
      userSkillsRoot: path.join(layout.runtimeRoot, 'user-skills'),
      destinationPath: portableSkillStatePath,
    });
    sources.push(fileSource(
      'user_skills',
      portableSkillStatePath,
      'runtime/skills.json',
      '用户 Skill 启用状态',
    ));
    await appendDirectorySources(sources, {
      category: 'user_skills',
      root: path.join(layout.runtimeRoot, 'user-skills'),
      logicalRoot: 'runtime/user-skills',
      labelPrefix: '用户 Skill',
      signal: input.signal,
    });
  }
  if (categories.has('usage')) {
    const usagePath = path.join(layout.runtimeRoot, 'usage.jsonl');
    if (await isRegularFile(usagePath)) {
      sources.push(fileSource('usage', usagePath, 'runtime/usage.jsonl', '模型用量记录'));
    }
  }
  return sources.sort((left, right) => (
    left.category.localeCompare(right.category)
    || left.logicalPath.localeCompare(right.logicalPath)
  ));
}

async function localSourceSize(source: LocalSnapshotSource, dataRoot: string): Promise<number> {
  if (source.data) return source.data.byteLength;
  if (!source.sourcePath) return 0;
  const layout = desktopDataLayout(dataRoot);
  if (source.sourcePath === layout.runtimeDatabasePath) {
    return sqliteLogicalSize(source.sourcePath);
  }
  return (await lstat(source.sourcePath)).size;
}

function sqliteLogicalSize(databasePath: string): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const pageCount = pragmaNumber(database, 'page_count');
    const pageSize = pragmaNumber(database, 'page_size');
    return pageCount * pageSize;
  } finally {
    database.close();
  }
}

function pragmaNumber(database: DatabaseSync, name: 'page_count' | 'page_size'): number {
  const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  const value = row?.[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`无法读取会话数据库 ${name}。`);
  }
  return value;
}

export async function inventorySnapshotSources(
  sources: readonly LocalSnapshotSource[],
  signal?: AbortSignal,
): Promise<LocalSnapshotInventoryItem[]> {
  const inventory: LocalSnapshotInventoryItem[] = [];
  try {
    for (const source of sources) {
      await throwIfAborted(signal);
      let measured: { sha256: string; size: number };
      if (source.data) {
        measured = { sha256: sha256Buffer(source.data), size: source.data.byteLength };
      } else {
        measured = await hashFile(source.sourcePath!);
      }
      inventory.push({
        category: source.category,
        kind: source.kind,
        logicalPath: source.logicalPath,
        label: source.label,
        ...(source.detail ? { detail: source.detail } : {}),
        ...(source.credentialId ? { credentialId: source.credentialId } : {}),
        ...(source.executable ? { executable: true } : {}),
        ...measured,
      });
    }
    return inventory;
  } finally {
    for (const source of sources) source.data?.fill(0);
  }
}

export function restoredFilePath(stagingRoot: string, logicalPath: string): string {
  if (
    logicalPath.includes('\\')
    || !logicalPath.startsWith('runtime/')
    || logicalPath.includes('../')
    || logicalPath.includes('/..')
  ) {
    throw new Error('备份清单包含不安全的本地路径。');
  }
  const resolvedRoot = path.resolve(stagingRoot);
  const resolved = path.resolve(resolvedRoot, ...logicalPath.split('/'));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('备份清单路径越过了还原暂存目录。');
  }
  return resolved;
}

export function restoredSecretsBuffer(items: Array<{
  kind: WebDavSnapshotItemKind;
  credentialId?: string;
  data: Buffer;
}>): Buffer {
  const providerEntries: Array<[string, string]> = [];
  const providerIds = new Set<string>();
  let imageGenerationApiKey: string | undefined;
  for (const item of items) {
    const value = item.data.toString('utf8');
    validateModelCredential(value);
    if (item.kind === 'provider-key' && item.credentialId) {
      if (providerIds.has(item.credentialId)) throw new Error('备份包含重复的模型 API Key。');
      providerIds.add(item.credentialId);
      providerEntries.push([item.credentialId, value]);
    } else if (item.kind === 'image-generation-key') {
      if (imageGenerationApiKey !== undefined) throw new Error('备份包含重复的图片生成 API Key。');
      imageGenerationApiKey = value;
    }
  }
  const secrets: StoredModelSecrets = {
    providerApiKeys: Object.fromEntries(providerEntries),
    ...(imageGenerationApiKey ? { imageGenerationApiKey } : {}),
  };
  return Buffer.from(`${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
}

export async function mergeRestoredSecretsBuffer(
  localSecretsPath: string,
  restoredBuffer?: Buffer,
): Promise<Buffer> {
  const restored: StoredModelSecrets = restoredBuffer
    ? normalizeModelSecrets(JSON.parse(restoredBuffer.toString('utf8')))
    : { providerApiKeys: {} };
  const local = await readOptionalModelSecrets(localSecretsPath);
  const merged: StoredModelSecrets = {
    providerApiKeys: { ...local.providerApiKeys, ...restored.providerApiKeys },
    ...(restored.imageGenerationApiKey || local.imageGenerationApiKey
      ? { imageGenerationApiKey: restored.imageGenerationApiKey ?? local.imageGenerationApiKey }
      : {}),
  };
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

export function categoryTargetPaths(
  dataRoot: string,
  categories: readonly DesktopWebDavSyncCategoryId[],
): string[] {
  const layout = desktopDataLayout(dataRoot);
  const selected = new Set(categories);
  const targets: string[] = [];
  if (selected.has('conversations')) {
    targets.push(
      layout.runtimeDatabasePath,
      `${layout.runtimeDatabasePath}-wal`,
      `${layout.runtimeDatabasePath}-shm`,
      path.join(layout.runtimeRoot, 'attachments'),
      layout.generatedImagesRoot,
      layout.toolResultsRoot,
    );
  }
  if (selected.has('conversations') || selected.has('memories')) {
    targets.push(path.join(layout.runtimeRoot, 'projects.json'));
  }
  if (selected.has('memories')) targets.push(layout.memoriesRoot);
  if (selected.has('preferences')) targets.push(layout.runtimeConfigPath);
  if (selected.has('model_credentials')) targets.push(path.join(layout.runtimeRoot, 'secrets.json'));
  if (selected.has('user_skills')) {
    targets.push(
      path.join(layout.runtimeRoot, 'skills.json'),
      path.join(layout.runtimeRoot, 'user-skills'),
    );
  }
  if (selected.has('usage')) targets.push(path.join(layout.runtimeRoot, 'usage.jsonl'));
  return targets;
}

export async function createSqliteSnapshot(
  sourcePath: string,
  destinationPath: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { totalPages: number; remainingPages: number }) => void;
  } = {},
): Promise<void> {
  assertNotAborted(options.signal);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rm(destinationPath, { force: true });
  try {
    assertNotAborted(options.signal);
    const database = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      await backup(database, destinationPath, {
        rate: 64,
        progress: (progress) => {
          assertNotAborted(options.signal);
          options.onProgress?.(progress);
          assertNotAborted(options.signal);
        },
      });
    } finally {
      database.close();
    }
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function appendDirectorySources(
  output: LocalSnapshotSource[],
  input: {
    category: DesktopWebDavSyncCategoryId;
    root: string;
    logicalRoot: string;
    labelPrefix: string;
    signal?: AbortSignal;
  },
): Promise<void> {
  const rootStats = await lstat(input.root).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw error;
  });
  if (!rootStats) return;
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`同步数据目录不是普通目录：${input.logicalRoot}`);
  }
  await walk(input.root, '');

  async function walk(currentRoot: string, relativeRoot: string): Promise<void> {
    await throwIfAborted(input.signal);
    const entries = await readdir(currentRoot, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const portableNames = new Set<string>();
    for (const entry of entries) {
      await throwIfAborted(input.signal);
      const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      if (!isPortablePathComponent(entry.name)) {
        throw new Error(`同步数据包含无法跨平台还原的文件名：${input.logicalRoot}/${relativePath}`);
      }
      const portableName = portablePathComparisonKey(entry.name);
      if (portableNames.has(portableName)) {
        throw new Error(`同步数据包含跨平台名称冲突：${input.logicalRoot}/${relativeRoot || '.'}`);
      }
      portableNames.add(portableName);
      const sourcePath = path.join(currentRoot, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`同步数据中包含不受支持的符号链接：${input.logicalRoot}/${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(sourcePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`同步数据中包含不受支持的文件类型：${input.logicalRoot}/${relativePath}`);
      }
      const executable = input.category === 'user_skills'
        && Boolean((await lstat(sourcePath)).mode & 0o111);
      output.push(fileSource(
        input.category,
        sourcePath,
        `${input.logicalRoot}/${relativePath}`,
        `${input.labelPrefix}：${entry.name}`,
        executable,
      ));
    }
  }
}

async function materializeFileSources(
  sources: readonly LocalSnapshotSource[],
  stagingRoot: string,
  signal?: AbortSignal,
): Promise<LocalSnapshotSource[]> {
  const resolvedRoot = path.resolve(stagingRoot);
  const materialized: LocalSnapshotSource[] = [];
  for (const source of sources) {
    await throwIfAborted(signal);
    if (!source.sourcePath) {
      materialized.push(source);
      continue;
    }
    const destinationPath = path.resolve(resolvedRoot, ...source.logicalPath.split('/'));
    if (!destinationPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('同步数据路径越过了本地快照目录。');
    }
    if (path.resolve(source.sourcePath) !== destinationPath) {
      await copySnapshotFile(source.sourcePath, destinationPath, signal);
    }
    materialized.push({ ...source, sourcePath: destinationPath });
  }
  return materialized;
}

async function copySnapshotFile(
  sourcePath: string,
  destinationPath: string,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [openedStats, currentStats] = await Promise.all([
      sourceHandle.stat(),
      lstat(sourcePath),
    ]);
    if (
      !openedStats.isFile()
      || currentStats.isSymbolicLink()
      || !currentStats.isFile()
      || openedStats.dev !== currentStats.dev
      || openedStats.ino !== currentStats.ino
    ) {
      throw new Error('同步源文件在复制前发生变化或不是普通文件。');
    }
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
      signal ? { signal } : {},
    );
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await sourceHandle?.close().catch(() => undefined);
  }
}

async function modelCredentialSources(runtimeRoot: string): Promise<LocalSnapshotSource[]> {
  const secretsPath = path.join(runtimeRoot, 'secrets.json');
  if (!await isRegularFile(secretsPath)) return [];
  const data = await readFile(secretsPath);
  try {
    if (data.byteLength > MAX_SECRETS_FILE_BYTES) throw new Error('模型密钥文件超过安全大小限制。');
    const secrets = normalizeModelSecrets(JSON.parse(data.toString('utf8')));
    const providerNames = await readProviderNames(path.join(runtimeRoot, 'config.json'));
    const sources = Object.entries(secrets.providerApiKeys)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerId, apiKey]): LocalSnapshotSource => ({
        category: 'model_credentials',
        kind: 'provider-key',
        logicalPath: `model-credentials/providers/${credentialPathToken(providerId)}`,
        label: providerNames.get(providerId) ?? providerId,
        detail: providerId,
        credentialId: providerId,
        data: Buffer.from(apiKey, 'utf8'),
      }));
    if (secrets.imageGenerationApiKey) {
      sources.push({
        category: 'model_credentials',
        kind: 'image-generation-key',
        logicalPath: 'model-credentials/image-generation',
        label: '图片生成服务',
        data: Buffer.from(secrets.imageGenerationApiKey, 'utf8'),
      });
    }
    return sources;
  } finally {
    data.fill(0);
  }
}

async function readOptionalModelSecrets(filePath: string): Promise<StoredModelSecrets> {
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return { providerApiKeys: {} };
    throw error;
  }
  try {
    if (data.byteLength > MAX_SECRETS_FILE_BYTES) {
      throw new Error('模型密钥文件超过安全大小限制。');
    }
    return normalizeModelSecrets(JSON.parse(data.toString('utf8')));
  } finally {
    data.fill(0);
  }
}

function normalizeModelSecrets(value: unknown): StoredModelSecrets {
  if (!isRecord(value)) throw new Error('模型密钥文件格式无效。');
  const rawProviderKeys = isRecord(value.providerApiKeys) ? value.providerApiKeys : {};
  const entries = Object.entries(rawProviderKeys);
  if (entries.length > MAX_MODEL_CREDENTIALS) throw new Error('模型密钥数量超过安全限制。');
  const providerApiKeys = Object.fromEntries(entries.map(([id, rawValue]) => {
    if (!id.trim() || typeof rawValue !== 'string') throw new Error('模型密钥条目无效。');
    validateModelCredential(rawValue);
    return [id, rawValue];
  }));
  const imageGenerationApiKey = typeof value.imageGenerationApiKey === 'string'
    && value.imageGenerationApiKey
    ? value.imageGenerationApiKey
    : undefined;
  if (imageGenerationApiKey) validateModelCredential(imageGenerationApiKey);
  return { providerApiKeys, ...(imageGenerationApiKey ? { imageGenerationApiKey } : {}) };
}

function validateModelCredential(value: string): void {
  if (!value || Buffer.byteLength(value, 'utf8') > MAX_MODEL_CREDENTIAL_BYTES) {
    throw new Error('模型 API Key 为空或超过安全大小限制。');
  }
}

async function readProviderNames(configPath: string): Promise<Map<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.providers)) return new Map();
    return new Map(parsed.providers.flatMap((provider): Array<[string, string]> => {
      if (!isRecord(provider) || typeof provider.id !== 'string') return [];
      const name = typeof provider.name === 'string' && provider.name.trim()
        ? provider.name.trim()
        : provider.id;
      return [[provider.id, name]];
    }));
  } catch {
    return new Map();
  }
}

function fileSource(
  category: DesktopWebDavSyncCategoryId,
  sourcePath: string,
  logicalPath: string,
  label: string,
  executable = false,
): LocalSnapshotSource {
  return {
    category,
    kind: 'file',
    sourcePath,
    logicalPath,
    label,
    detail: logicalPath,
    ...(executable ? { executable: true } : {}),
  };
}

async function hashFile(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += data.byteLength;
      hash.update(data);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return { sha256: hash.digest('hex'), size };
}

async function isRegularFile(filePath: string): Promise<boolean> {
  const stats = await lstat(filePath).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw error;
  });
  if (!stats) return false;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`同步数据不是普通文件：${filePath}`);
  }
  return true;
}

function credentialPathToken(providerId: string): string {
  return createHash('sha256').update(providerId, 'utf8').digest('hex').slice(0, 24);
}

async function throwIfAborted(signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('同步操作已取消。');
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
