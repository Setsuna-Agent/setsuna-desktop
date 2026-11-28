import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceTemporaryDirectoryPrefix, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { createDesignDocument, designDirectoryGrant, designDirectoryGrants, designPackageImportStagingPrefix, designPackageStagingFile, designPackageStagingPrefix,
  type DesignWorkspace } from '@setsuna-desktop/feature-design/contracts';
import { installDesignPackage } from '../../../src/adapters/workspace/design-package-import.js';
import { designStorageDirectories } from '../../../src/adapters/workspace/design-storage-directories.js';
import { createDesignWorkspaceFiles } from '../../../src/adapters/workspace/design-workspace-files.js';
import { moveDesignWorkspaceDocument } from '../../../src/adapters/workspace/design-workspace-document-mutations.js';
import { createDesignResourceOwnership } from '../../../src/adapters/workspace/design-workspace-resource-root.js';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function workspace() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-design-files-')));
  temporary.push(directory);
  const root = path.join(directory, 'project');
  const data = path.join(directory, 'state');
  await mkdir(root);
  const projects = new FileWorkspaceProjectStore(data, systemClock);
  const project = await projects.addProject({ path: root });
  return { root, directory, data, projects, projectId: project.id, signal: new AbortController().signal };
}

const draft = (documentId: string, libraries?: Record<string, string>) =>
  JSON.stringify({ schemaVersion: 1, documentId, rootIds: [], nodes: {}, libraries });

it('releases the workspace lock during export and discards an archive when an already-copied dependency changes', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const ticket = randomUUID();
  const staging = path.join(data, designPackageStagingPrefix + ticket);
  const ref = { projectId, path: 'board.design.json' };
  const documentId = 'board';
  const source = draft(documentId, { first: 'first.design.json', second: 'second.design.json' });
  const expectedRevision = createHash('sha256').update(source).digest('hex');
  await mkdir(staging, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, ref.path), source),
    writeFile(path.join(root, 'first.design.json'), draft('first')),
    writeFile(path.join(root, 'second.design.json'), draft('second', { 'setsuna-library-beui-bundled': 'builtin:beui' })),
  ]);
  const files = createDesignWorkspaceFiles(projects, data);
  let markEntered!: () => void;
  let releaseArchive!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { releaseArchive = resolve; });
  const preparation = files.preparePackage({ ref, documentId, expectedRevision, ticket }, async () => {
    markEntered();
    await released;
    return 'builtin-revision';
  }, signal);
  const conflict = expect(preparation).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  try {
    await entered;
    await expect(files.withDocument(ref, signal, (file) => file.read())).resolves.toMatchObject({ revision: expectedRevision });
    await writeFile(path.join(root, 'first.design.json'), draft('first') + '\n');
  } finally {
    releaseArchive();
  }
  await conflict;
  await expect(stat(path.join(staging, designPackageStagingFile))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('leaves a replacement import directory intact and removes the unused grant and bindings', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const ticket = randomUUID();
  const incoming = path.join(data, designPackageImportStagingPrefix + ticket);
  const entry = 'board.design.json';
  const folder = path.join(root, 'Copy');
  const content = path.join(folder, 'content');
  await mkdir(incoming, { recursive: true });
  await writeFile(path.join(incoming, designPackageStagingFile), zipSync({
    'manifest.json': Buffer.from(JSON.stringify({ formatVersion: 1, resourceRoot: 'content', entry: 'content/' + entry })),
    ['content/' + entry]: Buffer.from(draft('board')),
  }));
  const storage = designStorageDirectories(data, projects);
  const ownership = createDesignResourceOwnership(data);
  const withGrant = storage.withNewDirectoryGrant;
  vi.spyOn(storage, 'withNewDirectoryGrant').mockImplementationOnce((target, install) => withGrant(target, async () => {
    // A project sync renames the reserved folder after registration but before publication.
    await rename(folder, path.join(root, 'Moved'));
    await mkdir(folder);
    await writeFile(path.join(folder, 'notes.txt'), 'keep');
    await install();
  }));
  await expect(installDesignPackage(data, root, { ticket, destination: { scope: { projectId }, name: 'Copy' } },
    { storage, ownership }, signal)).rejects.toThrow('directory has changed');
  expect(await readdir(folder)).toEqual(['notes.txt']);
  expect(await readFile(path.join(folder, 'notes.txt'), 'utf8')).toBe('keep');
  expect(await storage.list()).not.toContainEqual(await designDirectoryGrant(content));
  expect(await ownership.project(path.join(content, entry), 'board')).toBeUndefined();
});

