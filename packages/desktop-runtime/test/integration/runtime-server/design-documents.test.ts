import { workspaceFilePathKey, workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDocumentVersion, type DesignDocumentRef, type DesignEdit, type DesignSnapshot } from '@setsuna-desktop/feature-design/contracts';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

it('moves and deletes a design in the chosen root while preserving shared resources', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    const primary = path.join(harness.runtimeDataDir, 'primary');
    const target = path.join(harness.runtimeDataDir, 'target');
    await Promise.all([path.join(source, 'drafts'), path.join(source, 'assets'), path.join(source, 'libraries'),
      primary, path.join(target, 'assets')].map((directory) => mkdir(directory, { recursive: true })));
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const from: WorkspaceProject = await post('/v1/projects', { name: 'Source', path: source });
    const to: WorkspaceProject = await post('/v1/projects', { name: 'Destination', roots: [{ path: primary }, { path: target }] });
    const ref = { projectId: from.id, path: 'drafts/screen.design.json' };
    const destination = { projectId: to.id, rootId: workspaceProjectRoots(to)[1].id };
    const route = '/v1/features/design/documents';
    const move = () => post(`${route}/move`, { ref, destination });
    const remove = (ref: DesignDocumentRef) => harness.runtimeFetch(`${route}?${new URLSearchParams(ref)}`, { method: 'DELETE' });
    const library = 'libraries/photo.design.json';
    const foundation = 'libraries/foundation.design.json';
    const photo = 'assets/photo.png';
    const override = 'assets/replacement.png';
    const texture = 'assets/shader-texture.png';
    const shaderSource = `precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
void main() { gl_FragColor = texture2D(u_texture, gl_FragCoord.xy / u_resolution); }`;
    const box = { x: 0, y: 0, width: 96, height: 64 };
    const original = JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'screen', libraries: { photos: library },
      rootIds: ['instance'], nodes: { instance: { ...box, kind: 'frame', childIds: [], instanceOf: 'photos:card',
        contentOverrides: { 'photos:image': { kind: 'image', assetPath: override } } } } }, null, 2);
    const sourceAsset = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
    await writeFile(path.join(source, ref.path), original);
    const shaderRoute = '/v1/features/design/shaders';
    const shaderPath: string = await post(shaderRoute, { ref, name: 'texture.glsl', source: shaderSource });
    await expect(post(shaderRoute, { ref, name: 'texture.glsl', source: shaderSource })).resolves.toBe(shaderPath);
    const shader = { assetPath: shaderPath, uniforms: { u_texture: { kind: 'image', assetPath: texture } } };
    await Promise.all([
      writeFile(path.join(source, library), JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'photos',
        libraries: { foundation }, rootIds: ['card'], nodes: { card: { ...box, kind: 'frame', component: true, childIds: ['image'] },
          image: { ...box, kind: 'image', assetPath: photo } } })),
      writeFile(path.join(source, foundation), JSON.stringify({ schemaVersion: 1, documentId: 'foundation', rootIds: [], nodes: {} })),
      writeFile(path.join(source, photo), sourceAsset), writeFile(path.join(source, override), sourceAsset),
      writeFile(path.join(source, texture), sourceAsset),
      writeFile(path.join(target, photo), 'destination file'),
    ]);
    const libraryRef = { projectId: from.id, path: library };
    const librarySnapshot: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams(libraryRef)}`);
    await post(`${route}/edits`, { ref: libraryRef, expectedRevision: librarySnapshot.revision,
      edits: [{ kind: 'update', nodeId: 'card', node: { ...librarySnapshot.document.nodes.card, fills: [{ color: '#000000', shader }] } }] });
    const consumer = { projectId: from.id, path: 'consumer.design.json' };
    await writeFile(path.join(source, consumer.path), JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'consumer', rootIds: [], nodes: {},
      libraries: { screen: ref.path } }));
    await expect(move()).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    await expect(remove(ref)).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    const { revision }: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams(consumer)}`);
    await post(`${route}/edits`, { ref: consumer, expectedRevision: revision, edits: [{ kind: 'unlinkLibrary', documentId: 'screen' }] });

    await expect(move()).rejects.toThrow('workspace_entry_exists');
    expect(await readFile(path.join(source, ref.path), 'utf8')).toBe(original);
    expect(await readdir(path.join(target, 'assets'))).toEqual(['photo.png']);
    expect(await readFile(path.join(target, photo), 'utf8')).toBe('destination file');

    await writeFile(path.join(target, photo), sourceAsset);
    const moved: DesignDocumentRef = await move();
    expect(moved).toEqual({ ...destination, path: 'screen.design.json' });
    const opened: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams(moved)}`);
    expect(opened.document).toMatchObject({ documentId: 'screen', libraries: { photos: library } });
    expect(await readFile(path.join(target, moved.path), 'utf8')).toBe(original);
    expect(await readdir(path.join(source, 'drafts'))).toEqual([]);
    expect(await readdir(primary)).toEqual([]);
    await expect(harness.runtimeFetch(`${shaderRoute}?${new URLSearchParams({ ...moved, shaderPath })}`)).resolves.toBe(shaderSource);
    const movedLibrary: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams({ ...moved, path: library })}`);
    expect(movedLibrary.document.nodes.card).toMatchObject({ fills: [{ shader }] });
    await remove(moved);
    await expect(harness.runtimeFetch(`${route}?${new URLSearchParams(moved)}`)).rejects.toThrow('DESIGN_NOT_FOUND');
    for (const resource of [library, foundation, photo, override, shaderPath, texture]) {
      expect(await readFile(path.join(target, resource))).toEqual(await readFile(path.join(source, resource)));
    }
  } finally {
    await harness.close();
  }
});

