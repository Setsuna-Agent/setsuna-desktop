import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
  type DesktopWebDavSyncCategorySummary,
  type DesktopWebDavSyncSnapshotSummary,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import {
  decryptWebDavBuffer,
  encryptWebDavBuffer,
  verifyWebDavRepositoryKey,
  WEB_DAV_ENCRYPTED_OBJECT_OVERHEAD_BYTES,
  webDavObjectAad,
  webDavRepositoryKeyVerifier,
} from './crypto.js';
import {
  WEB_DAV_REPOSITORY_FORMAT_VERSION,
  WEB_DAV_SNAPSHOT_FORMAT_VERSION,
  type WebDavRepositoryMetadata,
  type WebDavSnapshotCompleteMarker,
  type WebDavSnapshotManifest,
  type WebDavSnapshotManifestItem,
  type WebDavSnapshotRecord,
} from './model.js';
import {
  isPortablePathComponent,
  portablePathComparisonKey,
} from './portable-path.js';
import {
  type WebDavClient,
  WebDavResponseTooLargeError,
} from './webdav-client.js';

const REPOSITORY_PARTS = ['setsuna-backup', 'v1'] as const;
const REPOSITORY_FILE = 'repository.json';
const DEVICES_DIRECTORY = 'devices';
const SNAPSHOTS_DIRECTORY = 'snapshots';
const OBJECTS_DIRECTORY = 'objects';
const MANIFEST_FILE = 'manifest.enc';
const COMPLETE_FILE = 'complete.json';
const MAX_SNAPSHOT_COUNT = 200;
const MAX_SNAPSHOT_DIRECTORY_COUNT = 10_000;
const MAX_MANIFEST_ITEMS = 100_000;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PLAINTEXT_BYTES = 1024 * 1024 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SNAPSHOT_ID_PATTERN = /^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/u;

type SnapshotLocator = { deviceId: string; snapshotId: string };

class DamagedWebDavSnapshotError extends Error {
  constructor(cause: unknown) {
    super('WebDAV 快照元数据已损坏。', { cause });
  }
}

export class EncryptedWebDavRepository {
  constructor(
    private readonly client: WebDavClient,
    readonly metadata: WebDavRepositoryMetadata,
    private readonly recoveryKey: string,
  ) {}

  static async create(
    client: WebDavClient,
    recoveryKey: string,
    signal?: AbortSignal,
  ): Promise<EncryptedWebDavRepository> {
    // Creation is only useful when later backups can read and remove objects too.
    // Probe the complete permission set before writing durable repository metadata.
    await client.testReadWrite(signal);
    await client.ensureCollection(REPOSITORY_PARTS, signal);
    const repositoryPath = [...REPOSITORY_PARTS, REPOSITORY_FILE];
    if (await client.exists(repositoryPath, signal)) {
      throw new Error('该远端目录已经包含 Setsuna 备份仓库，请改用“连接现有仓库”。');
    }
    const repositoryId = randomUUID();
    const metadata: WebDavRepositoryMetadata = {
      formatVersion: WEB_DAV_REPOSITORY_FORMAT_VERSION,
      repositoryId,
      createdAt: new Date().toISOString(),
      keyVerifier: webDavRepositoryKeyVerifier(recoveryKey, repositoryId),
    };
    await client.putBuffer(
      repositoryPath,
      jsonBuffer(metadata),
      { contentType: 'application/json; charset=utf-8', ifNoneMatch: true, signal },
    );
    return new EncryptedWebDavRepository(client, metadata, recoveryKey);
  }

  static async connect(
    client: WebDavClient,
    recoveryKey: string,
    signal?: AbortSignal,
  ): Promise<EncryptedWebDavRepository> {
    await client.test(signal);
    const raw = await client.getBuffer(
      [...REPOSITORY_PARTS, REPOSITORY_FILE],
      { maxBytes: 16 * 1024, signal },
    );
    const metadata = parseRepositoryMetadata(parseJson(raw, 'WebDAV 仓库元数据'));
    if (!verifyWebDavRepositoryKey(
      recoveryKey,
      metadata.repositoryId,
      metadata.keyVerifier,
    )) {
      throw new Error('恢复密钥与该 WebDAV 备份仓库不匹配。');
    }
    return new EncryptedWebDavRepository(client, metadata, recoveryKey);
  }

