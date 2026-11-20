// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import type Konva from 'konva';
import { useLayoutEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { toWorld } from '../../src/renderer/design-geometry.js';
import { designDrawingPlacement } from '../../src/renderer/design-insertion.js';
import { resolveDesignScene, type DesignScene } from '../../src/renderer/design-layout.js';
import { useDesignCanvasGestures, type CanvasAction, type CanvasViewport, type DesignTool } from '../../src/renderer/use-design-canvas-gestures.js';

afterEach(cleanup);

function mountGestures(design: DesignDocument, scene: DesignScene, selected: readonly string[],
  { handle, scale = 1, tool = 'select' }: Readonly<{ handle?: string; scale?: number; tool?: DesignTool }> = {}) {
  const stage = { current: {
    getIntersection: () => selected.length ? { hasName: (name: string) => name === handle, findAncestor: () => ({ id: () => selected[0] }) } : null,
  } as unknown as Konva.Stage };
  const commit = vi.fn<(action: CanvasAction, revision: string) => Promise<boolean>>().mockResolvedValue(true);
  const editText = vi.fn();
  const pick = vi.fn();
  let preview: ReturnType<typeof useDesignCanvasGestures>['preview'];

  function CanvasGestureTarget() {
    const [selectedIds, onSelect] = useState<readonly string[]>(selected);
    const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale });
    const controls = useDesignCanvasGestures({
      stage, document: design, scene, revision: 'base', tool, selectedIds,
      interaction: 'edit', viewport, setViewport, onSelect, beginPick: () => pick, onEditText: editText, onAction: commit,
    });
    useLayoutEffect(() => { preview = controls.preview; }, [controls.preview]);
    return <div tabIndex={0} role="region" aria-label="Canvas" ref={(element) => {
      if (element) element.setPointerCapture = () => undefined;
    }} onPointerDown={controls.onPointerDown} onPointerMove={controls.onPointerMove}
      onPointerUp={controls.onPointerUp} onPointerCancel={controls.cancel} />;
  }

  const canvas = render(<CanvasGestureTarget />).getByRole('region', { name: 'Canvas' });
  Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 900 } });
  return { canvas, commit, editText, pick, preview: () => preview };
}

it('draws backwards from one frame corner to the other and keeps the snapped bounds inside auto layout', async () => {
  const design: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'draw-snap', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 40, y: 40, width: 300, height: 180, childIds: [],
      layout: { direction: 'horizontal', gap: 12, padding: 20, align: 'start' } } },
  };
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const scene = resolveDesignScene(yoga, design, measure);
  const { canvas, commit, preview } = mountGestures(design, scene, [], { tool: 'rectangle' });
  const start = { pointerId: 1, button: 0, clientX: 334, clientY: 212 };
  const end = { ...start, clientX: 35, clientY: 46 };
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, { ...end, altKey: true });
  expect(preview()?.drawing?.bounds).toEqual({ x: -5, y: 6, width: 299, height: 166 });
  expect(preview()?.guides).toBeUndefined();

  fireEvent.pointerMove(canvas, end);
  const drawing = preview()?.drawing;
  expect(drawing).toEqual({ kind: 'draw', tool: 'rectangle', parentId: 'board',
    bounds: { x: 0, y: 0, width: 300, height: 180 }, click: false });
  expect(preview()?.guides?.map(({ points }) => points)).toEqual([
    [340, 40, 340, 220], [40, 220, 340, 220], [40, 40, 40, 220], [40, 40, 340, 40],
  ]);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(canvas, end); });
  expect(commit).toHaveBeenCalledExactlyOnceWith(drawing, 'base');
  const [[saved]] = commit.mock.calls;
  if (saved.kind !== 'draw' || !saved.parentId) throw new Error('Expected drawing coordinates inside the frame.');
  const { parentId, placement } = designDrawingPlacement(design, scene, saved.parentId, saved.bounds);
  const next = applyDesignEdits(design, [{ kind: 'insert', nodeId: 'tile', parentId,
    node: { kind: 'rectangle', cornerRadius: 0, ...placement } }]);
  expect(resolveDesignScene(yoga, next, measure).tile).toMatchObject(saved.bounds);
});

