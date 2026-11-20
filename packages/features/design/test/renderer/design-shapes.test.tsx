// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { designDocumentVersion } from '../../src/contracts/index.js';
import { layerTransform, toWorld } from '../../src/renderer/design-geometry.js';
import { drawing, mountEditor } from './support/mount-design-editor.js';

it('saves a line on the frame edge, a reversed arrow, and an editable star', async () => {
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'shape-tools', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 0, y: 0, width: 300, height: 180, childIds: [] } } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  Object.defineProperties(canvas, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
  const user = userEvent.setup();

  async function draw(from: [number, number], to: [number, number], shiftKey = false) {
    const start = { button: 0, pointerId: 1, clientX: from[0], clientY: from[1], shiftKey };
    const end = { ...start, clientX: to[0], clientY: to[1] };
    fireEvent.pointerDown(canvas, start);
    fireEvent.pointerMove(canvas, end);
    await act(async () => { fireEvent.pointerUp(canvas, end); });
    const { document } = await read();
    const board = document.nodes.board;
    if (board.kind !== 'frame') throw new Error('Expected the original frame.');
    const layer = document.nodes[board.childIds.at(-1) ?? ''];
    if (layer?.kind !== 'vector') throw new Error('Expected a vector inside the frame.');
    return layer;
  }

  canvas.focus();
  await user.keyboard('l');
  const line = await draw([74, 108], [75, 148]);
  expect(line).toMatchObject({ x: 0, y: 40, height: 40, strokes: [{ width: 1 }],
    geometry: { kind: 'path', closed: false, anchors: [{ x: 0, y: 0 }, { x: 0, y: 1 }] } });
  const movedLine = await draw([68, 108], [118, 118]);
  expect(movedLine).toMatchObject({ x: 0, y: 50, width: 50, height: 30,
    geometry: { anchors: [{ x: 1, y: 0 }, { x: 0, y: 1 }] } });

  await user.keyboard('{Shift>}L{/Shift}');
  const arrow = await draw([218, 188], [138, 194], true);
  expect(arrow).toMatchObject({ x: 70, width: 80, strokes: [{ width: 1 }],
    geometry: { kind: 'path', endMarker: 'arrow', anchors: [{ x: 1, y: 0 }, { x: 0, y: 0 }] } });

  await user.click(screen.getByRole('button', { name: 'feature.design.shapeTools' }));
  await user.click(await screen.findByRole('menuitem', { name: 'feature.design.tool.star' }));
  const star = await draw([263, 108], [318, 153]);
  expect(star.geometry).toMatchObject({ kind: 'path', closed: true });
  if (star.geometry.kind !== 'path') throw new Error('Expected an editable star path.');
  expect(star.geometry.anchors).toHaveLength(10);
});

