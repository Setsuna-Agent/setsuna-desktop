import { lstatSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  maintenanceProfileRoot,
  resolveDesktopDataRootBootMode,
  writeDataRootMarker,
  writeDataRootPointer,
  writePendingDataMigration,
} from '../../../src/data-root/bootstrap.js';
import { DesktopDataRootCoordinator } from '../../../src/data-root/coordinator.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, lstatSync: vi.fn(original.lstatSync) };
});

const temporaryRoots: string[] = [];
const rollbackDirectory = '.webdav-sync-rollback-12345678-1234-1234-1234-123456789abc';

afterEach(async () => {
  vi.mocked(lstatSync).mockClear();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['committing', 'installing', 'committed', 'validated'])(
  'isolates an interrupted %s restore before writes and preserves missing live files and rollback bytes',
  async (phase) => {
    const fixture = await createFixture();
    const root = fixture.defaultRoot;
    const journal = JSON.stringify({
      version: 1, phase, rollbackDirectory,
      categories: ['conversations'],
      targets: [
        'threads.sqlite', 'threads.sqlite-wal', 'threads.sqlite-shm',
        'attachments', 'generated-images', 'tool-results', 'projects.json',
      ].map((name) => path.join('runtime', name)),
      existingTargets: [path.join('runtime', 'threads.sqlite')],
    });
    await writeFile(path.join(root, '.webdav-sync-restore.json'), journal);
    await mkdir(path.join(root, rollbackDirectory, 'runtime'), { recursive: true });
    const rollbackFile = path.join(root, rollbackDirectory, 'runtime', 'threads.sqlite');
    await writeFile(rollbackFile, Buffer.from([0, 255, 1, 12]));
    await mkdir(path.join(root, 'runtime'));
    const liveProjectFile = path.join(root, 'runtime', 'projects.json');
    await writeFile(liveProjectFile, '{"projects":[]}');
    const before = await readdir(root);
    const writabilityProbe = vi.fn();
    const mode = resolveDesktopDataRootBootMode({ ...fixture, writabilityProbe });

    expect(mode).toMatchObject({ mode: 'recovery', reason: 'configured_root_invalid', pointer: { dataRoot: root } });
    expect(maintenanceProfileRoot(mode)).not.toBe(root);
    expect(writabilityProbe).not.toHaveBeenCalled();
    const relaunch = vi.fn();
    const coordinator = new DesktopDataRootCoordinator({
      appDataRoot: fixture.appDataRoot, bootMode: mode, getRuntimeHost: () => null, requestRelaunch: relaunch,
    });
    await coordinator.finalizeStartup();
    await expect(coordinator.retryStartup()).resolves.toMatchObject({ ok: false, error: { code: 'configured_root_invalid' } });
    await expect(coordinator.restorePreviousRoot()).resolves.toMatchObject({ ok: false, error: { code: 'configured_root_invalid' } });
    expect(relaunch).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(before);
    expect(await readFile(rollbackFile)).toEqual(Buffer.from([0, 255, 1, 12]));
    expect(await readFile(liveProjectFile, 'utf8')).toBe('{"projects":[]}');
    expect(await readFile(path.join(root, '.webdav-sync-restore.json'), 'utf8')).toBe(journal);
    await expect(readFile(path.join(root, 'runtime', 'threads.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['{broken', '{}', '{"phase":"validated"}'])(
  'fails closed without parsing malformed legacy restore metadata %s',
  async (journal) => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.defaultRoot, '.webdav-sync-restore.json'), journal);
    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({ mode: 'recovery', reason: 'configured_root_invalid' });
    expect(await readFile(path.join(fixture.defaultRoot, '.webdav-sync-restore.json'), 'utf8')).toBe(journal);
  },
);

it('guards a configured custom root before its writable probe or profile selection', async () => {
  const fixture = await createFixture();
  const customRoot = path.join(path.dirname(fixture.defaultRoot), 'custom');
  await mkdir(customRoot);
  await writeDataRootMarker(customRoot, {
    owner: 'setsuna-desktop', version: 1, rootId: 'custom', createdAt: '2026-07-23T00:00:00.000Z',
  });
  await writeDataRootPointer(fixture.appDataRoot, {
    version: 1, dataRoot: customRoot, rootId: 'custom', updatedAt: '2026-07-23T00:00:00.000Z',
  });
  await mkdir(path.join(customRoot, '.webdav-sync-restore.json'));
  const writabilityProbe = vi.fn();

  const mode = resolveDesktopDataRootBootMode({ ...fixture, writabilityProbe });

  expect(mode).toMatchObject({ mode: 'recovery', reason: 'configured_root_invalid', pointer: { dataRoot: customRoot } });
  expect(maintenanceProfileRoot(mode)).not.toBe(customRoot);
  expect(writabilityProbe).not.toHaveBeenCalled();
});

it('fails closed when legacy metadata cannot be inspected', async () => {
  const fixture = await createFixture();
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  const journalPath = path.join(fixture.defaultRoot, '.webdav-sync-restore.json');
  vi.mocked(lstatSync).mockImplementation((...args) => {
    if (args[0] === journalPath) {
      throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    }
    return actualFs.lstatSync(...args);
  });

  try {
    expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
      mode: 'recovery', reason: 'configured_root_invalid', error: expect.stringContaining('cannot be inspected safely'),
    });
  } finally {
    vi.mocked(lstatSync).mockImplementation(actualFs.lstatSync);
  }
});

it.each(['source', 'target'] as const)('does not begin pending migration with a legacy restore in its %s root', async (location) => {
  const fixture = await createFixture();
  const targetRoot = path.join(path.dirname(fixture.defaultRoot), 'target');
  await mkdir(targetRoot);
  const affectedRoot = location === 'source' ? fixture.defaultRoot : targetRoot;
  await writeFile(path.join(affectedRoot, '.webdav-sync-restore.json'), '{"phase":"installing"}');
  await writePendingDataMigration(fixture.appDataRoot, {
    version: 1, migrationId: 'pending', sourceRoot: fixture.defaultRoot, targetRoot, createdAt: '2026-07-23T00:00:00.000Z',
  });

  expect(resolveDesktopDataRootBootMode(fixture)).toMatchObject({
    mode: 'recovery', reason: 'configured_root_invalid', pointer: { dataRoot: affectedRoot },
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-legacy-restore-guard-'));
  temporaryRoots.push(root);
  const appDataRoot = path.join(root, 'app-data');
  const defaultRoot = path.join(root, 'data');
  await mkdir(defaultRoot);
  return { appDataRoot, defaultRoot, legacyPolicyPaths: [] };
}