it.each(['first script', 'archived parent'] as const)('reopens a legacy draft in its editing root when both roots contain the script (%s)', async (scenario) => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const outer = path.join(harness.runtimeDataDir, 'outer');
    const inner = path.join(outer, 'inner');
    await mkdir(inner, { recursive: true });
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const [parent, child]: WorkspaceProject[] = await Promise.all([outer, inner].map((path) => post('/v1/projects', { path })));
    const ref = { projectId: child.id, path: 'legacy.design.json' };
    const route = '/v1/features/design/documents';
    const scriptPath = 'plot.js';
    const plot = { kind: 'script' as const, scriptPath, x: 0, y: 0, width: 32, height: 32 };
    const archived = scenario === 'archived parent';
    const legacy = { schemaVersion: 1, documentId: 'legacy', rootIds: archived ? ['plot'] : [], nodes: archived ? { plot } : {} };
    await Promise.all([writeFile(path.join(inner, ref.path), JSON.stringify(legacy)),
      writeFile(path.join(outer, scriptPath), 'return [];'), writeFile(path.join(inner, scriptPath), 'return [];')]);
    if (archived) await post(`/v1/projects/${parent.id}/archive`, {});
    const opened: DesignDocumentRef = await harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(ref)}`);
    const { revision }: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams(opened)}`);
    const edit: DesignEdit = archived ? { kind: 'update', nodeId: 'plot', node: { ...plot, name: 'Saved' } }
      : { kind: 'insert', nodeId: 'plot', parentId: null, node: plot };
    await post(`${route}/edits`, { ref: opened, expectedRevision: revision, edits: [edit] });
    if (archived) await post('/v1/projects', { path: outer });
    const fromParent = { projectId: parent.id, path: `inner/${ref.path}` };
    await expect(harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(fromParent)}`)).resolves.toMatchObject(ref);
  } finally { await harness.close(); }
});

it('protects libraries shared through overlapping roots and resolves the resource root from the draft references', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const parent = path.join(harness.runtimeDataDir, 'parent');
    const child = path.join(parent, 'child');
    const destinationPath = path.join(harness.runtimeDataDir, 'destination');
    await Promise.all([child, destinationPath, path.join(parent, 'design-assets')].map((directory) => mkdir(directory, { recursive: true })));
    await symlink(child, path.join(parent, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const [outer, inner, destination]: WorkspaceProject[] = await Promise.all([
      post('/v1/projects', { name: 'Parent', path: parent }),
      post('/v1/projects', { name: 'Child', path: child }),
      post('/v1/projects', { name: 'Destination', path: destinationPath }),
    ]);
    const ref = { projectId: inner.id, path: 'shared.design.json' };
    const parentRef = { projectId: outer.id, rootId: workspaceProjectRoots(outer)[0].id, path: `child/${ref.path}` };
    const scriptPath = 'design-assets/chart.js';
    const route = '/v1/features/design/documents';
    const draft = { schemaVersion: designDocumentVersion, documentId: 'shared', rootIds: ['chart'], nodes: {
      chart: { kind: 'script', x: 0, y: 0, width: 64, height: 64, scriptPath },
    } };
    const consumer = { schemaVersion: designDocumentVersion, documentId: 'consumer', rootIds: [], nodes: {} };
    await Promise.all([
      writeFile(path.join(child, ref.path), JSON.stringify(draft)),
      writeFile(path.join(parent, scriptPath), '/** @input width: number = 12 */\nreturn [];'),
      writeFile(path.join(parent, 'consumer.design.json'), JSON.stringify({ ...consumer, libraries: { shared: `alias/${ref.path}` } })),
    ]);

    const resolved: DesignDocumentRef = await harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(ref)}`);
    expect(resolved).toEqual(parentRef);
    await expect(harness.runtimeFetch(`/v1/features/design/scripts/parameters?${new URLSearchParams({ ...resolved, scriptPath })}`))
      .resolves.toMatchObject([{ name: 'width', defaultValue: 12 }]);
    async function expectProtected(source: DesignDocumentRef) {
      await expect(post(`${route}/move`, { ref: source, destination: { projectId: destination.id } })).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
      await expect(harness.runtimeFetch(`${route}?${new URLSearchParams(source)}`, { method: 'DELETE' })).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    }
    await expectProtected(ref);
    await Promise.all([
      writeFile(path.join(parent, 'consumer.design.json'), JSON.stringify(consumer)),
      writeFile(path.join(child, 'consumer.design.json'), JSON.stringify({ ...consumer, libraries: { shared: ref.path } })),
    ]);
    await expectProtected(parentRef);
    expect(await readFile(path.join(child, ref.path), 'utf8')).toBe(JSON.stringify(draft));
    expect(await readdir(destinationPath)).toEqual([]);
  } finally {
    await harness.close();
  }
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'preserves a library when its reference check cannot read a draft or its directory', async () => {
    const harness = await createRuntimeServerTestHarness();
    try {
      const root = path.join(harness.runtimeDataDir, 'source');
      const references = path.join(root, 'references');
      const target = path.join(harness.runtimeDataDir, 'target');
      await Promise.all([mkdir(references, { recursive: true }), mkdir(target)]);
      const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
      const [source, destination]: WorkspaceProject[] = await Promise.all([
        post('/v1/projects', { name: 'Source', path: root }), post('/v1/projects', { name: 'Target', path: target }),
      ]);
      const ref = { projectId: source.id, path: 'shared.design.json' };
      const route = '/v1/features/design/documents';
      const library = { schemaVersion: designDocumentVersion, documentId: 'shared', rootIds: [], nodes: {} };
      const consumer = path.join(references, 'consumer.design.json');
      await Promise.all([
        writeFile(path.join(root, ref.path), JSON.stringify(library)),
        writeFile(consumer, JSON.stringify({ ...library, documentId: 'consumer', libraries: { shared: ref.path } })),
      ]);
      const remove = () => harness.runtimeFetch(`${route}?${new URLSearchParams(ref)}`, { method: 'DELETE' });
      await expect(remove()).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
      for (const [entry, mode] of [[consumer, 0o600], [references, 0o700]] as const) {
        await chmod(entry, 0o000);
        try {
          await expect(post(`${route}/move`, { ref, destination: { projectId: destination.id } })).rejects.toThrow('DESIGN_DEPENDENCY_UNAVAILABLE');
          await expect(remove()).rejects.toThrow('DESIGN_DEPENDENCY_UNAVAILABLE');
        } finally { await chmod(entry, mode); }
      }
      expect(await readFile(path.join(root, ref.path), 'utf8')).toBe(JSON.stringify(library));
      expect(await readdir(target)).toEqual([]);
    } finally { await harness.close(); }
  },
);

