// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import type Konva from 'konva';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { applyDesignEdits } from '../../src/contracts/apply-design-edits.js';
import { toWorld } from '../../src/renderer/design-geometry.js';
import { resolveDesignScene, type DesignScene } from '../../src/renderer/design-layout.js';
import { useDesignCanvasGestures, type CanvasAction, type CanvasViewport } from '../../src/renderer/use-design-canvas-gestures.js';

afterEach(cleanup);

function mountGestures(design: DesignDocument, scene: DesignScene, selected: readonly [string, ...string[]]) {
  const stage = { current: {
    getIntersection: () => ({ hasName: () => false, findAncestor: () => ({ id: () => selected[0] }) }),
  } as unknown as Konva.Stage };
  const commit = vi.fn<(action: CanvasAction, revision: string) => Promise<boolean>>().mockResolvedValue(true);
  const editText = vi.fn();

  function CanvasGestureTarget() {
    const [selectedIds, onSelect] = useState<readonly string[]>(selected);
    const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 });
    const controls = useDesignCanvasGestures({
      stage, document: design, scene, revision: 'base', tool: 'select', selectedIds,
      disabled: false, viewport, setViewport, onSelect, onEditText: editText, onAction: commit,
    });
    return <div tabIndex={0} role="region" aria-label="Canvas" ref={(element) => {
      if (element) element.setPointerCapture = () => undefined;
    }} onPointerDown={controls.onPointerDown} onPointerMove={controls.onPointerMove}
      onPointerUp={controls.onPointerUp} onPointerCancel={controls.cancel} />;
  }

  const canvas = render(<CanvasGestureTarget />).getByRole('region', { name: 'Canvas' });
  return { canvas, commit, editText };
}

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
  const { canvas, commit, editText } = mountGestures(design, scene, ['primary', 'secondary']);
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

  for (const at of [100, 220]) {
    fireEvent.pointerDown(canvas, start);
    const release = createEvent.pointerUp(canvas, start);
    Object.defineProperty(release, 'timeStamp', { value: at });
    fireEvent(canvas, release);
  }
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