  async rollbackCreation(signal?: AbortSignal): Promise<void> {
    const repositoryPath = [...REPOSITORY_PARTS, REPOSITORY_FILE];
    const raw = await this.client.getBuffer(repositoryPath, { maxBytes: 16 * 1024, signal });
    const current = parseRepositoryMetadata(parseJson(raw, 'WebDAV 仓库元数据'));
    if (current.repositoryId !== this.metadata.repositoryId) return;
    await this.client.delete(repositoryPath, signal, false);
  }

  async initializeSnapshot(
    deviceId: string,
    snapshotId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    requireUuid(deviceId, '设备标识');
    requireSnapshotId(snapshotId);
    await this.client.ensureCollection([
      ...REPOSITORY_PARTS,
      DEVICES_DIRECTORY,
      deviceId,
      SNAPSHOTS_DIRECTORY,
      snapshotId,
      OBJECTS_DIRECTORY,
    ], signal);
  }

  putEncryptedObject(
    deviceId: string,
    snapshotId: string,
    objectName: string,
    encryptedPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.client.putFile(
      this.objectParts(deviceId, snapshotId, objectName),
      encryptedPath,
      { ifNoneMatch: true, signal },
    );
  }

  putEncryptedObjectBuffer(
    deviceId: string,
    snapshotId: string,
    objectName: string,
    encrypted: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.client.putBuffer(
      this.objectParts(deviceId, snapshotId, objectName),
      encrypted,
      { ifNoneMatch: true, signal },
    );
  }

  async publishSnapshot(manifest: WebDavSnapshotManifest, signal?: AbortSignal): Promise<void> {
    const validated = this.validateSnapshotManifest(manifest);
    const manifestData = jsonBuffer(validated);
    const encryptedManifest = encryptWebDavBuffer(
      manifestData,
      this.recoveryKey,
      webDavObjectAad(this.metadata.repositoryId, validated.id, MANIFEST_FILE),
    );
    await this.client.putBuffer(
      this.snapshotParts(validated.deviceId, validated.id, MANIFEST_FILE),
      encryptedManifest,
      { ifNoneMatch: true, signal },
    );
    const marker: WebDavSnapshotCompleteMarker = {
      formatVersion: WEB_DAV_SNAPSHOT_FORMAT_VERSION,
      snapshotId: validated.id,
    };
    // The completion marker is written last. Readers ignore an interrupted upload.
    await this.client.putBuffer(
      this.snapshotParts(validated.deviceId, validated.id, COMPLETE_FILE),
      jsonBuffer(marker),
      { contentType: 'application/json; charset=utf-8', ifNoneMatch: true, signal },
    );
  }

  /** Applies the same safety limits used by readers without touching the server. */
  validateSnapshotManifest(manifest: WebDavSnapshotManifest): WebDavSnapshotManifest {
    const validated = parseSnapshotManifest(manifest, this.metadata.repositoryId);
    if (jsonBuffer(validated).byteLength > MAX_MANIFEST_BYTES) {
      throw new Error('备份清单超过安全大小限制。');
    }
    return validated;
  }

  async listSnapshots(signal?: AbortSignal): Promise<WebDavSnapshotRecord[]> {
    const records: WebDavSnapshotRecord[] = [];
    for (const locator of await this.listSnapshotLocators(signal)) {
      if (!await this.client.exists(
        this.snapshotParts(locator.deviceId, locator.snapshotId, COMPLETE_FILE),
        signal,
      )) continue;
      try {
        records.push(await this.readSnapshot(locator.deviceId, locator.snapshotId, signal));
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        // Corrupt metadata should not hide another usable backup, but transport
        // and HTTP failures must remain visible so the user can retry.
        if (!(error instanceof DamagedWebDavSnapshotError)) throw error;
      }
      if (records.length >= MAX_SNAPSHOT_COUNT) break;
    }
    return records.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
  }

  async testWriteAccess(signal?: AbortSignal): Promise<void> {
    const objectName = `.write-test-${randomUUID()}`;
    const parts = [...REPOSITORY_PARTS, objectName];
    const payload = Buffer.from(randomUUID(), 'utf8');
    try {
      await this.client.putBuffer(parts, payload, { ifNoneMatch: true, signal });
      const downloaded = await this.client.getBuffer(parts, { maxBytes: 256, signal });
      if (!downloaded.equals(payload)) throw new Error('WebDAV 读写测试返回了不一致的内容。');
      await this.client.delete(parts, signal, false);
    } finally {
      payload.fill(0);
      await this.client.delete(parts, signal, false).catch(() => undefined);
    }
  }

