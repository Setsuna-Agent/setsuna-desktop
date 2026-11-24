// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { designDocumentVersion, type DesignFrame } from '../../../src/contracts/index.js';
import { DesignTasks } from '../../../src/runtime/design-tasks.js';
import DesignWorkspace from '../../../src/renderer/DesignWorkspace.js';
import { renderDesignThumbnail } from '../../../src/renderer/canvas/DesignThumbnail.js';
import { DesignSharedLibraries } from '../../../src/renderer/styles/DesignSharedLibraries.js';
import { createEditorFixture, designDragEvent, designDragTransfer, drawing, mountEditor } from '../support/mount-design-editor.js';

vi.mock('../../../src/renderer/design-text.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/renderer/design-text.js')>(),
  measureDesignText: () => ({ width: 70, height: 18 }),
}));
vi.mock('../../../src/renderer/canvas/DesignThumbnail.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/renderer/canvas/DesignThumbnail.js')>(), renderDesignThumbnail: vi.fn(),
}));

const viewKey = 'setsuna.design.component-view';
afterEach(() => { cleanup(); window.localStorage.removeItem(viewKey); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function observeLibraryPreviews() {
  const visible = new Map<Element, () => void>();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly notify: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
    observe(target: Element) { visible.set(target, () => this.notify([{ target, isIntersecting: true }])); }
    unobserve(target: Element) { visible.delete(target); }
    disconnect() { visible.clear(); }
  });
  return (card: HTMLElement) => visible.get(card.querySelector('[data-design-thumbnail]')!)!();
}

it('opens, links and unlinks the chosen preset without preparing it on browse', async () => {
  const path = 'Setsuna beUI.design.json';
  const documentId = 'setsuna-library-beui-123e4567-e89b-42d3-a456-426614174000';
  const frame = { kind: 'frame', x: 0, y: 0, width: 96, height: 40, childIds: [] } satisfies DesignFrame;
  const { client, documentRef, commit, read } = createEditorFixture({
    schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['frame'], nodes: { frame },
  }, undefined, {
    libraries: {
      [path]: { schemaVersion: designDocumentVersion, documentId, rootIds: ['button'],
        variableCollections: {
          default: { name: 'beUI Colors', defaultModeName: 'Light', modes: { dark: 'Dark' } },
          charts: { name: 'Chart colors', defaultModeName: 'Light', modes: { dark: 'Dark' } },
        },
        nodes: { button: { ...frame, name: 'Library button', component: true } } },
    },
    tasks: (service) => new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, service),
  });
  const prepare = vi.fn().mockResolvedValue({ kind: 'linkLibrary', documentId, path });
  const onLocationChange = vi.fn();
  const workspace = <DesignWorkspace client={{ ...client, prepareLibraryPreset: prepare }} location={documentRef} onLocationChange={onLocationChange}
    projects={[{ id: documentRef.projectId, name: 'Project', path: '/project', roots: [{ id: documentRef.rootId, path: '/project' }],
      createdAt: '', updatedAt: '' }]} watchDirectories={() => () => undefined}
    renderChat={() => <textarea aria-label="Draft chat" />} translate={(key) => key} />;
  const view = (colorScheme: 'light' | 'dark') => <UiProvider locale="en-US"><ToastProvider>
    {cloneElement(workspace, { colorScheme })}
  </ToastProvider></UiProvider>;
  const { rerender } = render(view('light'));
  const user = userEvent.setup();
  const library = 'feature.design.library';
  async function openPresets() {
    await user.click(await screen.findByRole('button', { name: library }));
    const panel = within(await screen.findByRole('dialog', { name: library }));
    await user.click(panel.getByRole('button', { name: library }));
    return panel;
  }

  await screen.findByRole('textbox', { name: 'Draft chat' });
  const panel = await openPresets();
  const card = within(panel.getByRole('article', { name: 'beUI' }));
  expect(prepare).not.toHaveBeenCalled();
  await user.click(card.getByRole('button', { name: 'feature.design.openLibrarySource' }));
  const libraryLayer = await screen.findByRole('button', { name: 'Library button' });
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ ref: documentRef, presetId: 'beui' }, expect.any(AbortSignal));
  expect(screen.queryByRole('textbox', { name: 'Draft chat' })).toBeNull();

  const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  drawing.hit = 'button';
  const point = { pointerId: 1, button: 0, clientX: 48, clientY: 20 };
  fireEvent.pointerDown(canvas, point);
  fireEvent.pointerUp(canvas, point);
  const properties = within(await screen.findByRole('complementary', { name: 'feature.design.properties' }));
  const modes = () => ['beUI Colors', 'Chart colors'].map((name) => properties.getByRole('combobox', { name }).textContent);
  expect(modes()).toEqual(['beUI Colors · Light', 'Chart colors · Light']);
  rerender(view('dark'));
  expect(modes()).toEqual(['beUI Colors · Dark', 'Chart colors · Dark']);
  rerender(view('light'));
  expect(modes()).toEqual(['beUI Colors · Light', 'Chart colors · Light']);
  const name = properties.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.name' });
  const width = properties.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.width' });
  expect(width.value).toBe(String(frame.width));
  expect(width.readOnly).toBe(true);
  await user.type(name, ' changed{Enter}');
  expect(name.value).toBe('Library button');

  await user.click(properties.getByRole('button', { name: 'feature.design.collapseProperties' }));
  expect(screen.queryByRole('complementary', { name: 'feature.design.properties' })).toBeNull();
  await user.click(libraryLayer);
  await screen.findByRole('complementary', { name: 'feature.design.properties' });
  await user.click(screen.getByRole('button', { name: 'feature.design.unlockLayer' }));
  canvas.focus();
  await user.keyboard('{Delete}');
  expect(commit).not.toHaveBeenCalled();
  expect(onLocationChange).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'feature.design.backToDraft' }));
  await screen.findByRole('textbox', { name: 'Draft chat' });
  const returned = within((await openPresets()).getByRole('article', { name: 'beUI' }));
  await user.click(returned.getByRole('button', { name: 'feature.design.linkLibrary' }));
  await waitFor(async () => expect((await read()).document.libraries).toEqual({ [documentId]: path }));
  await user.click(await returned.findByRole('button', { name: 'feature.design.unlinkLibrary' }));
  await waitFor(async () => expect((await read()).document.libraries).toBeUndefined());
});

