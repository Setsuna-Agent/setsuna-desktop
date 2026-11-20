// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { designDocumentVersion } from '../../src/contracts/index.js';
import { drawing, mountEditor } from './support/mount-design-editor.js';

it('cancels a draft, saves brush and pencil paths inside a frame, and samples the saved paint and width', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'drawing', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 20, y: 20, width: 240, height: 200, childIds: [],
      layout: { direction: 'horizontal', gap: 8, padding: 12, align: 'start' } } } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  const button = (name: string) => screen.getByRole('button', { name });
  const pointer = (clientX: number, clientY: number) => ({ pointerId: 1, button: 0, clientX, clientY });
  const start = pointer(92, 92);
  const middle = pointer(144, 130);
  const end = pointer(174, 120);
  const user = userEvent.setup();

  await user.click(button('feature.design.drawingMode'));
  await user.click(button('feature.design.tool.brush'));
  await user.click(button('feature.design.drawingPreset'));
  await user.click(await screen.findByRole('button', { name: 'feature.design.drawingPreset.dry' }));
  const controls = screen.getByRole('toolbar', { name: 'feature.design.drawingControls' });
  const color = within(controls).getByRole('button', { name: 'feature.design.color' });
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(color, 'getBoundingClientRect').mockReturnValue(new DOMRect(470, 60, 28, 28));
  await user.click(color);
  const hex = await screen.findByRole('textbox', { name: 'HEX' });
  await user.click(hex);
  fireEvent.change(hex, { target: { value: '2667B2' } });
  await user.click(button('feature.design.gradient'));
  await user.click(color);

  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, middle);
  fireEvent.keyDown(canvas, { key: 'Escape' });
  fireEvent.pointerUp(canvas, end);
  expect(commit).not.toHaveBeenCalled();

  const width = within(controls).getByRole('spinbutton', { name: 'feature.design.strokeWidth' });
  width.focus();
  fireEvent.change(width, { target: { value: '12' } });
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, middle);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(canvas, end); });
  expect(commit).toHaveBeenCalledOnce();
  const { document: first } = await read();
  const board = first.nodes.board;
  if (board.kind !== 'frame') throw new Error('Expected the drawing frame.');
  const [brushId] = board.childIds;
  const gradient = { kind: 'linear', stops: [{ color: '#2667b2', offset: 0 }, { color: '#2667b2', offset: 1, opacity: 0 }] };
  expect(first.nodes[brushId]).toMatchObject({ kind: 'vector', absolute: true,
    fills: [{ gradient }], geometry: { kind: 'path', closed: true, freehand: { preset: 'dry', width: 12 } } });

  fireEvent.click(button('feature.design.tool.pencil'));
  drawing.hit = brushId;
  fireEvent.pointerDown(canvas, { ...middle, metaKey: true });
  fireEvent.pointerUp(canvas, { ...middle, metaKey: true });
  expect(commit).toHaveBeenCalledOnce();
  await act(async () => {
    fireEvent.pointerDown(canvas, pointer(120, 155));
    fireEvent.pointerUp(canvas, pointer(177, 168));
  });
  expect(commit).toHaveBeenCalledTimes(2);
  const { document: saved } = await read();
  const updatedBoard = saved.nodes.board;
  if (updatedBoard.kind !== 'frame') throw new Error('Expected the drawing frame.');
  const [, pencilId] = updatedBoard.childIds;
  expect(saved.nodes[pencilId]).toMatchObject({ kind: 'vector', absolute: true, x: 32, y: 67,
    strokes: [{ gradient, width: 12 }], geometry: { kind: 'path', closed: false, freehand: { preset: 'smooth', width: 12 } } });

  await act(async () => { fireEvent.click(button('feature.design.undo')); });
  expect((await read()).document.nodes[pencilId]).toBeUndefined();
  expect((await read()).document.nodes[brushId]).toEqual(saved.nodes[brushId]);
});