it('returns a watchable local directory before the first draft is saved', async () => {
  const { data, projects, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const root = path.join(data, 'designs');
  await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  const { directories } = await files.catalog(signal);
  expect(directories).toContainEqual({ id: 'local', path: root });
  expect((await stat(root)).isDirectory()).toBe(true);
});

it('keeps package assets when their saved resource directory loses its grant after review', async () => {
  const { data, projects, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const ticket = randomUUID();
  const incoming = path.join(data, designPackageImportStagingPrefix + ticket);
  const board = { schemaVersion: 1, documentId: 'board', libraries: { library: 'A.design.json' }, rootIds: ['photo'],
    nodes: { photo: { kind: 'image', x: 0, y: 0, width: 1, height: 1, fit: 'contain', assetPath: 'photo.png' } } };
  const png = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
  await mkdir(incoming, { recursive: true });
  await writeFile(path.join(incoming, designPackageStagingFile), zipSync({
    'manifest.json': Buffer.from(JSON.stringify({ formatVersion: 1, resourceRoot: 'content', entry: 'content/Z.design.json' })),
    'content/Z.design.json': Buffer.from(JSON.stringify(board)), 'content/A.design.json': Buffer.from(draft('library')),
    'content/photo.png': png,
  }));
  const ref = await files.importPackage({ ticket, destination: { scope: { storageId: 'local' }, name: 'Copy' } }, signal);
  const content = path.join(data, 'designs', 'Copy', 'content');
  await writeFile(path.join(content, 'later.png'), png);
  const inventory = await files.listLocalFiles(signal);
  expect(inventory.incomplete).toBe(false);
  expect(inventory.files).toContainEqual(expect.objectContaining({ path: 'Copy/content/Z.design.json', libraryPaths: ['Copy/content/A.design.json'] }));
  const candidates = inventory.files.filter((file) => file.kind === 'asset');
  expect(candidates.map((file) => file.path)).toEqual(['Copy/content/later.png']);

  await writeFile(path.join(content, 'A.design.json'), draft('replacement'));
  const replaced = (await files.listLocalFiles(signal)).files.find((file) => file.path === 'Copy/content/Z.design.json');
  expect(replaced).toBeDefined();
  expect(replaced).not.toHaveProperty('libraryPaths');
  board.nodes.photo.assetPath = 'later.png';
  await writeFile(path.join(content, ref.path), JSON.stringify(board));
  await rm(path.join(data, designDirectoryGrants, ref.storageId + '.json'));
  const next = await files.listLocalFiles(signal);
  expect(next.incomplete).toBe(true);
  expect(next.files.filter((file) => file.kind === 'asset')).toEqual([]);
  await expect(files.removeUnusedAssets(candidates, signal)).resolves.toEqual(['Copy/content/later.png']);
  expect(await readFile(path.join(content, 'later.png'))).toEqual(png);
});

it('excludes unpublished import files from both the inventory and deletion recheck', async () => {
  const { data, projects, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const local = path.join(data, 'designs');
  const source = path.join(local, 'images');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'photo.png'), 'unpacked image');
  await writeFile(path.join(source, 'board.design.json'), draft('unpublished'));
  const { files: inventory } = await files.listLocalFiles(signal);
  const asset = inventory.find((file) => file.kind === 'asset')!;
  const document = inventory.find((file) => file.kind === 'document')!;
  const staging = await mkdtemp(path.join(local, workspaceTemporaryDirectoryPrefix));
  // Moving the containing directory preserves the reviewed asset's identity and revision.
  await rename(source, path.join(staging, 'images'));
  const stagedAsset = path.basename(staging) + '/' + asset.path;
  const stagedDraft = path.basename(staging) + '/' + document.path;
  await expect(files.listLocalFiles(signal)).resolves.toEqual({ files: [], incomplete: false });
  await expect(files.removeUnusedAssets([{ path: stagedAsset, revision: asset.revision }], signal)).resolves.toEqual([stagedAsset]);
  await expect(files.delete({ storageId: 'local', path: stagedDraft, expectedRevision: document.revision }, signal))
    .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(await readFile(path.join(local, stagedAsset), 'utf8')).toBe('unpacked image');
  expect(await readFile(path.join(local, stagedDraft), 'utf8')).toBe(draft('unpublished'));
});

it('keeps healthy drafts accessible while reporting and excluding invalid directory grants', async ({ onTestFinished }) => {
  const { root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const grants = path.join(data, designDirectoryGrants);
  const valid = await designDirectoryGrant(root);
  const invalidJson = 'a'.repeat(64);
  const relativePath = 'b'.repeat(64);
  await mkdir(grants);
  await Promise.all([
    writeFile(path.join(grants, valid.id + '.json'), JSON.stringify(valid.path)),
    writeFile(path.join(grants, invalidJson + '.json'), '{'),
    writeFile(path.join(grants, relativePath + '.json'), JSON.stringify('relative')),
  ]);

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  onTestFinished(() => warn.mockRestore());
  const local = { id: 'local', path: path.join(data, 'designs') };
  expect((await files.catalog(signal)).directories).toEqual([local, valid]);
  for (const storageId of [invalidJson, relativePath]) {
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(storageId + '.json'));
    await expect(files.list({ storageId }, signal)).rejects.toThrow();
  }

  const name = 'board.design.json';
  const read = (scope: DesignWorkspace) => files.withDocument({ ...scope, path: name }, signal, (file) => file.read());
  await writeFile(path.join(local.path, name), draft('local'));
  await writeFile(path.join(root, name), draft('project'));
  await expect(read({ storageId: 'local' })).resolves.toMatchObject({ content: draft('local') });
  await expect(read({ projectId })).resolves.toMatchObject({ content: draft('project') });
});

it('updates the catalog when a regular design is replaced by a preset file at the same path', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const pathName = 'Shared.design.json';
  const target = path.join(root, pathName);
  await writeFile(target, draft('setsuna-library-shadcn-ui-brand'));
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: pathName }]);
  const replacement = path.join(root, 'replacement.json');
  await writeFile(replacement, draft('setsuna-library-shadcn-ui-123e4567-e89b-42d3-a456-426614174000'));
  await rename(replacement, target);
  await expect(files.listEntries({ projectId }, signal)).resolves.toEqual([]);
  await writeFile(target, draft('setsuna-library-brand'));
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: pathName }]);
});