it('previews and connects the source on the shared card found by search', async () => {
  const showPreview = observeLibraryPreviews();
  const path = 'shared/feedback.design.json';
  const frame = { kind: 'frame', x: 0, y: 0, width: 160, height: 90, childIds: [] } as const;
  const draft = { schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: [], nodes: {} };
  const source = { ...draft, documentId: 'feedback', rootIds: ['board'], nodes: { board: frame } };
  const { client, documentRef } = createEditorFixture(draft, undefined, { libraries: { [path]: source } });
  const connect = vi.fn().mockResolvedValue(true);
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignSharedLibraries document={draft} documentRef={documentRef} disabled={false} translate={(key) => key}
      client={{ ...client, listEntries: async () => [{ path }, { path: 'shared/forms.design.json' }] }} onLink={connect} onUnlink={vi.fn()} />
  </ToastProvider></UiProvider>);

  const user = userEvent.setup();
  await screen.findByRole('article', { name: 'shared/forms.design.json' });
  await user.type(screen.getByRole('textbox', { name: 'feature.design.librarySearch' }), 'feedback');
  expect(screen.queryByRole('article', { name: 'shared/forms.design.json' })).toBeNull();
  const card = screen.getByRole('article', { name: path });
  act(() => showPreview(card));
  await waitFor(() => expect(vi.mocked(renderDesignThumbnail).mock.lastCall?.[0].document.documentId).toBe('feedback'));
  expect(connect).not.toHaveBeenCalled();
  await user.click(within(card).getByRole('button', { name: 'feature.design.linkLibrary' }));
  await waitFor(() => expect(connect).toHaveBeenCalledExactlyOnceWith('feedback', path));
});

