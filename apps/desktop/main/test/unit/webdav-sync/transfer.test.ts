import { describe, expect, it, vi } from 'vitest';
import { generateWebDavRecoveryKey } from '../../../src/webdav-sync/crypto.js';
import type { LocalSnapshotSource } from '../../../src/webdav-sync/model.js';
import { normalizeWebDavLocation } from '../../../src/webdav-sync/normalization.js';
import { EncryptedWebDavRepository } from '../../../src/webdav-sync/repository.js';
import { createAndUploadSnapshot } from '../../../src/webdav-sync/transfer.js';
import { WebDavClient } from '../../../src/webdav-sync/webdav-client.js';
import { MemoryWebDavServer } from '../../support/memory-webdav.js';

describe('WebDAV snapshot upload', () => {
  it('rejects an oversized manifest before creating a remote snapshot', async () => {
    const server = new MemoryWebDavServer('/dav');
    const recoveryKey = generateWebDavRecoveryKey();
    const repository = await EncryptedWebDavRepository.create(
      new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/backups' }),
        { username: 'alice', password: 'secret' },
        server.fetch,
      ),
      recoveryKey,
    );
    const initializeSnapshot = vi.spyOn(repository, 'initializeSnapshot');
    const source: LocalSnapshotSource = {
      category: 'preferences',
      kind: 'file',
      logicalPath: 'runtime/config.json',
      label: '设置',
      data: Buffer.alloc(0),
    };

    await expect(createAndUploadSnapshot({
      repository,
      recoveryKey,
      sourceDataRoot: '/data',
      categories: ['preferences'],
      sources: Array.from({ length: 100_001 }, () => source),
      deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
      deviceName: 'Test device',
      appVersion: '0.2.1',
      workRoot: '/unused',
    })).rejects.toThrow('清单条目数量无效');

    expect(initializeSnapshot).not.toHaveBeenCalled();
    expect([...server.directories].some((remotePath) => remotePath.includes('/snapshots/')))
      .toBe(false);
  });
});
