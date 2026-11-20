// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { designDocumentVersion, type DesignNode } from '../../src/contracts/index.js';
import { drawing, mountEditor } from './support/mount-design-editor.js';

it('accepts more property edits and layer selection while a dropdown change is saving', async () => {
  const tile = { kind: 'rectangle', x: 0, y: 0, width: 16, height: 16, cornerRadius: 0,
    strokes: [{ color: '#000000', width: 2, join: 'miter' }] } as const;
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    const { commit, replace, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'properties',
      rootIds: ['first', 'second'], nodes: { first: { ...tile, name: 'First' }, second: { ...tile, name: 'Second' } } }, gate);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'First' }));
    await user.click(screen.getByRole('combobox', { name: 'feature.design.strokeJoin' }));
    await user.click(await screen.findByRole('option', { name: 'feature.design.strokeJoin.round' }));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());

    const width = screen.getByRole('spinbutton', { name: 'feature.design.strokeWidth' });
    await user.clear(width);
    await user.type(width, '9{Enter}');
    await user.click(screen.getByRole('button', { name: 'Second' }));
    const opacity = screen.getByRole('spinbutton', { name: 'feature.design.opacity' });
    await user.clear(opacity);
    await user.type(opacity, '65{Enter}');
    expect(commit).toHaveBeenCalledOnce();

    await act(async () => { releaseSave(); });
    await waitFor(async () => expect((await read()).document.nodes).toMatchObject({
      first: { strokes: [{ join: 'round', width: 9 }] }, second: { opacity: 0.65 },
    }));
    expect(commit.mock.calls.map(([input]) => input.expectedRevision)).toEqual(['0', '1', '2']);
    await user.click(screen.getByRole('button', { name: 'feature.design.undo' }));
    await waitFor(async () => expect((await read()).document.nodes.second.opacity).toBeUndefined());
    expect((await read()).document.nodes.first.strokes?.[0]).toMatchObject({ join: 'round', width: 9 });
  } finally {
    releaseSave();
  }
});

it('restores the last saved model and drops dependent edits when a background write fails', async () => {
  let finishWrite!: () => void;
  let failWrite!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { finishWrite = resolve; failWrite = reject; });
  try {
    const { commit, replace, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'failure', rootIds: ['tile'],
      nodes: { tile: { kind: 'rectangle', name: 'Tile', x: 0, y: 0, width: 12, height: 12, cornerRadius: 0 } } }, gate);
    fireEvent.click(await screen.findByRole('button', { name: 'Tile' }));
    function setNumber(label: string, value: string) {
      const field = screen.getByRole<HTMLInputElement>('spinbutton', { name: label });
      field.focus();
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key: 'Enter' });
      return field;
    }
    const x = setNumber('X', '12');
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    const y = setNumber('Y', '8');
    expect(drawing.localX.get('tile')).toBe(12);
    expect(y.value).toBe('8');
    expect(commit).toHaveBeenCalledOnce();

    await act(async () => {
      failWrite(new Error('Could not write draft'));
      await commit.mock.results[0].value.catch(() => undefined);
    });
    await waitFor(() => expect(drawing.localX.get('tile')).toBe(0));
    expect([x.value, y.value]).toEqual(['0', '0']);
    expect(commit).toHaveBeenCalledOnce();
    expect((await read()).document.nodes.tile).toMatchObject({ x: 0, y: 0 });
  } finally {
    finishWrite();
  }
});

