import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore, walkWorkspaceFiles } from './file-workspace-project-store.js';

describe('file workspace project store', () => {
  it('serializes concurrent project additions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const alpha = path.join(root, 'alpha');
    const beta = path.join(root, 'beta');
    await Promise.all([mkdir(alpha), mkdir(beta)]);
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);

    await Promise.all([store.addProject({ path: alpha }), store.addProject({ path: beta })]);

    expect((await store.listProjects()).projects.map((project) => project.name).sort()).toEqual(['alpha', 'beta']);
  });

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

  it('archives a project without losing its identity when the same path is added again', async () => {
    const fixture = await createWorkspaceFixture();
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await store.archiveProject(project.id);
    expect((await store.listProjects()).projects).toEqual([]);

    const restored = await store.addProject({ path: fixture.projectDir });
    expect(restored.id).toBe(project.id);
    expect(restored.archivedAt).toBeUndefined();
    expect((await store.listProjects()).projects).toMatchObject([{ id: project.id }]);
  });

  it('provides a hidden temporary workspace when no project is selected', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);

    const status = await store.getStatus();
    const written = await store.writeFile(status.project!.id, 'notes/draft.txt', 'temporary\n');

    expect(status).toMatchObject({
      exists: true,
      readable: true,
      project: { id: 'temporary_workspace', name: '临时目录' },
    });
    expect((await store.listProjects()).projects).toEqual([]);
    expect(await store.readFile(status.project!.id, written.path)).toMatchObject({ content: 'temporary\n' });
  });

  it('rejects paths outside the project root', async () => {
    const fixture = await createWorkspaceFixture();
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await expect(store.readFile(project.id, '../outside.txt')).rejects.toThrow('escapes');
    await expect(store.writeFile(project.id, '../outside.txt', 'outside')).rejects.toThrow('escapes');
  });

  it.skipIf(process.platform === 'win32')('does not search through file symlinks outside the project', async () => {
    const fixture = await createWorkspaceFixture();
    const outsideSecret = path.join(path.dirname(fixture.projectDir), 'outside-secret.txt');
    await writeFile(outsideSecret, 'SYMLINK_SECRET_NEEDLE\n', 'utf8');
    await symlink(outsideSecret, path.join(fixture.projectDir, 'linked-secret.txt'));
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await expect(store.search(project.id, 'SYMLINK_SECRET_NEEDLE')).resolves.toMatchObject({ results: [] });
    await expect(store.readFile(project.id, 'linked-secret.txt')).rejects.toThrow('escapes');
  });

  it('lists every direct child instead of applying the fuzzy-search result limit', async () => {
    const fixture = await createWorkspaceFixture();
    await Promise.all(
      Array.from({ length: 90 }, (_, index) =>
        writeFile(path.join(fixture.projectDir, `match-${String(index).padStart(3, '0')}.txt`), 'fixture\n'),
      ),
    );
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    const directory = await store.searchEntries(project.id, '', '');
    const search = await store.searchEntries(project.id, 'match-');

    expect(directory.entries.filter((entry) => entry.name.startsWith('match-'))).toHaveLength(90);
    expect(directory.truncated).toBe(false);
    expect(search.entries).toHaveLength(80);
    expect(search.truncated).toBe(true);
  });

  it('propagates an early-stop signal out of nested directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-walk-test-'));
    await Promise.all([
      mkdir(path.join(root, 'first'), { recursive: true }),
      mkdir(path.join(root, 'second'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, 'first', 'one.txt'), 'one\n'),
      writeFile(path.join(root, 'second', 'two.txt'), 'two\n'),
    ]);
    const visited: string[] = [];

    const completed = await walkWorkspaceFiles(root, async (filePath) => {
      visited.push(filePath);
      return false;
    });

    expect(completed).toBe(false);
    expect(visited).toHaveLength(1);
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
