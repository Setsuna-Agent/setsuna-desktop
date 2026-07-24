import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  newPendingLegacyDataImport,
  readDataRootMarkerSync,
  writeDataRootMarker,
  writePendingDataMigration,
} from '../../../src/data-root/bootstrap.js';
import { DesktopDataRootCoordinator } from '../../../src/data-root/coordinator.js';
import {
  DATA_MIGRATION_OWNER_FILE_NAME,
  LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME,
  dataRootBootstrapLayout,
  desktopDataLayout,
} from '../../../src/data-root/layout.js';
import type { DesktopDataRootBootMode, PendingDataMigration } from '../../../src/data-root/model.js';
import type { RuntimeHost } from '../../../src/runtime/host.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('desktop data root coordinator', () => {
  it('copies, validates and commits a target before switching the bootstrap pointer', async () => {
    const fixture = await createMigrationFixture();
    await writeFixture(fixture.sourceRoot, 'runtime/config.json', JSON.stringify({
      schemaVersion: 2,
      storagePath: '/legacy-memory',
      hooks: {},
      providers: [],
    }));
    await writeFixture(fixture.sourceRoot, 'runtime/plugins.json', JSON.stringify({
      installRoot: path.join(fixture.sourceRoot, 'runtime', 'plugins'),
    }));
    await mkdir(path.join(fixture.sourceRoot, 'runtime', 'empty-owned'), {
      recursive: true,
      mode: 0o700,
    });
    await writeFixture(fixture.sourceRoot, 'Preferences', '{"theme":"dark"}');
    await writeFixture(
      fixture.sourceRoot,
      'runtime/user-skills/demo/fixtures/intentionally-invalid.json',
      '{not-managed-json',
    );
    await writeFixture(
      fixture.sourceRoot,
      'runtime/workspace-dependencies/lib/intentionally-invalid.jsonl',
      'not-managed-jsonl\n',
    );
    await writeFixture(
      fixture.sourceRoot,
      'Default/browser-fixture.json',
      '{browser-owned-fixture',
    );
    const relaunch = vi.fn();
    const coordinator = migratingCoordinator(fixture, relaunch);

    await expect(coordinator.runMigration()).resolves.toEqual({ ok: true });

    expect(relaunch).toHaveBeenCalledOnce();
    await expect(readFile(path.join(fixture.sourceRoot, 'Preferences'), 'utf8'))
      .resolves.toBe('{"theme":"dark"}');
    await expect(readFile(path.join(fixture.targetRoot, 'Preferences'), 'utf8'))
      .resolves.toBe('{"theme":"dark"}');
    await expect(readFile(
      path.join(
        fixture.targetRoot,
        'runtime/user-skills/demo/fixtures/intentionally-invalid.json',
      ),
      'utf8',
    )).resolves.toBe('{not-managed-json');
    await expect(readFile(
      path.join(
        fixture.targetRoot,
        'runtime/workspace-dependencies/lib/intentionally-invalid.jsonl',
      ),
      'utf8',
    )).resolves.toBe('not-managed-jsonl\n');
    await expect(readFile(
      path.join(fixture.targetRoot, 'Default/browser-fixture.json'),
      'utf8',
    )).resolves.toBe('{browser-owned-fixture');
    const migratedConfig = JSON.parse(
      await readFile(path.join(fixture.targetRoot, 'runtime', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(migratedConfig.storagePath).toBeUndefined();
    expect(migratedConfig.schemaVersion).toBe(3);
    const migratedPlugins = JSON.parse(
      await readFile(path.join(fixture.targetRoot, 'runtime', 'plugins.json'), 'utf8'),
    ) as { installRoot: string };
    expect(migratedPlugins.installRoot).toBe(
      path.join(fixture.targetRoot, 'runtime', 'plugins'),
    );
    const migratedEmptyDirectory = await lstat(
      path.join(fixture.targetRoot, 'runtime', 'empty-owned'),
    );
    expect(migratedEmptyDirectory.isDirectory()).toBe(true);
    if (process.platform !== 'win32') {
      expect(migratedEmptyDirectory.mode & 0o777).toBe(0o700);
    }
    expect(readDataRootMarkerSync(fixture.targetRoot)).toMatchObject({
      owner: 'setsuna-desktop',
      rootId: expect.any(String),
    });

    const bootstrap = dataRootBootstrapLayout(fixture.appDataRoot);
    const pointer = JSON.parse(await readFile(bootstrap.pointerPath, 'utf8')) as {
      dataRoot: string;
      previousDataRoot: string;
      rootId: string;
    };
    expect(pointer).toMatchObject({
      dataRoot: fixture.targetRoot,
      previousDataRoot: fixture.sourceRoot,
      rootId: readDataRootMarkerSync(fixture.targetRoot)?.rootId,
    });
    const retained = JSON.parse(
      await readFile(bootstrap.retainedBackupsPath, 'utf8'),
    ) as { backups: Array<{ dataRoot: string; promptOnStartup: boolean }> };
    expect(retained.backups).toEqual([
      expect.objectContaining({
        dataRoot: fixture.sourceRoot,
        promptOnStartup: true,
      }),
    ]);
    await expect(lstat(bootstrap.pendingMigrationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('relocates a virtual environment that uses managed Python', async () => {
    const fixture = await createMigrationFixture();
    const managedPythonRelative = 'runtime/workspace-dependencies/toolchain/python/bin/python3.12';
    const virtualEnvironmentPythonRelative = 'runtime/temporary-workspace/.venv/bin/python';
    const virtualEnvironmentConfigRelative = 'runtime/temporary-workspace/.venv/pyvenv.cfg';
    await writeFixture(fixture.sourceRoot, managedPythonRelative, 'managed-python');
    const sourceManagedPython = path.join(fixture.sourceRoot, managedPythonRelative);
    const sourceVirtualEnvironmentPython = path.join(
      fixture.sourceRoot,
      virtualEnvironmentPythonRelative,
    );
    await mkdir(path.dirname(sourceVirtualEnvironmentPython), { recursive: true });
    await symlink(sourceManagedPython, sourceVirtualEnvironmentPython);
    await writeFixture(
      fixture.sourceRoot,
      virtualEnvironmentConfigRelative,
      `home = ${path.dirname(sourceManagedPython)}\n`,
    );
    const coordinator = migratingCoordinator(fixture, vi.fn());

    await expect(coordinator.runMigration()).resolves.toEqual({ ok: true });

    const targetManagedPython = path.join(fixture.targetRoot, managedPythonRelative);
    const targetVirtualEnvironmentPython = path.join(
      fixture.targetRoot,
      virtualEnvironmentPythonRelative,
    );
    const migratedLinkTarget = await readlink(targetVirtualEnvironmentPython);
    expect(path.isAbsolute(migratedLinkTarget)).toBe(false);
    expect(path.resolve(path.dirname(targetVirtualEnvironmentPython), migratedLinkTarget))
      .toBe(targetManagedPython);
    await expect(readFile(
      path.join(fixture.targetRoot, virtualEnvironmentConfigRelative),
      'utf8',
    )).resolves.toBe(`home = ${path.dirname(targetManagedPython)}\n`);
    await expect(readlink(sourceVirtualEnvironmentPython)).resolves.toBe(sourceManagedPython);
  });

  it('keeps the pointer on the source and leaves the old data untouched when validation fails', async () => {
    const fixture = await createMigrationFixture();
    await writeFixture(fixture.sourceRoot, 'runtime/config.json', '{broken');
    const relaunch = vi.fn();
    const coordinator = migratingCoordinator(fixture, relaunch);

    const result = await coordinator.runMigration();

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'migration_failed' },
    });
    expect(coordinator.getState()).toMatchObject({
      mode: 'migrating',
      migration: { phase: 'failed' },
    });
    expect(relaunch).not.toHaveBeenCalled();
    await expect(readFile(path.join(fixture.sourceRoot, 'runtime', 'config.json'), 'utf8'))
      .resolves.toBe('{broken');
    await expect(lstat(fixture.targetRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(dataRootBootstrapLayout(fixture.appDataRoot).pointerPath))
      .rejects.toMatchObject({ code: 'ENOENT' });

    await expect(coordinator.cancelMigration()).resolves.toEqual({ ok: true });
    expect(relaunch).toHaveBeenCalledOnce();
    const pointer = JSON.parse(
      await readFile(dataRootBootstrapLayout(fixture.appDataRoot).pointerPath, 'utf8'),
    ) as { dataRoot: string };
    expect(pointer.dataRoot).toBe(fixture.sourceRoot);
  });

  it('finishes an interrupted post-rename commit and removes the staging owner marker', async () => {
    const fixture = await createMigrationFixture();
    fixture.pending.targetRootId = 'root_after_rename';
    await writePendingDataMigration(fixture.appDataRoot, fixture.pending);
    await mkdir(fixture.targetRoot, { recursive: true });
    await writeDataRootMarker(fixture.targetRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: fixture.pending.targetRootId,
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    await writeFixture(fixture.targetRoot, DATA_MIGRATION_OWNER_FILE_NAME, JSON.stringify({
      owner: 'setsuna-desktop',
      version: 1,
      migrationId: fixture.pending.migrationId,
    }));
    const relaunch = vi.fn();
    const coordinator = migratingCoordinator(fixture, relaunch);

    await expect(coordinator.runMigration()).resolves.toEqual({ ok: true });

    expect(relaunch).toHaveBeenCalledOnce();
    await expect(lstat(path.join(fixture.targetRoot, DATA_MIGRATION_OWNER_FILE_NAME)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const pointer = JSON.parse(
      await readFile(dataRootBootstrapLayout(fixture.appDataRoot).pointerPath, 'utf8'),
    ) as { dataRoot: string; rootId: string };
    expect(pointer).toMatchObject({
      dataRoot: fixture.targetRoot,
      rootId: fixture.pending.targetRootId,
    });
  });

  it('imports legacy memories and policies in maintenance mode with custom memories taking priority', async () => {
    const fixture = await createLegacyImportFixture();
    const progressStates: Array<{ phase: string; operation: string }> = [];
    const relaunch = vi.fn();
    const coordinator = legacyImportCoordinator(fixture, relaunch);
    coordinator.subscribe((state) => {
      if (state.mode === 'migrating') {
        progressStates.push({
          phase: state.migration.phase,
          operation: state.migration.operation,
        });
      }
    });

    await expect(coordinator.runMigration()).resolves.toEqual({ ok: true });

    const layout = desktopDataLayout(fixture.activeRoot);
    const merged = JSON.parse(
      await readFile(path.join(layout.memoriesRoot, 'memories.json'), 'utf8'),
    ) as { memories: Array<{ id: string; content: string }> };
    expect(merged.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mem_shared', content: 'custom wins' }),
      expect.objectContaining({ id: 'mem_custom', content: 'custom only' }),
      expect.objectContaining({ id: 'mem_default', content: 'default only' }),
    ]));
    await expect(readFile(path.join(layout.memoriesRoot, 'MEMORY.md'), 'utf8'))
      .resolves.toBe('default artifact\n');
    await expect(readFile(layout.pcLocalExecPolicyPath, 'utf8')).resolves.toContain('legacy-exec');
    await expect(readFile(layout.pcLocalShellPolicyPath, 'utf8')).resolves.toContain('legacy-shell');
    await expect(readFile(layout.runtimeConfigPath, 'utf8')).resolves.not.toContain('storagePath');
    await expect(readFile(fixture.legacyMemoryIndexPath, 'utf8')).resolves.toBe(fixture.legacyMemoryIndex);
    await expect(readFile(fixture.unrelatedLegacyFile, 'utf8')).resolves.toBe('leave untouched\n');
    expect(await readdir(layout.runtimeRoot)).toContain(
      `.memories-before-unification-${fixture.pending.migrationId}`,
    );
    await expect(lstat(dataRootBootstrapLayout(fixture.appDataRoot).pendingMigrationPath))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(relaunch).toHaveBeenCalledOnce();
    expect(progressStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'copying', operation: 'legacy_import' }),
      expect.objectContaining({ phase: 'merging_memory', operation: 'legacy_import' }),
      expect.objectContaining({ phase: 'committing', operation: 'legacy_import' }),
    ]));
  });

  it('recovers a crash between the memory backup and staging renames', async () => {
    const fixture = await createLegacyImportFixture();
    const layout = desktopDataLayout(fixture.activeRoot);
    const stagingRoot = path.join(
      layout.runtimeRoot,
      `.memories-unification-${fixture.pending.migrationId}`,
    );
    const backupRoot = path.join(
      layout.runtimeRoot,
      `.memories-before-unification-${fixture.pending.migrationId}`,
    );
    await rename(layout.memoriesRoot, backupRoot);
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(path.join(stagingRoot, DATA_MIGRATION_OWNER_FILE_NAME), JSON.stringify({
      owner: 'setsuna-desktop',
      version: 1,
      migrationId: fixture.pending.migrationId,
    }), 'utf8');
    await writeFile(path.join(stagingRoot, LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME), JSON.stringify({
      version: 1,
      migrationId: fixture.pending.migrationId,
      importedAt: '2026-07-24T00:00:00.000Z',
    }), 'utf8');
    await writeFile(path.join(stagingRoot, 'memories.json'), JSON.stringify({
      version: 1,
      memories: [{ id: 'mem_recovered', content: 'recovered transaction' }],
    }), 'utf8');
    fixture.pending.legacyTransactionStage = 'prepared';
    fixture.pending.legacyPolicyPaths = [];
    await writePendingDataMigration(fixture.appDataRoot, fixture.pending);
    const relaunch = vi.fn();

    await expect(legacyImportCoordinator(fixture, relaunch).runMigration())
      .resolves.toEqual({ ok: true });

    await expect(readFile(path.join(layout.memoriesRoot, 'memories.json'), 'utf8'))
      .resolves.toContain('mem_recovered');
    await expect(lstat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(backupRoot)).isDirectory()).toBe(true);
    await expect(readFile(layout.runtimeConfigPath, 'utf8')).resolves.not.toContain('storagePath');
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('removes pending state when strict runtime shutdown rejects the relaunch', async () => {
    const fixture = await createMigrationFixture();
    await writeFixture(fixture.sourceRoot, 'Preferences', '{"theme":"dark"}');
    const runtime = {
      prepareDataMigration: vi.fn().mockResolvedValue({
        ready: true,
        registeredTasks: 0,
        pendingMutations: 0,
      }),
      cancelDataMigrationPreparation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RuntimeHost;
    const requestRelaunch = vi.fn()
      .mockRejectedValueOnce(new Error('Runtime reported an unsuccessful graceful shutdown.'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new DesktopDataRootCoordinator({
      appDataRoot: fixture.appDataRoot,
      bootMode: {
        mode: 'normal',
        activeRoot: fixture.sourceRoot,
        defaultRoot: fixture.sourceRoot,
      },
      getRuntimeHost: () => runtime,
      requestRelaunch,
    });
    const plan = await coordinator.scanTarget(fixture.targetRoot);

    await expect(coordinator.beginMigration(plan.planId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'schedule_failed' },
    });
    await expect(lstat(dataRootBootstrapLayout(fixture.appDataRoot).pendingMigrationPath))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(requestRelaunch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'an interrupted atomic owner temporary file',
      ownerFileName: `.${DATA_MIGRATION_OWNER_FILE_NAME}.interrupted.tmp`,
      contents: '{"owner":"setsuna-desktop"',
    },
    {
      name: 'a truncated owner from the previous non-atomic writer',
      ownerFileName: DATA_MIGRATION_OWNER_FILE_NAME,
      contents: '{"owner":"setsuna-desktop"',
    },
  ])('recovers staging containing only $name', async ({ ownerFileName, contents }) => {
    const fixture = await createMigrationFixture();
    const stagingRoot = path.join(
      path.dirname(fixture.targetRoot),
      `.${path.basename(fixture.targetRoot)}.setsuna-staging-${fixture.pending.migrationId}`,
    );
    await mkdir(stagingRoot);
    await writeFile(path.join(stagingRoot, ownerFileName), contents, 'utf8');
    const relaunch = vi.fn();
    const coordinator = migratingCoordinator(fixture, relaunch);

    await expect(coordinator.cancelMigration()).resolves.toEqual({ ok: true });

    await expect(lstat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('cleans a committed pending record before normal startup', async () => {
    const fixture = await createMigrationFixture();
    const bootMode: DesktopDataRootBootMode = {
      mode: 'normal',
      activeRoot: fixture.targetRoot,
      defaultRoot: fixture.sourceRoot,
      completedPending: fixture.pending,
    };
    const coordinator = new DesktopDataRootCoordinator({
      appDataRoot: fixture.appDataRoot,
      bootMode,
      getRuntimeHost: () => null,
      requestRelaunch: async () => undefined,
    });

    await coordinator.finalizeStartup();

    await expect(lstat(dataRootBootstrapLayout(fixture.appDataRoot).pendingMigrationPath))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('discovers the immediate previous root and an older default root for cleanup', async () => {
    const fixture = await createMigrationFixture();
    const previousRoot = path.join(fixture.root, 'previous-custom-data');
    await mkdir(previousRoot);
    await writeDataRootMarker(previousRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: 'previous_root',
      createdAt: '2026-07-24T00:00:00.000Z',
    });
    await writeFixture(
      fixture.sourceRoot,
      'runtime/config.json',
      JSON.stringify({ schemaVersion: 3 }),
    );
    await mkdir(fixture.targetRoot);
    const coordinator = normalCoordinator(fixture, {
      version: 1,
      dataRoot: fixture.targetRoot,
      rootId: 'active_root',
      previousDataRoot: previousRoot,
      previousRootId: 'previous_root',
      updatedAt: '2026-07-24T00:00:00.000Z',
    });

    await coordinator.finalizeStartup();

    expect(coordinator.getState()).toMatchObject({
      mode: 'normal',
      retainedBackups: expect.arrayContaining([
        expect.objectContaining({ path: previousRoot, promptOnStartup: true }),
        expect.objectContaining({ path: fixture.sourceRoot, promptOnStartup: true }),
      ]),
    });
  });

  it('permanently deletes a confirmed old root and clears the rollback pointer', async () => {
    const fixture = await createMigrationFixture();
    const previousRoot = path.join(fixture.root, 'previous-custom-data');
    await mkdir(previousRoot);
    await writeFixture(previousRoot, 'old.txt', 'old data');
    await writeDataRootMarker(previousRoot, {
      owner: 'setsuna-desktop',
      version: 1,
      rootId: 'previous_root',
      createdAt: '2026-07-24T00:00:00.000Z',
    });
    await mkdir(fixture.targetRoot);
    const coordinator = normalCoordinator(fixture, {
      version: 1,
      dataRoot: fixture.targetRoot,
      rootId: 'active_root',
      previousDataRoot: previousRoot,
      previousRootId: 'previous_root',
      updatedAt: '2026-07-24T00:00:00.000Z',
    });
    await coordinator.finalizeStartup();
    const state = coordinator.getState();
    if (state.mode !== 'normal') throw new Error('Expected normal data-root state.');
    const backup = state.retainedBackups.find((candidate) => candidate.path === previousRoot);
    if (!backup) throw new Error('Expected previous root backup.');

    await expect(coordinator.deleteRetainedBackup(backup.id)).resolves.toEqual({ ok: true });

    await expect(lstat(previousRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(coordinator.getState()).toMatchObject({
      mode: 'normal',
      retainedBackups: [],
    });
    expect(coordinator.getState()).not.toHaveProperty('previousRoot');
    const pointer = JSON.parse(
      await readFile(dataRootBootstrapLayout(fixture.appDataRoot).pointerPath, 'utf8'),
    ) as Record<string, unknown>;
    expect(pointer.previousDataRoot).toBeUndefined();
    expect(pointer.previousRootId).toBeUndefined();
    expect((await lstat(fixture.targetRoot)).isDirectory()).toBe(true);
  });
});

type MigrationFixture = {
  root: string;
  appDataRoot: string;
  sourceRoot: string;
  targetRoot: string;
  pending: PendingDataMigration;
};

async function createMigrationFixture(): Promise<MigrationFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-data-root-coordinator-test-'));
  temporaryRoots.push(root);
  const appDataRoot = path.join(root, 'app-data');
  const sourceRoot = path.join(root, 'source-data');
  const targetRoot = path.join(root, 'target-data');
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
  ]);
  const pending: PendingDataMigration = {
    version: 1,
    migrationId: 'migration_1',
    sourceRoot,
    targetRoot,
    createdAt: '2026-07-23T00:00:00.000Z',
  };
  await writePendingDataMigration(appDataRoot, pending);
  return { root, appDataRoot, sourceRoot, targetRoot, pending };
}

type LegacyImportFixture = {
  appDataRoot: string;
  activeRoot: string;
  pending: PendingDataMigration;
  legacyMemoryIndex: string;
  legacyMemoryIndexPath: string;
  unrelatedLegacyFile: string;
};

async function createLegacyImportFixture(): Promise<LegacyImportFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-legacy-import-coordinator-test-'));
  temporaryRoots.push(root);
  const appDataRoot = path.join(root, 'app-data');
  const activeRoot = path.join(root, 'active-data');
  const legacyContainer = path.join(root, 'legacy-container');
  const legacyMemoryRoot = path.join(legacyContainer, '.setsuna-memory');
  const execPolicyPath = path.join(root, 'exec-policy.json');
  const shellPolicyPath = path.join(root, 'shell-policy.json');
  const layout = desktopDataLayout(activeRoot);
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(layout.memoriesRoot, { recursive: true }),
    mkdir(legacyMemoryRoot, { recursive: true }),
  ]);
  await writeFile(layout.runtimeConfigPath, JSON.stringify({
    schemaVersion: 2,
    storagePath: legacyContainer,
    providers: [],
  }), 'utf8');
  await writeFile(path.join(layout.memoriesRoot, 'memories.json'), JSON.stringify({
    version: 1,
    memories: [
      { id: 'mem_shared', content: 'default loses' },
      { id: 'mem_default', content: 'default only' },
    ],
  }), 'utf8');
  await writeFile(path.join(layout.memoriesRoot, 'MEMORY.md'), 'default artifact\n', 'utf8');
  await writeFile(path.join(legacyMemoryRoot, '.setsuna-memory-root.json'), JSON.stringify({
    owner: 'setsuna-desktop',
    version: 1,
    legacyImportComplete: true,
  }), 'utf8');
  const legacyMemoryIndex = JSON.stringify({
    version: 1,
    memories: [
      { id: 'mem_shared', content: 'custom wins' },
      { id: 'mem_custom', content: 'custom only' },
    ],
  });
  const legacyMemoryIndexPath = path.join(legacyMemoryRoot, 'memories.json');
  const unrelatedLegacyFile = path.join(legacyContainer, 'keep.txt');
  await Promise.all([
    writeFile(legacyMemoryIndexPath, legacyMemoryIndex, 'utf8'),
    writeFile(unrelatedLegacyFile, 'leave untouched\n', 'utf8'),
    writeFile(execPolicyPath, JSON.stringify({
      rules: [{ action: 'allow', prefix: ['legacy-exec'] }],
    }), 'utf8'),
    writeFile(shellPolicyPath, JSON.stringify({
      rules: [{ action: 'deny', prefix: ['legacy-shell'] }],
    }), 'utf8'),
  ]);
  const pending = newPendingLegacyDataImport(activeRoot, {
    memoryStoragePath: legacyContainer,
    policyPaths: [execPolicyPath, shellPolicyPath],
  });
  await writePendingDataMigration(appDataRoot, pending);
  return {
    appDataRoot,
    activeRoot,
    pending,
    legacyMemoryIndex,
    legacyMemoryIndexPath,
    unrelatedLegacyFile,
  };
}

function migratingCoordinator(
  fixture: MigrationFixture,
  requestRelaunch: () => void,
): DesktopDataRootCoordinator {
  const bootMode: DesktopDataRootBootMode = {
    mode: 'migrating',
    activeRoot: fixture.sourceRoot,
    defaultRoot: fixture.sourceRoot,
    pending: fixture.pending,
  };
  return new DesktopDataRootCoordinator({
    appDataRoot: fixture.appDataRoot,
    bootMode,
    getRuntimeHost: () => null,
    requestRelaunch: async () => requestRelaunch(),
  });
}

function normalCoordinator(
  fixture: MigrationFixture,
  pointer: NonNullable<Extract<DesktopDataRootBootMode, { mode: 'normal' }>['pointer']>,
): DesktopDataRootCoordinator {
  return new DesktopDataRootCoordinator({
    appDataRoot: fixture.appDataRoot,
    bootMode: {
      mode: 'normal',
      activeRoot: fixture.targetRoot,
      defaultRoot: fixture.sourceRoot,
      pointer,
    },
    getRuntimeHost: () => null,
    requestRelaunch: async () => undefined,
  });
}

function legacyImportCoordinator(
  fixture: LegacyImportFixture,
  requestRelaunch: () => void,
): DesktopDataRootCoordinator {
  return new DesktopDataRootCoordinator({
    appDataRoot: fixture.appDataRoot,
    bootMode: {
      mode: 'migrating',
      activeRoot: fixture.activeRoot,
      defaultRoot: fixture.activeRoot,
      pending: fixture.pending,
    },
    getRuntimeHost: () => null,
    requestRelaunch: async () => requestRelaunch(),
  });
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
