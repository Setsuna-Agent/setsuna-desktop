import { access, lstat, mkdir, mkdtemp, readFile, realpath, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { FileWorkspaceProjectStore, MAX_WORKSPACE_IMAGE_BYTES, walkWorkspaceFiles } from './file-workspace-project-store.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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
    const metadata = await store.inspectFile(project.id, 'README.md');
    const readme = await store.readFile(project.id, 'README.md');
    const search = await store.search(project.id, 'needle');
    const written = await store.writeFile(project.id, 'src/generated.txt', 'generated\n');

    expect(project.name).toBe('project');
    expect(status).toMatchObject({ exists: true, readable: true });
    expect(entries.entries.map((entry) => entry.path)).toContain('README.md');
    expect(metadata).toMatchObject({ projectId: project.id, path: 'README.md', size: 21, modifiedAt: expect.any(String) });
    expect(readme.content).toContain('needle');
    expect(readme.preview).toEqual({ kind: 'text' });
    expect(search.results).toMatchObject([{ path: 'README.md', line: 1 }]);
    expect(written).toMatchObject({ path: 'src/generated.txt', created: true });
  });

  it('reads bounded workspace images by file signature', async () => {
    const fixture = await createWorkspaceFixture();
    await writeFile(path.join(fixture.projectDir, 'preview.bin'), ONE_PIXEL_PNG);
    await writeFile(path.join(fixture.projectDir, 'spoofed.png'), 'not an image');
    await writeFile(path.join(fixture.projectDir, 'program.exe'), Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x01, 0x02]));
    const oversizedPath = path.join(fixture.projectDir, 'oversized.png');
    await writeFile(oversizedPath, ONE_PIXEL_PNG);
    await truncate(oversizedPath, MAX_WORKSPACE_IMAGE_BYTES + 1);
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await expect(store.readImage(project.id, 'preview.bin')).resolves.toMatchObject({
      path: 'preview.bin',
      mimeType: 'image/png',
      size: ONE_PIXEL_PNG.byteLength,
      base64: ONE_PIXEL_PNG.toString('base64'),
    });
    await expect(store.readImage(project.id, 'spoofed.png')).rejects.toThrow('Unsupported image format');
    await expect(store.readImage(project.id, 'oversized.png')).rejects.toThrow('workspace limit');
    await expect(store.readImage(project.id, '../outside.txt')).rejects.toThrow('escapes');
    await expect(store.readFile(project.id, 'preview.bin')).resolves.toMatchObject({
      content: '',
      preview: { kind: 'image', mimeType: 'image/png', base64: ONE_PIXEL_PNG.toString('base64') },
      truncated: false,
    });
    await expect(store.readFile(project.id, 'program.exe')).resolves.toMatchObject({
      content: '',
      preview: { kind: 'unsupported', reason: 'binary' },
      truncated: false,
    });
    await expect(store.readFile(project.id, 'oversized.png')).resolves.toMatchObject({
      content: '',
      preview: { kind: 'unsupported', reason: 'image-too-large' },
      truncated: false,
    });
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

  it('isolates conversation workspaces under their local creation date', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    const createdAt = new Date(2026, 6, 18, 12, 0, 0).toISOString();

    const first = await store.ensureTemporaryWorkspace({ threadId: 'thread_first', createdAt });
    const second = await store.ensureTemporaryWorkspace({ threadId: 'thread_second', createdAt });
    await store.writeFile(first.id, 'src/example.ts', 'export const value = 1;\n');
    await store.writeBinaryFile(first.id, 'generated-images/example.png', ONE_PIXEL_PNG);

    expect(first.id).toBe('temporary_workspace.2026-07-18.thread_first');
    expect(first.path).toBe(await realpath(path.join(dataDir, 'temporary-workspace', '2026-07-18', 'thread_first')));
    expect(second.path).toBe(await realpath(path.join(dataDir, 'temporary-workspace', '2026-07-18', 'thread_second')));
    expect(await store.readFile(first.id, 'src/example.ts')).toMatchObject({ content: 'export const value = 1;\n' });
    expect(await store.readImage(first.id, 'generated-images/example.png')).toMatchObject({
      mimeType: 'image/png',
      size: ONE_PIXEL_PNG.byteLength,
    });
    await expect(store.readFile(second.id, 'src/example.ts')).rejects.toThrow();
    expect((await store.listProjects()).projects).toEqual([]);
  });

  it('removes only the selected scoped temporary workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const projectDir = path.join(root, 'formal-project');
    await mkdir(projectDir);
    await writeFile(path.join(projectDir, 'formal.txt'), 'keep formal\n');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    const formalProject = await store.addProject({ path: projectDir });
    const createdAt = new Date(2026, 6, 18, 12, 0, 0).toISOString();
    const scoped = await store.ensureTemporaryWorkspace({ threadId: 'thread_remove', createdAt });
    const sibling = await store.ensureTemporaryWorkspace({ threadId: 'thread_keep', createdAt });
    const legacyMarker = path.join(dataDir, 'temporary-workspace', 'legacy.txt');
    await Promise.all([
      writeFile(path.join(scoped.path, 'delete-me.txt'), 'delete\n'),
      writeFile(path.join(sibling.path, 'keep-me.txt'), 'keep sibling\n'),
      writeFile(legacyMarker, 'keep legacy\n'),
    ]);

    await store.removeTemporaryWorkspace({ threadId: 'thread_remove', createdAt });

    await expect(access(scoped.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(sibling.path, 'keep-me.txt'), 'utf8')).resolves.toBe('keep sibling\n');
    await expect(readFile(legacyMarker, 'utf8')).resolves.toBe('keep legacy\n');
    await expect(readFile(path.join(formalProject.path, 'formal.txt'), 'utf8')).resolves.toBe('keep formal\n');
  });

  it('unlinks a scoped workspace junction without traversing its target', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const temporaryRoot = path.join(dataDir, 'temporary-workspace');
    const dateRoot = path.join(temporaryRoot, '2026-07-18');
    const outside = path.join(root, 'outside-target');
    const scopedLink = path.join(dateRoot, 'thread_link');
    await Promise.all([mkdir(dateRoot, { recursive: true }), mkdir(outside)]);
    await writeFile(path.join(outside, 'sentinel.txt'), 'outside survives\n');
    await symlink(outside, scopedLink, process.platform === 'win32' ? 'junction' : 'dir');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);

    await store.removeTemporaryWorkspace({
      threadId: 'thread_link',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    });

    await expect(lstat(scopedLink)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(outside, 'sentinel.txt'), 'utf8')).resolves.toBe('outside survives\n');
  });

  it('rejects a temporary workspace root junction instead of deleting through it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const linkedRoot = path.join(dataDir, 'temporary-workspace');
    const outside = path.join(root, 'outside-root');
    const outsideScoped = path.join(outside, '2026-07-18', 'thread_target');
    await mkdir(outsideScoped, { recursive: true });
    await writeFile(path.join(outsideScoped, 'sentinel.txt'), 'outside survives\n');
    await mkdir(dataDir, { recursive: true });
    await symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);

    await expect(store.removeTemporaryWorkspace({
      threadId: 'thread_target',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    })).rejects.toThrow('must not be a symbolic link or junction');
    await expect(readFile(path.join(outsideScoped, 'sentinel.txt'), 'utf8')).resolves.toBe('outside survives\n');
  });

  it('rejects a cross-date junction inside the temporary workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const temporaryRoot = path.join(dataDir, 'temporary-workspace');
    const targetDate = path.join(temporaryRoot, '2026-07-17');
    const linkedDate = path.join(temporaryRoot, '2026-07-18');
    const targetWorkspace = path.join(targetDate, 'thread_cross_date');
    await mkdir(targetWorkspace, { recursive: true });
    await writeFile(path.join(targetWorkspace, 'sentinel.txt'), 'other date survives\n');
    await symlink(targetDate, linkedDate, process.platform === 'win32' ? 'junction' : 'dir');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);

    await expect(store.removeTemporaryWorkspace({
      threadId: 'thread_cross_date',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    })).rejects.toThrow('date directory must not be a symbolic link or junction');

    await expect(readFile(path.join(targetWorkspace, 'sentinel.txt'), 'utf8')).resolves.toBe('other date survives\n');
    expect((await lstat(linkedDate)).isSymbolicLink()).toBe(true);
  });

  it('does not materialize or cache an untrusted scoped temporary workspace id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-test-'));
    const dataDir = path.join(root, 'data');
    const store = new FileWorkspaceProjectStore(dataDir, systemClock);
    const untrustedId = 'temporary_workspace.2026-07-17.thread_target';

    await expect(store.getStatus(untrustedId)).resolves.toEqual({ exists: false, readable: false });
    await expect(realpath(path.join(dataDir, 'temporary-workspace', '2026-07-17', 'thread_target')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const workspace = await store.ensureTemporaryWorkspace({
      threadId: 'thread_target',
      createdAt: new Date(2026, 6, 18, 12, 0, 0).toISOString(),
    });
    expect(workspace.id).toBe('temporary_workspace.2026-07-18.thread_target');
  });

  it('rejects paths outside the project root', async () => {
    const fixture = await createWorkspaceFixture();
    const store = new FileWorkspaceProjectStore(fixture.dataDir, systemClock);
    const project = await store.addProject({ path: fixture.projectDir });

    await expect(store.readFile(project.id, '../outside.txt')).rejects.toThrow('escapes');
    await expect(store.inspectFile(project.id, '../outside.txt')).rejects.toThrow('escapes');
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
    await expect(store.inspectFile(project.id, 'linked-secret.txt')).rejects.toThrow('escapes');
    await expect(store.readFile(project.id, 'linked-secret.txt')).rejects.toThrow('escapes');
    await expect(store.readImage(project.id, 'linked-secret.txt')).rejects.toThrow('escapes');
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
