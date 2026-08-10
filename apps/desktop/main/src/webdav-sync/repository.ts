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
import type { WebDavClient } from './webdav-client.js';

const REPOSITORY_PARTS = ['setsuna-backup', 'v1'] as const;
const REPOSITORY_FILE = 'repository.json';
const DEVICES_DIRECTORY = 'devices';
const SNAPSHOTS_DIRECTORY = 'snapshots';
const OBJECTS_DIRECTORY = 'objects';
const MANIFEST_FILE = 'manifest.enc';
const COMPLETE_FILE = 'complete.json';
const MAX_SNAPSHOT_COUNT = 200;
const MAX_MANIFEST_ITEMS = 100_000;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PLAINTEXT_BYTES = 1024 * 1024 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SNAPSHOT_ID_PATTERN = /^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/u;

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
    await client.test(signal);
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
    const validated = parseSnapshotManifest(manifest, this.metadata.repositoryId);
    const manifestData = jsonBuffer(validated);
    if (manifestData.byteLength > MAX_MANIFEST_BYTES) throw new Error('备份清单超过安全大小限制。');
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

  async listSnapshots(signal?: AbortSignal): Promise<WebDavSnapshotRecord[]> {
    const deviceEntries = (await this.client.list([
      ...REPOSITORY_PARTS,
      DEVICES_DIRECTORY,
    ], signal)).filter((entry) => entry.collection && UUID_PATTERN.test(entry.name));
    if (deviceEntries.length > 100) throw new Error('WebDAV 仓库中的设备数量超过安全限制。');
    const locators: Array<{ deviceId: string; snapshotId: string }> = [];
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
        }
      }
    }
    locators.sort((left, right) => right.snapshotId.localeCompare(left.snapshotId));
    const records: WebDavSnapshotRecord[] = [];
    for (const locator of locators.slice(0, MAX_SNAPSHOT_COUNT)) {
      if (!await this.client.exists(
        this.snapshotParts(locator.deviceId, locator.snapshotId, COMPLETE_FILE),
        signal,
      )) continue;
      try {
        records.push(await this.readSnapshot(locator.deviceId, locator.snapshotId, signal));
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        // A damaged upload must not hide a usable complete backup.
      }
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
   * Keeps the newest authenticated backup while only deleting snapshots that
   * were complete before this replacement started. A concurrently published
   * snapshot is therefore never removed by another device's pruning pass; a
   * later backup will collapse any temporary overlap back to one snapshot.
   */
  async retainNewestCompleteSnapshot(
    replaceableSnapshots: readonly WebDavSnapshotRecord[],
    signal?: AbortSignal,
  ): Promise<WebDavSnapshotRecord> {
    const retained = (await this.listSnapshots(signal))[0];
    if (!retained) throw new Error('新备份发布后无法读取，旧备份未被替换。');
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
    const marker = parseCompleteMarker(parseJson(
      await this.client.getBuffer(
        this.snapshotParts(deviceId, snapshotId, COMPLETE_FILE),
        { maxBytes: 4 * 1024, signal },
      ),
      'WebDAV 快照完成标记',
    ));
    if (marker.snapshotId !== snapshotId) throw new Error('WebDAV 快照完成标记不匹配。');
    const encrypted = await this.client.getBuffer(
      this.snapshotParts(deviceId, snapshotId, MANIFEST_FILE),
      { maxBytes: MAX_MANIFEST_BYTES + 64, signal },
    );
    const decrypted = decryptWebDavBuffer(
      encrypted,
      this.recoveryKey,
      webDavObjectAad(this.metadata.repositoryId, snapshotId, MANIFEST_FILE),
    );
    const manifest = parseSnapshotManifest(
      parseJson(decrypted, 'WebDAV 快照清单'),
      this.metadata.repositoryId,
    );
    if (manifest.deviceId !== deviceId || manifest.id !== snapshotId) {
      throw new Error('WebDAV 快照目录与清单不匹配。');
    }
    return { manifest, summary: snapshotSummary(manifest) };
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
  const objectNames = new Set(items.map((item) => item.objectName));
  if (logicalPaths.size !== items.length || objectNames.size !== items.length) {
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
  return {
    category,
    kind,
    logicalPath,
    label: limitedText(value.label, 512, '条目名称'),
    ...(typeof value.detail === 'string' && value.detail
      ? { detail: limitedText(value.detail, 1_024, '条目说明') }
      : {}),
    ...(credentialId ? { credentialId } : {}),
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
  const logicalPath = stringValue(value).replaceAll('\\', '/');
  if (
    !logicalPath
    || logicalPath.length > 2_048
    || logicalPath.startsWith('/')
    || logicalPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
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
