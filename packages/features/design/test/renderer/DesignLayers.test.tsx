// @vitest-environment happy-dom

import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { bundledDesignLibraryDocumentId } from '../../src/contracts/design-library-presets.js';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { DesignDocumentSurface } from '../../src/renderer/DesignDocumentSurface.js';
import { createEditorFixture, drawing, mountEditor } from './support/mount-design-editor.js';

afterEach(() => window.localStorage.clear());

it('saves the layer thumbnail preference and skips thumbnail work in a subsequent library preview', async () => {
  const preferencesKey = 'setsuna.design.canvas-settings';
  localStorage.setItem(preferencesKey, JSON.stringify({ snapToObjects: false }));
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    observe = observe;
    disconnect = disconnect;
    unobserve() {}
  });
  const draft: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'], nodes: {
    board: { kind: 'frame', name: 'Board', x: 0, y: 0, width: 100, height: 80, childIds: [] },
  } };
  const { commit } = await mountEditor(draft);
  await waitFor(() => expect(observe).toHaveBeenCalledOnce());

  const user = userEvent.setup();
  const title = 'feature.design.settings.title';
  await user.click(screen.getByRole('button', { name: title }));
  const settings = within(await screen.findByRole('dialog', { name: title }));
  await user.click(settings.getByRole('tab', { name: 'feature.design.settings.appearance' }));
  const toggle = settings.getByRole('switch', { name: 'feature.design.settings.layerThumbnails' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await user.click(toggle);
  expect(JSON.parse(localStorage.getItem(preferencesKey)!)).toMatchObject({ snapToObjects: false, showLayerThumbnails: false });
  expect(disconnect).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();

  cleanup();
  observe.mockClear();
  const { client, documentRef } = createEditorFixture({ ...draft, documentId: bundledDesignLibraryDocumentId('beui') });
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignDocumentSurface client={client} documentRef={documentRef} libraryPreview="light" translate={(key) => key} />
  </ToastProvider></UiProvider>);
  await user.click(await screen.findByRole('button', { name: 'Board' }));
  await screen.findByRole('complementary', { name: 'feature.design.properties' });
  expect(observe).not.toHaveBeenCalled();
});

it('starts with collapsed layers and restores expansion for the right draft after switching and reopening', async () => {
  const draft: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'layout', rootIds: ['frame'], nodes: {
    frame: { kind: 'frame', name: 'Layout', x: 0, y: 0, width: 300, height: 200, childIds: ['tile'] },
    tile: { kind: 'rectangle', name: 'Tile', x: 12, y: 12, width: 40, height: 30, cornerRadius: 0 },
  } };
  const openDraft = () => mountEditor(draft, undefined, { documentPath: 'layout.design.json' });
  const tile = () => screen.queryByRole('button', { name: 'Tile' });

  const first = await openDraft();
  await screen.findByRole('button', { name: 'Layout' });
  expect(tile()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
  expect(tile()).not.toBeNull();
  expect(first.commit).not.toHaveBeenCalled();
  cleanup();

  await mountEditor({ ...draft, documentId: 'alternate' }, undefined, { documentPath: 'alternate.design.json' });
  await screen.findByRole('button', { name: 'Layout' });
  expect(tile()).toBeNull();
  cleanup();

  const reopened = await openDraft();
  await screen.findByRole('button', { name: 'Tile' });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.collapseLayer' }));
  expect(tile()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Layout', pressed: false })).not.toBeNull();
  expect(reopened.commit).not.toHaveBeenCalled();
  cleanup();

  await openDraft();
  await screen.findByRole('button', { name: 'Layout' });
  expect(tile()).toBeNull();
});

it('reveals a canvas selection through collapsed ancestors and can reveal the same layer again', async () => {
  await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'nested', rootIds: ['board'], nodes: {
    board: { kind: 'frame', name: 'Board', x: 0, y: 0, width: 300, height: 200, childIds: ['panel'] },
    panel: { kind: 'frame', name: 'Panel', x: 10, y: 10, width: 160, height: 100, childIds: ['tile'] },
    tile: { kind: 'rectangle', name: 'Tile', x: 12, y: 12, width: 40, height: 30, cornerRadius: 0 },
  } });
  const canvas = await screen.findByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  function selectTile() {
    drawing.hit = 'tile';
    const point = { pointerId: 1, button: 0, clientX: 78, clientY: 80 };
    fireEvent.pointerDown(canvas, point);
    fireEvent.pointerUp(canvas, point);
    const tile = screen.getByRole('button', { name: 'Tile', pressed: true });
    expect(scroll.mock.contexts.at(-1)).toBe(tile);
  }

  expect(screen.queryByRole('button', { name: 'Tile' })).toBeNull();
  selectTile();
  const panel = screen.getByRole('button', { name: 'Panel' }).closest<HTMLElement>('[data-design-layer-id]')!;
  fireEvent.click(within(panel).getByRole('button', { name: 'feature.design.collapseLayer' }));
  expect(screen.queryByRole('button', { name: 'Tile' })).toBeNull();
  selectTile();

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.collapseAllLayers' }));
  expect(screen.queryByRole('button', { name: 'Panel' })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.name' }).value).toBe('Tile');
  expect(localStorage.getItem('setsuna.design.expanded-layers:nested')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
  expect(screen.getByRole('button', { name: 'Panel' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tile' })).toBeNull();
  selectTile();
});