it('protects the copy of a library in the resource root of a relocated consumer', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const parent = path.join(harness.runtimeDataDir, 'parent');
    const child = path.join(parent, 'child');
    await mkdir(child, { recursive: true });
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const [outer, inner]: WorkspaceProject[] = await Promise.all([
      post('/v1/projects', { name: 'Parent', path: parent }), post('/v1/projects', { name: 'Child', path: child }),
    ]);
    const libraryPath = 'shared.design.json';
    const ref = { projectId: outer.id, path: 'consumer.design.json' };
    const library = { schemaVersion: designDocumentVersion, documentId: 'shared', rootIds: [], nodes: {} };
    await Promise.all([
      writeFile(path.join(parent, libraryPath), JSON.stringify(library)),
      writeFile(path.join(parent, ref.path), JSON.stringify({ ...library, documentId: 'consumer', libraries: { shared: libraryPath } })),
    ]);
    const route = '/v1/features/design/documents';
    const remove = (projectId: string) => harness.runtimeFetch(`${route}?${new URLSearchParams({ projectId, path: libraryPath })}`, { method: 'DELETE' });
    await expect(remove(outer.id)).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    await post(`${route}/move`, { ref, destination: { projectId: inner.id } });
    await expect(remove(outer.id)).resolves.toBeNull();
    await expect(remove(inner.id)).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    expect(await readFile(path.join(child, libraryPath), 'utf8')).toBe(JSON.stringify(library));
  } finally { await harness.close(); }
});

it('binds new transitive library copies to the destination and rolls their bindings back on failure', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const parent = path.join(harness.runtimeDataDir, 'parent');
    const child = path.join(parent, 'child');
    await mkdir(child, { recursive: true });
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const [outer, inner]: WorkspaceProject[] = await Promise.all([
      post('/v1/projects', { name: 'Parent', path: parent }), post('/v1/projects', { name: 'Child', path: child }),
    ]);
    const empty = { schemaVersion: designDocumentVersion, rootIds: [], nodes: {} };
    const draftPath = 'draft.design.json';
    const componentsPath = 'components.design.json';
    const basePath = 'base.design.json';
    const draft = JSON.stringify({ ...empty, documentId: 'draft', libraries: { components: componentsPath } });
    const components = JSON.stringify({ ...empty, documentId: 'components', libraries: { base: basePath } });
    const base = JSON.stringify({ ...empty, documentId: 'base' });
    const childComponents = path.join(child, componentsPath);
    const childBase = path.join(child, basePath);
    await Promise.all([
      writeFile(path.join(parent, draftPath), draft), writeFile(path.join(parent, componentsPath), components),
      writeFile(path.join(parent, basePath), base), writeFile(childBase, `${base}\n`),
    ]);
    const route = '/v1/features/design/documents';
    const ref = (projectId: string, path: string) => ({ projectId, rootId: 'primary', path });
    const move = () => post(`${route}/move`, { ref: ref(outer.id, draftPath), destination: { projectId: inner.id } });
    const resolve = (reference: DesignDocumentRef) => harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(reference)}`);
    const remove = (reference: DesignDocumentRef) => harness.runtimeFetch(`${route}?${new URLSearchParams(reference)}`, { method: 'DELETE' });

    await expect(move()).rejects.toThrow('workspace_entry_exists');
    await expect(readdir(child)).resolves.toEqual([basePath]);
    await expect(readFile(path.join(parent, draftPath), 'utf8')).resolves.toBe(draft);
    // A file copied outside the app after rollback has no binding to reuse.
    await writeFile(childComponents, components);
    await expect(resolve(ref(inner.id, componentsPath))).rejects.toThrow('DESIGN_RESOURCE_ROOT_AMBIGUOUS');
    await unlink(childBase);
    const originalLibraryRoot = ref(outer.id, `child/${componentsPath}`);
    await expect(resolve(ref(inner.id, componentsPath))).resolves.toEqual(originalLibraryRoot);
    await expect(move()).rejects.toThrow('workspace_entry_exists');
    await expect(readdir(child)).resolves.toEqual([componentsPath]);
    await expect(readFile(path.join(parent, draftPath), 'utf8')).resolves.toBe(draft);
    await expect(resolve(ref(inner.id, componentsPath))).resolves.toEqual(originalLibraryRoot);
    await unlink(childComponents);

    await move();
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    await expect(resolve(ref(outer.id, `child/${componentsPath}`))).resolves.toEqual(ref(inner.id, componentsPath));
    await expect(resolve(ref(outer.id, `child/${basePath}`))).resolves.toEqual(ref(inner.id, basePath));

    const secondPath = 'another.design.json';
    await writeFile(path.join(parent, secondPath), JSON.stringify({ ...empty, documentId: 'another', libraries: { components: componentsPath } }));
    await expect(post(`${route}/move`, { ref: ref(outer.id, secondPath), destination: { projectId: inner.id, rootId: 'primary' } }))
      .resolves.toEqual(ref(inner.id, secondPath));

    await expect(remove(ref(outer.id, componentsPath))).resolves.toBeNull();
    await expect(remove(ref(outer.id, basePath))).resolves.toBeNull();
    await expect(remove(ref(inner.id, basePath))).rejects.toThrow('DESIGN_LIBRARY_IN_USE');
  } finally { await harness.close(); }
});

it('rolls back a transfer whose later library copies would make an existing library ambiguous', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    const parent = path.join(harness.runtimeDataDir, 'parent');
    const destination = path.join(parent, 'child');
    await Promise.all([path.join(source, 'child'), path.join(destination, 'child')].map((directory) => mkdir(directory, { recursive: true })));
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const [from, , to]: WorkspaceProject[] = await Promise.all([
      post('/v1/projects', { name: 'Source', path: source }), post('/v1/projects', { name: 'Parent', path: parent }),
      post('/v1/projects', { name: 'Destination', path: destination }),
    ]);
    const empty = { schemaVersion: designDocumentVersion, rootIds: [], nodes: {} };
    const basePath = 'base.design.json';
    const nestedBasePath = `child/${basePath}`;
    const libraryPath = 'components.design.json';
    const library = JSON.stringify({ ...empty, documentId: 'components', libraries: { base: nestedBasePath } });
    const base = JSON.stringify({ ...empty, documentId: 'base' });
    const ref = { projectId: from.id, rootId: 'primary', path: 'draft.design.json' };
    const draft = JSON.stringify({ ...empty, documentId: 'draft', libraries: { components: libraryPath, base: basePath } });
    await Promise.all([
      writeFile(path.join(source, ref.path), draft), writeFile(path.join(source, libraryPath), library),
      writeFile(path.join(source, basePath), base), writeFile(path.join(source, nestedBasePath), base),
      writeFile(path.join(destination, libraryPath), library), writeFile(path.join(destination, nestedBasePath), base),
    ]);
    const route = '/v1/features/design/documents';
    const existing = { projectId: to.id, rootId: 'primary', path: libraryPath };
    const resolve = () => harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(existing)}`);
    await expect(resolve()).resolves.toEqual(existing);
    // Copying the direct base reference would give the parent root a matching child/base.design.json.
    await expect(post(`${route}/move`, { ref, destination: { projectId: to.id } })).rejects.toThrow('workspace_entry_exists');
    await expect(readFile(path.join(source, ref.path), 'utf8')).resolves.toBe(draft);
    await expect(readFile(path.join(destination, basePath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(resolve()).resolves.toEqual(existing);
  } finally { await harness.close(); }
});