it('prefers the frame border over a nearer interior guide and bypasses it with Alt', async () => {
  const design: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'border-snap', rootIds: ['board'],
    nodes: {
      board: { kind: 'frame', x: 40, y: 40, width: 300, height: 180, childIds: ['tile', 'peer'] },
      tile: { kind: 'rectangle', x: 60, y: 32, width: 50, height: 24, cornerRadius: 0 },
      peer: { kind: 'rectangle', x: 9, y: 100, width: 130, height: 30, cornerRadius: 0 },
    },
  };
  const scene = resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 }));
  const { canvas, commit, preview } = mountGestures(design, scene, ['tile']);
  const start = { pointerId: 1, button: 0, clientX: 110, clientY: 80 };
  const end = { ...start, clientX: 59 };
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, end);
  expect(preview()?.guides).toEqual([{ axis: 'x', points: [40, 40, 40, 220] }]);
  await act(async () => { fireEvent.pointerUp(canvas, end); });
  expect(commit).toHaveBeenCalledExactlyOnceWith({ kind: 'move', placements: { tile: { x: 0, y: 32 } } }, 'base');

  fireEvent.pointerDown(canvas, start);
  await act(async () => { fireEvent.pointerUp(canvas, { ...end, altKey: true }); });
  expect(commit).toHaveBeenLastCalledWith({ kind: 'move', placements: { tile: { x: 9, y: 32 } } }, 'base');
});

it('references a completed marquee as one group of editable layers inside its board', async () => {
  const rect = { kind: 'rectangle', x: 10, y: 10, width: 8, height: 12, cornerRadius: 0 } as const;
  const design: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: ['board'], nodes: {
    board: { kind: 'frame', x: 0, y: 0, width: 200, height: 200, childIds: ['rail', 'other', 'locked', 'third'] },
    rail: rect, other: { ...rect, y: 36 }, locked: { ...rect, locked: true }, third: { ...rect, y: 80 },
  } };
  const scene = resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 }));
  const { canvas, pick, commit } = mountGestures(design, scene, []);
  const start = { pointerId: 1, button: 0, clientX: 4, clientY: 4 };
  const end = { ...start, clientX: 24, clientY: 52 };
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerUp(canvas, start);
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, end);
  expect(pick).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas, end);
  expect(pick).toHaveBeenCalledExactlyOnceWith(['rail', 'other']);
  const extend = { ...start, clientY: 72, shiftKey: true };
  const extended = { ...extend, clientX: 24, clientY: 96 };
  fireEvent.pointerDown(canvas, extend);
  fireEvent.pointerMove(canvas, extended);
  fireEvent.pointerUp(canvas, extended);
  expect(pick).toHaveBeenLastCalledWith(['rail', 'other', 'third']);
  expect(commit).not.toHaveBeenCalled();
});

it('snaps a resized edge to the true outline of a rotated and reflected frame', async () => {
  const design: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'resize-snap', rootIds: ['board'],
    nodes: {
      board: { kind: 'frame', x: 124, y: 240, width: 1440, height: 400, rotation: 27, flipX: true, childIds: ['tile'] },
      tile: { kind: 'rectangle', x: 0, y: 20, width: 400, height: 166, cornerRadius: 0 },
    },
  };
  const scale = 0.57;
  const scene = resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 }));
  const { canvas, commit, preview } = mountGestures(design, scene, ['tile'], { handle: 'design-anchor-4', scale });
  function pointerAt(x: number) {
    const point = toWorld(scene.board, { x, y: 103 });
    return { pointerId: 1, button: 0, clientX: point.x * scale, clientY: point.y * scale };
  }
  fireEvent.pointerDown(canvas, pointerAt(400));
  fireEvent.pointerMove(canvas, pointerAt(1424));
  const guide = preview()?.guides?.[0];
  expect(guide?.axis).toBe('x');
  const top = toWorld(scene.board, { x: 1440, y: 0 });
  const bottom = toWorld(scene.board, { x: 1440, y: 400 });
  [top.x, top.y, bottom.x, bottom.y].forEach((value, index) => expect(guide?.points[index]).toBeCloseTo(value, 6));
  await act(async () => { fireEvent.pointerUp(canvas, pointerAt(1424)); });
  expect(commit).toHaveBeenCalledExactlyOnceWith({
    kind: 'transform', id: 'tile', placement: { x: 0, y: 20, width: 1440, height: 166 },
  }, 'base');
});

