import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  maintenanceProfileRoot,
  newPendingLegacyDataImport,
  resolveDesktopDataRootBootMode,
  writeDataRootMarker,
  writeDataRootPointer,
  writePendingDataMigration,
} from '../../../src/data-root/bootstrap.js';
import { dataRootBootstrapLayout, desktopDataLayout } from '../../../src/data-root/layout.js';
import type { PendingDataMigration } from '../../../src/data-root/model.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('desktop data root bootstrap', () => {
  it('uses the Electron default when no location pointer has been created', async () => {
    const fixture = await createFixture();

    expect(resolveDesktopDataRootBootMode(fixture)).toEqual({
      mode: 'normal',
      activeRoot: fixture.defaultRoot,
      defaultRoot: fixture.defaultRoot,
    });
  });

  it('enters recovery instead of silently falling back when the pointer is corrupted', async () => {
    const fixture = await createFixture();
    const bootstrap = dataRootBootstrapLayout(fixture.appDataRoot);
    await mkdir(bootstrap.root, { recursive: true });
    await writeFile(bootstrap.pointerPath, '{broken', 'utf8');

    const mode = resolveDesktopDataRootBootMode(fixture);

    expect(mode).toMatchObject({
      mode: 'recovery',
      defaultRoot: fixture.defaultRoot,
      reason: 'configured_root_invalid',
      pointer: { dataRoot: '' },
    });
    expect(maintenanceProfileRoot(mode)).not.toBe(fixture.defaultRoot);
  });

  it('activates a marked custom root before the single-instance profile is chosen', async () => {
    const fixture = await createFixture();
    const customRoot = path.join(path.dirname(fixture.defaultRoot), 'custom-data');
    await mkdir(customRoot);
    await writeDataRootMarker(customRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: 'root_custom',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    await writeDataRootPointer(fixture.appDataRoot, {
      version: 1,
      dataRoot: customRoot,
      rootId: 'root_custom',
      previousDataRoot: fixture.defaultRoot,
      updatedAt: '2026-07-23T00:00:00.000Z',
    });

    const mode = resolveDesktopDataRootBootMode(fixture);

    expect(mode).toMatchObject({
      mode: 'normal',
      activeRoot: customRoot,
      defaultRoot: fixture.defaultRoot,
    });
    expect(maintenanceProfileRoot(mode)).toBeNull();
  });

  it('enters recovery before profile selection when a marked custom root is not writable', async () => {
    const fixture = await createFixture();
    const customRoot = path.join(path.dirname(fixture.defaultRoot), 'read-only-custom-data');
    await mkdir(customRoot);
    await writeDataRootMarker(customRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: 'root_read_only',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    await writeDataRootPointer(fixture.appDataRoot, {
      version: 1,
      dataRoot: customRoot,
      rootId: 'root_read_only',
      previousDataRoot: fixture.defaultRoot,
      updatedAt: '2026-07-23T00:00:00.000Z',
    });

    const mode = resolveDesktopDataRootBootMode({
      ...fixture,
      writabilityProbe: () => new Error('read-only mount'),
    });

    expect(mode).toMatchObject({
      mode: 'recovery',
      defaultRoot: fixture.defaultRoot,
      pointer: { dataRoot: customRoot },
      reason: 'configured_root_unavailable',
      error: expect.stringContaining('read-only mount'),
    });
    expect(maintenanceProfileRoot(mode)).not.toBe(customRoot);
  });

  it('uses an isolated maintenance profile while a migration is pending', async () => {
    const fixture = await createFixture();
    const targetRoot = path.join(path.dirname(fixture.defaultRoot), 'target-data');
    const pending: PendingDataMigration = {
      version: 1,
      migrationId: 'migration_1',
      sourceRoot: fixture.defaultRoot,
      targetRoot,
      createdAt: '2026-07-23T00:00:00.000Z',
    };
    await writePendingDataMigration(fixture.appDataRoot, pending);

    const mode = resolveDesktopDataRootBootMode(fixture);
    const profile = maintenanceProfileRoot(mode);

    expect(mode).toMatchObject({ mode: 'migrating', activeRoot: fixture.defaultRoot, pending });
    expect(profile).toContain(path.join('setsuna-desktop-maintenance', pending.migrationId));
    expect(profile).not.toBe(fixture.defaultRoot);
    expect(profile).not.toBe(targetRoot);
  });

  it('does not recreate a missing default root after an explicit rollback pointer exists', async () => {
    const fixture = await createFixture();
    await writeDataRootPointer(fixture.appDataRoot, {
      version: 1,
      dataRoot: fixture.defaultRoot,
      rootId: '',
      previousDataRoot: path.join(path.dirname(fixture.defaultRoot), 'custom-data'),
      previousRootId: 'root_custom',
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    await rm(fixture.defaultRoot, { recursive: true });

    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'recovery',
      reason: 'configured_root_unavailable',
      pointer: { dataRoot: fixture.defaultRoot },
    });
  });

  it('enters recovery when pending migration metadata is corrupted', async () => {
    const fixture = await createFixture();
    const bootstrap = dataRootBootstrapLayout(fixture.appDataRoot);
    await mkdir(bootstrap.root, { recursive: true });
    await writeFile(bootstrap.pendingMigrationPath, '{"version":1}', 'utf8');

    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'recovery',
      reason: 'configured_root_invalid',
      bootstrapIssue: 'pending_migration',
      pointer: { dataRoot: fixture.defaultRoot },
    });
  });

  it('enters maintenance before runtime startup when legacy memory remains configured', async () => {
    const fixture = await createFixture();
    const legacyRoot = path.join(path.dirname(fixture.defaultRoot), 'legacy-memory');
    await mkdir(path.join(fixture.defaultRoot, 'runtime'), { recursive: true });
    await writeFile(desktopDataLayout(fixture.defaultRoot).runtimeConfigPath, JSON.stringify({
      schemaVersion: 2,
      storagePath: legacyRoot,
      providers: [],
    }), 'utf8');

    const mode = resolveDesktopDataRootBootMode(fixture);

    expect(mode).toMatchObject({
      mode: 'migrating',
      activeRoot: fixture.defaultRoot,
      pending: {
        kind: 'legacy_import',
        sourceRoot: fixture.defaultRoot,
        targetRoot: fixture.defaultRoot,
        legacyMemoryStoragePath: legacyRoot,
      },
    });
    expect(maintenanceProfileRoot(mode)).not.toBe(fixture.defaultRoot);
  });

  it('treats a pointer-matched pending record as committed before checking target availability', async () => {
    const fixture = await createFixture();
    const targetRoot = path.join(path.dirname(fixture.defaultRoot), 'committed-target');
    await mkdir(targetRoot);
    await writeDataRootMarker(targetRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: 'root_committed',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    await writeDataRootPointer(fixture.appDataRoot, {
      version: 1,
      dataRoot: targetRoot,
      rootId: 'root_committed',
      previousDataRoot: fixture.defaultRoot,
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    const pending: PendingDataMigration = {
      version: 1,
      migrationId: 'migration_committed',
      sourceRoot: fixture.defaultRoot,
      targetRoot,
      targetRootId: 'root_committed',
      createdAt: '2026-07-23T00:00:00.000Z',
    };
    await writePendingDataMigration(fixture.appDataRoot, pending);

    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'normal',
      activeRoot: targetRoot,
      completedPending: pending,
    });

    await rm(targetRoot, { recursive: true });
    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'recovery',
      reason: 'configured_root_unavailable',
      bootstrapIssue: 'committed_pending',
      pointer: { dataRoot: targetRoot },
    });
  });

  it('resumes a persisted legacy import transaction in the same maintenance mode', async () => {
    const fixture = await createFixture();
    const pending = newPendingLegacyDataImport(fixture.defaultRoot, {
      memoryStoragePath: path.join(path.dirname(fixture.defaultRoot), 'legacy-memory'),
      policyPaths: [],
    });
    await writePendingDataMigration(fixture.appDataRoot, pending);

    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'migrating',
      activeRoot: fixture.defaultRoot,
      pending,
    });
  });
});

async function createFixture(): Promise<{
  appDataRoot: string;
  defaultRoot: string;
  legacyPolicyPaths: string[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-data-root-bootstrap-test-'));
  temporaryRoots.push(root);
  const appDataRoot = path.join(root, 'app-data');
  const defaultRoot = path.join(root, 'default-data');
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(defaultRoot, { recursive: true }),
  ]);
  return { appDataRoot, defaultRoot, legacyPolicyPaths: [] };
}