it('keeps the original scripts after file-tree relocations and refuses ambiguous legacy transfers', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const parent = path.join(harness.runtimeDataDir, 'parent');
    const child = path.join(parent, 'child');
    const target = path.join(parent, 'target');
    await Promise.all([path.join(child, 'drafts', 'detail'), path.join(child, 'drafts', 'archive'), path.join(child, 'stored'), target]
      .map((directory) => mkdir(directory, { recursive: true })));
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const route = '/v1/features/design/documents';
    const resolve = (ref: DesignDocumentRef) => harness.runtimeFetch(`${route}/resource-root?${new URLSearchParams(ref)}`);
    const [outer, inner, to]: WorkspaceProject[] = await Promise.all([
      post('/v1/projects', { name: 'Parent', path: parent }),
      post('/v1/projects', { name: 'Child', path: child }),
      post('/v1/projects', { name: 'Destination', path: target }),
    ]);
    const parentRef = { projectId: outer.id, rootId: 'primary', path: 'child/drafts/parent.design.json' };
    const childRef = { projectId: inner.id, rootId: 'primary', path: 'drafts/detail/child.design.json' };
    const byParent = { ...parentRef, path: `child/${childRef.path}` };
    const destination = { projectId: to.id, rootId: 'primary' };
    const scriptPath = 'design-assets/chart.js';
    const script = (width: number) => `/** @input width: number = ${width} */\nreturn [];`;
    await Promise.all([parentRef, childRef].map(async (ref, index) => {
      await post(route, { projectId: ref.projectId, rootId: ref.rootId, parentPath: path.posix.dirname(ref.path), name: path.posix.basename(ref.path) });
      await expect(post('/v1/features/design/scripts', { ref, name: 'chart.js', source: script(index === 0 ? 12 : 36) })).resolves.toBe(scriptPath);
      const { document, revision }: DesignSnapshot = await harness.runtimeFetch(`${route}?${new URLSearchParams(ref)}`);
      await post(`${route}/edits`, { ref, expectedRevision: revision, edits: [{ kind: 'insert', nodeId: 'chart', parentId: null,
        node: { kind: 'script', x: 0, y: 0, width: 64, height: 64, scriptPath } }] });
      if (ref === parentRef) {
        // Older ownership files store only the root. A folder rename must still carry them forward.
        const root = await realpath(parent);
        const key = JSON.stringify([workspaceFilePathKey(root, ref.path), document.documentId]);
        const filename = `${createHash('sha256').update(key).digest('hex')}.json`;
        const binding = path.join(harness.runtimeDataDir, 'runtime', 'design-resource-roots', filename);
        await access(binding);
        await writeFile(binding, JSON.stringify(root));
      }
    }));

    await expect(resolve(byParent)).resolves.toEqual(childRef);
    const moveOutsideOwner = (entryPath: string) => post(
      `/v1/projects/${outer.id}/entries/move?${new URLSearchParams({ rootId: byParent.rootId, path: entryPath })}`,
      { parentPath: 'target' },
    );
    await expect(moveOutsideOwner(byParent.path)).rejects.toThrow('"code":"conflict"');
    await expect(moveOutsideOwner('child/drafts')).rejects.toThrow('"code":"conflict"');
    await expect(readdir(target)).resolves.toEqual([]);

    const name = 'renamed.design.json';
    const entryQuery = new URLSearchParams({ rootId: byParent.rootId, path: byParent.path });
    await expect(harness.runtimeFetch(`/v1/projects/${byParent.projectId}/entries?${entryQuery}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    })).resolves.toEqual({ name, path: `child/drafts/detail/${name}`, type: 'file' });
    const renamed = { ...childRef, path: `drafts/detail/${name}` };
    await expect(resolve(renamed)).resolves.toEqual(renamed);

    const dragQuery = new URLSearchParams({ rootId: byParent.rootId, path: `child/${renamed.path}` });
    await expect(post(`/v1/projects/${byParent.projectId}/entries/move?${dragQuery}`, { parentPath: 'child/drafts/archive' }))
      .resolves.toEqual({ name, path: `child/drafts/archive/${name}`, type: 'file' });
    const dragged = { ...childRef, path: `drafts/archive/${name}` };
    await expect(resolve(dragged)).resolves.toEqual(dragged);

    const folderQuery = new URLSearchParams({ rootId: childRef.rootId, path: 'drafts' });
    await expect(harness.runtimeFetch(`/v1/projects/${childRef.projectId}/entries?${folderQuery}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'layouts' }),
    })).resolves.toEqual({ name: 'layouts', path: 'layouts', type: 'directory' });
    const folderDragQuery = new URLSearchParams({ rootId: childRef.rootId, path: 'layouts' });
    await expect(post(`/v1/projects/${childRef.projectId}/entries/move?${folderDragQuery}`, { parentPath: 'stored' }))
      .resolves.toEqual({ name: 'layouts', path: 'stored/layouts', type: 'directory' });
    const relocated = { ...childRef, path: `stored/layouts/archive/${name}` };
    const relocatedByParent = { ...byParent, path: `child/${relocated.path}` };
    const relocatedParent = { ...parentRef, path: 'child/stored/layouts/parent.design.json' };

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    await expect(resolve({ ...childRef, path: 'stored/layouts/parent.design.json' })).resolves.toEqual(relocatedParent);
    await expect(resolve(relocatedByParent)).resolves.toEqual(relocated);
    await expect(resolve(relocated)).resolves.toEqual(relocated);
    await expect(harness.runtimeFetch(`/v1/features/design/scripts/parameters?${new URLSearchParams({ ...relocatedParent, scriptPath })}`))
      .resolves.toMatchObject([{ name: 'width', defaultValue: 12 }]);
    await expect(harness.runtimeFetch(`/v1/features/design/scripts/parameters?${new URLSearchParams({ ...relocated, scriptPath })}`))
      .resolves.toMatchObject([{ name: 'width', defaultValue: 36 }]);

    const unknown = { ...byParent, path: 'child/legacy.design.json' };
    const original = JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'legacy', rootIds: ['chart'], nodes: {
      chart: { kind: 'script', x: 0, y: 0, width: 64, height: 64, scriptPath },
    } });
    await writeFile(path.join(parent, unknown.path), original);
    await expect(resolve(unknown)).rejects.toThrow('DESIGN_RESOURCE_ROOT_AMBIGUOUS');
    await expect(post(`${route}/move`, { ref: unknown, destination })).rejects.toThrow('DESIGN_RESOURCE_ROOT_AMBIGUOUS');
    expect(await readFile(path.join(parent, unknown.path), 'utf8')).toBe(original);
    expect(await readdir(target)).toEqual([]);

    await expect(post(`${route}/move`, { ref: relocatedByParent, destination })).resolves.toEqual({ ...destination, path: name });
    expect(await readFile(path.join(target, scriptPath), 'utf8')).toBe(script(36));
    await expect(resolve({ ...byParent, path: `target/${name}` })).resolves.toEqual({ ...destination, path: name });
    expect(await readdir(path.join(child, 'stored', 'layouts', 'archive'))).toEqual([]);
  } finally {
    await harness.close();
  }
});