it('commits only completed canvas drops and places linked components at the drop point', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 96, height: 40, childIds: [], component: true } satisfies DesignFrame;
  const path = 'shared/controls.design.json';
  const { read, commit } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'screen', rootIds: ['master', 'board'], libraries: { controls: path },
    nodes: {
      master: { ...frame, name: 'Main component', width: 1440, height: 900 },
      board: { ...frame, name: 'Small board', x: 1500, width: 522, height: 196, clip: true, component: undefined, childIds: ['tile'],
        layout: { direction: 'horizontal', gap: 8, padding: 0, align: 'start' } },
      tile: { kind: 'rectangle', x: 0, y: 0, width: 100, height: 40, cornerRadius: 0 },
    },
  }, undefined, { libraries: { [path]: {
    schemaVersion: designDocumentVersion, documentId: 'controls', rootIds: ['button', 'loading'], nodes: {
      button: { ...frame, name: 'Button' },
      loading: { ...frame, name: 'Button', componentSet: 'button', variantName: 'Loading' },
    },
  } } });

  const user = userEvent.setup();
  const title = 'feature.design.library';
  const trigger = await screen.findByRole('button', { name: title });
  const canvas = screen.getByRole('region', { name: 'feature.design.canvas' });
  const board = screen.getByRole('button', { name: 'Small board' });
  await user.click(board);
  await user.click(trigger);
  const local = within(await screen.findByRole('dialog', { name: title }));
  const master = local.getByTitle('Main component');
  await user.click(master);
  expect(commit).not.toHaveBeenCalled();

  const grab = { x: 30, y: 40 };
  const release = { x: 1768, y: 168 };
  const cancelled = designDragTransfer();
  designDragEvent('dragstart', master, cancelled, grab);
  expect(designDragEvent('dragover', canvas, cancelled, release)).toBe(false);
  designDragEvent('dragend', master, cancelled, release);
  expect(designDragEvent('drop', canvas, cancelled, release)).toBe(true);
  expect(commit).not.toHaveBeenCalled();

  await user.click(local.getByRole('button', { name: 'feature.design.showComponentList' }));
  const transfer = designDragTransfer();
  designDragEvent('dragstart', local.getByTitle('Main component'), transfer, grab);
  designDragEvent('dragover', canvas, transfer, { ...release, x: release.x - 10 });
  expect(designDragEvent('drop', canvas, transfer, release)).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
  const { document } = await read();
  expect(document.rootIds.map((id) => document.nodes[id])).toContainEqual(expect.objectContaining({
    instanceOf: 'master', width: 1440, height: 900, x: 980, y: -350,
  }));

  await user.click(trigger);
  const shared = within(await screen.findByRole('dialog', { name: title }));
  await user.type(shared.getByRole('textbox', { name: 'feature.design.componentSearch' }), 'loading');
  await user.click(shared.getByRole('button', { name: 'feature.design.showComponentGrid' }));
  expect(shared.queryByTitle('Main component')).toBeNull();
  const variant = await shared.findByTitle(/^Button · Loading · /u);
  const sharedTransfer = designDragTransfer();
  const slot = { x: 1598, y: 98 };
  designDragEvent('dragstart', variant, sharedTransfer, grab);
  designDragEvent('dragover', canvas, sharedTransfer, slot);
  expect(designDragEvent('drop', canvas, sharedTransfer, slot)).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
  const inserted = (await read()).document;
  const target = inserted.nodes.board as DesignFrame;
  expect(target.childIds.map((id) => inserted.nodes[id])).toEqual([
    expect.objectContaining({ instanceOf: 'controls:loading' }), inserted.nodes.tile,
  ]);
  expect(commit).toHaveBeenCalledTimes(2);
});

