import { describe, expect, it } from 'vitest';
import { generateWebDavRecoveryKey, sha256Buffer } from '../../../src/webdav-sync/crypto.js';
import { normalizeWebDavLocation } from '../../../src/webdav-sync/normalization.js';
import {
  EncryptedWebDavRepository,
  createSnapshotId,
} from '../../../src/webdav-sync/repository.js';
import { WebDavClient } from '../../../src/webdav-sync/webdav-client.js';
import { MemoryWebDavServer } from '../../support/memory-webdav.js';

describe('EncryptedWebDavRepository', () => {
  it('publishes encrypted data and safely retains only the latest complete backup', async () => {
    const server = new MemoryWebDavServer('/dav');
    const client = new WebDavClient(
      normalizeWebDavLocation({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
      }),
      { username: 'alice', password: 'secret' },
      server.fetch,
    );
    const recoveryKey = generateWebDavRecoveryKey();
    const repository = await EncryptedWebDavRepository.create(client, recoveryKey);
    const snapshotId = createSnapshotId(new Date('2026-08-10T10:20:30.123Z'));
    const deviceId = '55bc8840-ac7a-435a-b5a7-88c2e91e7d87';
    const apiKey = Buffer.from('sk-secret-value', 'utf8');
    const objectName = '000001.enc';
    await repository.initializeSnapshot(deviceId, snapshotId);
    await repository.putEncryptedObjectBuffer(
      deviceId,
      snapshotId,
      objectName,
      repository.encryptSmallObject(snapshotId, objectName, apiKey),
    );
    await expect(repository.putEncryptedObjectBuffer(
      deviceId,
      snapshotId,
      objectName,
      repository.encryptSmallObject(snapshotId, objectName, apiKey),
    )).rejects.toThrow('已存在');
    await repository.publishSnapshot({
      formatVersion: 1,
      repositoryId: repository.metadata.repositoryId,
      id: snapshotId,
      deviceId,
      deviceName: 'Work laptop',
      createdAt: '2026-08-10T10:20:30.123Z',
      appVersion: '0.2.1',
      sourceDataRoot: '/Users/alice/Setsuna',
      categories: ['model_credentials'],
      items: [{
        category: 'model_credentials',
        kind: 'provider-key',
        logicalPath: 'model-credentials/providers/1234567890abcdef12345678',
        label: 'OpenAI',
        detail: 'provider-openai',
        credentialId: 'provider-openai',
        objectName,
        sha256: sha256Buffer(apiKey),
        size: apiKey.byteLength,
      }],
    });

    const connected = await EncryptedWebDavRepository.connect(client, recoveryKey);
    await connected.testWriteAccess();
    expect([...server.files.keys()].some((name) => name.includes('.write-test-'))).toBe(false);
    const snapshots = await connected.listSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.summary).toMatchObject({
      id: snapshotId,
      deviceName: 'Work laptop',
      totalBytes: apiKey.byteLength,
      categories: [{ id: 'model_credentials', itemCount: 1, totalBytes: apiKey.byteLength }],
    });
    const rawRemote = [...server.files.values()].map((data) => data.toString('utf8')).join('\n');
    expect(rawRemote).not.toContain('sk-secret-value');
    expect(rawRemote).not.toContain('provider-openai');

    const replacementDeviceId = '1455a7df-11ca-4b40-9fd8-f65e3a8846f0';
    const replacementId = createSnapshotId(new Date('2026-08-10T11:20:30.123Z'));
    await connected.initializeSnapshot(replacementDeviceId, replacementId);
    await connected.publishSnapshot({
      formatVersion: 1,
      repositoryId: repository.metadata.repositoryId,
      id: replacementId,
      deviceId: replacementDeviceId,
      deviceName: 'Replacement device',
      createdAt: '2026-08-10T11:20:30.123Z',
      appVersion: '0.2.1',
      sourceDataRoot: '/Users/alice/Setsuna',
      categories: ['usage'],
      items: [],
    });
    const newest = await connected.retainNewestCompleteSnapshot();

    const retained = await connected.listSnapshots();
    expect(newest.manifest.id).toBe(replacementId);
    expect(retained.map((record) => record.manifest.id)).toEqual([replacementId]);
    expect([...server.files.keys()].some((remotePath) => remotePath.includes(snapshotId))).toBe(false);
  });

  it('rejects the wrong recovery key and redirects', async () => {
    const server = new MemoryWebDavServer('/dav');
    const location = normalizeWebDavLocation({
      endpoint: 'https://dav.test/dav',
      remoteRoot: '/Backups',
    });
    const client = new WebDavClient(location, { username: 'alice', password: 'secret' }, server.fetch);
    await EncryptedWebDavRepository.create(client, generateWebDavRecoveryKey());
    await expect(EncryptedWebDavRepository.connect(client, generateWebDavRecoveryKey()))
      .rejects.toThrow('恢复密钥');

    const redirectingClient = new WebDavClient(
      location,
      { username: 'alice', password: 'secret' },
      async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }),
    );
    await expect(redirectingClient.test()).rejects.toThrow('不会自动跟随');
  });
});