it('saves layers drawn above a clipping artboard when a quick release leaves the canvas', async () => {
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'above-board', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 0, y: 0, width: 480, height: 240, childIds: [], clip: true } } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  Object.defineProperties(canvas, { clientWidth: { value: 640 }, clientHeight: { value: 480 } });
  const user = userEvent.setup();

  const createAbove = async (kind: 'frame' | 'rectangle' | 'script' | 'web', x: number, y: number,
    ending: 'release' | 'release-only' | 'hover' | 'cancel' = 'release',
  ) => {
    if (kind === 'frame') await user.click(screen.getByRole('button', { name: 'feature.design.tool.frame' }));
    else {
      await user.click(screen.getByRole('button', { name: 'feature.design.shapeTools' }));
      await user.click(await screen.findByRole('menuitem', { name: `feature.design.tool.${kind}` }));
    }
    const start = { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y };
    const end = { ...start, clientX: x + 60, clientY: 20 };
    const toolbar = screen.getByRole('toolbar', { name: 'feature.design.tools' });
    drawing.hit = 'board';
    await act(async () => {
      fireEvent.pointerDown(canvas, start);
      if (ending !== 'release-only') fireEvent.pointerMove(canvas, ending === 'hover' ? end : { ...end, clientX: x + 30, clientY: 34 });
      fireEvent(canvas, new PointerEvent('lostpointercapture', { ...start, bubbles: true }));
      if (ending === 'cancel') fireEvent.pointerCancel(toolbar, end);
      if (ending === 'hover') fireEvent.pointerMove(canvas, { ...end, buttons: 0, clientX: 550, clientY: 124 });
      else fireEvent.pointerUp(toolbar, { ...end, buttons: 0 });
    });
    drawing.hit = undefined;
  };

  // Start at the artboard edge, and at the artboard's label above the edge.
  await createAbove('frame', 120, 70, 'release-only');
  await createAbove('rectangle', 80, 49);
  await createAbove('script', 288, 70);
  await createAbove('web', 400, 70, 'hover');
  await createAbove('rectangle', 517, 70, 'cancel');

  const { document } = await read();
  expect(document.nodes.board).toMatchObject({ childIds: [] });
  expect(document.rootIds.slice(1).map((id) => document.nodes[id])).toMatchObject([
    { kind: 'frame', x: 52, y: -48, width: 60, height: 48 },
    { kind: 'rectangle', x: 12, y: -48, width: 60, height: 29 },
    { kind: 'script', x: 220, y: -48, width: 60, height: 48 },
    { kind: 'web', x: 332, y: -48, width: 60, height: 48 },
  ]);
});

it('reopens a saved arrow as a path, grows its head live, and drags its tip while pinning the other endpoint', async () => {
  const svg = { kind: 'svg', viewBox: { x: 0, y: 0, width: 80, height: 13.2 },
    paths: [{ data: 'M80 6.6 L0 6.6 M12 13.2 L0 6.6 L12 0', lineCap: 'round' }] } as const;
  const arrow = { kind: 'vector', x: -28, y: 24, width: 80, height: 13.2, rotation: 90, flipY: true,
    name: 'Renamed arrow', geometry: svg, strokes: [{ color: '#000000', width: 1 }] } as const;
  const { commit, read } = await mountEditor({ schemaVersion: 10, documentId: 'legacy-arrow', rootIds: ['arrow', 'artwork'], nodes: {
    arrow, artwork: { ...arrow, name: 'Imported artwork', x: 500,
      geometry: { ...svg, paths: [{ ...svg.paths[0], data: 'M80 6.6 L0 6.6 M18 13.2 L0 6.6 L12 0' }] } },
  } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Renamed arrow' }));
  const initial = (await read()).document;
  expect(initial.nodes.artwork).toMatchObject({ geometry: { kind: 'svg' } });
  expect(initial.nodes.arrow).toMatchObject({ geometry: { kind: 'path', endMarker: 'arrow', anchors: [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }] } });
  const length = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.segment.length' });
  const angle = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.segment.angle' });
  expect([length.value, angle.value]).toEqual(['80', '-90']);

  const width = screen.getByRole('spinbutton', { name: 'feature.design.strokeWidth' });
  const thin = drawing.paths.get('arrow');
  width.focus();
  fireEvent.change(width, { target: { value: '14' } });
  const thick = drawing.paths.get('arrow');
  expect(thin).toMatch(/^M80 6\.6 L0 6\.6 M6 /u);
  expect(thick).toMatch(/^M80 6\.6 L0 6\.6 M40 /u);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(width, { key: 'Escape' });

  const start = { button: 0, pointerId: 2, clientX: 80, clientY: 58.6, altKey: true };
  const end = { ...start, clientX: 120, clientY: 78.6 };
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, end);
  expect(drawing.paths.get('arrow')).not.toBe(thin);
  expect([length.value, angle.value]).toEqual(['72.11', '-56.31']);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  fireEvent.pointerUp(canvas, end);
  expect(drawing.paths.get('arrow')).toBe(thin);
  expect([length.value, angle.value]).toEqual(['80', '-90']);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.pointerDown(canvas, start);
  await act(async () => { fireEvent.pointerUp(canvas, end); });
  const saved = (await read()).document.nodes.arrow;
  if (saved.kind !== 'vector' || saved.geometry.kind !== 'path') throw new Error('Expected a saved arrow path.');
  expect(saved.geometry.endMarker).toBe('arrow');
  const pose = layerTransform(saved, saved);
  const [tail, tip] = saved.geometry.anchors.map((point) => toWorld(pose, { x: point.x * saved.width, y: point.y * saved.height }));
  expect(tail.x).toBeCloseTo(12);
  expect(tail.y).toBeCloseTo(70.6);
  expect(tip.x).toBeCloseTo(52);
  expect(tip.y).toBeCloseTo(10.6);
  expect([length.value, angle.value]).toEqual(['72.11', '-56.31']);
  expect(commit).toHaveBeenCalledOnce();
});

