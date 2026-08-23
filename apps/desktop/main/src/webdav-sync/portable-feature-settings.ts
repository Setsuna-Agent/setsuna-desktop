import type {
  ErasedFeatureSettingsDocumentDefinition,
  PortableFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { visionRecognitionSettings } from '@setsuna-desktop/feature-vision-recognition/contracts';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { builtinFeatureSettingsDocuments } from '../composition/builtin-feature-settings.js';

const PORTABLE_FEATURE_SETTINGS_ROOT = 'runtime/portable-feature-settings';
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const installedDefinitions = builtinFeatureSettingsDocuments;

export type PortableFeatureSettingsFile = Readonly<{
  sourcePath: string;
  logicalPath: string;
  label: string;
}>;

/**
 * Revalidates the runtime catalog projection at the process boundary and
 * materializes only installed, explicitly portable documents.
 */
export async function materializePortableFeatureSettings(input: Readonly<{
  documents: readonly PortableFeatureSettingsDocument[];
  stagingRoot: string;
}>): Promise<readonly PortableFeatureSettingsFile[]> {
  const byKey = definitionMap();
  const seen = new Set<string>();
  const files: PortableFeatureSettingsFile[] = [];
  for (const document of input.documents) {
    const key = documentKey(document.featureId, document.documentId);
    if (seen.has(key)) throw new Error(`Portable Feature settings document is duplicated: ${key}`);
    seen.add(key);
    const definition = byKey.get(key);
    if (!definition || definition.syncPolicy !== 'portable') {
      throw new Error(`Portable Feature settings document is not installed: ${key}`);
    }
    const normalized = normalizePortableDocument(definition, document);
    const logicalPath = portableLogicalPath(definition);
    const sourcePath = path.join(input.stagingRoot, ...logicalPath.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `${JSON.stringify(normalized, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    files.push(Object.freeze({
      sourcePath,
      logicalPath,
      label: `Feature 设置：${definition.featureId}/${definition.documentId}`,
    }));
  }
  return Object.freeze(files);
}

/**
 * Converts downloaded portable documents into local envelopes before the
 * restore commit. Local revision and secret references never come from the
 * remote snapshot. The runtime is stopped while this runs, which is the
 * restore transaction's exclusive local write boundary.
 */
export async function preparePortableFeatureSettingsRestore(input: Readonly<{
  dataRoot: string;
  stagingRoot: string;
  preferencesSelected: boolean;
  modelCredentialsSelected: boolean;
  restoredSecretsBuffer?: Buffer;
}>): Promise<readonly string[]> {
  const portable = input.preferencesSelected
    ? await readDownloadedPortableDocuments(input.stagingRoot)
    : new Map<string, PortableFeatureSettingsDocument>();
  const legacyConnection = input.preferencesSelected
    ? await readLegacyImageConnection(path.join(input.stagingRoot, 'runtime', 'config.json'))
    : null;
  const legacyVisionSelection = input.preferencesSelected
    ? await readLegacyVisionSelection(path.join(input.stagingRoot, 'runtime', 'config.json'))
    : undefined;
  const legacyApiKey = input.modelCredentialsSelected
    ? await preferredLegacyImageApiKey(
        input.restoredSecretsBuffer,
        path.join(input.dataRoot, 'runtime', 'secrets.json'),
      )
    : undefined;
  const targets: string[] = [];

  for (const definition of installedDefinitions) {
    const key = documentKey(definition.featureId, definition.documentId);
    const remoteDocument = portable.get(key);
    const isImageConnection = key === documentKey(
      imageGenerationSettings.documents.connection.featureId,
      imageGenerationSettings.documents.connection.documentId,
    );
    const isVisionSelection = key === documentKey(
      visionRecognitionSettings.documents['model-selection'].featureId,
      visionRecognitionSettings.documents['model-selection'].documentId,
    );
    const importedData = remoteDocument
      ? normalizePortableDocument(definition, remoteDocument).data
      : isImageConnection && legacyConnection
        ? definition.schema.parse(legacyConnection)
        : isVisionSelection && legacyVisionSelection !== undefined
          ? definition.schema.parse(legacyVisionSelection)
        : undefined;
    const importedSecret = isImageConnection ? legacyApiKey : undefined;
    const localPath = localDocumentPath(input.dataRoot, definition);
    const stagedPath = stagedDocumentPath(input.stagingRoot, definition);

    if (importedData === undefined && importedSecret === undefined) {
      if (input.preferencesSelected && await isRegularFile(localPath)) {
        await mkdir(path.dirname(stagedPath), { recursive: true });
        await copyFile(localPath, stagedPath);
        targets.push(localPath);
      }
      continue;
    }

    const local = await readLocalEnvelope(localPath, definition);
    const data = importedData ?? local?.data ?? definition.schema.parse(definition.defaults());
    let secretRevision = local?.secretRevision;
    if (importedSecret !== undefined) {
      secretRevision = await stageRestoredImageSecret({
        dataRoot: input.dataRoot,
        stagingRoot: input.stagingRoot,
        apiKey: importedSecret,
      });
      targets.push(path.join(
        input.dataRoot,
        'runtime',
        'secrets',
        definition.featureId,
        definition.documentId,
      ));
    }
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, `${JSON.stringify({
      featureId: definition.featureId,
      documentId: definition.documentId,
      schemaVersion: definition.currentVersion,
      revision: Math.max(1, (local?.revision ?? 0) + 1),
      ...(secretRevision ? { secretRevision } : {}),
      data,
    }, null, 2)}\n`, { mode: 0o600 });
    targets.push(localPath);
  }

  if (portable.size) {
    const importedKeys = new Set(installedDefinitions.map((definition) => (
      documentKey(definition.featureId, definition.documentId)
    )));
    for (const key of portable.keys()) {
      if (!importedKeys.has(key)) throw new Error(`Portable Feature settings document is not installed: ${key}`);
    }
  }
  return Object.freeze([...new Set(targets)]);
}

function definitionMap(): ReadonlyMap<string, ErasedFeatureSettingsDocumentDefinition> {
  return new Map(installedDefinitions.map((definition) => [
    documentKey(definition.featureId, definition.documentId),
    definition,
  ]));
}

function normalizePortableDocument(
  definition: ErasedFeatureSettingsDocumentDefinition,
  document: PortableFeatureSettingsDocument,
): PortableFeatureSettingsDocument {
  if (!Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 1) {
    throw new Error('Portable Feature settings schemaVersion is invalid.');
  }
  if (document.schemaVersion > definition.currentVersion) {
    throw new Error(`Unsupported portable settings schema version ${document.schemaVersion}.`);
  }
  let data = document.data;
  for (let version = document.schemaVersion; version < definition.currentVersion; version += 1) {
    data = definition.migrations[version](data);
  }
  return Object.freeze({
    featureId: definition.featureId,
    documentId: definition.documentId,
    schemaVersion: definition.currentVersion,
    data: definition.schema.parse(data),
  });
}

async function readDownloadedPortableDocuments(
  stagingRoot: string,
): Promise<Map<string, PortableFeatureSettingsDocument>> {
  const root = path.join(stagingRoot, ...PORTABLE_FEATURE_SETTINGS_ROOT.split('/'));
  const files = await regularFilesRecursively(root);
  const allowedPaths = new Map(installedDefinitions.map((definition) => [
    path.resolve(stagingRoot, ...portableLogicalPath(definition).split('/')),
    definition,
  ]));
  const documents = new Map<string, PortableFeatureSettingsDocument>();
  for (const filePath of files) {
    const definition = allowedPaths.get(path.resolve(filePath));
    if (!definition) throw new Error('备份包含未知的 portable Feature settings document。');
    const raw = await readBoundedJson(filePath, 'portable Feature settings document');
    if (!isRecord(raw)) throw new Error('Portable Feature settings document 格式无效。');
    const document = normalizePortableDocument(definition, {
      featureId: raw.featureId as PortableFeatureSettingsDocument['featureId'],
      documentId: String(raw.documentId ?? ''),
      schemaVersion: Number(raw.schemaVersion),
      data: raw.data,
    });
    if (raw.featureId !== definition.featureId || raw.documentId !== definition.documentId) {
      throw new Error('Portable Feature settings document 身份不匹配。');
    }
    const key = documentKey(document.featureId, document.documentId);
    if (documents.has(key)) throw new Error(`Portable Feature settings document is duplicated: ${key}`);
    documents.set(key, document);
  }
  return documents;
}

async function readLocalEnvelope(
  filePath: string,
  definition: ErasedFeatureSettingsDocumentDefinition,
): Promise<Readonly<{
  revision: number;
  secretRevision?: string;
  data: unknown;
}> | null> {
  if (!await isRegularFile(filePath)) return null;
  const raw = await readBoundedJson(filePath, 'local Feature settings document');
  if (!isRecord(raw) || raw.featureId !== definition.featureId || raw.documentId !== definition.documentId) {
    return null;
  }
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) return null;
  try {
    return {
      revision: raw.revision as number,
      ...(typeof raw.secretRevision === 'string' ? { secretRevision: raw.secretRevision } : {}),
      data: definition.schema.parse(raw.data),
    };
  } catch {
    return {
      revision: raw.revision as number,
      ...(typeof raw.secretRevision === 'string' ? { secretRevision: raw.secretRevision } : {}),
      data: definition.schema.parse(definition.defaults()),
    };
  }
}

async function stageRestoredImageSecret(input: Readonly<{
  dataRoot: string;
  stagingRoot: string;
  apiKey: string;
}>): Promise<string> {
  const definition = imageGenerationSettings.documents.connection;
  const localDirectory = path.join(
    input.dataRoot,
    'runtime',
    'secrets',
    definition.featureId,
    definition.documentId,
  );
  const stagedDirectory = path.join(
    input.stagingRoot,
    'runtime',
    'secrets',
    definition.featureId,
    definition.documentId,
  );
  await copyRegularDirectory(localDirectory, stagedDirectory);
  await mkdir(stagedDirectory, { recursive: true, mode: 0o700 });
  const revision = `secret-${randomUUID()}`;
  await writeFile(
    path.join(stagedDirectory, `${revision}.json`),
    `${JSON.stringify({ 'api-key': input.apiKey }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return revision;
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

function portableLogicalPath(definition: ErasedFeatureSettingsDocumentDefinition): string {
  return `${PORTABLE_FEATURE_SETTINGS_ROOT}/${definition.featureId}/${definition.documentId}.json`;
}

function localDocumentPath(dataRoot: string, definition: ErasedFeatureSettingsDocumentDefinition): string {
  return path.join(
    dataRoot,
    'runtime',
    'features',
    definition.featureId,
    'settings',
    `${definition.documentId}.json`,
  );
}

function stagedDocumentPath(stagingRoot: string, definition: ErasedFeatureSettingsDocumentDefinition): string {
  return path.join(
    stagingRoot,
    'runtime',
    'features',
    definition.featureId,
    'settings',
    `${definition.documentId}.json`,
  );
}

async function copyRegularDirectory(source: string, destination: string): Promise<void> {
  const sourceStats = await lstat(source).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw error;
  });
  if (!sourceStats) return;
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error('Feature secret namespace is not a regular directory.');
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Feature secret namespace contains an unsupported entry.');
    }
    await copyFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
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
