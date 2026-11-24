// @vitest-environment happy-dom

import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { designBundledFontFamilies, type DesignCustomFont } from '../../../src/contracts/design-fonts.js';
import { designDocumentVersion, type DesignDocument, type DesignDocumentRef } from '../../../src/contracts/index.js';
import DesignWorkspace, { type DesignWorkspaceProps } from '../../../src/renderer/DesignWorkspace.js';
import { renderDesignThumbnail } from '../../../src/renderer/canvas/DesignThumbnail.js';
import { renderDesignCatalogPreview } from '../../../src/renderer/catalog/design-catalog-preview.js';
import { measureDesignText } from '../../../src/renderer/design-text.js';
import { designFontCatalogChannel } from '../../../src/renderer/text/design-font-loader.js';
import { createEditorFixture } from '../support/mount-design-editor.js';

vi.mock('../../../src/renderer/canvas/DesignThumbnail.js', async (original) => ({
  ...await original<typeof import('../../../src/renderer/canvas/DesignThumbnail.js')>(), renderDesignThumbnail: vi.fn(),
}));
vi.mock('../../../src/renderer/design-text.js', async (original) => ({
  ...await original<typeof import('../../../src/renderer/design-text.js')>(), measureDesignText: vi.fn(() => ({ width: 72, height: 16 })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function observeCatalogPreviews() {
  const nearby = new Map<Element, (isIntersecting: boolean) => void>();
  vi.stubGlobal('IntersectionObserver', class {
    private readonly elements = new Set<Element>();
    constructor(private readonly notify: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
    observe(target: Element) {
      this.elements.add(target);
      nearby.set(target, (isIntersecting) => this.notify([{ target, isIntersecting }]));
    }
    unobserve(target: Element) { this.elements.delete(target); nearby.delete(target); }
    disconnect() { for (const target of this.elements) this.unobserve(target); }
  });
  return (row: HTMLElement, isIntersecting = true) => nearby.get(row.querySelector('[data-design-thumbnail]')!)!(isIntersecting);
}

it('repaints a catalog thumbnail when its saved shared library changes', async () => {
  const showPreview = observeCatalogPreviews();
  const ref = { storageId: 'local', path: 'Screen.design.json' };
  const source = { projectId: 'project', rootId: 'library-root', path: 'drafts/Screen.design.json' };
  const independentPath = 'Independent.design.json';
  const libraryPath = 'Shared.design.json';
  const frame = { kind: 'frame', x: 0, y: 0, width: 128, height: 48 } as const;
  const label = { kind: 'text', text: 'Continue', x: 12, y: 12, width: 90, fontSize: 16 } as const;
  const fill = { color: '#0072e8' };
  const document: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'screen', rootIds: ['instance'], libraries: { shared: libraryPath },
    nodes: { instance: { ...frame, instanceOf: 'shared:button', childIds: [] } },
  };
  const independent: DesignDocument = { ...document, documentId: 'independent', libraries: undefined, nodes: {
    instance: { ...frame, childIds: [] },
  } };
  let library: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'shared', rootIds: ['button'],
    nodes: {
      button: { ...frame, component: true, childIds: ['label'], fills: [fill] },
      label,
    },
  };
  const snapshot = (document: DesignDocument) => ({ document, revision: document.documentId, canUndo: false, canRedo: false });
  const { client } = createEditorFixture(document);
  const read = vi.fn(async (target: DesignDocumentRef) => {
    if (target.path === ref.path) return snapshot(document);
    if (target.path === independentPath) return snapshot(independent);
    if (target.projectId === source.projectId && target.rootId === source.rootId && target.path === libraryPath) return snapshot(library);
    throw new Error('The library is only available in the saved resource root.');
  });
  const projectRoot = '/project';
  const projects: DesignWorkspaceProps['projects'] = [{ id: source.projectId, name: 'Project', createdAt: '', updatedAt: '',
    roots: [{ id: source.rootId, path: projectRoot }] }];
  let libraryRevision = 'first';
  let libraryChanged: (() => void) | undefined;
  const view = render(<ToastProvider><DesignWorkspace location={null} projects={projects} onLocationChange={vi.fn()} translate={(key) => key}
    watchDirectories={(root, _paths, changed) => {
      if (root === projectRoot) libraryChanged = changed;
      return () => undefined;
    }} client={{ ...client, read, resolveResourceRoot: async () => source,
      catalog: async () => ({ directories: [{ id: 'local', path: `${projectRoot}/drafts` }], associations: [] }),
      listEntries: async (scope) => scope.storageId
        ? [{ path: ref.path, revision: 'screen' }, { path: independentPath, revision: 'independent' }]
        : [{ path: libraryPath, revision: libraryRevision }],
    }} /></ToastProvider>);

  const screens = await Promise.all([independentPath, ref.path].map((path) => view.findByRole('button', { name: `feature.design.localDesigns / ${path}` })));
  act(() => { for (const row of screens) showPreview(row); });
  await waitFor(() => expect(renderDesignThumbnail).toHaveBeenCalledTimes(2));
  const projectedBoard = (text: string) => expect.objectContaining({
    ids: ['instance'],
    document: expect.objectContaining({ nodes: expect.objectContaining({
      instance: expect.objectContaining({ childIds: ['instance/shared:label'], fills: [fill] }),
      'instance/shared:label': expect.objectContaining({ text }),
    }) }),
  });
  expect(renderDesignThumbnail).toHaveBeenCalledWith(projectedBoard('Continue'), expect.any(Function), 512, expect.any(AbortSignal));

  library = { ...library, nodes: { ...library.nodes, label: { ...label, text: 'Confirm' } } };
  libraryRevision = 'second';
  act(() => libraryChanged!());
  await waitFor(() => expect(renderDesignThumbnail).toHaveBeenLastCalledWith(projectedBoard('Confirm'), expect.any(Function), 512, expect.any(AbortSignal)));
  expect(read.mock.calls.filter(([target]) => target.path === independentPath)).toHaveLength(1);
});

it('waits for bundled and imported font data before measuring the previewed board', async () => {
  const decode = Promise.withResolvers<void>();
  const decoding = vi.fn();
  const fonts = stubFontRegistration(async () => { decoding(); await decode.promise; });
  const face: DesignCustomFont = { id: '1'.repeat(64), family: 'Imported', name: 'Imported Regular', format: 'woff2',
    minWeight: 400, maxWeight: 400, style: 'normal', embeddable: true };
  const unused = { ...face, id: '2'.repeat(64), family: 'Other board' };
  const fontRead = vi.fn(async () => ({ base64: 'Zm9udA==' }));
  const frame = { kind: 'frame', x: 0, y: 0, width: 128, height: 48 } as const;
  const text = { kind: 'text', x: 12, y: 12, width: 90, fontSize: 16, text: 'Sample' } as const;
  const { client, documentRef } = createEditorFixture({
    documentId: 'font-preview', schemaVersion: designDocumentVersion, rootIds: ['board', 'other'], nodes: {
      board: { ...frame, childIds: ['label'] }, other: { ...frame, childIds: ['outside'] },
      label: { ...text, fontFamily: designBundledFontFamilies.geist, runs: [{ start: 0, end: 2, fontFamily: face.family }] },
      outside: { ...text, fontFamily: unused.family },
    },
  }, undefined, { fonts: { list: async () => [face, unused], read: fontRead, import: vi.fn(), remove: vi.fn() } });
  const measure = vi.mocked(measureDesignText);
  measure.mockImplementationOnce(() => {
    expect(fonts.registered.size).toBe(2);
    return { width: 72, height: 16 };
  });
  const signal = new AbortController();
  const preview = renderDesignCatalogPreview(client, documentRef, signal.signal);
  try {
    await vi.waitFor(() => expect(decoding).toHaveBeenCalledTimes(2));
    expect(measure).not.toHaveBeenCalled();
    decode.resolve();
    await preview;
    expect(measure).toHaveBeenCalled();
    expect(renderDesignThumbnail).toHaveBeenCalledOnce();
    expect(fontRead).toHaveBeenCalledExactlyOnceWith(face.id, expect.any(AbortSignal));
  } finally {
    signal.abort();
    decode.resolve();
    await preview.catch(() => undefined);
    fonts.restore();
  }
});

it('refreshes a cached preview when another window imports or removes its font', async () => {
  const showPreview = observeCatalogPreviews();
  const fonts = stubFontRegistration();
  const face: DesignCustomFont = { id: '1'.repeat(64), family: 'Imported', name: 'Imported Regular', format: 'woff2',
    minWeight: 400, maxWeight: 400, style: 'normal', embeddable: true };
  let imported: readonly DesignCustomFont[] = [];
  const read = vi.fn(async () => ({ base64: 'Zm9udA==' }));
  const { client, documentRef } = createEditorFixture({
    documentId: 'imported-font', schemaVersion: designDocumentVersion, rootIds: ['label'], nodes: {
      label: { kind: 'text', x: 0, y: 0, width: 90, fontSize: 16, text: 'Sample', fontFamily: face.family },
    },
  }, undefined, { fonts: { list: async () => imported, read, import: vi.fn(), remove: vi.fn() } });
  const projects: DesignWorkspaceProps['projects'] = [{ id: 'project', name: 'Project', path: '/project', createdAt: '', updatedAt: '' }];
  const sender = new BroadcastChannel(designFontCatalogChannel);
  const view = render(<ToastProvider><DesignWorkspace location={null} projects={projects} onLocationChange={vi.fn()} translate={(key) => key}
    client={{ ...client, listEntries: async () => [{ path: documentRef.path }] }} /></ToastProvider>);
  try {
    const row = await view.findByRole('button', { name: `Project / ${documentRef.path}` });
    act(() => showPreview(row));
    await waitFor(() => expect(renderDesignThumbnail).toHaveBeenCalledOnce());
    expect(read).not.toHaveBeenCalled();

    imported = [face];
    sender.postMessage(null);
    await waitFor(() => expect(renderDesignThumbnail).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenCalledExactlyOnceWith(face.id, expect.any(AbortSignal));
    expect(fonts.registered.size).toBe(1);

    imported = [];
    sender.postMessage(null);
    await waitFor(() => expect(renderDesignThumbnail).toHaveBeenCalledTimes(3));
    expect(fonts.registered.size).toBe(0);
  } finally {
    sender.close();
    view.unmount();
    fonts.restore();
  }
});

it('releases the thumbnail queue when a font read outlives the scrolled-away preview', async () => {
  const showPreview = observeCatalogPreviews();
  const face: DesignCustomFont = { id: '1'.repeat(64), family: 'Imported', name: 'Imported Regular', format: 'woff2',
    minWeight: 400, maxWeight: 400, style: 'normal', embeddable: true };
  const pending = Promise.withResolvers<{ base64: string }>();
  const readFont = vi.fn((_id: string, _signal?: AbortSignal) => pending.promise);
  const label = { kind: 'text', x: 0, y: 0, width: 90, fontSize: 16, text: 'Sample' } as const;
  const { client, documentRef } = createEditorFixture({
    documentId: 'slow-font', schemaVersion: designDocumentVersion, rootIds: ['label'], nodes: { label: { ...label, fontFamily: face.family } },
  }, undefined, { fonts: { list: async () => [face], read: readFont, import: vi.fn(), remove: vi.fn() } });
  const second = 'System.design.json';
  const system: DesignDocument = { documentId: 'system-font', schemaVersion: designDocumentVersion, rootIds: ['label'], nodes: { label } };
  const projects: DesignWorkspaceProps['projects'] = [{ id: 'project', name: 'Project', path: '/project', createdAt: '', updatedAt: '' }];
  const view = render(<ToastProvider><DesignWorkspace location={null} projects={projects} onLocationChange={vi.fn()} translate={(key) => key}
    client={{ ...client, listEntries: async () => [{ path: documentRef.path }, { path: second }],
      read: (ref, signal) => ref.path === second ? Promise.resolve({ document: system, revision: 'system', canUndo: false, canRedo: false })
        : client.read(ref, signal),
    }} /></ToastProvider>);
  try {
    const firstRow = await view.findByRole('button', { name: `Project / ${documentRef.path}` });
    const secondRow = view.getByRole('button', { name: `Project / ${second}` });
    act(() => showPreview(firstRow));
    await waitFor(() => expect(readFont).toHaveBeenCalledOnce());
    const [, signal] = readFont.mock.calls[0];
    expect(signal?.aborted).toBe(false);
    act(() => { showPreview(firstRow, false); showPreview(secondRow); });
    await waitFor(() => expect(renderDesignThumbnail).toHaveBeenCalledOnce());
    expect(vi.mocked(renderDesignThumbnail).mock.lastCall?.[0].document.documentId).toBe('system-font');
    expect(signal?.aborted).toBe(true);
  } finally {
    view.unmount();
    pending.resolve({ base64: 'Zm9udA==' });
  }
});

function stubFontRegistration(decode: () => Promise<void> = async () => undefined) {
  const registered = new Set<object>();
  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: registered });
  vi.stubGlobal('FontFace', class {
    async load() { await decode(); return this; }
  });
  return { registered, restore: () => {
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
  } };
}
