import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRuntimeServerTestHarness,
  mediumIntegrationTestTimeoutMs,
  type RuntimeServerTestHarness,
} from '../../support/runtime-server/harness.js';
import {
  AppServerStreamNotification
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer file system', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('supports AppServer fs methods inside registered workspaces', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-'));
      await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'AppServer fs' }),
      });
      const sourceDir = path.join(projectDir, 'source');
      const nestedDir = path.join(sourceDir, 'nested');
      const nestedFile = path.join(nestedDir, 'blob.bin');
      const copiedFile = path.join(projectDir, 'copy.bin');
      const copiedDir = path.join(projectDir, 'copied');
      const bytes = Buffer.from([0, 1, 2, 255]);
  
      await expect(harness.appServerRpc('fs/createDirectory', {
        path: nestedDir,
      })).resolves.toEqual({});
      await expect(harness.appServerRpc('fs/writeFile', {
        path: nestedFile,
        dataBase64: bytes.toString('base64'),
      })).resolves.toEqual({});
      await expect(readFile(nestedFile)).resolves.toEqual(bytes);
  
      await expect(harness.appServerRpc('fs/readFile', { path: nestedFile })).resolves.toEqual({
        dataBase64: bytes.toString('base64'),
      });
      await expect(harness.appServerRpc('fs/getMetadata', { path: nestedFile })).resolves.toMatchObject({
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        createdAtMs: expect.any(Number),
        modifiedAtMs: expect.any(Number),
      });
      await expect(harness.appServerRpc('fs/readDirectory', { path: sourceDir })).resolves.toEqual({
        entries: [
          {
            fileName: 'nested',
            isDirectory: true,
            isFile: false,
          },
        ],
      });
  
      await expect(harness.appServerRpc('fs/copy', {
        sourcePath: nestedFile,
        destinationPath: copiedFile,
        recursive: false,
      })).resolves.toEqual({});
      await expect(readFile(copiedFile)).resolves.toEqual(bytes);
      await expect(harness.appServerRpc('fs/copy', {
        sourcePath: sourceDir,
        destinationPath: copiedDir,
        recursive: true,
      })).resolves.toEqual({});
      await expect(readFile(path.join(copiedDir, 'nested', 'blob.bin'))).resolves.toEqual(bytes);
  
      await expect(harness.appServerRpc('fs/remove', { path: copiedDir })).resolves.toEqual({});
      await expect(readFile(path.join(copiedDir, 'nested', 'blob.bin'))).rejects.toThrow();
    });
  
  it('streams AppServer fs/watch changes and scopes fs/unwatch to the owner connection', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-watch-'));
      await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'AppServer fs watch' }),
      });
      const watchDir = path.join(projectDir, '.git');
      const changedFile = path.join(watchDir, 'FETCH_HEAD');
      await mkdir(watchDir, { recursive: true });
      await writeFile(changedFile, 'old\n');
  
      const ownerConnectionId = 'fs-watch-owner';
      const foreignConnectionId = 'fs-watch-foreign';
      const watchId = 'watch-git-dir';
      const ownerStream = await harness.openAppServerNotificationStream({ connectionId: ownerConnectionId });
      const foreignStream = await harness.openAppServerNotificationStream({ connectionId: foreignConnectionId });
      try {
        await expect(harness.appServerRpc('fs/watch', {
          watchId,
          path: watchDir,
        }, { connectionId: ownerConnectionId })).resolves.toEqual({ path: watchDir });
  
        await expect(harness.appServerRpcEnvelope({
          id: 'duplicate_fs_watch',
          method: 'fs/watch',
          params: { watchId, path: changedFile },
        }, { connectionId: ownerConnectionId })).resolves.toMatchObject({
          id: 'duplicate_fs_watch',
          error: {
            code: -32600,
            message: 'watchId already exists: watch-git-dir',
          },
        });
  
        await expect(harness.appServerRpc('fs/unwatch', { watchId }, { connectionId: foreignConnectionId })).resolves.toEqual({});
  
        let changed: AppServerStreamNotification | null = null;
        for (let attempt = 0; attempt < 8 && !changed; attempt += 1) {
          await writeFile(changedFile, `updated:${attempt}\n`);
          changed = await ownerStream.readNotification((notification) => (
            notification.method === 'fs/changed'
            && notification.params?.watchId === watchId
            && Array.isArray(notification.params.changedPaths)
            && notification.params.changedPaths.includes(changedFile)
          ), { timeoutMs: harness.fsWatchEventTimeoutMs });
        }
  
        expect(changed).toMatchObject({
          method: 'fs/changed',
          params: {
            watchId,
            changedPaths: expect.arrayContaining([changedFile]),
          },
        });
        await expect(foreignStream.readNotification((notification) => notification.method === 'fs/changed', { timeoutMs: 250 }))
          .resolves.toBeNull();
  
        await expect(harness.appServerRpc('fs/unwatch', { watchId }, { connectionId: ownerConnectionId })).resolves.toEqual({});
        await writeFile(path.join(watchDir, 'packed-refs'), 'refs\n');
  
        const missingFile = path.join(watchDir, 'MERGE_HEAD');
        const missingWatchId = 'watch-missing-file';
        await expect(harness.appServerRpc('fs/watch', {
          watchId: missingWatchId,
          path: missingFile,
        }, { connectionId: ownerConnectionId })).resolves.toEqual({ path: missingFile });
  
        let missingChanged: AppServerStreamNotification | null = null;
        for (let attempt = 0; attempt < 8 && !missingChanged; attempt += 1) {
          await writeFile(missingFile, `merge:${attempt}\n`);
          missingChanged = await ownerStream.readNotification((notification) => (
            notification.method === 'fs/changed'
            && notification.params?.watchId === missingWatchId
            && Array.isArray(notification.params.changedPaths)
            && notification.params.changedPaths.includes(missingFile)
          ), { timeoutMs: harness.fsWatchEventTimeoutMs });
        }
  
        expect(missingChanged).toMatchObject({
          method: 'fs/changed',
          params: {
            watchId: missingWatchId,
            changedPaths: expect.arrayContaining([missingFile]),
          },
        });
  
        await expect(harness.appServerRpc('fs/unwatch', { watchId: missingWatchId }, { connectionId: ownerConnectionId })).resolves.toEqual({});
        await writeFile(path.join(watchDir, 'ORIG_HEAD'), 'refs\n');
        await expect(ownerStream.readNotification((notification) => notification.method === 'fs/changed', { timeoutMs: harness.negativeEventTimeoutMs }))
          .resolves.toBeNull();
      } finally {
        await ownerStream.close();
        await foreignStream.close();
      }
    }, mediumIntegrationTestTimeoutMs);
  
  it('rejects unsafe AppServer fs requests', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-safe-'));
      const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-outside-'));
      await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'AppServer fs safety' }),
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'relative_fs_read',
        method: 'fs/readFile',
        params: { path: 'relative.txt' },
      })).resolves.toMatchObject({
        id: 'relative_fs_read',
        error: {
          code: -32602,
          message: 'fs/readFile path must be an absolute path',
        },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'outside_fs_write',
        method: 'fs/writeFile',
        params: {
          path: path.join(outsideDir, 'outside.txt'),
          dataBase64: Buffer.from('outside').toString('base64'),
        },
      })).resolves.toMatchObject({
        id: 'outside_fs_write',
        error: {
          code: -32600,
          message: expect.stringContaining('outside registered workspaces'),
        },
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'invalid_fs_base64',
        method: 'fs/writeFile',
        params: {
          path: path.join(projectDir, 'invalid.bin'),
          dataBase64: '%%%',
        },
      })).resolves.toMatchObject({
        id: 'invalid_fs_base64',
        error: {
          code: -32602,
          message: expect.stringContaining('fs/writeFile requires valid base64 dataBase64'),
        },
      });
    });
});
