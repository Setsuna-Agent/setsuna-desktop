import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncSnapshotSummary,
} from '@setsuna-desktop/contracts';
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

export type WebDavTransferProgress = {
  phase: 'snapshotting' | 'encrypting' | 'uploading' | 'downloading' | 'inspecting';
  completedBytes?: number;
  totalBytes?: number;
  completedItems?: number;
  totalItems?: number;
};

export async function createAndUploadSnapshot(input: {
  repository: EncryptedWebDavRepository;
  recoveryKey: string;
  dataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  deviceId: string;
  deviceName: string;
  appVersion: string;
  workRoot: string;
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<{ manifest: WebDavSnapshotManifest; summary: DesktopWebDavSyncSnapshotSummary }> {
  input.onProgress?.({ phase: 'snapshotting' });
  const sources = await prepareLocalSnapshotSources({
    dataRoot: input.dataRoot,
    categories: input.categories,
    stagingRoot: path.join(input.workRoot, 'local-snapshot'),
    signal: input.signal,
  });
  const snapshotId = createSnapshotId();
  let initialized = false;
  let published = false;
  try {
    await input.repository.initializeSnapshot(input.deviceId, snapshotId, input.signal);
    initialized = true;
    const totalBytes = await sourceTotalBytes(sources);
    let completedBytes = 0;
    const items: WebDavSnapshotManifestItem[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(input.signal);
      const source = sources[index]!;
      const objectName = `${String(index + 1).padStart(6, '0')}.enc`;
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
      completedBytes += measured.size;
      items.push(manifestItem(source, objectName, measured));
    }
    const manifest: WebDavSnapshotManifest = {
      formatVersion: WEB_DAV_SNAPSHOT_FORMAT_VERSION,
      repositoryId: input.repository.metadata.repositoryId,
      id: snapshotId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      createdAt: new Date().toISOString(),
      appVersion: input.appVersion,
      sourceDataRoot: input.dataRoot,
      categories: [...input.categories],
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
  signal?: AbortSignal;
  onProgress?: (progress: WebDavTransferProgress) => void;
}): Promise<LocalSnapshotInventoryItem[]> {
  input.onProgress?.({ phase: 'snapshotting' });
  const sources = await prepareLocalSnapshotSources({
    dataRoot: input.dataRoot,
    categories: input.categories,
    stagingRoot: path.join(input.workRoot, 'local-snapshot'),
    signal: input.signal,
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
}): Promise<{ secretsBuffer?: Buffer }> {
  const selected = new Set(input.categories);
  const items = input.manifest.items.filter((item) => selected.has(item.category));
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const restoredCredentialItems: Array<{
    kind: WebDavSnapshotManifestItem['kind'];
    credentialId?: string;
    data: Buffer;
  }> = [];
  let completedBytes = 0;
  try {
    for (let index = 0; index < items.length; index += 1) {
      throwIfAborted(input.signal);
      const item = items[index]!;
      const encryptedPath = path.join(input.workRoot, 'downloads', item.objectName);
      input.onProgress?.({
        phase: 'downloading',
        completedBytes,
        totalBytes,
        completedItems: index,
        totalItems: items.length,
      });
      await input.repository.downloadEncryptedObject(
        input.manifest,
        item,
        encryptedPath,
        input.signal,
      );
      if (item.kind === 'file') {
        const destinationPath = restoredFilePath(input.stagingRoot, item.logicalPath);
        const measured = await decryptWebDavFile({
          sourcePath: encryptedPath,
          destinationPath,
          recoveryKey: input.recoveryKey,
          aad: input.repository.objectAad(input.manifest.id, item.objectName),
          signal: input.signal,
        });
        assertItemIntegrity(item, measured);
      } else {
        const encrypted = await readFile(encryptedPath);
        const data = input.repository.decryptSmallObject(input.manifest, item, encrypted);
        try {
          assertItemIntegrity(item, { sha256: sha256Buffer(data), size: data.byteLength });
          restoredCredentialItems.push({
            kind: item.kind,
            ...(item.credentialId ? { credentialId: item.credentialId } : {}),
            data,
          });
        } catch (error) {
          data.fill(0);
          throw error;
        }
      }
      completedBytes += item.size;
    }
    if (!selected.has('model_credentials')) return {};
    return { secretsBuffer: restoredSecretsBuffer(restoredCredentialItems) };
  } finally {
    for (const item of restoredCredentialItems) item.data.fill(0);
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
    objectName,
    ...measured,
  };
}

async function sourceTotalBytes(sources: readonly LocalSnapshotSource[]): Promise<number> {
  let total = 0;
  for (const source of sources) {
    if (source.data) total += source.data.byteLength;
    else {
      const file = await stat(source.sourcePath!);
      total += file.size;
    }
  }
  return total;
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
