import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  finalizeCommittedWebDavRestore,
  recoverInterruptedWebDavRestore,
  rollbackCommittedWebDavRestore,
  webDavRestoreJournalPath,
  writeWebDavRestoreJournal,
} from '../../../src/webdav-sync/restore-journal.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDAV restore crash recovery', () => {
  it('rolls an interrupted commit back before Runtime opens the data root', async () => {
    const root = await temporaryRoot();
    const rollbackDirectory = '.webdav-sync-rollback-1455a7df-11ca-4b40-9fd8-f65e3a8846f0';
    await mkdir(path.join(root, 'runtime'), { recursive: true });
    await mkdir(path.join(root, rollbackDirectory, 'runtime'), { recursive: true });
    await writeFile(path.join(root, 'runtime', 'config.json'), '{"value":"partially-restored"}\n');
    await writeFile(path.join(root, rollbackDirectory, 'runtime', 'config.json'), '{"value":"original"}\n');
    await writeWebDavRestoreJournal(root, {
      version: 1,
      phase: 'installing',
      rollbackDirectory,
      categories: ['preferences'],
      targets: [path.join('runtime', 'config.json')],
      existingTargets: [path.join('runtime', 'config.json')],
    });

    await expect(recoverInterruptedWebDavRestore(root)).resolves.toBe('rolled-back');
    expect(await readFile(path.join(root, 'runtime', 'config.json'), 'utf8')).toContain('original');
    await expect(readFile(webDavRestoreJournalPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a committed rollback until the restored Runtime has started successfully', async () => {
    const root = await temporaryRoot();
    const rollbackDirectory = '.webdav-sync-rollback-55bc8840-ac7a-435a-b5a7-88c2e91e7d87';
    await mkdir(path.join(root, 'runtime'), { recursive: true });
    await mkdir(path.join(root, rollbackDirectory, 'runtime'), { recursive: true });
    await writeFile(path.join(root, 'runtime', 'config.json'), '{"value":"restored"}\n');
    await writeFile(path.join(root, rollbackDirectory, 'runtime', 'config.json'), '{"value":"original"}\n');
    await writeWebDavRestoreJournal(root, {
      version: 1,
      phase: 'committed',
      rollbackDirectory,
      categories: ['preferences'],
      targets: [path.join('runtime', 'config.json')],
      existingTargets: [path.join('runtime', 'config.json')],
    });

    await expect(recoverInterruptedWebDavRestore(root)).resolves.toBe('awaiting-validation');
    expect(await readFile(path.join(root, 'runtime', 'config.json'), 'utf8')).toContain('restored');
    expect(await readFile(path.join(root, rollbackDirectory, 'runtime', 'config.json'), 'utf8'))
      .toContain('original');
    await expect(finalizeCommittedWebDavRestore(root)).resolves.toBe(true);
    await expect(readFile(path.join(root, rollbackDirectory, 'runtime', 'config.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finishes cleanup instead of rolling back after Runtime validation was journaled', async () => {
    const root = await temporaryRoot();
    const rollbackDirectory = '.webdav-sync-rollback-64c7ae17-04bf-4e6f-91ec-aec6f90570d9';
    await mkdir(path.join(root, 'runtime'), { recursive: true });
    await mkdir(path.join(root, rollbackDirectory, 'runtime'), { recursive: true });
    await writeFile(path.join(root, 'runtime', 'config.json'), '{"value":"restored"}\n');
    await writeFile(path.join(root, rollbackDirectory, 'runtime', 'config.json'), '{"value":"original"}\n');
    await writeWebDavRestoreJournal(root, {
      version: 1,
      phase: 'validated',
      rollbackDirectory,
      categories: ['preferences'],
      targets: [path.join('runtime', 'config.json')],
      existingTargets: [path.join('runtime', 'config.json')],
    });

    await expect(recoverInterruptedWebDavRestore(root)).resolves.toBe('none');
    expect(await readFile(path.join(root, 'runtime', 'config.json'), 'utf8')).toContain('restored');
    await expect(readFile(webDavRestoreJournalPath(root), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['installing', 'committed'] as const)(
    'refuses a $phase rollback when an expected original target is missing',
    async (phase) => {
      const root = await temporaryRoot();
      const rollbackDirectory = '.webdav-sync-rollback-13cf2860-d745-426a-83d2-bfb6fe5de4a3';
      await mkdir(path.join(root, 'runtime'), { recursive: true });
      await mkdir(path.join(root, rollbackDirectory), { recursive: true });
      await writeFile(path.join(root, 'runtime', 'config.json'), '{"value":"restored"}\n');
      await writeWebDavRestoreJournal(root, {
        version: 1,
        phase,
        rollbackDirectory,
        categories: ['preferences'],
        targets: [path.join('runtime', 'config.json')],
        existingTargets: [path.join('runtime', 'config.json')],
      });

      await expect(rollbackCommittedWebDavRestore(root)).rejects.toThrow('回滚数据不完整');
      expect(await readFile(path.join(root, 'runtime', 'config.json'), 'utf8')).toContain('restored');
      await expect(readFile(webDavRestoreJournalPath(root), 'utf8')).resolves.toContain(phase);
    },
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-journal-'));
  temporaryRoots.push(root);
  return root;
}
