// @vitest-environment happy-dom

import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { mountEditor } from './support/mount-design-editor.js';

afterEach(() => window.localStorage.clear());

it('restores layer expansion for the right draft after switching and reopening', async () => {
  const draft: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'layout', rootIds: ['frame'], nodes: {
    frame: { kind: 'frame', name: 'Layout', x: 0, y: 0, width: 300, height: 200, childIds: ['tile'] },
    tile: { kind: 'rectangle', name: 'Tile', x: 12, y: 12, width: 40, height: 30, cornerRadius: 0 },
  } };
  const openDraft = () => mountEditor(draft, undefined, { documentPath: 'layout.design.json' });
  const tile = () => screen.queryByRole('button', { name: 'Tile' });

  const first = await openDraft();
  await screen.findByRole('button', { name: 'Tile' });
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
  expect(screen.queryByRole('button', { name: 'Layout', pressed: true })).not.toBeNull();
  expect(tile()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.collapseLayer' }));
  expect(tile()).toBeNull();
  expect(first.commit).not.toHaveBeenCalled();
  cleanup();

  await mountEditor({ ...draft, documentId: 'alternate' }, undefined, { documentPath: 'alternate.design.json' });
  await screen.findByRole('button', { name: 'Tile' });
  cleanup();

  const reopened = await openDraft();
  await screen.findByRole('button', { name: 'Layout' });
  expect(tile()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
  expect(screen.queryByRole('button', { name: 'Layout', pressed: false })).not.toBeNull();
  expect(reopened.commit).not.toHaveBeenCalled();
  cleanup();

  await openDraft();
  await screen.findByRole('button', { name: 'Tile' });
});