it('distinguishes cancelled drags, batch moves in a reflected frame, and text editing clicks', async () => {
  const design: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'screen', rootIds: ['board'],
    nodes: {
      board: { kind: 'frame', x: 0, y: 0, width: 200, height: 200, rotation: 90, flipX: true, childIds: ['primary', 'secondary'] },
      primary: { kind: 'text', x: 30, y: 40, width: 25, fontSize: 12, text: 'AB' },
      secondary: { kind: 'ellipse', x: 70, y: 60, width: 25, height: 25, fills: [{ color: '#897ddd' }] },
    },
  };
  const scene = resolveDesignScene(await loadYoga(), design, () => ({ width: 1, height: 1 }));
  const { canvas, commit, editText, pick } = mountGestures(design, scene, ['primary', 'secondary']);
  const start = { pointerId: 1, button: 0, clientX: 150, clientY: 40 };
  const end = { ...start, clientY: 60, altKey: true };
  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, end);
  fireEvent.pointerCancel(canvas, end);
  fireEvent.pointerUp(canvas, end);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.pointerDown(canvas, start);
  fireEvent.pointerMove(canvas, end);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(canvas, end); });
  expect(commit).toHaveBeenCalledExactlyOnceWith({
    kind: 'move', placements: { primary: { x: 10, y: 40 }, secondary: { x: 50, y: 60 } },
  }, 'base');
  expect(editText).not.toHaveBeenCalled();
  expect(pick).not.toHaveBeenCalled();

  for (const at of [100, 220]) {
    fireEvent.pointerDown(canvas, start);
    const release = createEvent.pointerUp(canvas, start);
    Object.defineProperty(release, 'timeStamp', { value: at });
    fireEvent(canvas, release);
  }
  expect(pick).toHaveBeenLastCalledWith(['primary']);
  expect(editText).toHaveBeenCalledExactlyOnceWith('primary', design.nodes.primary);
  expect(commit).toHaveBeenCalledTimes(1);
});

it.each([
  { destination: 'the root', parentId: null, clientX: 220, clientY: 130 },
  { destination: 'another artboard', parentId: 'target', clientX: 284, clientY: 128 },
])('preserves the grabbed point and orientation when dragging a layer out to $destination', async ({ parentId, clientX, clientY }) => {
  const design: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'reparent', rootIds: ['board', 'target'], nodes: {
      board: { kind: 'frame', x: 30, y: 30, width: 160, height: 120, rotation: 90, flipX: true, childIds: ['tile'] },
      target: { kind: 'frame', x: 260, y: 100, width: 60, height: 80, childIds: [] },
      tile: { kind: 'rectangle', x: 20, y: 16, width: 24, height: 12, cornerRadius: 0 },
    },
  };
  const yoga = await loadYoga();
  const measure = () => ({ width: 1, height: 1 });
  const scene = resolveDesignScene(yoga, design, measure);
  const { canvas, commit } = mountGestures(design, scene, ['tile']);
  const grab = toWorld(scene.tile, { x: 4, y: 2 });
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: grab.x, clientY: grab.y });
  const release = { pointerId: 1, button: 0, clientX, clientY };
  fireEvent.pointerMove(canvas, release);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(canvas, release); });
  expect(commit).toHaveBeenCalledOnce();

  const [[action]] = commit.mock.calls;
  if (action.kind !== 'drop') throw new Error('Expected one atomic layer drop.');
  const next = applyDesignEdits(design, action.edits);
  expect(next.nodes.board).toMatchObject({ childIds: [] });
  expect(next.rootIds.includes('tile')).toBe(parentId === null);
  const landed = resolveDesignScene(yoga, next, measure).tile;
  expect(landed.parentId).toBe(parentId);
  for (const point of [{ x: 4, y: 2 }, { x: 24, y: 0 }, { x: 0, y: 12 }]) {
    const before = toWorld(scene.tile, point);
    const after = toWorld(landed, point);
    expect(after.x - before.x).toBeCloseTo(clientX - grab.x);
    expect(after.y - before.y).toBeCloseTo(clientY - grab.y);
  }
});
