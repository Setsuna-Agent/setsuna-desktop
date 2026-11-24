import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDirectoryGrant, designDirectoryGrants, designDocumentVersion, type DesignDocument, type DesignDocumentRef,
  type DesignEdit, type DesignSnapshot } from '@setsuna-desktop/feature-design/contracts';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { writeJsonFile } from '../../../src/adapters/store/json-file.js';

it('keeps read-only preset sources with the project and adds missing resources to the existing copy', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const primary = path.join(harness.runtimeDataDir, 'primary');
    const resources = path.join(harness.runtimeDataDir, 'resources');
    await Promise.all([mkdir(primary), mkdir(resources)]);
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Design', roots: [{ path: primary }, { path: resources }] });
    const workspace = { projectId: project.id, rootId: workspaceProjectRoots(project)[1].id };
    const documents = '/v1/features/design/documents';
    const create = async (name: string): Promise<DesignDocumentRef> => {
      const { path } = await post(documents, { ...workspace, parentPath: '.', name });
      return { ...workspace, path };
    };
    const read = (ref: DesignDocumentRef): Promise<DesignSnapshot> =>
      harness.runtimeFetch(`${documents}?${new URLSearchParams(Object.entries(ref))}`);
    const commit = (ref: DesignDocumentRef, expectedRevision: string, edits: readonly DesignEdit[]): Promise<DesignSnapshot> =>
      post(`${documents}/edits`, { ref, expectedRevision, edits });
    const prepare = (ref: DesignDocumentRef, presetId: string): Promise<Extract<DesignEdit, { kind: 'linkLibrary' }>> =>
      post('/v1/features/design/libraries/preset', { ref, presetId });

    const first = await create('Screen.design.json');
    const second = await create('Settings.design.json');
    const [link, concurrentLink] = await Promise.all([prepare(first, 'shadcn-ui'), prepare(second, 'shadcn-ui')]);
    expect(concurrentLink).toEqual(link);
    expect(await readdir(primary)).toEqual([]);
    expect((await readdir(resources)).sort()).toEqual([first.path, second.path, link.path].sort());

    const source = { ...workspace, path: link.path };
    const library = await read(source);
    const componentId = library.document.rootIds[0];
    const component = library.document.nodes[componentId];
    if (component?.kind !== 'frame' || !component.component) throw new Error('Expected a native main component.');
    const textId = component.childIds[0];
    const label = library.document.nodes[textId];
    if (label?.kind !== 'text') throw new Error('Expected an editable component label.');
    expect(library.document.styles?.[label.textStyleId ?? '']?.kind).toBe('text');
    expect(library.document.styles?.[component.fills?.[0]?.styleId ?? '']?.kind).toBe('color');
    await expect(commit(source, library.revision, [{ kind: 'updateText', nodeId: textId, text: 'Publish' }])).rejects.toThrow('INVALID_INPUT');
    await expect(post(`${documents}/history`, { ref: source, expectedRevision: library.revision, direction: 'undo' })).rejects.toThrow('INVALID_INPUT');
    await expect(harness.runtimeFetch(`${documents}/resource-root?${new URLSearchParams(source)}`)).rejects.toThrow('INVALID_INPUT');
    await expect(prepare(second, 'shadcn-ui')).resolves.toEqual(link);
    await expect(read(source)).resolves.toEqual(library);

    const instanceOf = `${link.documentId}:${componentId}`;
    await expect(commit(first, (await read(first)).revision, [link, {
      kind: 'insert', nodeId: 'placed', parentId: null,
      node: { kind: 'frame', x: 10, y: 10, width: component.width, height: component.height, childIds: [], instanceOf },
    }])).resolves.toMatchObject({
      document: { libraries: { [link.documentId]: link.path }, nodes: { placed: { instanceOf } } },
    });

    const savedLabel = { ...label, text: 'Keep this project label' };
    await writeFile(path.join(resources, link.path), JSON.stringify({
      ...library.document,
      rootIds: [componentId],
      nodes: { [componentId]: { ...component, childIds: [textId] }, [textId]: savedLabel },
      styles: { 'preset-color-primary': { kind: 'color', name: 'Project primary', color: '#263b53', modeValues: { sepia: '#443326' } } },
      variableCollections: { default: { name: 'Project colors', defaultModeName: 'Day', modes: { sepia: 'Sepia' } } },
    }));
    await expect(prepare(first, 'shadcn-ui')).resolves.toEqual(link);
    const expanded = await read(source);
    expect(expanded.document).toMatchObject({
      documentId: link.documentId,
      rootIds: expect.arrayContaining([componentId, 'data-table']),
      nodes: { [textId]: savedLabel, 'data-table': { component: true } },
      styles: {
        'preset-color-primary': { name: 'Project primary', color: '#263b53', modeValues: { sepia: '#443326', dark: '#f4f4f5' } },
        'preset-color-chartBlue': { collectionId: 'charts' },
      },
      variableCollections: {
        default: { name: 'Project colors', defaultModeName: 'Day', modes: { sepia: 'Sepia', dark: 'Dark' } },
        charts: { name: 'Chart colors', modes: { dark: 'Dark' } },
      },
    });
    await expect(read(first)).resolves.toMatchObject({ document: { nodes: { placed: { instanceOf } } } });

    const local = await post(documents, { storageId: 'local', parentPath: '.', name: 'Local.design.json' });
    const localRef = { storageId: 'local', path: local.path };
    const localDraft = await read(localRef);
    if (!localDraft.workspaceRoot) throw new Error('Expected the local draft storage directory.');
    const localLink = { kind: 'linkLibrary', documentId: 'setsuna-library-beui-123e4567-e89b-42d3-a456-426614174000', path: 'Existing beUI.design.json' } as const;
    const bundledBeui = (await read({ ...localRef, path: 'builtin:beui' })).document;
    const localButton = bundledBeui.nodes['button-primary'];
    const localLabel = bundledBeui.nodes['button-primary-1'];
    if (localButton?.kind !== 'frame' || localLabel?.kind !== 'text') throw new Error('Expected the beUI button and label.');
    const legacyLabel = { ...localLabel, text: 'Keep this local label' };
    await writeFile(path.join(localDraft.workspaceRoot, localLink.path), JSON.stringify({
      schemaVersion: designDocumentVersion, documentId: localLink.documentId, rootIds: ['button-primary'],
      nodes: { 'button-primary': localButton, 'button-primary-1': legacyLabel },
    }));
    const localInstanceOf = `${localLink.documentId}:button-primary`;
    const linkedLocal = await commit(localRef, localDraft.revision, [localLink, {
      kind: 'insert', nodeId: 'placed', parentId: null,
      node: { kind: 'frame', x: 0, y: 0, width: localButton.width, height: localButton.height, childIds: [], instanceOf: localInstanceOf },
    }]);
    const localSource = { ...localRef, path: localLink.path };
    await expect(prepare(localRef, 'beui')).resolves.toEqual(localLink);
    const localLibrary = await read(localSource);
    expect(localLibrary.document).toMatchObject({
      documentId: localLink.documentId, rootIds: bundledBeui.rootIds,
      nodes: { 'button-primary-1': legacyLabel, 'command-palette': { component: true } },
      styles: { 'preset-color-primary': { kind: 'color' } },
    });
    await expect(read(localRef)).resolves.toMatchObject({ revision: linkedLocal.revision, document: {
      libraries: { [localLink.documentId]: localLink.path }, nodes: { placed: { instanceOf: localInstanceOf } },
    } });
    await expect(prepare(localRef, 'beui')).resolves.toEqual(localLink);
    await expect(read(localSource)).resolves.toEqual(localLibrary);

    await expect(post(`${documents}/move`, { ref: first, destination: { storageId: 'local' } })).rejects.toThrow('DESIGN_LIBRARY_PROJECT_REQUIRED');
    await expect(harness.runtimeFetch(`${documents}/list?storageId=local`)).resolves.toEqual([local.path]);
    const target = path.join(harness.runtimeDataDir, 'other-project');
    const designs = path.join(target, 'designs');
    await mkdir(designs, { recursive: true });
    await post('/v1/projects', { name: 'Other project', path: target });
    const chosen = await designDirectoryGrant(await realpath(designs));
    await writeJsonFile(path.join(harness.runtimeDataDir, 'runtime', designDirectoryGrants, `${chosen.id}.json`), chosen.path);
    const destination = { storageId: chosen.id };
    const moved: DesignDocumentRef = await post(`${documents}/move`, { ref: first, destination });
    const movedDraft = await read(moved);
    expect(movedDraft.document.libraries).toEqual({ [link.documentId]: link.path });
    await expect(read({ ...destination, path: link.path })).resolves.toMatchObject({ document: { documentId: link.documentId } });

    const beui = await prepare(moved, 'beui');
    expect((await readdir(designs)).sort()).toEqual([moved.path, link.path, beui.path].sort());
    await commit(moved, movedDraft.revision, [beui]);
    const beuiSource = { ...destination, path: beui.path };
    const beuiDocument = await read(beuiSource);
    await writeFile(path.join(designs, beui.path), JSON.stringify({ ...beuiDocument.document, rootIds: [], nodes: {} }));
    await expect(prepare(moved, 'beui')).resolves.toEqual(beui);
    await expect(read(beuiSource)).resolves.toMatchObject({ document: { nodes: { 'button-primary': { component: true } } } });

    const occupied = await create('Setsuna beUI.design.json');
    const customId = 'setsuna-library-brand';
    await writeFile(path.join(resources, occupied.path), JSON.stringify({ schemaVersion: designDocumentVersion, documentId: customId, rootIds: [], nodes: {} }));
    const custom = await read(occupied);
    const original = await commit(occupied, custom.revision, [{ kind: 'insert', nodeId: 'label', parentId: null,
      node: { kind: 'text', x: 0, y: 0, width: 100, fontSize: 16, text: 'Brand' } }]);
    expect(original.document.documentId).toBe(customId);
    await expect(prepare(second, 'beui')).rejects.toThrow('workspace_entry_exists');
    await expect(read(occupied)).resolves.toMatchObject({ document: original.document, revision: original.revision });
    await expect(prepare(second, 'mdxcn')).rejects.toThrow('INVALID_INPUT');

    const query = new URLSearchParams(workspace);
    await expect(harness.runtimeFetch(`${documents}/list?${query}`)).resolves.toEqual([second.path, occupied.path].sort());
    const entries = await harness.runtimeFetch(`${documents}/entries?${query}`);
    expect(entries.map(({ path }: { path: string }) => path)).toEqual([second.path, occupied.path].sort());
    query.set('includePreviewMetadata', 'true');
    const entriesWithPresets = await harness.runtimeFetch(`${documents}/entries?${query}`);
    expect(entriesWithPresets).toContainEqual(expect.objectContaining({ path: link.path, libraryPreset: true, revision: expect.any(String) }));
    const projectEntries = await harness.runtimeFetch(`/v1/features/design/project-documents?${new URLSearchParams({ projectId: project.id })}`);
    expect(projectEntries.map(({ ref }: { ref: DesignDocumentRef }) => ref.path).sort()).toEqual([first.path, second.path, occupied.path].sort());
  } finally {
    await harness.close();
  }
});