it('lists every design in the selected root and finds image assets beyond the entry search limit', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const primary = path.join(harness.runtimeDataDir, 'primary');
    const secondary = path.join(harness.runtimeDataDir, 'secondary');
    const outside = path.join(harness.runtimeDataDir, 'outside');
    await Promise.all([primary, secondary, outside].map((directory) => mkdir(directory)));
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, {
      method: 'POST', body: JSON.stringify(input),
    });
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Design images', roots: [{ path: primary }, { path: secondary }] });
    const [firstRoot, secondRoot] = workspaceProjectRoots(project);
    const ref = { projectId: project.id, rootId: secondRoot.id, path: 'images.design.json' };
    const primaryRef = { ...ref, rootId: firstRoot.id };
    await Promise.all([ref, primaryRef].map(({ projectId, rootId, path: name }) =>
      post('/v1/features/design/documents', { projectId, rootId, name, parentPath: '.' })));

    const route = '/v1/features/design/images';
    const otherPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1X8AAAAASUVORK5CYII=';
    const inputs = [ONE_PIXEL_PNG_BASE64, otherPng];
    const paths: string[] = await Promise.all(inputs.map((base64) => post(route, { ref, name: 'photo.png', base64 })));
    expect([...paths].sort()).toEqual(['design-assets/photo-2.png', 'design-assets/photo.png']);
    for (const [index, relative] of paths.entries()) {
      const query = new URLSearchParams({ rootId: ref.rootId, path: relative });
      const file = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/read?${query}`);
      expect(file.preview).toEqual({ kind: 'image', mimeType: 'image/png', base64: inputs[index] });
      expect(await readFile(path.join(secondary, relative))).toEqual(Buffer.from(inputs[index], 'base64'));
    }
    await expect(post(route, { ref, name: 'pretend.png', base64: Buffer.from('text').toString('base64') })).rejects.toThrow('INVALID_INPUT');
    expect((await readdir(path.join(secondary, 'design-assets'))).sort()).toEqual(['photo-2.png', 'photo.png']);
    expect(await readdir(primary)).toEqual([ref.path]);
    const drafts = Array.from({ length: 81 }, (_, index) => `screen-${index}.design.json`);
    const draft = await readFile(path.join(secondary, ref.path));
    await Promise.all(drafts.map((name) => writeFile(path.join(secondary, name), draft)));
    await mkdir(path.join(secondary, 'screens'));
    await writeFile(path.join(secondary, 'screens', 'final.design.json'), draft);
    const searchQuery = new URLSearchParams({ rootId: ref.rootId, extension: 'PNG' });
    const images = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/entries/search?${searchQuery}`);
    expect(images.entries.map((entry: { path: string }) => entry.path).sort()).toEqual([...paths].sort());
    expect(images.truncated).toBe(false);

    const list = (rootId: string) => harness.runtimeFetch(`/v1/features/design/documents/list?${new URLSearchParams({ projectId: project.id, rootId })}`);
    await expect(list(secondRoot.id)).resolves.toEqual([...drafts, ref.path, 'screens/final.design.json'].sort((a, b) => a.localeCompare(b)));
    await expect(list(firstRoot.id)).resolves.toEqual([primaryRef.path]);
    await symlink(outside, path.join(primary, 'design-assets'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(post(route, { ref: primaryRef, name: 'photo.png', base64: ONE_PIXEL_PNG_BASE64 })).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await harness.close();
  }
});

