import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  maintenanceProfileRoot,
  resolveDesktopDataRootBootMode,
  writePendingDataMigration,
} from '../../../src/data-root/bootstrap.js';
import { acquireBootstrapInstanceLock } from '../../../src/data-root/instance-lock.js';
import { dataRootBootstrapLayout } from '../../../src/data-root/layout.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('bootstrap instance lock', () => {
  it('keeps one lock domain across processes regardless of the Electron profile', async () => {
    const appDataRoot = await temporaryRoot();
    const first = acquireBootstrapInstanceLock(appDataRoot, {
      pid: 101,
      isProcessAlive: (pid) => pid === 101,
    });
    const defaultRoot = path.join(appDataRoot, 'normal-profile');
    await mkdir(defaultRoot);
    await writePendingDataMigration(appDataRoot, {
      version: 1,
      migrationId: 'migration-profile-switch',
      sourceRoot: defaultRoot,
      targetRoot: path.join(appDataRoot, 'target'),
      createdAt: '2026-07-24T00:00:00.000Z',
    });
    const maintenanceMode = resolveDesktopDataRootBootMode({
      appDataRoot,
      defaultRoot,
      legacyPolicyPaths: [],
    });

    expect(first).not.toBeNull();
    expect(maintenanceMode.mode).toBe('migrating');
    expect(maintenanceProfileRoot(maintenanceMode)).not.toBe(defaultRoot);
    expect(acquireBootstrapInstanceLock(appDataRoot, {
      pid: 202,
      isProcessAlive: (pid) => pid === 101,
    })).toBeNull();

    first?.release();
    const replacement = acquireBootstrapInstanceLock(appDataRoot, {
      pid: 202,
      isProcessAlive: () => false,
    });
    expect(replacement).not.toBeNull();
    replacement?.release();
  });

  it('recovers an owner file left by a crashed process', async () => {
    const appDataRoot = await temporaryRoot();
    const lockRoot = dataRootBootstrapLayout(appDataRoot).instanceLockRoot;
    await mkdir(lockRoot, { recursive: true });
    await writeFile(path.join(lockRoot, 'owner.json'), JSON.stringify({
      version: 1,
      lockId: 'stale-lock',
      pid: 999_999,
      createdAt: '2026-07-23T00:00:00.000Z',
    }), 'utf8');

    const lock = acquireBootstrapInstanceLock(appDataRoot, {
      pid: 303,
      isProcessAlive: () => false,
    });

    expect(lock).not.toBeNull();
    lock?.release();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-bootstrap-lock-test-'));
  temporaryRoots.push(root);
  return root;
}
