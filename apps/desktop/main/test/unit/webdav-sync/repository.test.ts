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
    const replaceableSnapshots = await connected.listSnapshots();
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
    const newest = await connected.retainPublishedSnapshot(
      replacementDeviceId,
      replacementId,
      replaceableSnapshots,
    );

    const retained = await connected.listSnapshots();
    expect(newest.manifest.id).toBe(replacementId);
    expect(retained.map((record) => record.manifest.id)).toEqual([replacementId]);
    expect([...server.files.keys()].some((remotePath) => remotePath.includes(snapshotId))).toBe(false);
  });

  it('never prunes a complete snapshot published by a concurrent backup', async () => {
    const server = new MemoryWebDavServer('/dav');
    const client = new WebDavClient(
      normalizeWebDavLocation({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
      }),
      { username: 'alice', password: 'secret' },
      server.fetch,
    );
    const repository = await EncryptedWebDavRepository.create(client, generateWebDavRecoveryKey());
    const deviceA = '55bc8840-ac7a-435a-b5a7-88c2e91e7d87';
    const deviceB = '1455a7df-11ca-4b40-9fd8-f65e3a8846f0';
    const initialId = createSnapshotId(new Date('2026-08-10T10:00:00.000Z'));
    await publishEmptySnapshot(repository, deviceA, initialId, '2026-08-10T10:00:00.000Z');

    // Both devices begin from the same complete snapshot. Neither pruning pass
    // may delete a replacement that the other device publishes afterwards.
    const replaceableByA = await repository.listSnapshots();
    const replaceableByB = await repository.listSnapshots();
    const snapshotA = createSnapshotId(new Date('2026-08-10T11:00:00.000Z'));
    const snapshotB = createSnapshotId(new Date('2026-08-10T11:00:01.000Z'));
    await publishEmptySnapshot(repository, deviceA, snapshotA, '2026-08-10T11:00:00.000Z');
    await repository.retainPublishedSnapshot(deviceA, snapshotA, replaceableByA);
    await publishEmptySnapshot(repository, deviceB, snapshotB, '2026-08-10T11:00:01.000Z');
    await repository.retainPublishedSnapshot(deviceB, snapshotB, replaceableByB);

    expect((await repository.listSnapshots()).map((record) => record.manifest.id))
      .toEqual([snapshotB, snapshotA]);

    // The following ordinary backup sees both candidates and collapses the
    // temporary overlap back to the single newest complete snapshot.
    const replaceableAfterConflict = await repository.listSnapshots();
    const finalId = createSnapshotId(new Date('2026-08-10T12:00:00.000Z'));
    await publishEmptySnapshot(repository, deviceA, finalId, '2026-08-10T12:00:00.000Z');
    await repository.retainPublishedSnapshot(deviceA, finalId, replaceableAfterConflict);
    expect((await repository.listSnapshots()).map((record) => record.manifest.id))
      .toEqual([finalId]);
  });

  it('retains the just-published backup instead of a peer snapshot with a future clock', async () => {
    const server = new MemoryWebDavServer('/dav');
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      server.fetch,
    );
    const repository = await EncryptedWebDavRepository.create(client, generateWebDavRecoveryKey());
    const localDevice = '55bc8840-ac7a-435a-b5a7-88c2e91e7d87';
    const peerDevice = '1455a7df-11ca-4b40-9fd8-f65e3a8846f0';
    const peerId = createSnapshotId(new Date('2099-08-10T10:00:00.000Z'));
    await publishEmptySnapshot(repository, peerDevice, peerId, '2099-08-10T10:00:00.000Z');
    const replaceableSnapshots = await repository.listSnapshots();
    const localId = createSnapshotId(new Date('2026-08-10T12:00:00.000Z'));
    await publishEmptySnapshot(repository, localDevice, localId, '2026-08-10T12:00:00.000Z');

    const retained = await repository.retainPublishedSnapshot(
      localDevice,
      localId,
      replaceableSnapshots,
    );

    expect(retained.manifest.id).toBe(localId);
    expect((await repository.listSnapshots()).map((record) => record.manifest.id)).toEqual([localId]);
  });

  it('surfaces transient failures while reading a completed snapshot', async () => {
    const server = new MemoryWebDavServer('/dav');
    const location = normalizeWebDavLocation({
      endpoint: 'https://dav.test/dav',
      remoteRoot: '/Backups',
    });
    const recoveryKey = generateWebDavRecoveryKey();
    const repository = await EncryptedWebDavRepository.create(
      new WebDavClient(location, { username: 'alice', password: 'secret' }, server.fetch),
      recoveryKey,
    );
    await publishEmptySnapshot(
      repository,
      '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
      createSnapshotId(new Date('2026-08-10T12:00:00.000Z')),
      '2026-08-10T12:00:00.000Z',
    );
    let failMarkerRead = true;
    const flakyFetch = (async (...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args;
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (
        failMarkerRead
        && (init?.method ?? 'GET').toUpperCase() === 'GET'
        && url.pathname.replace(/\/+$/u, '').endsWith('/complete.json')
      ) {
        failMarkerRead = false;
        return new Response(null, { status: 500 });
      }
      return server.fetch(...args);
    }) as typeof globalThis.fetch;
    const connected = await EncryptedWebDavRepository.connect(
      new WebDavClient(location, { username: 'alice', password: 'secret' }, flakyFetch),
      recoveryKey,
    );

    await expect(connected.listSnapshots()).rejects.toThrow('HTTP 500');
  });

  it('skips damaged completed snapshots without hiding healthy backups', async () => {
    const server = new MemoryWebDavServer('/dav');
    const repository = await EncryptedWebDavRepository.create(
      new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
        { username: 'alice', password: 'secret' },
        server.fetch,
      ),
      generateWebDavRecoveryKey(),
    );
    const damagedId = createSnapshotId(new Date('2026-08-10T12:01:00.000Z'));
    const healthyId = createSnapshotId(new Date('2026-08-10T12:00:00.000Z'));
    await publishEmptySnapshot(
      repository,
      '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
      healthyId,
      '2026-08-10T12:00:00.000Z',
    );
    await publishEmptySnapshot(
      repository,
      '1455a7df-11ca-4b40-9fd8-f65e3a8846f0',
      damagedId,
      '2026-08-10T12:01:00.000Z',
    );
    const damagedManifestPath = [...server.files.keys()].find((remotePath) => (
      remotePath.includes(damagedId) && remotePath.endsWith('/manifest.enc')
    ));
    expect(damagedManifestPath).toBeDefined();
    server.files.set(damagedManifestPath!, Buffer.from('damaged manifest', 'utf8'));

    await expect(repository.listSnapshots()).resolves.toMatchObject([
      { manifest: { id: healthyId } },
    ]);
  });

  it('lists backups past incomplete fragments and reclaims fragments from this device', async () => {
    const server = new MemoryWebDavServer('/dav');
    const repository = await EncryptedWebDavRepository.create(
      new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
        { username: 'alice', password: 'secret' },
        server.fetch,
      ),
      generateWebDavRecoveryKey(),
    );
    const localDevice = '55bc8840-ac7a-435a-b5a7-88c2e91e7d87';
    const peerDevice = '1455a7df-11ca-4b40-9fd8-f65e3a8846f0';
    const healthyId = createSnapshotId(new Date('2026-08-10T10:00:00.000Z'));
    await publishEmptySnapshot(repository, peerDevice, healthyId, '2026-08-10T10:00:00.000Z');
    const incompleteIds = Array.from({ length: 201 }, (_, index) => (
      createSnapshotId(new Date(Date.parse('2026-08-10T11:00:00.000Z') + index))
    ));
    for (const snapshotId of incompleteIds) {
      await repository.initializeSnapshot(localDevice, snapshotId);
    }

    const replaceable = await repository.listSnapshots();
    expect(replaceable.map((record) => record.manifest.id)).toEqual([healthyId]);

    const finalId = createSnapshotId(new Date('2026-08-10T12:00:00.000Z'));
    await publishEmptySnapshot(repository, localDevice, finalId, '2026-08-10T12:00:00.000Z');
    await repository.retainPublishedSnapshot(localDevice, finalId, replaceable);

    expect((await repository.listSnapshots()).map((record) => record.manifest.id)).toEqual([finalId]);
    expect([...server.directories].filter((remotePath) => (
      incompleteIds.some((snapshotId) => remotePath.includes(snapshotId))
    ))).toEqual([]);
  });

  it('rejects manifest paths that cannot round-trip across supported platforms', async () => {
    const server = new MemoryWebDavServer('/dav');
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      server.fetch,
    );
    const repository = await EncryptedWebDavRepository.create(client, generateWebDavRecoveryKey());
    const snapshotId = createSnapshotId(new Date('2026-08-10T12:30:00.000Z'));

    const manifest = {
      formatVersion: 1,
      repositoryId: repository.metadata.repositoryId,
      id: snapshotId,
      deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
      deviceName: 'Work laptop',
      createdAt: '2026-08-10T12:30:00.000Z',
      appVersion: '0.2.1',
      sourceDataRoot: '/Users/alice/Setsuna',
      categories: ['user_skills'] as const,
    };
    for (const logicalPath of [
      'runtime/user-skills/docs\\guide.md',
      'runtime/user-skills/CON/readme.md',
      'runtime/user-skills/docs/file:part.md',
      'runtime/user-skills/docs/trailing. ',
    ]) {
      await expect(repository.publishSnapshot({
        ...manifest,
        categories: [...manifest.categories],
        items: [{
          category: 'user_skills',
          kind: 'file',
          logicalPath,
          label: 'guide.md',
          objectName: '000001.enc',
          sha256: '0'.repeat(64),
          size: 0,
        }],
      })).rejects.toThrow('路径无效');
    }

    await expect(repository.publishSnapshot({
      ...manifest,
      categories: [...manifest.categories],
      items: ['A.txt', 'a.txt'].map((fileName, index) => ({
        category: 'user_skills' as const,
        kind: 'file' as const,
        logicalPath: `runtime/user-skills/demo/${fileName}`,
        label: fileName,
        objectName: `${String(index + 1).padStart(6, '0')}.enc`,
        sha256: '0'.repeat(64),
        size: 0,
      })),
    })).rejects.toThrow('重复条目');
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

  it.each(['GET', 'DELETE'] as const)(
    'does not create repository metadata without %s access',
    async (deniedMethod) => {
      const server = new MemoryWebDavServer('/dav');
      const restrictedFetch = (async (
        input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) => {
        if ((init?.method ?? 'GET').toUpperCase() === deniedMethod) {
          return new Response(null, { status: 403 });
        }
        return server.fetch(input, init);
      }) as typeof globalThis.fetch;
      const client = new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
        { username: 'alice', password: 'secret' },
        restrictedFetch,
      );

      await expect(EncryptedWebDavRepository.create(client, generateWebDavRecoveryKey()))
        .rejects.toThrow('目录权限');
      expect([...server.files.keys()].some((remotePath) => remotePath.endsWith('/repository.json')))
        .toBe(false);
    },
  );
});

async function publishEmptySnapshot(
  repository: EncryptedWebDavRepository,
  deviceId: string,
  snapshotId: string,
  createdAt: string,
): Promise<void> {
  await repository.initializeSnapshot(deviceId, snapshotId);
  await repository.publishSnapshot({
    formatVersion: 1,
    repositoryId: repository.metadata.repositoryId,
    id: snapshotId,
    deviceId,
    deviceName: deviceId,
    createdAt,
    appVersion: '0.2.1',
    sourceDataRoot: '/Users/alice/Setsuna',
    categories: ['usage'],
    items: [],
  });
}