it('saves and reopens a design with a long filename, with atomic batches and revision-checked history', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const workspace = path.join(harness.runtimeDataDir, 'design-workspace');
    await mkdir(workspace);
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, {
      method: 'POST', body: JSON.stringify(input),
    });
    const project = await post('/v1/projects', { name: 'Design workspace', path: workspace });
    const documents = '/v1/features/design/documents';
    const name = `${'a'.repeat(200)}.design.json`;
    const create = { projectId: project.id, parentPath: '.', name };
    const entry = await post(documents, create);
    const ref: DesignDocumentRef = { projectId: project.id, path: entry.path };
    const documentRoute = `${documents}?${new URLSearchParams({ projectId: ref.projectId, path: ref.path })}`;
    const read = (): Promise<DesignSnapshot> => harness.runtimeFetch(documentRoute);
    const commit = (expectedRevision: string, edits: readonly DesignEdit[]): Promise<DesignSnapshot> =>
      post(`${documents}/edits`, { ref, expectedRevision, edits });
    const history = (expectedRevision: string, direction: 'undo' | 'redo'): Promise<DesignSnapshot> =>
      post(`${documents}/history`, { ref, expectedRevision, direction });

    const libraryPath = 'library.design.json';
    await writeFile(path.join(workspace, libraryPath), JSON.stringify({ schemaVersion: 4, documentId: 'library', rootIds: ['card'],
      styles: { accent: { kind: 'color', name: 'Accent', color: '#663399' } }, nodes: {
        card: { kind: 'frame', x: 0, y: 0, width: 120, height: 48, component: true, childIds: ['label'] },
        label: { kind: 'text', x: 8, y: 8, width: 100, fontSize: 16, text: 'Card' },
      },
    }));
    const initial = await read();
    const outlineGradient = { kind: 'diamond', axis: { start: { x: 0.25, y: 0.5 }, end: { x: 0.85, y: 0.7 } },
      stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#663399' }] } as const;
    const drawing = await commit(initial.revision, [
      { kind: 'linkLibrary', documentId: 'library', path: libraryPath },
      { kind: 'setStyle', styleId: 'brand', style: { kind: 'color', name: 'Brand', color: '#663399' } },
      { kind: 'insert', nodeId: 'frame', parentId: null, node: {
        kind: 'frame', x: 0, y: 0, width: 960, height: 600, childIds: [],
        layout: { direction: 'horizontal', align: 'start', padding: 12, gap: 12, wrap: true },
        fills: [{ color: '#ffffff', gradient: { kind: 'radial', stops: [
          { color: '#ffffff', offset: 0 }, { color: '#663399', offset: 1, styleId: 'library:accent' },
        ] } }],
        strokes: [{ color: '#663399', width: 2, gradient: outlineGradient }],
      } },
      { kind: 'insert', nodeId: 'title', parentId: 'frame', node: {
        kind: 'text', x: 24, y: 24, width: 216, fontSize: 24, text: '设置',
        fontFamily: 'Avenir Next', widthMode: 'fill', minWidth: 120, maxWidth: 600,
        runs: [{ start: 0, end: 2, color: '#663399', styleId: 'brand', fontWeight: 700 }],
        interaction: { kind: 'overlay', targetId: 'overlay' },
      } },
      { kind: 'insert', nodeId: 'overlay', parentId: null, node: {
        kind: 'frame', x: 980, y: 0, width: 360, height: 240, childIds: [], interaction: { kind: 'close' },
      } },
      { kind: 'insert', nodeId: 'instance', parentId: 'overlay', node: {
        kind: 'frame', x: 12, y: 12, width: 120, height: 48, childIds: [], instanceOf: 'library:card',
        contentOverrides: { 'library:label': { kind: 'text', text: 'Local card' } },
      } },
    ]);
    const file = path.join(workspace, name);
    const baseline = await readFile(file, 'utf8');
    await expect(commit(drawing.revision, [{ kind: 'linkLibrary', documentId: 'library', path: '../outside.design.json' }]))
      .rejects.toThrow('INVALID_INPUT');
    await expect(post(documents, create)).rejects.toThrow('workspace_entry_exists');
    await expect(commit(drawing.revision, [
      { kind: 'updateText', nodeId: 'title', text: 'Discard this change' },
      { kind: 'remove', nodeId: 'missing-layer' },
    ])).rejects.toThrow('INVALID_INPUT');
    expect(await readFile(file, 'utf8')).toBe(baseline);

    const results = await Promise.allSettled([
      commit(drawing.revision, [
        { kind: 'move', nodeId: 'title', x: 48, y: 32 },
        { kind: 'updateText', nodeId: 'title', text: '账户设置' },
      ]),
      commit(drawing.revision, [
        { kind: 'move', nodeId: 'title', x: 64, y: 48 },
        { kind: 'updateText', nodeId: 'title', text: '通知设置' },
      ]),
    ]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ message: expect.stringContaining('REVISION_CONFLICT') });
    const edited = winners[0].value;
    expect((await read()).document).toEqual(edited.document);
    expect((await history(edited.revision, 'undo')).document).toEqual(drawing.document);
    const restored = await history(drawing.revision, 'redo');
    expect(restored.document).toEqual(edited.document);

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const reopened = await read();
    expect(reopened.document).toEqual(restored.document);
    expect(reopened.document).toMatchObject({ libraries: { library: libraryPath }, styles: { brand: { color: '#663399' } }, nodes: {
      title: { runs: [{ start: 2, end: 4, styleId: 'brand' }], interaction: { kind: 'overlay', targetId: 'overlay' } },
      frame: { layout: { wrap: true }, fills: [{ gradient: { kind: 'radial', stops: [{ offset: 0 }, { styleId: 'library:accent' }] } }],
        strokes: [{ width: 2, gradient: outlineGradient }] },
      instance: { childIds: [], instanceOf: 'library:card', contentOverrides: { 'library:label': { text: 'Local card' } } },
    } });
    expect(reopened.document.nodes).not.toHaveProperty('card');
    expect(reopened.canUndo).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(reopened.document);
  } finally {
    await harness.close();
  }
});