  async findSnapshot(snapshotId: string, signal?: AbortSignal): Promise<WebDavSnapshotRecord> {
    requireSnapshotId(snapshotId);
    const record = (await this.listSnapshots(signal)).find((item) => item.manifest.id === snapshotId);
    if (!record) throw new Error('所选远端备份不存在、尚未完成或已经损坏。');
    return record;
  }

  downloadEncryptedObject(
    manifest: WebDavSnapshotManifest,
    item: WebDavSnapshotManifestItem,
    destinationPath: string,
    signal?: AbortSignal,
    onProgress?: (receivedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const maxBytes = item.size + 64;
    const totalBytes = item.size + WEB_DAV_ENCRYPTED_OBJECT_OVERHEAD_BYTES;
    return this.client.downloadFile(
      this.objectParts(manifest.deviceId, manifest.id, item.objectName),
      destinationPath,
      {
        maxBytes,
        signal,
        ...(onProgress ? {
          onProgress: (receivedBytes) => onProgress(receivedBytes, totalBytes),
        } : {}),
      },
    );
  }

  decryptSmallObject(
    manifest: WebDavSnapshotManifest,
    item: WebDavSnapshotManifestItem,
    encrypted: Buffer,
  ): Buffer {
    return decryptWebDavBuffer(
      encrypted,
      this.recoveryKey,
      webDavObjectAad(this.metadata.repositoryId, manifest.id, item.objectName),
    );
  }

  encryptSmallObject(
    snapshotId: string,
    objectName: string,
    data: Buffer,
  ): Buffer {
    return encryptWebDavBuffer(
      data,
      this.recoveryKey,
      webDavObjectAad(this.metadata.repositoryId, snapshotId, objectName),
    );
  }

  objectAad(snapshotId: string, objectName: string): string {
    return webDavObjectAad(this.metadata.repositoryId, snapshotId, objectName);
  }

  /**
   * Keeps the snapshot published by this backup while only deleting snapshots
   * that were complete before the replacement started. Selecting the explicit
   * publication avoids trusting another device's wall clock for retention. A
   * concurrently published snapshot is never removed by this pruning pass; a
   * later backup will collapse any temporary overlap back to one snapshot.
   */
  async retainPublishedSnapshot(
    publishedDeviceId: string,
    publishedSnapshotId: string,
    replaceableSnapshots: readonly WebDavSnapshotRecord[],
    signal?: AbortSignal,
  ): Promise<WebDavSnapshotRecord> {
    let retained: WebDavSnapshotRecord;
    try {
      retained = await this.readSnapshot(
        requireUuid(publishedDeviceId, '设备标识'),
        requireSnapshotId(publishedSnapshotId),
        signal,
      );
    } catch (error) {
      throw new Error('新备份发布后无法读取，旧备份未被替换。', { cause: error });
    }
    const retainedDeviceId = retained.manifest.deviceId;
    const retainedSnapshotId = retained.manifest.id;
    const deleted = new Set<string>();
    for (const snapshot of replaceableSnapshots) {
      const deviceId = snapshot.manifest.deviceId;
      const snapshotId = snapshot.manifest.id;
      if (deviceId === retainedDeviceId && snapshotId === retainedSnapshotId) continue;
      const key = `${deviceId}/${snapshotId}`;
      if (deleted.has(key)) continue;
      deleted.add(key);
      await this.client.delete(this.snapshotParts(deviceId, snapshotId), signal);
    }

    // A failed upload from this device has no completion marker and is absent
    // from replaceableSnapshots. Operations are serialized per device, so it is
    // safe for a later successful upload to reclaim those private fragments
    // without touching an in-progress upload from another device.
    for (const locator of await this.listSnapshotLocators(signal)) {
      if (
        locator.deviceId !== retainedDeviceId
        || locator.snapshotId === retainedSnapshotId
        || await this.client.exists(
          this.snapshotParts(locator.deviceId, locator.snapshotId, COMPLETE_FILE),
          signal,
        )
      ) continue;
      await this.client.delete(this.snapshotParts(locator.deviceId, locator.snapshotId), signal);
    }
    return retained;
  }

  deleteSnapshot(deviceId: string, snapshotId: string, signal?: AbortSignal): Promise<void> {
    return this.client.delete(this.snapshotParts(
      requireUuid(deviceId, '设备标识'),
      requireSnapshotId(snapshotId),
    ), signal);
  }

  private async readSnapshot(
    deviceId: string,
    snapshotId: string,
    signal?: AbortSignal,
  ): Promise<WebDavSnapshotRecord> {
    const markerData = await readSnapshotMetadata(() => this.client.getBuffer(
      this.snapshotParts(deviceId, snapshotId, COMPLETE_FILE),
      { maxBytes: 4 * 1024, signal },
    ));
    const marker = parseSnapshotMetadata(() => parseCompleteMarker(parseJson(
      markerData,
      'WebDAV 快照完成标记',
    )));
    if (marker.snapshotId !== snapshotId) {
      throw new DamagedWebDavSnapshotError(new Error('WebDAV 快照完成标记不匹配。'));
    }
    const encrypted = await readSnapshotMetadata(() => this.client.getBuffer(
      this.snapshotParts(deviceId, snapshotId, MANIFEST_FILE),
      { maxBytes: MAX_MANIFEST_BYTES + 64, signal },
    ));
    const manifest = parseSnapshotMetadata(() => {
      const decrypted = decryptWebDavBuffer(
        encrypted,
        this.recoveryKey,
        webDavObjectAad(this.metadata.repositoryId, snapshotId, MANIFEST_FILE),
      );
      try {
        const parsed = parseSnapshotManifest(
          parseJson(decrypted, 'WebDAV 快照清单'),
          this.metadata.repositoryId,
        );
        if (parsed.deviceId !== deviceId || parsed.id !== snapshotId) {
          throw new Error('WebDAV 快照目录与清单不匹配。');
        }
        return parsed;
      } finally {
        decrypted.fill(0);
      }
    });
    return { manifest, summary: snapshotSummary(manifest) };
  }

  private async listSnapshotLocators(signal?: AbortSignal): Promise<SnapshotLocator[]> {
    const deviceEntries = (await this.client.list([
      ...REPOSITORY_PARTS,
      DEVICES_DIRECTORY,
    ], signal)).filter((entry) => entry.collection && UUID_PATTERN.test(entry.name));
    if (deviceEntries.length > 100) throw new Error('WebDAV 仓库中的设备数量超过安全限制。');
    const locators: SnapshotLocator[] = [];
    for (const device of deviceEntries) {
      const snapshots = await this.client.list([
        ...REPOSITORY_PARTS,
        DEVICES_DIRECTORY,
        device.name,
        SNAPSHOTS_DIRECTORY,
      ], signal);
      for (const snapshot of snapshots) {
        if (snapshot.collection && SNAPSHOT_ID_PATTERN.test(snapshot.name)) {
          locators.push({ deviceId: device.name, snapshotId: snapshot.name });
          if (locators.length > MAX_SNAPSHOT_DIRECTORY_COUNT) {
            throw new Error('WebDAV 仓库中的快照目录数量超过安全限制。');
          }
        }
      }
    }
    return locators.sort((left, right) => right.snapshotId.localeCompare(left.snapshotId));
  }

  private snapshotParts(deviceId: string, snapshotId: string, tail?: string): string[] {
    const parts = [
      ...REPOSITORY_PARTS,
      DEVICES_DIRECTORY,
      requireUuid(deviceId, '设备标识'),
      SNAPSHOTS_DIRECTORY,
      requireSnapshotId(snapshotId),
    ];
    return tail ? [...parts, tail] : parts;
  }

  private objectParts(deviceId: string, snapshotId: string, objectName: string): string[] {
    return [
      ...this.snapshotParts(deviceId, snapshotId),
      OBJECTS_DIRECTORY,
      requireObjectName(objectName),
    ];
  }
}

function parseSnapshotMetadata<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof DamagedWebDavSnapshotError) throw error;
    throw new DamagedWebDavSnapshotError(error);
  }
}