it('previews and saves segment measurements in the inspector against the actual canvas axes', async () => {
  const { read, commit } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'segment-fields', rootIds: ['board'], nodes: {
    board: { kind: 'frame', x: -48, y: -26, width: 100, height: 80, rotation: 90, flipX: true, clip: false, childIds: ['arrow'] },
    arrow: { kind: 'vector', name: 'Arrow', x: 20, y: 20, width: 40, height: 1, flipY: true,
      geometry: { kind: 'path', endMarker: 'arrow', closed: false, anchors: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      strokes: [{ color: '#000000', width: 1 }] },
  } });
  fireEvent.click(await screen.findByRole('button', { name: 'Arrow' }));
  const length = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.segment.length' });
  const angle = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.segment.angle' });
  expect([length.value, angle.value]).toEqual(['40', '-90']);

  length.focus();
  fireEvent.change(length, { target: { value: '70' } });
  expect(drawing.paths.get('arrow')).toMatch(/^M0 0 L70 0 /u);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(length, { key: 'Enter' }); });
  expect([length.value, angle.value]).toEqual(['70', '-90']);

  angle.focus();
  fireEvent.change(angle, { target: { value: '225' } });
  expect(drawing.paths.get('arrow')).not.toMatch(/^M0 0 L70 0 /u);
  expect(commit).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.keyDown(angle, { key: 'Enter' }); });
  expect([length.value, angle.value]).toEqual(['70', '-135']);

  const { document } = await read();
  const { board, arrow } = document.nodes;
  if (board.kind !== 'frame' || arrow.kind !== 'vector' || arrow.geometry.kind !== 'path') throw new Error('Expected the edited arrow in its frame.');
  const pose = layerTransform(arrow, arrow, layerTransform(board, board));
  const [tail, tip] = arrow.geometry.anchors.map((point) => toWorld(pose, { x: point.x * arrow.width, y: point.y * arrow.height }));
  expect(tail.x).toBeCloseTo(21);
  expect(tail.y).toBeCloseTo(44);
  expect(tip.x).toBeCloseTo(21 - 70 / Math.SQRT2);
  expect(tip.y).toBeCloseTo(44 - 70 / Math.SQRT2);
  expect(arrow.geometry.endMarker).toBe('arrow');
  expect(commit).toHaveBeenCalledTimes(2);
});

it('opens the image picker from the canvas with the platform shortcut', async () => {
  const { commit } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'image-shortcut', rootIds: [], nodes: {} });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  const user = userEvent.setup();

  canvas.focus();
  await user.keyboard('{Meta>}{Shift>}K{/Shift}{/Meta}');
  const picker = await screen.findByRole('dialog', { name: 'feature.design.addImage' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(picker.isConnected).toBe(false));

  canvas.focus();
  await user.keyboard('{Control>}{Shift>}K{/Shift}{/Control}');
  await screen.findByRole('dialog', { name: 'feature.design.addImage' });
  expect(commit).not.toHaveBeenCalled();
});
