// @vitest-environment happy-dom

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { designDocumentVersion, type DesignFrame } from '../../../src/contracts/index.js';
import { designDragEvent, designDragTransfer, mountEditor } from '../support/mount-design-editor.js';

vi.mock('../../../src/renderer/design-text.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/renderer/design-text.js')>(),
  measureDesignText: () => ({ width: 70, height: 18 }),
}));

const viewKey = 'setsuna.design.component-view';
afterEach(() => { window.localStorage.removeItem(viewKey); });

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
  await user.click(panel.getByRole('button', { name: path }));
  await user.click(panel.getByRole('button', { name: 'feature.design.unlinkLibrary' }));

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