it('lists a cached association only while the original path holds a valid draft with the bound ID', async () => {
  const { directory, root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const file = path.join(root, 'linked.design.json');
  const binding = { file, projectId };
  const associations = async () => (await files.catalog(signal)).associations;
  const modified = new Date('2025-01-01T00:00:00Z');
  await writeFile(file, draft('first'));
  await utimes(file, modified, modified);
  await createDesignResourceOwnership(data).setProject(file, 'first', root, projectId);
  await expect(associations()).resolves.toEqual([binding]);

  // The replacement has the same size and modification time.
  const replacement = path.join(root, 'replacement.json');
  await writeFile(replacement, draft('other'));
  await utimes(replacement, modified, modified);
  await rename(replacement, file);
  await expect(associations()).resolves.toEqual([]);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, documentId: 'first', rootIds: ['missing'], nodes: {} }));
  await expect(associations()).resolves.toEqual([]);
  await writeFile(file, draft('first'));
  await expect(associations()).resolves.toEqual([binding]);

  // Redirecting the parent leaves the file's own identity and timestamps intact.
  const moved = path.join(directory, 'moved');
  await rename(root, moved);
  await symlink(moved, root, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(associations()).resolves.toEqual([]);
});

it('classifies late, escaped root IDs without mistaking layer data for a preset', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const presetId = 'setsuna-library-beui-123e4567-e89b-42d3-a456-426614174000';
  const ordinaryId = 'setsuna-library-beui-brand';
  function withLateId(id: string, nestedId: string) {
    const body = JSON.stringify({ schemaVersion: 1, rootIds: ['label'], nodes: { label: {
      kind: 'text', x: 0, y: 0, width: 180, fontSize: 14, documentId: nestedId, text: 'Layer { "text" } \\ '.repeat(2000),
    } } });
    return `${body.slice(0, -1)}, "document\\u0049d": ${JSON.stringify(id)}}`;
  }
  const normal = 'Normal.design.json';
  const preset = 'Renamed preset.design.json';
  await Promise.all([
    writeFile(path.join(root, normal), withLateId(ordinaryId, presetId)),
    writeFile(path.join(root, preset), withLateId(presetId, ordinaryId)),
  ]);
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: normal }]);
  await expect(files.listEntries({ projectId, includePreviewMetadata: true }, signal)).resolves.toMatchObject([
    { path: normal, revision: expect.any(String) }, { path: preset, revision: expect.any(String), libraryPreset: true },
  ]);
});