it('updates a pencil stroke before save and keeps its preview until the save completes', async () => {
  const path: DesignNode = {
    kind: 'vector', name: 'Pencil line', x: 0, y: 0, width: 60, height: 100,
    geometry: { kind: 'path', anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false, freehand: { preset: 'smooth', width: 2 } },
    strokes: [{ color: '#000000', width: 2, join: 'round' }],
  };
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    const { commit, replace, read } = await mountEditor({ schemaVersion: designDocumentVersion,
      documentId: 'stroke', rootIds: ['path'], nodes: { path } }, saveGate);
    fireEvent.click(await screen.findByRole('button', { name: 'Pencil line' }));
    const width = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.strokeWidth' });
    const drawnWidth = () => drawing.pathStrokeWidths.get('path');
    const typeWidth = (value: string) => { width.focus(); fireEvent.change(width, { target: { value } }); };

    expect(drawnWidth()).toBe(2);
    typeWidth('19');
    expect(drawnWidth()).toBe(19);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(width, { key: 'Escape' });
    expect(drawnWidth()).toBe(2);
    expect(commit).not.toHaveBeenCalled();

    typeWidth('24');
    fireEvent.keyDown(width, { key: 'Enter' });
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(drawnWidth()).toBe(24);
    expect((await read()).document.nodes.path.strokes?.[0].width).toBe(2);
    await act(async () => { releaseSave(); await commit.mock.results[0].value; });
    expect((await read()).document.nodes.path.strokes?.[0].width).toBe(24);
    expect(commit).toHaveBeenCalledOnce();
  } finally {
    releaseSave();
  }
});

it('previews a dragged stroke width and commits only when the drag finishes', async () => {
  const path: DesignNode = {
    kind: 'vector', name: 'Line', x: 0, y: 0, width: 60, height: 100,
    geometry: { kind: 'path', anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false },
    strokes: [{ color: '#000000', width: 2 }],
  };
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'stroke-drag', rootIds: ['path'], nodes: { path } });
  fireEvent.click(await screen.findByRole('button', { name: 'Line' }));
  const width = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.strokeWidth' });
  const handle = within(width.closest('label')!).getByText('W');
  const start = { pointerId: 1, button: 0, clientX: 100 };

  fireEvent.pointerDown(handle, start);
  fireEvent.pointerMove(handle, { ...start, clientX: 90 });
  expect(drawing.pathStrokeWidths.get('path')).toBe(0.01);
  fireEvent.keyDown(width, { key: 'Escape' });
  fireEvent.pointerUp(handle, { ...start, clientX: 90 });
  expect(drawing.pathStrokeWidths.get('path')).toBe(2);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.pointerDown(handle, start);
  fireEvent.pointerMove(handle, { ...start, clientX: 110 });
  expect(drawing.pathStrokeWidths.get('path')).toBe(12);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { ...start, clientX: 113 });
  await waitFor(async () => expect((await read()).document.nodes.path.strokes?.[0].width).toBe(15));
  expect(commit).toHaveBeenCalledOnce();
});

it('previews a numeric variable through its alias and reflows the bound auto layout', async () => {
  const tile = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 } as const;
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'tokens', rootIds: ['board'], nodes: {
    board: { kind: 'frame', x: -80, y: -40, width: 160, height: 100, childIds: ['first', 'next'],
      layout: { direction: 'horizontal', align: 'start', padding: 0, gap: 8, variableIds: { gap: 'alias' } } },
    first: tile, next: tile,
  }, styles: { spacing: { kind: 'number', name: 'Spacing', value: 8 }, alias: { kind: 'number', name: 'Row gap', value: 8, aliasId: 'spacing' } } });
  const variables = await screen.findByRole('button', { name: 'feature.design.variables' });
  const spacingField = () => screen.findByRole<HTMLInputElement>('spinbutton', { name: /^Spacing · /u });
  fireEvent.click(variables);
  const spacing = await spacingField();
  spacing.focus();
  expect(drawing.localX.get('next')).toBe(28);
  fireEvent.change(spacing, { target: { value: '32' } });
  expect(drawing.localX.get('next')).toBe(52);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(spacing, { key: 'Escape' });
  expect(drawing.localX.get('next')).toBe(28);

  fireEvent.click(variables);
  const reopened = await spacingField();
  reopened.focus();
  fireEvent.change(reopened, { target: { value: '40' } });
  fireEvent.keyDown(reopened, { key: 'Enter' });
  await waitFor(async () => expect((await read()).document.styles?.spacing).toMatchObject({ kind: 'number', value: 40 }));
  expect(drawing.localX.get('next')).toBe(60);
  expect(commit).toHaveBeenCalledOnce();
});