async function readSnapshotMetadata<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof WebDavResponseTooLargeError) {
      throw new DamagedWebDavSnapshotError(error);
    }
    throw error;
  }
}

export function createSnapshotId(now = new Date()): string {
  const timestamp = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function snapshotSummary(manifest: WebDavSnapshotManifest): DesktopWebDavSyncSnapshotSummary {
  const categories = DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.flatMap((id) => {
    if (!manifest.categories.includes(id)) return [];
    const items = manifest.items.filter((item) => item.category === id);
    return [{
      id,
      // Project linkage is supporting metadata, not user content.
      itemCount: items.filter((item) => item.kind !== 'project-catalog').length,
      totalBytes: items.reduce((sum, item) => sum + item.size, 0),
    } satisfies DesktopWebDavSyncCategorySummary];
  });
  return {
    id: manifest.id,
    deviceId: manifest.deviceId,
    deviceName: manifest.deviceName,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    categories,
    totalBytes: categories.reduce((sum, category) => sum + category.totalBytes, 0),
  };
}

function parseRepositoryMetadata(value: unknown): WebDavRepositoryMetadata {
  if (!isRecord(value) || value.formatVersion !== WEB_DAV_REPOSITORY_FORMAT_VERSION) {
    throw new Error('WebDAV 备份仓库版本不受支持。');
  }
  const repositoryId = requireUuid(value.repositoryId, '仓库标识');
  const createdAt = requireIsoDate(value.createdAt, '仓库创建时间');
  const keyVerifier = stringValue(value.keyVerifier);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(keyVerifier)) throw new Error('WebDAV 仓库密钥校验值无效。');
  return { formatVersion: WEB_DAV_REPOSITORY_FORMAT_VERSION, repositoryId, createdAt, keyVerifier };
}

