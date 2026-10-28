import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { stageMergedProjectIndex } from '../../src/main/portable-projects.js';

it('remaps restored following references while preserving reused local defaults', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-project-defaults-'));
  try {
    const base = { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' };
    const local = { ...base, id: 'local-source', name: 'Source', conversationDefaults: { skillIds: ['local-skill'] } };
    const follower = { ...base, id: 'local-follower', name: 'Local follower', conversationDefaults: { sourceProjectId: local.id } };
    await mkdir(path.join(dataRoot, 'runtime'), { recursive: true });
    await writeFile(path.join(dataRoot, 'runtime', 'projects.json'), JSON.stringify({ version: 1, projects: [local, follower] }));
    const stagingRoot = path.join(dataRoot, 'staging');
    await stageMergedProjectIndex({ dataRoot, stagingRoot, remoteProjects: [
      { ...base, id: 'remote-follower', name: 'New follower', conversationDefaults: { sourceProjectId: 'remote-source' } },
      { ...base, id: 'remote-source', name: local.name, conversationDefaults: { skillIds: ['remote-skill'] } },
      { ...base, id: 'remote-local-follower', name: follower.name, conversationDefaults: {} },
    ] });
    const { projects } = JSON.parse(await readFile(path.join(stagingRoot, 'runtime', 'projects.json'), 'utf8')) as { projects: WorkspaceProject[] };
    expect(projects.find((project) => project.name === 'New follower')?.conversationDefaults).toEqual({ sourceProjectId: local.id });
    expect(projects.find((project) => project.id === follower.id)?.conversationDefaults).toEqual(follower.conversationDefaults);
    expect(projects.find((project) => project.id === local.id)?.conversationDefaults).toEqual(local.conversationDefaults);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