it('saves rapid strokes across the top of the artboard while another stroke is being written', async () => {
  let releaseSave!: () => void;
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const { commit, read, replace } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'rapid-drawing', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 20, y: 20, width: 240, height: 200, childIds: [] } } }, gate);
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  const pointer = (clientX: number, clientY: number) => ({ pointerId: 1, button: 0, clientX, clientY });
  function start(y: number) { fireEvent.pointerDown(canvas, pointer(96, y)); }
  function end(y: number) { fireEvent.pointerUp(canvas, pointer(160, y)); }
  async function readStrokes() {
    const { document } = await read();
    const board = document.nodes.board;
    if (board.kind !== 'frame') throw new Error('Expected the drawing frame.');
    return { inside: board.childIds.map((id) => document.nodes[id]), above: document.rootIds.slice(1).map((id) => document.nodes[id]) };
  }

  try {
    fireEvent.click(screen.getByRole('button', { name: 'feature.design.drawingMode' }));
    start(106);
    end(118);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());

    start(88);
    end(38);
    start(66);
    fireEvent.pointerMove(canvas, pointer(128, 48));
    expect(commit).toHaveBeenCalledOnce();

    await act(async () => { releaseSave(); });
    await waitFor(async () => expect((await readStrokes()).above).toHaveLength(1));
    // The acknowledgement of the first two strokes arrives while the third is still being drawn.
    await act(async () => { end(30); });
    expect(commit.mock.calls.map(([input]) => input.expectedRevision)).toEqual(['0', '1', '2']);
    const pencil = { kind: 'vector', width: 64, geometry: { kind: 'path', closed: false, freehand: { preset: 'smooth', width: 2 } } };
    expect(await readStrokes()).toMatchObject({ inside: [{ ...pencil, x: 8, y: 18 }],
      above: [{ ...pencil, x: 28, y: -30, height: 50 }, { ...pencil, x: 28, y: -38, height: 36 }] });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'feature.design.undo' })); });
    expect((await readStrokes()).above).toHaveLength(1);
  } finally {
    releaseSave();
  }
});

it.each([
  { event: 'release on the toolbar', point: { x: 125, y: 106 }, saved: { y: 18, width: 5, height: 8 } },
  { event: 'return with the button released', point: { x: 180, y: 145 }, saved: { y: 23, width: 2, height: 3 } },
] as const)('saves a flick completed before the next frame on $event', async ({ event, point, saved }) => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'quick-flick', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 20, y: 20, width: 240, height: 200, childIds: [] } } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.drawingMode' }));
  const toolbar = screen.getByRole('toolbar', { name: 'feature.design.drawingControls' });
  const start = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 120, clientY: 114 };

  await act(async () => {
    fireEvent.pointerDown(canvas, start);
    fireEvent.pointerMove(canvas, { ...start, clientX: 122, clientY: 111 });
    fireEvent(canvas, new PointerEvent('lostpointercapture', { ...start, bubbles: true }));
    const released = { ...start, buttons: 0, clientX: point.x, clientY: point.y };
    if (event === 'release on the toolbar') fireEvent.pointerUp(toolbar, released);
    else fireEvent.pointerMove(canvas, released);
  });

  expect(commit).toHaveBeenCalledOnce();
  const { document } = await read();
  const board = document.nodes.board;
  if (board.kind !== 'frame' || board.childIds.length !== 1) throw new Error('Expected one saved stroke on the artboard.');
  const stroke = document.nodes[board.childIds[0]];
  expect(stroke).toMatchObject({ kind: 'vector', x: 32, ...saved });
  if (stroke.kind !== 'vector' || stroke.geometry.kind !== 'path') throw new Error('Expected a saved path.');
  expect(stroke.geometry.anchors.at(-1)).toMatchObject({ x: 1, y: 0 });
});

it('keeps a brief back-and-forth stroke when the browser batches the movement', async () => {
  const { read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'brief-turn', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 20, y: 20, width: 240, height: 200, childIds: [] } } });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.drawingMode' }));
  const start = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 120, clientY: 114 };
  const moved = new PointerEvent('pointermove', { ...start, bubbles: true, clientX: 121 });
  Object.defineProperty(moved, 'getCoalescedEvents', { value: () => [121, 120, 121].map((clientX) =>
    new PointerEvent('pointermove', { ...start, clientX })) });

  await act(async () => {
    fireEvent.pointerDown(canvas, start);
    fireEvent(canvas, moved);
    fireEvent.pointerUp(canvas, { ...start, buttons: 0 });
  });

  const { document } = await read();
  const board = document.nodes.board;
  if (board.kind !== 'frame' || board.childIds.length !== 1) throw new Error('Expected one saved stroke on the artboard.');
  const stroke = document.nodes[board.childIds[0]];
  if (stroke.kind !== 'vector' || stroke.geometry.kind !== 'path') throw new Error('Expected a saved path.');
  expect(stroke.geometry.anchors.map(({ x }) => x * stroke.width)).toContain(1);
});