function parseCompleteMarker(value: unknown): WebDavSnapshotCompleteMarker {
  if (!isRecord(value) || value.formatVersion !== WEB_DAV_SNAPSHOT_FORMAT_VERSION) {
    throw new Error('WebDAV 快照完成标记无效。');
  }
  return {
    formatVersion: WEB_DAV_SNAPSHOT_FORMAT_VERSION,
    snapshotId: requireSnapshotId(value.snapshotId),
  };
}

function parseSnapshotManifest(value: unknown, repositoryId: string): WebDavSnapshotManifest {
  if (!isRecord(value) || value.formatVersion !== WEB_DAV_SNAPSHOT_FORMAT_VERSION) {
    throw new Error('WebDAV 快照清单版本不受支持。');
  }
  if (requireUuid(value.repositoryId, '仓库标识') !== repositoryId) {
    throw new Error('WebDAV 快照属于其他仓库。');
  }
  if (!Array.isArray(value.items) || value.items.length > MAX_MANIFEST_ITEMS) {
    throw new Error('WebDAV 快照清单条目数量无效。');
  }
  const items = value.items.map(parseSnapshotItem);
  if (!Array.isArray(value.categories)) throw new Error('WebDAV 快照数据类别无效。');
  const categories = [...new Set(value.categories.map(requireCategory))];
  if (!categories.length || categories.length !== value.categories.length) {
    throw new Error('WebDAV 快照数据类别无效。');
  }
  if (items.some((item) => !categories.includes(item.category))) {
    throw new Error('WebDAV 快照条目不属于清单声明的数据类别。');
  }
  const logicalPaths = new Set(items.map((item) => item.logicalPath));
  const portableLogicalPaths = new Set(items.map((item) => (
    portablePathComparisonKey(item.logicalPath)
  )));
  const objectNames = new Set(items.map((item) => item.objectName));
  if (
    logicalPaths.size !== items.length
    || portableLogicalPaths.size !== items.length
    || objectNames.size !== items.length
  ) {
    throw new Error('WebDAV 快照清单包含重复条目。');
  }
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_PLAINTEXT_BYTES) {
    throw new Error('WebDAV 快照声明的数据量超过安全限制。');
  }
  const sourceDataRoot = stringValue(value.sourceDataRoot);
  if (!sourceDataRoot || sourceDataRoot.length > 4_096) throw new Error('WebDAV 快照源目录无效。');
  return {
    formatVersion: WEB_DAV_SNAPSHOT_FORMAT_VERSION,
    repositoryId,
    id: requireSnapshotId(value.id),
    deviceId: requireUuid(value.deviceId, '设备标识'),
    deviceName: limitedText(value.deviceName, 80, '设备名称'),
    createdAt: requireIsoDate(value.createdAt, '快照创建时间'),
    appVersion: limitedText(value.appVersion, 80, '应用版本'),
    sourceDataRoot,
    categories: DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.filter((category) => categories.includes(category)),
    items,
  };
}