it('creates a numeric variable from a field with no matches and keeps the other axis linked after a move', async () => {
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'position', rootIds: ['tile'], nodes: {
    tile: { kind: 'rectangle', name: 'Tile', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 },
  }, styles: { color: { kind: 'color', name: 'Color', color: '#123456' } } }, undefined, {
    translate: (key, params) => key === 'feature.design.bindVariable' ? `Bind ${params?.field}` : key,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Tile' }));
  await user.click(screen.getByRole('combobox', { name: 'Bind X' }));
  await user.click(await screen.findByRole('option', { name: 'feature.design.openVariables' }));
  await user.click(await screen.findByRole('button', { name: 'feature.design.addVariable' }));
  await user.click(await screen.findByRole('menuitem', { name: 'feature.design.variableType.number' }));
  const number = await screen.findByRole('spinbutton', { name: /^feature\.design\.variableType\.number · /u });
  await user.clear(number);
  await user.type(number, '12{Enter}');
  const variable = async () => Object.entries((await read()).document.styles ?? {}).find(([, style]) => style.kind === 'number');
  await waitFor(async () => expect(await variable()).toEqual([expect.any(String), expect.objectContaining({ value: 12 })]));
  const id = (await variable())![0];

  for (const axis of ['X', 'Y']) {
    await user.click(screen.getByRole('combobox', { name: `Bind ${axis}` }));
    await user.click(await screen.findByRole('option', { name: 'feature.design.variableType.number' }));
  }
  await waitFor(async () => expect((await read()).document.nodes.tile.variableIds).toEqual({ x: id, y: id }));
  expect(drawing.localX.get('tile')).toBe(12);
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'X' }).readOnly).toBe(true);

  const canvas = screen.getByRole('region', { name: 'feature.design.canvas' });
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  await waitFor(async () => expect((await read()).document.nodes.tile).toMatchObject({ x: 13, y: 12, variableIds: { y: id } }));
  expect((await read()).document.nodes.tile.variableIds?.x).toBeUndefined();
  expect(drawing.localX.get('tile')).toBe(13);
});

it('previews a different variable binding on the canvas and restores the saved binding when dismissed', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'variable-preview', rootIds: ['tile'], nodes: {
    tile: { kind: 'rectangle', name: 'Tile', x: 12, y: 0, width: 20, height: 20, cornerRadius: 0, variableIds: { x: 'outer' } },
  }, styles: { outer: { kind: 'number', name: 'Outer', value: 24 }, inner: { kind: 'number', name: 'Inner', value: 12 } } }, undefined, {
    translate: (key, params) => key === 'feature.design.bindVariable' ? `Bind ${params?.field}` : key,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Tile' }));
  expect(drawing.localX.get('tile')).toBe(24);
  const binding = screen.getByRole('combobox', { name: /^Bind X · /u });
  await user.click(binding);
  const option = await screen.findByRole('option', { name: 'Inner' });
  fireEvent.pointerOver(option, { pointerType: 'mouse' });
  expect(drawing.localX.get('tile')).toBe(12);
  expect((await read()).document.nodes.tile.variableIds).toEqual({ x: 'outer' });
  expect(commit).not.toHaveBeenCalled();

  await user.keyboard('{Escape}');
  expect(drawing.localX.get('tile')).toBe(24);
  expect(commit).not.toHaveBeenCalled();

  await user.click(binding);
  await user.click(await screen.findByRole('option', { name: 'Inner' }));
  await waitFor(async () => expect((await read()).document.nodes.tile.variableIds).toEqual({ x: 'inner' }));
  expect(drawing.localX.get('tile')).toBe(12);
  expect(commit).toHaveBeenCalledOnce();
});
