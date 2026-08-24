import type {
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
  PortableFeatureSettingsRestoreTarget,
} from '@setsuna-desktop/feature-core/settings';
import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { memorySettings } from '@setsuna-desktop/feature-memory/contracts';
import { visionRecognitionSettings } from '@setsuna-desktop/feature-vision-recognition/contracts';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const PORTABLE_FEATURE_SETTINGS_ROOT = 'runtime/portable-feature-settings';
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export type PortableFeatureSettingsFile = Readonly<{
  sourcePath: string;
  logicalPath: string;
  label: string;
}>;

export function isPortableFeatureSettingsLogicalPath(logicalPath: string): boolean {
  const prefix = `${PORTABLE_FEATURE_SETTINGS_ROOT}/`;
  if (!logicalPath.startsWith(prefix)) return false;
  const components = logicalPath.slice(prefix.length).split('/');
  return components.length === 2
    && SAFE_ID_PATTERN.test(components[0]!)
    && SAFE_ID_PATTERN.test(components[1]!.slice(0, -'.json'.length))
    && components[1]!.endsWith('.json');
}

/** Exact Runtime-staged Feature paths that a restore transaction may replace. */
export function featureSettingsRestoreTargetPaths(
  dataRoot: string,
  targets: readonly PortableFeatureSettingsRestoreTarget[],
): string[] {
  const paths: string[] = [];
  for (const target of targets) {
    assertPortableIdentity(target.featureId, target.documentId);
    paths.push(localDocumentPath(dataRoot, target));
    if (target.includesSecrets) {
      paths.push(path.join(
        dataRoot,
        'runtime',
        'secrets',
        target.featureId,
        target.documentId,
      ));
    }
  }
  return [...new Set(paths)];
}

/**
 * Revalidates the serializable runtime projection at the process boundary.
 * Feature schema and migration ownership remains in Runtime.
 */
