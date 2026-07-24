import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeDataRootMarker } from '../../../src/data-root/bootstrap.js';
import { dataRootBootstrapLayout } from '../../../src/data-root/layout.js';
import {
  deleteRetainedDataRootBackup,
  dismissRetainedDataRootBackups,
  inspectRetainedDataRootBackup,
  readRetainedDataRootBackups,
  recoverRetainedDataRootDeletions,
  registerRetainedDataRootBackup,
} from '../../../src/data-root/retained-backups.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('retained data root backups', () => {
  it('persists inspection identity and preserves a dismissed startup prompt', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.backupRoot, 'data.bin'), 'retained-data', 'utf8');

    let backups = await registerBackup(fixture);
    const inspection = await inspectRetainedDataRootBackup(
      fixture.appDataRoot,
      backups[0].id,
      safetyContext(fixture),
    );

    expect(inspection).toMatchObject({
      status: 'ready',
      fileCount: 1,
      totalBytes: 13,
    });
    backups = await dismissRetainedDataRootBackups(
      fixture.appDataRoot,
      [backups[0].id],
    );
    expect(backups[0].promptOnStartup).toBe(false);

    backups = await registerRetainedDataRootBackup(fixture.appDataRoot, {
      dataRoot: fixture.backupRoot,
      promptOnStartup: true,
      refreshIdentity: false,
    });

    expect(backups).toHaveLength(1);
    expect(backups[0].promptOnStartup).toBe(false);
  });

  it('deletes only the registered inactive root and removes its registry record', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.activeRoot, 'active.txt'), 'active', 'utf8');
    await writeFile(path.join(fixture.backupRoot, 'old.txt'), 'old', 'utf8');
    const [backup] = await registerBackup(fixture);

    const remaining = await deleteRetainedDataRootBackup(
      fixture.appDataRoot,
      backup.id,
      safetyContext(fixture),
    );

    expect(remaining).toEqual([]);
    await expect(lstat(fixture.backupRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(fixture.activeRoot, 'active.txt'), 'utf8'))
      .resolves.toBe('active');
    await expect(readRetainedDataRootBackups(fixture.appDataRoot)).resolves.toEqual([]);
  });

  it('refuses a retained root that overlaps the active data location', async () => {
    const fixture = await createFixture();
    const activeInsideBackup = path.join(fixture.backupRoot, 'active');
    await mkdir(activeInsideBackup);
    const [backup] = await registerBackup(fixture);

    await expect(deleteRetainedDataRootBackup(
      fixture.appDataRoot,
      backup.id,
      {
        activeRoot: activeInsideBackup,
        reservedRoots: [dataRootBootstrapLayout(fixture.appDataRoot).root],
      },
    )).rejects.toMatchObject({ code: 'backup_cleanup_unsafe_path' });

    expect((await lstat(fixture.backupRoot)).isDirectory()).toBe(true);
  });

  it('never deletes the currently active data root', async () => {
    const fixture = await createFixture();
    const [backup] = await registerBackup(fixture);

    await expect(deleteRetainedDataRootBackup(
      fixture.appDataRoot,
      backup.id,
      {
        activeRoot: fixture.backupRoot,
        reservedRoots: [dataRootBootstrapLayout(fixture.appDataRoot).root],
      },
    )).rejects.toMatchObject({ code: 'backup_cleanup_unsafe_path' });

    expect((await lstat(fixture.backupRoot)).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses an active root reached through a different parent symlink',
    async () => {
      const fixture = await createFixture();
      const aliasRoot = path.join(fixture.root, 'root-alias');
      await symlink(fixture.root, aliasRoot);
      const [backup] = await registerBackup(fixture);

      await expect(deleteRetainedDataRootBackup(
        fixture.appDataRoot,
        backup.id,
        {
          activeRoot: path.join(aliasRoot, path.basename(fixture.backupRoot)),
          reservedRoots: [dataRootBootstrapLayout(fixture.appDataRoot).root],
        },
      )).rejects.toMatchObject({ code: 'backup_cleanup_unsafe_path' });

      expect((await lstat(fixture.backupRoot)).isDirectory()).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'refuses an old root that resolves inside the active root through a parent symlink',
    async () => {
      const fixture = await createFixture();
      const activeContainer = path.join(fixture.root, 'active-container');
      const nestedBackup = path.join(activeContainer, 'nested-old-data');
      const aliasRoot = path.join(fixture.root, 'active-alias');
      await mkdir(nestedBackup, { recursive: true });
      await symlink(activeContainer, aliasRoot);
      const [backup] = await registerRetainedDataRootBackup(fixture.appDataRoot, {
        dataRoot: path.join(aliasRoot, 'nested-old-data'),
        promptOnStartup: true,
        refreshIdentity: true,
      });

      await expect(deleteRetainedDataRootBackup(
        fixture.appDataRoot,
        backup.id,
        {
          activeRoot: activeContainer,
          reservedRoots: [dataRootBootstrapLayout(fixture.appDataRoot).root],
        },
      )).rejects.toMatchObject({ code: 'backup_cleanup_unsafe_path' });

      expect((await lstat(nestedBackup)).isDirectory()).toBe(true);
    },
  );

  it('refuses deletion when the registered directory has been replaced', async () => {
    const fixture = await createFixture();
    const [backup] = await registerBackup(fixture);
    const movedRoot = `${fixture.backupRoot}-moved`;
    await rename(fixture.backupRoot, movedRoot);
    await mkdir(fixture.backupRoot);

    await expect(deleteRetainedDataRootBackup(
      fixture.appDataRoot,
      backup.id,
      safetyContext(fixture),
    )).rejects.toMatchObject({ code: 'backup_changed' });

    expect((await lstat(fixture.backupRoot)).isDirectory()).toBe(true);
    expect((await lstat(movedRoot)).isDirectory()).toBe(true);
  });

  it('refuses deletion when a custom-root ownership marker changes', async () => {
    const fixture = await createFixture();
    await writeDataRootMarker(fixture.backupRoot, marker('root_before'));
    const [backup] = await registerRetainedDataRootBackup(fixture.appDataRoot, {
      dataRoot: fixture.backupRoot,
      rootId: 'root_before',
      promptOnStartup: true,
      refreshIdentity: true,
    });
    await writeDataRootMarker(fixture.backupRoot, marker('root_after'));

    await expect(deleteRetainedDataRootBackup(
      fixture.appDataRoot,
      backup.id,
      safetyContext(fixture),
    )).rejects.toMatchObject({ code: 'backup_changed' });

    expect((await lstat(fixture.backupRoot)).isDirectory()).toBe(true);
  });

  it('finishes an already-confirmed deletion after a crash following the rename', async () => {
    const fixture = await createFixture();
    const [backup] = await registerBackup(fixture);
    const deletionRoot = path.join(
      path.dirname(fixture.backupRoot),
      `.${path.basename(fixture.backupRoot)}.setsuna-delete-recovery`,
    );
    await rename(fixture.backupRoot, deletionRoot);
    await writeFile(
      dataRootBootstrapLayout(fixture.appDataRoot).retainedBackupsPath,
      JSON.stringify({
        version: 1,
        backups: [{
          ...backup,
          deletionRequestedAt: '2026-07-24T00:00:00.000Z',
          deletionRoot,
        }],
      }),
      'utf8',
    );

    const remaining = await recoverRetainedDataRootDeletions(
      fixture.appDataRoot,
      safetyContext(fixture),
    );

    expect(remaining).toEqual([]);
    await expect(lstat(deletionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

type Fixture = {
  root: string;
  appDataRoot: string;
  activeRoot: string;
  backupRoot: string;
};

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-retained-backup-test-'));
  temporaryRoots.push(root);
  const appDataRoot = path.join(root, 'app-data');
  const activeRoot = path.join(root, 'active-data');
  const backupRoot = path.join(root, 'old-data');
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(activeRoot, { recursive: true }),
    mkdir(backupRoot, { recursive: true }),
  ]);
  return { root, appDataRoot, activeRoot, backupRoot };
}

function registerBackup(fixture: Fixture) {
  return registerRetainedDataRootBackup(fixture.appDataRoot, {
    dataRoot: fixture.backupRoot,
    promptOnStartup: true,
    refreshIdentity: true,
  });
}

function safetyContext(fixture: Fixture) {
  return {
    activeRoot: fixture.activeRoot,
    reservedRoots: [dataRootBootstrapLayout(fixture.appDataRoot).root],
  };
}

function marker(rootId: string) {
  return {
    owner: 'setsuna-desktop' as const,
    version: 1 as const,
    rootId,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}