it('keeps a moved library search open while selecting a layer and closes it on request', async () => {
  const user = userEvent.setup();
  const title = 'feature.design.library';
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'],
    nodes: { board: { kind: 'frame', name: 'Artboard', x: 0, y: 0, width: 240, height: 120, childIds: [] } } });

  await user.click(await screen.findByRole('button', { name: title }));
  const libraryWindow = await screen.findByRole('dialog', { name: title });
  const panel = within(libraryWindow);
  const search = panel.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.componentSearch' });
  await user.type(search, 'Card');

  const grip = panel.getByRole('group', { name: 'feature.design.toolWindowHandle' });
  const capturePointer = vi.fn();
  grip.setPointerCapture = capturePointer;
  libraryWindow.getBoundingClientRect = () => new DOMRect(80, 96, 480, 360);
  const pointer = { pointerId: 1, button: 0, clientX: 320, clientY: 113 };
  fireEvent.pointerDown(grip, pointer);
  fireEvent.pointerMove(grip, { ...pointer, clientX: 380, clientY: 150 });
  fireEvent.pointerUp(grip, { ...pointer, clientX: 380, clientY: 150 });
  expect(capturePointer).toHaveBeenCalledExactlyOnceWith(pointer.pointerId);

  await user.click(screen.getByRole('button', { name: 'Artboard' }));
  const inspector = within(await screen.findByRole('complementary', { name: 'feature.design.properties' }));
  expect(inspector.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.name' }).value).toBe('Artboard');
  expect(screen.getByRole('dialog', { name: title })).toBe(libraryWindow);
  expect(panel.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.componentSearch' }).value).toBe('Card');

  await user.click(panel.getByRole('button', { name: 'feature.design.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
});

it('saves the chosen component view and restores it in a fresh editor for another draft', async () => {
  const user = userEvent.setup();
  const title = 'feature.design.library';
  const draft = { schemaVersion: designDocumentVersion, documentId: 'first', rootIds: [], nodes: {} };

  async function openLibrary() {
    await user.click(await screen.findByRole('button', { name: title }));
    return within(await screen.findByRole('dialog', { name: title }));
  }

  const first = await mountEditor(draft, undefined, { documentPath: 'first.design.json' });
  const firstLibrary = await openLibrary();
  await user.click(firstLibrary.getByRole('button', { name: 'feature.design.showComponentList' }));
  expect(window.localStorage.getItem(viewKey)).toBe('list');
  expect(first.commit).not.toHaveBeenCalled();

  cleanup();
  const next = await mountEditor({ ...draft, documentId: 'second' }, undefined, { documentPath: 'second.design.json' });
  const nextLibrary = await openLibrary();
  await user.click(nextLibrary.getByRole('button', { name: 'feature.design.showComponentGrid' }));
  expect(window.localStorage.getItem(viewKey)).toBe('grid');
  expect(next.commit).not.toHaveBeenCalled();
});

it('unlinks a shared library in one edit while keeping placed content and resolved board values', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 96, height: 40, childIds: [] } satisfies DesignFrame;
  const path = 'shared/controls.design.json';
  const other = 'shared/icons.design.json';
  const { read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'screen', rootIds: ['template', 'board'], libraries: { controls: path, icons: other },
    styles: { accent: { kind: 'color', name: 'Local accent', color: '#000000', aliasId: 'controls:accent' } },
    nodes: {
      template: { ...frame, component: true, childIds: ['embedded'] },
      embedded: { ...frame, instanceOf: 'controls:card' },
      board: { ...frame, width: 300, height: 200, variableModeIds: { controls: 'dark' }, childIds: ['placed', 'badge'] },
      placed: { ...frame, instanceOf: 'template', contentOverrides: { 'embedded/controls:label': { kind: 'text', text: 'Custom label' } } },
      badge: { kind: 'rectangle', x: 0, y: 60, width: 80, height: 30, cornerRadius: 0, fills: [{ color: '#000000', styleId: 'controls:accent' }] },
    },
  }, undefined, { libraries: {
    [path]: { schemaVersion: designDocumentVersion, documentId: 'controls', rootIds: ['card'],
      variableCollections: { default: { modes: { dark: 'Dark' } } },
      styles: { accent: { kind: 'color', name: 'Accent', color: '#112233', modeValues: { dark: '#445566' } } },
      nodes: {
        card: { ...frame, name: 'Shared card', component: true, childIds: ['label'] },
        label: { kind: 'text', x: 2, y: 2, width: 70, fontSize: 14, text: 'Shared label' },
      },
    },
    [other]: { schemaVersion: designDocumentVersion, documentId: 'icons', rootIds: [], nodes: {} },
  } });

  const user = userEvent.setup();
  const title = 'feature.design.library';
  await user.click(await screen.findByRole('button', { name: title }));
  const panel = within(await screen.findByRole('dialog', { name: title }));
  await panel.findByTitle(/^Shared card · /u);
  await user.click(panel.getByRole('button', { name: 'feature.design.sharedLibraries' }));
  const card = within(panel.getByRole('article', { name: path }));
  await user.click(card.getByRole('button', { name: 'feature.design.unlinkLibrary' }));

  await waitFor(async () => expect((await read()).document.libraries).toEqual({ icons: other }));
  const { document } = await read();
  expect(document.nodes.placed).toMatchObject({ instanceOf: undefined, contentOverrides: undefined });
  expect(document.nodes.embedded).toMatchObject({ instanceOf: undefined });
  expect(Object.values(document.nodes).filter((node) => node.kind === 'text').map((node) => node.text).sort())
    .toEqual(['Custom label', 'Shared label']);
  expect(document.nodes.badge).toMatchObject({ fills: [{ color: '#445566', styleId: undefined }] });
  expect(document.nodes.board).toMatchObject({ variableModeIds: undefined });
  expect(document.styles?.accent).toMatchObject({ color: '#112233', aliasId: undefined });

  await user.click(screen.getByRole('button', { name: 'feature.design.undo' }));
  await waitFor(async () => expect((await read()).document).toMatchObject({
    libraries: { controls: path, icons: other }, nodes: { placed: { instanceOf: 'template' }, embedded: { instanceOf: 'controls:card' } },
  }));
});