it('opens a v1 file and preserves nested layout and image references through edits and undo', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const workspace = path.join(harness.runtimeDataDir, 'legacy-design');
    await mkdir(workspace);
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, {
      method: 'POST', body: JSON.stringify(input),
    });
    const project = await post('/v1/projects', { name: 'Legacy design', path: workspace });
    const ref: DesignDocumentRef = { projectId: project.id, path: 'screen.design.json' };
    const artboard = { kind: 'frame', x: 40, y: 32, width: 720, height: 480, childIds: ['title'] } as const;
    const title = { kind: 'text', x: 24, y: 24, width: 216, fontSize: 24, text: '设置' } as const;
    const legacyStroke = { color: '#312e81', width: 2, opacity: 0.75 } as const;
    const original = { schemaVersion: 1, documentId: 'screen', rootIds: ['artboard'], nodes: {
      artboard, title: { ...title, fill: '#263153', fillOpacity: 0.65, fillHidden: true, stroke: legacyStroke },
    } };
    const migratedNodes = {
      artboard: { ...artboard, fills: [{ color: '#ffffff' }] },
      title: { ...title, strokes: [legacyStroke], fills: [{ color: '#263153', opacity: 0.65, hidden: true }] },
    };
    const file = path.join(workspace, ref.path);
    await writeFile(file, JSON.stringify(original));

    const route = '/v1/features/design/documents';
    const read = (): Promise<DesignSnapshot> => harness.runtimeFetch(`${route}?${new URLSearchParams(ref)}`);
    const commit = (expectedRevision: string, edits: readonly DesignEdit[]): Promise<DesignSnapshot> =>
      post(`${route}/edits`, { ref, expectedRevision, edits });
    const opened = await read();
    expect(opened.document.nodes).toEqual(migratedNodes);
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1);

    const layout = { direction: 'horizontal', gap: 12, padding: 16, paddingSides: [12, 20, 16, 8], align: 'center' } as const;
    const image = { kind: 'image', x: 0, y: 0, width: 96, height: 64, assetPath: 'assets/avatar.png' } as const;
    const badge = {
      kind: 'rectangle', x: 0, y: 0, width: 80, height: 30, widthMode: 'fill', flipY: true,
      fills: [{ color: '#6a79df', opacity: 0.5, hidden: true }, { color: '#fbbede', opacity: 0.3 }],
      cornerRadius: 8, cornerRadii: [4, 6, 8, 10],
      strokes: [
        { color: '#4c5688', width: 2, alignment: 'outside', join: 'round', opacity: 0.75 },
        { color: '#0c3d44', width: 1, alignment: 'inside', hidden: true },
      ],
    } as const;
    const updated = await commit(opened.revision, [
      { kind: 'insert', nodeId: 'row', parentId: 'artboard', node: {
        kind: 'frame', x: 24, y: 96, width: 480, height: 100, heightMode: 'hug', layout, childIds: [],
      } },
      { kind: 'insert', nodeId: 'avatar', parentId: 'row', node: image },
      { kind: 'insert', nodeId: 'badge', parentId: 'row', node: badge },
      { kind: 'reorder', nodeId: 'badge', beforeId: 'avatar' },
    ]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      schemaVersion: designDocumentVersion, nodes: {
        title: migratedNodes.title, artboard: { childIds: ['title', 'row'] }, row: { childIds: ['badge', 'avatar'], heightMode: 'hug', layout },
        avatar: image, badge,
      },
    });
    await expect(commit(updated.revision, [
      { kind: 'remove', nodeId: 'badge' },
      { kind: 'reorder', nodeId: 'avatar', beforeId: 'title' },
    ])).rejects.toThrow('INVALID_INPUT');
    await expect(commit(updated.revision, [
      { kind: 'update', nodeId: 'avatar', node: { ...image, assetPath: '../private.png' } },
    ])).rejects.toThrow('INVALID_INPUT');
    await expect(commit(updated.revision, [
      { kind: 'update', nodeId: 'badge', node: { ...badge, cornerRadii: [4, 6, -8, 10] } },
    ])).rejects.toThrow('INVALID_INPUT');
    expect((await read()).revision).toBe(updated.revision);

    const removed = await commit(updated.revision, [{ kind: 'remove', nodeId: 'row' }]);
    expect(removed.document.nodes).toEqual(migratedNodes);
    const restored: DesignSnapshot = await post(`${route}/history`, {
      ref, expectedRevision: removed.revision, direction: 'undo',
    });
    expect(restored.document).toEqual(updated.document);

    const moved = await commit(restored.revision, [
      { kind: 'reparent', nodeId: 'avatar', parentId: 'artboard', beforeId: 'row' },
      { kind: 'move', nodeId: 'avatar', x: 36, y: 112 },
    ]);
    expect(moved.document.nodes).toMatchObject({
      artboard: { childIds: ['title', 'avatar', 'row'] },
      row: { childIds: ['badge'] },
      avatar: { x: 36, y: 112, assetPath: image.assetPath },
    });
    await expect(commit(moved.revision, [
      { kind: 'reparent', nodeId: 'artboard', parentId: 'row', beforeId: null },
    ])).rejects.toThrow('INVALID_INPUT');
    expect((await read()).document).toEqual(moved.document);
    const undoMove: DesignSnapshot = await post(`${route}/history`, { ref, expectedRevision: moved.revision, direction: 'undo' });
    expect(undoMove.document).toEqual(updated.document);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(updated.document);

    const marker = {
      kind: 'ellipse', x: 760, y: 60, width: 72, height: 40, fills: [], rotation: 22, opacity: 0.55,
      strokes: [{ color: '#4c5688', width: 2 }],
      shadow: { color: '#141829', x: 2, y: 4, blur: 8 },
    } as const;
    const withMarker = await commit(undoMove.revision, [
      { kind: 'insert', nodeId: 'marker', parentId: null, node: marker },
      { kind: 'move', nodeId: 'artboard', x: 32, y: 24 },
    ]);
    expect((await read()).document).toMatchObject({
      rootIds: ['artboard', 'marker'],
      nodes: { artboard: { x: 32, y: 24 }, marker },
    });
    await expect(commit(withMarker.revision, [
      { kind: 'move', nodeId: 'marker', x: 700, y: 20 },
      { kind: 'update', nodeId: 'marker', node: { ...marker, opacity: 2 } },
    ])).rejects.toThrow('INVALID_INPUT');
    expect((await read()).revision).toBe(withMarker.revision);
    const beforeMarker = await post(`${route}/history`, { ref, expectedRevision: withMarker.revision, direction: 'undo' });
    expect(beforeMarker.document).toEqual(updated.document);
  } finally {
    await harness.close();
  }
});

