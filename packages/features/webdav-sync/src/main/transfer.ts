import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncSnapshotSummary,
} from '../contracts/index.js';
import type {
  WebDavSyncStorageHost,
} from './capabilities.js';
import type {
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  decryptWebDavFile,
  encryptWebDavFile,
  sha256Buffer,
} from './crypto.js';
import type {
  LocalSnapshotInventoryItem,
  LocalSnapshotSource,
  WebDavSnapshotManifest,
  WebDavSnapshotManifestItem,
} from './model.js';
import { WEB_DAV_SNAPSHOT_FORMAT_VERSION } from './model.js';
import {
  inventorySnapshotSources,
  prepareLocalSnapshotSources,
  restoredFilePath,
  restoredSecretsBuffer,
} from './snapshot-data.js';
import {
  createSnapshotId,
  type EncryptedWebDavRepository,
  snapshotSummary,
} from './repository.js';
import {
  parsePortableProjectCatalog,
  type PortableProjectRecord,
} from './portable-projects.js';

const MANIFEST_SHA256_PLACEHOLDER = '0'.repeat(64);

export type WebDavTransferProgress = {
  phase: 'snapshotting' | 'encrypting' | 'uploading' | 'downloading' | 'inspecting';
  completedBytes?: number;
  totalBytes?: number;
  completedItems?: number;
  totalItems?: number;
};

