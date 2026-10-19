import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { parsePortableProjectCatalog, portableProjectCatalogSource, stageMergedProjectIndex } from '../../src/main/portable-projects.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('portable project restore', () => {
  it('backs up project icons and restores new projects while preserving existing local choices', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-portable-projects-'));
    temporaryRoots.push(dataRoot);
    await mkdir(path.join(dataRoot, 'runtime'), { recursive: true });
    const project: WorkspaceProject = {
      id: 'local-project', name: 'Agent', path: '/Users/alice/agent',
      icon: { key: 'code', color: 'text' },
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
    };
    await writeFile(path.join(dataRoot, 'runtime', 'projects.json'), JSON.stringify({ version: 1, projects: [project] }));
    const source = await portableProjectCatalogSource(dataRoot, 'conversations');
    const remoteProjects = parsePortableProjectCatalog(source.data!);
    expect(remoteProjects[0]).toEqual({
      id: project.id, name: project.name, icon: project.icon, createdAt: project.createdAt, updatedAt: project.updatedAt,
    });

    const stagingRoot = path.join(dataRoot, 'staging');
    await stageMergedProjectIndex({ dataRoot, stagingRoot, remoteProjects: [
      { ...remoteProjects[0], icon: { key: 'book' } },
      { ...remoteProjects[0], id: 'remote-project', name: 'Website', icon: { key: 'globe', color: '#5688ed' } },
    ] });
    const restored = JSON.parse(await readFile(path.join(stagingRoot, 'runtime', 'projects.json'), 'utf8')) as { projects: WorkspaceProject[] };
    expect(restored.projects[0]).toMatchObject({ id: project.id, path: project.path, icon: project.icon });
    expect(restored.projects[1]).toMatchObject({ name: 'Website', icon: { key: 'globe', color: '#5688ed' } });
    expect(restored.projects[1]).not.toHaveProperty('path');
  });

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
