import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore } from './file-workspace-project-store.js';

describe('file workspace project store', () => {
  it('adds a project and exposes local file operations', async () => {
    const fixture = await createWorkspaceFixture();
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);

    const project = await store.addProject({ path: fixture.projectDir });
    const status = await store.getStatus(project.id);
    const entries = await store.listEntries(project.id);
    const readme = await store.readFile(project.id, 'README.md');
    const search = await store.search(project.id, 'needle');
    const written = await store.writeFile(project.id, 'src/generated.txt', 'generated\n');

    expect(project.name).toBe('project');
    expect(status).toMatchObject({ exists: true, readable: true });
    expect(entries.entries.map((entry) => entry.path)).toContain('README.md');
    expect(readme.content).toContain('needle');
    expect(search.results).toMatchObject([{ path: 'README.md', line: 1 }]);
    expect(written).toMatchObject({ path: 'src/generated.txt', created: true });
  });

  it('rejects paths outside the project root', async () => {
    const fixture = await createWorkspaceFixture();
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await expect(store.readFile(project.id, '../outside.txt')).rejects.toThrow('escapes');
    await expect(store.writeFile(project.id, '../outside.txt', 'outside')).rejects.toThrow('escapes');
  });
});

async function createWorkspaceFixture(): Promise<{ dataDir: string; projectDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  await mkdir(path.join(projectDir, 'src'), { recursive: true });
  await writeFile(path.join(projectDir, 'README.md'), 'needle in a haystack\n');
  await writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'outside.txt'), 'outside\n');
  return { dataDir, projectDir };
}