it('previews and links a bundled preset from a standalone draft and preserves the link when the draft moves', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const documents = '/v1/features/design/documents';
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const read = (ref: DesignDocumentRef): Promise<DesignSnapshot> =>
      harness.runtimeFetch(`${documents}?${new URLSearchParams(Object.entries(ref))}`);
    const local = { storageId: 'local' };
    const { path: draftPath } = await post(documents, { ...local, parentPath: '.', name: 'Standalone.design.json' });
    const ref = { ...local, path: draftPath };
    const draft = await read(ref);
    if (!draft.workspaceRoot) throw new Error('Expected the local draft storage directory.');

    const prepare = (ref: DesignDocumentRef): Promise<Extract<DesignEdit, { kind: 'linkLibrary' }>> =>
      post('/v1/features/design/libraries/preset', { ref, presetId: 'beui' });
    const link = await prepare(ref);
    const source = { ...local, path: link.path };
    const preview = await read(source);
    expect(preview.document).toMatchObject({ documentId: link.documentId, nodes: { 'button-primary': { component: true } } });
    await expect(read(ref)).resolves.toEqual(draft);
    await expect(post(`${documents}/edits`, {
      ref: source, expectedRevision: preview.revision, edits: [{ kind: 'remove', nodeId: 'button-primary' }],
    })).rejects.toThrow('INVALID_INPUT');

    const instanceOf = `${link.documentId}:button-primary`;
    await post(`${documents}/edits`, { ref, expectedRevision: draft.revision, edits: [link, {
      kind: 'insert', nodeId: 'placed', parentId: null,
      node: { kind: 'frame', x: 0, y: 0, width: 100, height: 32, childIds: [], instanceOf },
    }] });
    expect(await readdir(draft.workspaceRoot)).toEqual([ref.path]);

    const projectRoot = path.join(harness.runtimeDataDir, 'move-destination');
    await mkdir(projectRoot);
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Moved drafts', path: projectRoot });
    const moved: DesignDocumentRef = await post(`${documents}/move`, { ref, destination: { projectId: project.id } });
    expect(await readdir(projectRoot)).toEqual([ref.path]);
    await expect(prepare(moved)).resolves.toEqual(link);
    await expect(read({ ...moved, path: link.path })).resolves.toEqual(preview);
    await expect(read(moved)).resolves.toMatchObject({
      document: { libraries: { [link.documentId]: link.path }, nodes: { placed: { instanceOf } } },
    });
  } finally {
    await harness.close();
  }
});