it('deletes a variable without losing the resolved values on different boards and restores the bindings on undo', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const workspace = path.join(harness.runtimeDataDir, 'design-variables');
    await mkdir(workspace);
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Design variables', path: workspace });
    const route = '/v1/features/design/documents';
    const ref = { projectId: project.id, path: 'variables.design.json' };
    const read = (): Promise<DesignSnapshot> => harness.runtimeFetch(`${route}?${new URLSearchParams(ref)}`);
    const commit = (expectedRevision: string, edits: readonly DesignEdit[]): Promise<DesignSnapshot> =>
      post(`${route}/edits`, { expectedRevision, ref, edits });
    const undo = (expectedRevision: string): Promise<DesignSnapshot> =>
      post(`${route}/history`, { ref, expectedRevision, direction: 'undo' });
    const file = path.join(workspace, ref.path);
    const frame = { kind: 'frame', x: 0, y: 0, width: 300, height: 200, childIds: [] } as const;
    const rectangle = { kind: 'rectangle', x: 10, y: 10, width: 120, height: 32, cornerRadius: 4, variableIds: { cornerRadius: 'radius' } } as const;
    await writeFile(file, JSON.stringify({ schemaVersion: 6, documentId: 'library', rootIds: ['default', 'compact'],
      variableModes: { compact: 'Compact' },
      styles: { radius: { kind: 'number', name: 'Radius', value: 12, modeValues: { compact: 6 } } },
      nodes: {
        default: { ...frame, childIds: ['normalCard'] },
        compact: { ...frame, x: 400, childIds: ['compactCard'], variableModeIds: { library: 'compact' } },
        normalCard: rectangle, compactCard: rectangle,
      },
    }));
    const initial = await read();
    const authored = await commit(initial.revision, [
      { kind: 'setVariableCollection', collectionId: 'spacing', collection: { name: 'Spacing', modes: { compact: 'Compact' } } },
      { kind: 'setStyle', styleId: 'gap', style: { kind: 'number', name: 'Gap', collectionId: 'spacing', value: 16, modeValues: { compact: 8 } } },
      { kind: 'update', nodeId: 'compact', node: { ...frame, x: 400, variableModeIds: { library: 'compact', 'library:spacing': 'compact' } } },
    ]);
    expect((await read()).document).toEqual(authored.document);
    const removedMode = await commit(authored.revision, [{ kind: 'setVariableCollection', collectionId: 'default', collection: {} }]);
    const saved = (await read()).document;
    expect(saved.styles?.radius).not.toHaveProperty('modeValues');
    expect(saved.styles?.gap).toHaveProperty('modeValues', { compact: 8 });
    expect(saved.nodes.compact).toHaveProperty('variableModeIds', { 'library:spacing': 'compact' });
    const restoredMode = await undo(removedMode.revision);
    expect(restoredMode.document).toEqual(authored.document);

    const removed = await commit(restoredMode.revision, [{ kind: 'setStyle', styleId: 'radius', style: null }]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      schemaVersion: designDocumentVersion, nodes: { normalCard: { cornerRadius: 12 }, compactCard: { cornerRadius: 6 } },
    });
    expect(removed.document.nodes.compactCard.variableIds).toBeUndefined();
    expect((await undo(removed.revision)).document).toEqual(authored.document);
  } finally {
    await harness.close();
  }
});