export async function materializeSnapshotForUpload(input: {
  dataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  workRoot: string;
  storage: WebDavSyncStorageHost;
  portableFeatureSettings?: readonly PortableFeatureSettingsDocument[];
  featureCredentialBackups?: readonly FeatureCredentialBackup[];
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<LocalSnapshotSource[]> {
  input.onProgress?.({ phase: 'snapshotting' });
  return prepareLocalSnapshotSources({
    dataRoot: input.dataRoot,
    categories: input.categories,
    stagingRoot: path.join(input.workRoot, 'local-snapshot'),
    storage: input.storage,
    signal: input.signal,
    portableFeatureSettings: input.portableFeatureSettings,
    featureCredentialBackups: input.featureCredentialBackups,
  });
}

export async function createAndUploadSnapshot(input: {
  repository: EncryptedWebDavRepository;
  recoveryKey: string;
  sourceDataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  sources: LocalSnapshotSource[];
  deviceId: string;
  deviceName: string;
  appVersion: string;
  workRoot: string;
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<{ manifest: WebDavSnapshotManifest; summary: DesktopWebDavSyncSnapshotSummary }> {
  const sources = input.sources;
  const snapshotId = createSnapshotId();
  let initialized = false;
  let published = false;
  try {
    const sourceSizes = await snapshotSourceSizes(sources);
    let manifest = input.repository.validateSnapshotManifest({
      formatVersion: WEB_DAV_SNAPSHOT_FORMAT_VERSION,
      repositoryId: input.repository.metadata.repositoryId,
      id: snapshotId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      createdAt: new Date().toISOString(),
      appVersion: input.appVersion,
      sourceDataRoot: input.sourceDataRoot,
      categories: [...input.categories],
      items: sources.map((source, index) => manifestItem(
        source,
        `${String(index + 1).padStart(6, '0')}.enc`,
        { sha256: MANIFEST_SHA256_PLACEHOLDER, size: sourceSizes[index]! },
      )),
    });
    const totalBytes = sourceSizes.reduce((total, size) => total + size, 0);

    // Validate item count, declared size and serialized manifest size before
    // creating any remote snapshot directories or uploading encrypted objects.
    await input.repository.initializeSnapshot(input.deviceId, snapshotId, input.signal);
    initialized = true;
    let completedBytes = 0;
    const items: WebDavSnapshotManifestItem[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(input.signal);
      const source = sources[index]!;
      const preflightItem = manifest.items[index]!;
      const objectName = preflightItem.objectName;
      input.onProgress?.({
        phase: 'encrypting',
        completedBytes,
        totalBytes,
        completedItems: index,
        totalItems: sources.length,
      });
      let measured: { sha256: string; size: number };
      if (source.data) {
        measured = { sha256: sha256Buffer(source.data), size: source.data.byteLength };
        const encrypted = input.repository.encryptSmallObject(snapshotId, objectName, source.data);
        try {
          input.onProgress?.({
            phase: 'uploading',
            completedBytes,
            totalBytes,
            completedItems: index,
            totalItems: sources.length,
          });
          await input.repository.putEncryptedObjectBuffer(
            input.deviceId,
            snapshotId,
            objectName,
            encrypted,
            input.signal,
          );
        } finally {
          source.data.fill(0);
          encrypted.fill(0);
        }
      } else {
        const encryptedPath = path.join(input.workRoot, 'encrypted', objectName);
        measured = await encryptWebDavFile({
          sourcePath: source.sourcePath!,
          destinationPath: encryptedPath,
          recoveryKey: input.recoveryKey,
          aad: input.repository.objectAad(snapshotId, objectName),
          signal: input.signal,
        });
        input.onProgress?.({
          phase: 'uploading',
          completedBytes,
          totalBytes,
          completedItems: index,
          totalItems: sources.length,
        });
        await input.repository.putEncryptedObject(
          input.deviceId,
          snapshotId,
          objectName,
          encryptedPath,
          input.signal,
        );
      }
      if (measured.size !== sourceSizes[index]) {
        throw new Error(`备份源在暂存后发生了变化：${preflightItem.label}`);
      }
      completedBytes += measured.size;
      items.push({ ...preflightItem, sha256: measured.sha256 });
    }
    manifest = {
      ...manifest,
      items,
    };
    await input.repository.publishSnapshot(manifest, input.signal);
    published = true;
    return { manifest, summary: snapshotSummary(manifest) };
  } catch (error) {
    // Failed replacements must not accumulate large, invisible partial uploads.
    // A completed snapshot is left intact for the caller to atomically promote.
    if (initialized && !published) {
      await input.repository.deleteSnapshot(input.deviceId, snapshotId).catch(() => undefined);
    }
    throw error;
  } finally {
    for (const source of sources) source.data?.fill(0);
  }
}

export async function createLocalInventory(input: {
  dataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  workRoot: string;
  storage: WebDavSyncStorageHost;
  portableFeatureSettings?: readonly PortableFeatureSettingsDocument[];
  featureCredentialBackups?: readonly FeatureCredentialBackup[];
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<LocalSnapshotInventoryItem[]> {
  input.onProgress?.({ phase: 'snapshotting' });
  const sources = await prepareLocalSnapshotSources({
    dataRoot: input.dataRoot,
    categories: input.categories,
    stagingRoot: path.join(input.workRoot, 'local-snapshot'),
    storage: input.storage,
    signal: input.signal,
    portableFeatureSettings: input.portableFeatureSettings,
    featureCredentialBackups: input.featureCredentialBackups,
  });
  input.onProgress?.({ phase: 'inspecting', totalItems: sources.length, completedItems: 0 });
  return inventorySnapshotSources(sources, input.signal);
}

export async function downloadSnapshotForRestore(input: {
  repository: EncryptedWebDavRepository;
  recoveryKey: string;
  manifest: WebDavSnapshotManifest;
  categories: DesktopWebDavSyncCategoryId[];
  stagingRoot: string;
  workRoot: string;
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<{ secretsBuffer?: Buffer; portableProjects: PortableProjectRecord[] }> {
  const selected = new Set(input.categories);
  const needsProjectCatalog = selected.has('conversations') || selected.has('memories');
  const items = input.manifest.items.filter((item) => (
    selected.has(item.category) || (needsProjectCatalog && item.kind === 'project-catalog')
  ));
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const restoredCredentialItems: Array<{
    kind: WebDavSnapshotManifestItem['kind'];
    credentialId?: string;
    data: Buffer;
  }> = [];
  let portableProjects: PortableProjectRecord[] = [];
  let projectCatalogFound = false;
  let completedBytes = 0;
  let lastReportedBytes = 0;
  const progressStepBytes = Math.max(16 * 1024, Math.ceil(totalBytes / 100));
  const reportDownloadProgress = (
    nextCompletedBytes: number,
    completedItems: number,
    force = false,
  ) => {
    if (
      !force
      && nextCompletedBytes < totalBytes
      && nextCompletedBytes - lastReportedBytes < progressStepBytes
    ) return;
    lastReportedBytes = nextCompletedBytes;
    input.onProgress?.({
      phase: 'downloading',
      completedBytes: nextCompletedBytes,
      totalBytes,
      completedItems,
      totalItems: items.length,
    });
  };
  try {
    reportDownloadProgress(0, 0, true);
    for (let index = 0; index < items.length; index += 1) {
      throwIfAborted(input.signal);
      const item = items[index]!;
      const encryptedPath = path.join(input.workRoot, 'downloads', item.objectName);
      await input.repository.downloadEncryptedObject(
        input.manifest,
        item,
        encryptedPath,
        input.signal,
        (receivedBytes, encryptedTotalBytes) => {
          const itemCompletedBytes = proportionalBytes(
            item.size,
            receivedBytes,
            encryptedTotalBytes,
          );
          reportDownloadProgress(completedBytes + itemCompletedBytes, index);
        },
      );
      if (item.kind === 'file') {
        const destinationPath = restoredFilePath(input.stagingRoot, item.logicalPath);
        const measured = await decryptWebDavFile({
          sourcePath: encryptedPath,
          destinationPath,
          recoveryKey: input.recoveryKey,
          aad: input.repository.objectAad(input.manifest.id, item.objectName),
          mode: item.category === 'user_skills' && item.executable ? 0o700 : 0o600,
          signal: input.signal,
        });
        assertItemIntegrity(item, measured);
      } else {
        const encrypted = await readFile(encryptedPath);
        const data = input.repository.decryptSmallObject(input.manifest, item, encrypted);
        try {
          assertItemIntegrity(item, { sha256: sha256Buffer(data), size: data.byteLength });
          if (item.kind === 'project-catalog') {
            if (projectCatalogFound) throw new Error('备份包含重复的项目清单。');
            projectCatalogFound = true;
            portableProjects = parsePortableProjectCatalog(data);
            data.fill(0);
          } else {
            restoredCredentialItems.push({
              kind: item.kind,
              ...(item.credentialId ? { credentialId: item.credentialId } : {}),
              data,
            });
          }
        } catch (error) {
          data.fill(0);
          throw error;
        }
      }
      completedBytes += item.size;
      reportDownloadProgress(completedBytes, index + 1, true);
    }
    return {
      portableProjects,
      ...(selected.has('model_credentials')
        ? { secretsBuffer: restoredSecretsBuffer(restoredCredentialItems) }
        : {}),
    };
  } finally {
    for (const item of restoredCredentialItems) item.data.fill(0);
  }
}

function proportionalBytes(totalBytes: number, completedBytes: number, measuredTotalBytes: number): number {
  if (totalBytes <= 0 || measuredTotalBytes <= 0) return 0;
  return Math.min(totalBytes, Math.floor((completedBytes / measuredTotalBytes) * totalBytes));
}

export async function downloadSnapshotProjectCatalog(input: {
  repository: EncryptedWebDavRepository;
  manifest: WebDavSnapshotManifest;
  workRoot: string;
  signal?: AbortSignal;
}): Promise<PortableProjectRecord[]> {
  const item = input.manifest.items.find((candidate) => candidate.kind === 'project-catalog');
  if (!item) return [];
  const encryptedPath = path.join(input.workRoot, 'project-catalog', item.objectName);
  await input.repository.downloadEncryptedObject(input.manifest, item, encryptedPath, input.signal);
  const encrypted = await readFile(encryptedPath);
  const data = input.repository.decryptSmallObject(input.manifest, item, encrypted);
  try {
    assertItemIntegrity(item, { sha256: sha256Buffer(data), size: data.byteLength });
    return parsePortableProjectCatalog(data);
  } finally {
    encrypted.fill(0);
    data.fill(0);
  }
}

function manifestItem(
  source: LocalSnapshotSource,
  objectName: string,
  measured: { sha256: string; size: number },
): WebDavSnapshotManifestItem {
  return {
    category: source.category,
    kind: source.kind,
    logicalPath: source.logicalPath,
    label: source.label,
    ...(source.detail ? { detail: source.detail } : {}),
    ...(source.credentialId ? { credentialId: source.credentialId } : {}),
    ...(source.executable ? { executable: true } : {}),
    objectName,
    ...measured,
  };
}

async function snapshotSourceSizes(sources: readonly LocalSnapshotSource[]): Promise<number[]> {
  const sizes: number[] = [];
  for (const source of sources) {
    if (source.data) sizes.push(source.data.byteLength);
    else {
      const file = await stat(source.sourcePath!);
      sizes.push(file.size);
    }
  }
  return sizes;
}

function assertItemIntegrity(
  item: WebDavSnapshotManifestItem,
  measured: { sha256: string; size: number },
): void {
  if (item.size !== measured.size || item.sha256 !== measured.sha256) {
    throw new Error(`备份对象校验失败：${item.label}`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('同步操作已取消。');
}