it('allocates different numbered names for concurrent creates and preserves the existing draft', async () => {
  const { data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const input = { storageId: 'local', parentPath: '.', name: '新建设计稿.design.json' };
  const original = createDesignDocument.input.parse(input);
  await files.create(original, draft('original'), signal);
  await expect(files.create(original, draft('conflict'), signal)).rejects.toMatchObject({ code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE });

  const numbered = createDesignDocument.input.parse({ ...input, autoNumber: true, linkedProjectId: projectId });
  const created = await Promise.all([files.create(numbered, draft('first'), signal), files.create(numbered, draft('second'), signal)]);
  expect(created.map(({ path }) => path).sort()).toEqual(['新建设计稿 2.design.json', '新建设计稿 3.design.json']);
  await expect(readFile(path.join(data, 'designs', input.name), 'utf8')).resolves.toBe(draft('original'));
  const linked = await files.projectDesigns(projectId, signal);
  expect(linked).toHaveLength(2);
  expect(linked).toEqual(expect.arrayContaining(created.map(({ path }, index) => ({
    ref: { storageId: 'local', path }, documentId: index === 0 ? 'first' : 'second',
  }))));
});

it.skipIf(process.platform === 'win32')('moves and deletes the listed macOS filename without touching its nested namesake', async () => {
  const { root, directory, data, projects, projectId, signal } = await workspace();
  const target = path.join(directory, 'target');
  await Promise.all([mkdir(path.join(root, 'a')), mkdir(target)]);
  const destination = await projects.addProject({ path: target });
  const files = createDesignWorkspaceFiles(projects, data);
  const flat = 'a\\b.design.json';
  const nested = 'a/b.design.json';
  await Promise.all([writeFile(path.join(root, flat), draft('flat')), writeFile(path.join(root, nested), draft('nested'))]);
  expect(await files.list({ projectId }, signal)).toEqual(expect.arrayContaining([flat, nested]));
  const byName = await projects.searchEntries(projectId, flat);
  expect(byName.entries.map(({ path }) => path)).toEqual([flat]);
  const byContent = await projects.search(projectId, '"flat"');
  expect(byContent.results.map(({ path }) => path)).toEqual([flat]);
  await expect(projects.readFile(projectId, byContent.results[0].path)).resolves.toMatchObject({ content: draft('flat') });
  const moved = await files.move({ ref: { projectId, path: flat }, destination: { projectId: destination.id } }, signal);
  expect(moved.path).toBe(flat);
  await expect(readFile(path.join(target, flat), 'utf8')).resolves.toBe(draft('flat'));
  await files.move({ ref: moved, destination: { projectId } }, signal);
  await files.delete({ projectId, path: flat }, signal);
  await expect(readFile(path.join(root, flat))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, nested), 'utf8')).resolves.toBe(draft('nested'));
});

it.each(['removed', 'replaced', 'edited'] as const)('keeps the source when the destination draft is %s before the move commits', async (change) => {
  const { root, directory, data, signal } = await workspace();
  const destination = path.join(directory, 'destination');
  const name = 'board.design.json';
  const original = draft('source');
  await mkdir(destination);
  await writeFile(path.join(root, name), original);
  const ownership = createDesignResourceOwnership(data);
  const move = moveDesignWorkspaceDocument(root, name, destination, [root, destination], { ...ownership,
    async remember(file, id, location) {
      const added = await ownership.remember(file, id, location);
      if (change === 'removed') await rm(file);
      if (change === 'edited') await writeFile(file, draft('edited'));
      if (change === 'replaced') {
        const replacement = path.join(directory, 'replacement');
        await writeFile(replacement, original);
        await rename(replacement, file);
      }
      return added;
    },
  }, signal);
  await expect(move).rejects.toMatchObject({ code: change === 'removed' ? 'DESIGN_NOT_FOUND' : 'REVISION_CONFLICT' });
  await expect(readFile(path.join(root, name), 'utf8')).resolves.toBe(original);
  const copy = readFile(path.join(destination, name), 'utf8');
  if (change === 'removed') await expect(copy).rejects.toMatchObject({ code: 'ENOENT' });
  else await expect(copy).resolves.toBe(change === 'edited' ? draft('edited') : original);
});

it('rolls back its copies while preserving externally edited and replaced destination files', async () => {
  const { root, directory, data, signal } = await workspace();
  const target = path.join(directory, 'target');
  await mkdir(target);
  const libraries = { unchanged: 'first.design.json', edited: 'second.design.json', replaced: 'third.design.json', conflict: 'last.design.json' };
  const main = 'main.design.json';
  await writeFile(path.join(root, main), draft('main', libraries));
  for (const [id, filename] of Object.entries(libraries)) await writeFile(path.join(root, filename), draft(id));
  await writeFile(path.join(target, libraries.conflict), draft('preexisting'));
  const ownership = createDesignResourceOwnership(data);
  const edited = draft('edited', { another: 'another.design.json' });
  const move = moveDesignWorkspaceDocument(root, main, target, [root, target], { ...ownership,
    async remember(file, id, location) {
      const added = await ownership.remember(file, id, location);
      if (id === 'replaced') {
        await writeFile(path.join(target, libraries.edited), edited);
        const replacement = path.join(target, 'replacement.tmp');
        await writeFile(replacement, draft(id));
        await rename(replacement, file);
      }
      return added;
    },
  }, signal);
  await expect(move).rejects.toMatchObject({ code: 'workspace_entry_exists' });
  await expect(readFile(path.join(target, libraries.unchanged))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(target, libraries.edited), 'utf8')).resolves.toBe(edited);
  await expect(readFile(path.join(target, libraries.replaced), 'utf8')).resolves.toBe(draft('replaced'));
  await expect(readFile(path.join(root, main), 'utf8')).resolves.toBe(draft('main', libraries));
});
