import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesignDocumentRef, DesignEdit, DesignSnapshot } from '@setsuna-desktop/feature-design/contracts';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

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
    const drawing = await commit(initial.revision, [
      { kind: 'linkLibrary', documentId: 'library', path: libraryPath },
      { kind: 'setStyle', styleId: 'brand', style: { kind: 'color', name: 'Brand', color: '#663399' } },
      { kind: 'insert', nodeId: 'frame', parentId: null, node: {
        kind: 'frame', x: 0, y: 0, width: 960, height: 600, childIds: [],
        layout: { direction: 'horizontal', align: 'start', padding: 12, gap: 12, wrap: true },
        fills: [{ color: '#ffffff', gradient: { kind: 'radial', stops: [
          { color: '#ffffff', offset: 0 }, { color: '#663399', offset: 1, styleId: 'library:accent' },
        ] } }],
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
      frame: { layout: { wrap: true }, fills: [{ gradient: { kind: 'radial', stops: [{ offset: 0 }, { styleId: 'library:accent' }] } }] },
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
    const migratedNodes = { artboard, title: { ...title, strokes: [legacyStroke], fills: [{ color: '#263153', opacity: 0.65, hidden: true }] } };
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
      schemaVersion: 5, nodes: {
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