export async function materializePortableFeatureSettings(input: Readonly<{
  documents: readonly PortableFeatureSettingsDocument[];
  stagingRoot: string;
}>): Promise<readonly PortableFeatureSettingsFile[]> {
  const seen = new Set<string>();
  const files: PortableFeatureSettingsFile[] = [];
  for (const document of input.documents) {
    const normalized = normalizePortableDocumentEnvelope(document);
    const key = documentKey(normalized.featureId, normalized.documentId);
    if (seen.has(key)) throw new Error(`Portable Feature settings document is duplicated: ${key}`);
    seen.add(key);
    const logicalPath = portableLogicalPath(normalized);
    const sourcePath = path.join(input.stagingRoot, ...logicalPath.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `${JSON.stringify(normalized, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    files.push(Object.freeze({
      sourcePath,
      logicalPath,
      label: `Feature 设置：${normalized.featureId}/${normalized.documentId}`,
    }));
  }
  return Object.freeze(files);
}

/**
 * Reads the generic portable payload and projects the three pre-Feature legacy
 * config shapes. Runtime validates and stages the resulting documents.
 */
export async function readPortableFeatureSettingsRestorePayload(input: Readonly<{
  dataRoot: string;
  stagingRoot: string;
  preferencesSelected: boolean;
  modelCredentialsSelected: boolean;
  restoredSecretsBuffer?: Buffer;
}>): Promise<Readonly<{
  documents: readonly PortableFeatureSettingsDocument[];
  credentials: readonly FeatureCredentialBackup[];
}>> {
  const portable = input.preferencesSelected
    ? await readDownloadedPortableDocuments(input.stagingRoot)
    : new Map<string, PortableFeatureSettingsDocument>();
  const legacyConnection = input.preferencesSelected
    ? await readLegacyImageConnection(path.join(input.stagingRoot, 'runtime', 'config.json'))
    : null;
  const legacyVisionSelection = input.preferencesSelected
    ? await readLegacyVisionSelection(path.join(input.stagingRoot, 'runtime', 'config.json'))
    : undefined;
  const legacyMemoryPreferences = input.preferencesSelected
    ? await readLegacyMemoryPreferences(path.join(input.stagingRoot, 'runtime', 'config.json'))
    : undefined;
  const legacyApiKey = input.modelCredentialsSelected
    ? await preferredLegacyImageApiKey(
        input.restoredSecretsBuffer,
        path.join(input.dataRoot, 'runtime', 'secrets.json'),
      )
    : undefined;
  appendLegacyDocument(
    portable,
    imageGenerationSettings.documents.connection,
    legacyConnection ?? undefined,
  );
  appendLegacyDocument(
    portable,
    visionRecognitionSettings.documents['model-selection'],
    legacyVisionSelection,
  );
  appendLegacyDocument(
    portable,
    memorySettings.documents.preferences,
    legacyMemoryPreferences,
  );

  const credentials = legacyApiKey === undefined
    ? []
    : [Object.freeze({
        featureId: imageGenerationSettings.documents.connection.featureId,
        documentId: imageGenerationSettings.documents.connection.documentId,
        secretName: 'api-key',
        value: legacyApiKey,
      })];
  return Object.freeze({
    documents: Object.freeze([...portable.values()]),
    credentials: Object.freeze(credentials),
  });
}

function appendLegacyDocument(
  documents: Map<string, PortableFeatureSettingsDocument>,
  definition: Readonly<{
    featureId: PortableFeatureSettingsDocument['featureId'];
    documentId: string;
    currentVersion: number;
  }>,
  data: unknown | undefined,
): void {
  if (data === undefined) return;
  const key = documentKey(definition.featureId, definition.documentId);
  if (documents.has(key)) return;
  documents.set(key, Object.freeze({
    featureId: definition.featureId,
    documentId: definition.documentId,
    schemaVersion: definition.currentVersion,
    data,
  }));
}

async function readDownloadedPortableDocuments(
  stagingRoot: string,
): Promise<Map<string, PortableFeatureSettingsDocument>> {
  const root = path.join(stagingRoot, ...PORTABLE_FEATURE_SETTINGS_ROOT.split('/'));
  const files = await regularFilesRecursively(root);
  const documents = new Map<string, PortableFeatureSettingsDocument>();
  for (const filePath of files) {
    const components = path.relative(root, filePath).split(path.sep);
    if (components.length !== 2 || !components[1]!.endsWith('.json')) {
      throw new Error('备份包含无效的 portable Feature settings document 路径。');
    }
    const pathFeatureId = components[0]!;
    const pathDocumentId = components[1]!.slice(0, -'.json'.length);
    assertPortableIdentity(pathFeatureId, pathDocumentId);
    const raw = await readBoundedJson(filePath, 'portable Feature settings document');
    if (!isRecord(raw)) throw new Error('Portable Feature settings document 格式无效。');
    const document = normalizePortableDocumentEnvelope({
      featureId: raw.featureId as PortableFeatureSettingsDocument['featureId'],
      documentId: String(raw.documentId ?? ''),
      schemaVersion: Number(raw.schemaVersion),
      data: raw.data,
    });
    if (document.featureId !== pathFeatureId || document.documentId !== pathDocumentId) {
      throw new Error('Portable Feature settings document 身份不匹配。');
    }
    const key = documentKey(document.featureId, document.documentId);
    if (documents.has(key)) throw new Error(`Portable Feature settings document is duplicated: ${key}`);
    documents.set(key, document);
  }
  return documents;
}

async function readLegacyImageConnection(filePath: string): Promise<unknown | null> {
  if (!await isRegularFile(filePath)) return null;
  const config = await readBoundedJson(filePath, 'legacy portable config');
  if (!isRecord(config) || !isRecord(config.imageGeneration)) return null;
  const value = {
    baseUrl: config.imageGeneration.baseUrl ?? '',
    model: config.imageGeneration.model ?? '',
  };
  return imageGenerationSettings.documents.connection.schema.parse(value);
}

async function readLegacyVisionSelection(filePath: string): Promise<unknown | undefined> {
  if (!await isRegularFile(filePath)) return undefined;
  const config = await readBoundedJson(filePath, 'legacy portable config');
  if (!isRecord(config) || !Object.hasOwn(config, 'visionRecognition')) return undefined;
  return visionRecognitionSettings.documents['model-selection'].schema.parse(config.visionRecognition);
}

async function readLegacyMemoryPreferences(filePath: string): Promise<unknown | undefined> {
  if (!await isRegularFile(filePath)) return undefined;
  const config = await readBoundedJson(filePath, 'legacy portable config');
  if (!isRecord(config)) return undefined;
  const memory = isRecord(config.memory) ? config.memory : {};
  const taskModels = isRecord(config.taskModels) ? config.taskModels : {};
  const hasLegacyMemory = Object.hasOwn(config, 'memory')
    || Object.hasOwn(config, 'memoryEnabled')
    || Object.hasOwn(taskModels, 'memoryExtraction')
    || Object.hasOwn(taskModels, 'memoryConsolidation');
  if (!hasLegacyMemory) return undefined;

  const legacyEnabled = typeof config.memoryEnabled === 'boolean' ? config.memoryEnabled : true;
  const extractionModel = legacyModelReference(taskModels.memoryExtraction);
  const consolidationModel = legacyModelReference(taskModels.memoryConsolidation);
  return memorySettings.documents.preferences.schema.parse({
    useMemories: legacyBoolean(memory.useMemories, legacyEnabled),
    generateMemories: legacyBoolean(memory.generateMemories, legacyEnabled),
    disableOnExternalContext: legacyBoolean(memory.disableOnExternalContext, false),
    extractionModel: extractionModel ?? null,
    consolidationModel: consolidationModel ?? null,
    ...legacyString(memory.extractModel, 'extractionModelCode'),
    ...legacyString(memory.consolidationModel, 'consolidationModelCode'),
    ...legacyInteger(memory.minRateLimitRemainingPercent, 'minRateLimitRemainingPercent', 0, 100),
    ...legacyInteger(memory.maxRolloutsPerStartup, 'maxRolloutsPerStartup', 1),
    ...legacyInteger(memory.maxRolloutAgeDays, 'maxRolloutAgeDays', 1),
    ...legacyInteger(memory.minRolloutIdleHours, 'minRolloutIdleHours', 1),
    ...legacyInteger(memory.maxUnusedDays, 'maxUnusedDays', 1),
    ...legacyInteger(memory.maxRawMemoriesForConsolidation, 'maxRawMemoriesForConsolidation', 1),
  });
}

function legacyBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function legacyModelReference(value: unknown): Readonly<{ providerId: string; modelId: string }> | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = legacyStableId(value.providerId);
  const modelId = legacyStableId(value.modelId);
  return providerId && modelId ? Object.freeze({ providerId, modelId }) : undefined;
}

function legacyStableId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

function legacyString(
  value: unknown,
  key: 'extractionModelCode' | 'consolidationModelCode',
): Record<string, string> {
  if (typeof value !== 'string' || !value.trim()) return {};
  return { [key]: value.trim() };
}

function legacyInteger(
  value: unknown,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): Record<string, number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  const normalized = Math.floor(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) return {};
  return { [key]: normalized };
}

async function preferredLegacyImageApiKey(
  restoredBuffer: Buffer | undefined,
  localSecretsPath: string,
): Promise<string | undefined> {
  const restored = restoredBuffer ? legacyImageApiKey(JSON.parse(restoredBuffer.toString('utf8'))) : undefined;
  if (restored !== undefined) return restored;
  if (!await isRegularFile(localSecretsPath)) return undefined;
  return legacyImageApiKey(await readBoundedJson(localSecretsPath, 'legacy local secrets'));
}

function legacyImageApiKey(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.imageGenerationApiKey !== 'string') return undefined;
  const normalized = value.imageGenerationApiKey.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 64 * 1024) {
    throw new Error('Legacy image generation API Key is invalid.');
  }
  return normalized;
}

function normalizePortableDocumentEnvelope(
  document: PortableFeatureSettingsDocument,
): PortableFeatureSettingsDocument {
  assertPortableIdentity(document.featureId, document.documentId);
  if (!Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 1) {
    throw new Error('Portable Feature settings schemaVersion is invalid.');
  }
  return Object.freeze({
    featureId: document.featureId,
    documentId: document.documentId,
    schemaVersion: document.schemaVersion,
    data: document.data,
  });
}

function assertPortableIdentity(featureId: string, documentId: string): void {
  if (!SAFE_ID_PATTERN.test(featureId) || !SAFE_ID_PATTERN.test(documentId)) {
    throw new Error('Portable Feature settings identity is invalid.');
  }
}

function portableLogicalPath(
  document: Pick<PortableFeatureSettingsDocument, 'featureId' | 'documentId'>,
): string {
  return `${PORTABLE_FEATURE_SETTINGS_ROOT}/${document.featureId}/${document.documentId}.json`;
}

function localDocumentPath(
  dataRoot: string,
  target: Pick<PortableFeatureSettingsRestoreTarget, 'featureId' | 'documentId'>,
): string {
  return path.join(
    dataRoot,
    'runtime',
    'features',
    target.featureId,
    'settings',
    `${target.documentId}.json`,
  );
}

async function regularFilesRecursively(root: string): Promise<string[]> {
  const stats = await lstat(root).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw error;
  });
  if (!stats) return [];
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Portable Feature settings root is not a regular directory.');
  }
  const files: string[] = [];
  await walk(root);
  return files;

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Portable Feature settings contains a symbolic link.');
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile()) files.push(filePath);
      else throw new Error('Portable Feature settings contains an unsupported entry.');
    }
  }
}

async function readBoundedJson(filePath: string, label: string): Promise<unknown> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${label} is not a supported JSON file.`);
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid.`, { cause: error });
  }
}

async function isRegularFile(filePath: string): Promise<boolean> {
  return lstat(filePath).then((stats) => stats.isFile() && !stats.isSymbolicLink()).catch((error) => {
    if (isMissingFileError(error)) return false;
    throw error;
  });
}

function documentKey(featureId: string, documentId: string): string {
  return `${featureId}\0${documentId}`;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