it('refreshes the generated beUI palette without changing existing links or custom palettes', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const documents = '/v1/features/design/documents';
    const post = (route: string, input: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(input) });
    const read = (ref: DesignDocumentRef): Promise<DesignSnapshot> =>
      harness.runtimeFetch(`${documents}?${new URLSearchParams(Object.entries(ref))}`);
    const projectRoot = path.join(harness.runtimeDataDir, 'project');
    await mkdir(projectRoot);
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Design', path: projectRoot });
    const { path: draftPath } = await post(documents, { projectId: project.id, parentPath: '.', name: 'Screen.design.json' });
    const ref = { projectId: project.id, path: draftPath };
    const prepare = () => post('/v1/features/design/libraries/preset', { ref, presetId: 'beui' });
    const link: Extract<DesignEdit, { kind: 'linkLibrary' }> = await prepare();
    const source = { ...ref, path: link.path };
    const { document: template } = await read(source);
    const draft = await post(`${documents}/edits`, { ref, expectedRevision: (await read(ref)).revision, edits: [link] });

    const primary = 'preset-color-primary';
    const foreground = 'preset-color-primaryForeground';
    const label = template.nodes['button-primary-1'];
    const swatch = template.nodes['palette-2-3'];
    if (label.kind !== 'text' || swatch.kind !== 'text') throw new Error('Expected the button and palette labels.');
    const lightStyles = Object.fromEntries(Object.entries(template.styles ?? {}).filter(([id]) => !id.startsWith('preset-palette-hex-'))
      .map(([id, style]) => [id, style.kind === 'text' ? style : { ...style, modeValues: undefined, modeAliasIds: undefined }]));
    const previous: DesignDocument = {
      ...template,
      styles: {
        ...lightStyles,
        [primary]: { kind: 'color', name: 'Primary', color: '#0285f7' },
        [foreground]: { kind: 'color', name: 'Primary foreground', color: '#071522' },
      },
      variableCollections: { default: { name: 'beUI Colors' }, charts: { name: 'Chart colors' } },
      nodes: {
        ...template.nodes,
        'button-primary-1': { ...label, text: 'Project label', fills: [{ color: '#071522', styleId: foreground }] },
        'palette-2-3': { ...swatch, text: '#0285F7', variableIds: undefined },
      },
    };
    const sourceFile = path.join(projectRoot, link.path);
    await writeFile(sourceFile, JSON.stringify(previous));
    await expect(prepare()).resolves.toEqual(link);
    await expect(read(source)).resolves.toMatchObject({
      document: {
        documentId: link.documentId,
        styles: { [primary]: template.styles?.[primary], [foreground]: template.styles?.[foreground] },
        nodes: {
          'button-primary-1': { text: 'Project label', fills: label.fills },
          'palette-2-3': { text: swatch.text, variableIds: swatch.variableIds },
        },
      },
    });
    await expect(read(ref)).resolves.toMatchObject({ document: { libraries: { [link.documentId]: link.path } }, revision: draft.revision });

    await writeFile(sourceFile, JSON.stringify({
      ...template,
      styles: { ...template.styles, [primary]: { kind: 'color', name: 'Custom primary', color: '#2d7a63', modeValues: { dark: '#82d3b7' } } },
      variableCollections: { ...template.variableCollections, default: { name: 'Custom colors', modes: { dark: 'Studio Night' } } },
    }));
    const custom = await read(source);
    await expect(prepare()).resolves.toEqual(link);
    await expect(read(source)).resolves.toEqual(custom);
  } finally {
    await harness.close();
  }
});
