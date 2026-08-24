import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stageMergedProjectIndex } from '../../src/main/portable-projects.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('portable project restore', () => {
  it('preserves an active local project when the matching backup project is archived', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-portable-projects-'));
    temporaryRoots.push(dataRoot);
    await mkdir(path.join(dataRoot, 'runtime'), { recursive: true });
    await writeFile(path.join(dataRoot, 'runtime', 'projects.json'), `${JSON.stringify({
      version: 1,
      projects: [{
        id: 'local-project',
        name: 'Agent',
        path: '/Users/alice/agent',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      }],
    })}\n`, 'utf8');
    const stagingRoot = path.join(dataRoot, 'staging');

    await stageMergedProjectIndex({
      dataRoot,
      stagingRoot,
      remoteProjects: [{
        id: 'remote-project',
        name: 'Agent',
        archivedAt: '2026-08-08T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
      }],
    });

    const restored = JSON.parse(
      await readFile(path.join(stagingRoot, 'runtime', 'projects.json'), 'utf8'),
    ) as { projects: Array<{ id: string; path?: string; archivedAt?: string }> };
    expect(restored.projects[0]).toMatchObject({
      id: 'local-project',
      path: '/Users/alice/agent',
    });
    expect(restored.projects[0]?.archivedAt).toBeUndefined();
  });
});