function parseSnapshotItem(value: unknown): WebDavSnapshotManifestItem {
  if (!isRecord(value)) throw new Error('WebDAV 快照清单条目无效。');
  const category = requireCategory(value.category);
  const kind = value.kind === 'file'
    || value.kind === 'provider-key'
    || value.kind === 'image-generation-key'
    || value.kind === 'project-catalog'
    ? value.kind
    : null;
  if (!kind) throw new Error('WebDAV 快照条目类型无效。');
  const logicalPath = requireLogicalPath(value.logicalPath, category, kind);
  const size = typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0
    ? value.size
    : -1;
  if (size < 0) throw new Error('WebDAV 快照条目大小无效。');
  const sha256 = stringValue(value.sha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error('WebDAV 快照条目校验值无效。');
  const credentialId = typeof value.credentialId === 'string' && value.credentialId
    ? value.credentialId
    : undefined;
  if ((kind === 'provider-key') !== Boolean(credentialId) || (credentialId?.length ?? 0) > 256) {
    throw new Error('WebDAV 模型密钥标识无效。');
  }
  if (value.executable !== undefined && typeof value.executable !== 'boolean') {
    throw new Error('WebDAV 快照文件权限无效。');
  }
  const executable = value.executable === true;
  if (executable && (kind !== 'file' || category !== 'user_skills')) {
    throw new Error('WebDAV 快照文件权限无效。');
  }
  return {
    category,
    kind,
    logicalPath,
    label: limitedText(value.label, 512, '条目名称'),
    ...(typeof value.detail === 'string' && value.detail
      ? { detail: limitedText(value.detail, 1_024, '条目说明') }
      : {}),
    ...(credentialId ? { credentialId } : {}),
    ...(executable ? { executable: true } : {}),
    objectName: requireObjectName(value.objectName),
    sha256,
    size,
  };
}

function requireLogicalPath(
  value: unknown,
  category: DesktopWebDavSyncCategoryId,
  kind: WebDavSnapshotManifestItem['kind'],
): string {
  const logicalPath = stringValue(value);
  const components = logicalPath.split('/');
  if (
    !logicalPath
    || logicalPath.length > 2_048
    || logicalPath.startsWith('/')
    || logicalPath.includes('\\')
    || components.some((segment) => !isPortablePathComponent(segment))
  ) throw new Error('WebDAV 快照条目路径无效。');
  if (kind !== 'file') {
    if (kind === 'project-catalog') {
      if (
        (category !== 'conversations' && category !== 'memories')
        || logicalPath !== 'portable/projects.json'
      ) {
        throw new Error('WebDAV 项目清单的类别或路径无效。');
      }
      return logicalPath;
    }
    if (category !== 'model_credentials' || !logicalPath.startsWith('model-credentials/')) {
      throw new Error('WebDAV 密钥条目的类别或路径无效。');
    }
    return logicalPath;
  }
  if (!allowedFilePath(category, logicalPath)) {
    throw new Error('WebDAV 快照文件超出所选数据类别。');
  }
  return logicalPath;
}

function allowedFilePath(category: DesktopWebDavSyncCategoryId, logicalPath: string): boolean {
  if (category === 'conversations') {
    return logicalPath === 'runtime/threads.sqlite'
      || logicalPath.startsWith('runtime/attachments/')
      || logicalPath.startsWith('runtime/generated-images/');
  }
  if (category === 'memories') return logicalPath.startsWith('runtime/memories/');
  if (category === 'preferences') return logicalPath === 'runtime/config.json';
  if (category === 'user_skills') {
    return logicalPath === 'runtime/skills.json' || logicalPath.startsWith('runtime/user-skills/');
  }
  if (category === 'usage') return logicalPath === 'runtime/usage.jsonl';
  return false;
}

function requireCategory(value: unknown): DesktopWebDavSyncCategoryId {
  const category = stringValue(value) as DesktopWebDavSyncCategoryId;
  if (!DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.includes(category)) throw new Error('WebDAV 快照数据类别无效。');
  return category;
}

function requireUuid(value: unknown, label: string): string {
  const id = stringValue(value).toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error(`WebDAV ${label}无效。`);
  return id;
}

function requireSnapshotId(value: unknown): string {
  const id = stringValue(value);
  if (!SNAPSHOT_ID_PATTERN.test(id)) throw new Error('WebDAV 快照标识无效。');
  return id;
}

function requireObjectName(value: unknown): string {
  const name = stringValue(value);
  if (!/^[0-9]{6}\.enc$/u.test(name)) throw new Error('WebDAV 快照对象名称无效。');
  return name;
}

function requireIsoDate(value: unknown, label: string): string {
  const parsed = Date.parse(stringValue(value));
  if (!Number.isFinite(parsed)) throw new Error(`WebDAV ${label}无效。`);
  return new Date(parsed).toISOString();
}

function limitedText(value: unknown, maxChars: number, label: string): string {
  const text = stringValue(value);
  if (!text || Array.from(text).length > maxChars) throw new Error(`WebDAV ${label}无效。`);
  return text;
}

function parseJson(data: Buffer, label: string): unknown {
  try {
    return JSON.parse(data.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label}不是有效的 JSON。`, { cause: error });
  }
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
