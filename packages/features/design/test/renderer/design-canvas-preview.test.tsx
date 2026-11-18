// @vitest-environment happy-dom

import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { commitDesignEdits, designDocumentVersion, type DesignDocument, type DesignFrame } from '../../src/contracts/index.js';
import DesignEditor from '../../src/renderer/DesignEditor.js';
import type { DesignAssets, DesignClient } from '../../src/renderer/client.js';
import type { Bounds, Point } from '../../src/renderer/design-geometry.js';
import { DesignDocumentService } from '../../src/runtime/design-document-service.js';

const drawing = vi.hoisted(() => ({
  frameFills: new Map<string, string>(),
  localX: new Map<string, number>(),
  images: new Map<string, { image: HTMLImageElement; name?: string; crop?: Bounds }>(),
  paths: new Map<string, string>(),
  handles: new Set<string>(),
  hit: undefined as string | undefined,
}));

vi.mock('react-konva', async () => {
  const { createContext, forwardRef, useContext, useImperativeHandle } = await import('react');
  const LayerId = createContext<string | undefined>(undefined);
  const Container = ({ children }: PropsWithChildren) => <>{children}</>;
  const Stage = forwardRef(function Stage({ children }: PropsWithChildren, ref) {
    useImperativeHandle(ref, () => ({
      getIntersection() {
        const hit = drawing.hit;
        const image = hit ? drawing.images.get(hit) : undefined;
        if (hit && image) return { hasName: (name: string) => name === image.name,
          findAncestor: () => ({ id: () => hit }), getAttr: (key: string) => key === 'image' ? image.image : undefined };
        if (hit && drawing.handles.has(hit)) return { hasName: (name: string) => name === hit, findAncestor: () => null };
        return hit && drawing.localX.has(hit) ? { hasName: () => false, findAncestor: () => ({ id: () => hit }) } : null;
      },
    }), []);
    return <>{children}</>;
  });
  function Group({ id, x = 0, offsetX = 0, children }: PropsWithChildren<{ id?: string; x?: number; offsetX?: number }>) {
    if (!id) return <>{children}</>;
    drawing.localX.set(id, x - offsetX);
    return <LayerId.Provider value={id}>{children}</LayerId.Provider>;
  }
  function Rect({ name, fill }: { name?: string; fill?: string }) {
    const id = useContext(LayerId);
    if (id && name === 'design-frame-interior' && fill) drawing.frameFills.set(id, fill);
    if (name?.startsWith('design-layout-') || name?.startsWith('design-anchor-')) drawing.handles.add(name);
    return null;
  }
  function Image(props: { image: HTMLImageElement; name?: string; crop?: Bounds }) {
    const id = useContext(LayerId);
    if (id) drawing.images.set(id, props);
    return null;
  }
  function Path({ data }: { data: string }) {
    const id = useContext(LayerId);
    if (id) drawing.paths.set(id, data);
    return null;
  }
  const shape = () => null;
  return { Stage, Group, Layer: Container, Rect, Circle: shape, Ellipse: shape, Line: shape,
    Shape: shape, Path, Image, Label: Container, Tag: shape, Text: shape };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drawing.frameFills.clear();
  drawing.localX.clear();
  drawing.images.clear();
  drawing.paths.clear();
  drawing.handles.clear();
  drawing.hit = undefined;
});

async function mountEditor(source: DesignDocument, saveGate = Promise.resolve(), assets: Readonly<{
  searchImages?: DesignAssets['search'];
  readImage?: DesignAssets['read'];
  importImage?: DesignClient['importImage'];
  requestClipboardPaste?: DesignAssets['requestClipboardPaste'];
  readDesignLayers?: DesignAssets['output']['readDesignLayers'];
}> = {}) {
  const documentRef = { projectId: 'project', rootId: 'root', path: 'test.design.json' };
  let content = JSON.stringify(source);
  let revision = 0;
  const replace = vi.fn(async (next: string) => {
    await saveGate;
    content = next;
    return String(++revision);
  });
  const service = new DesignDocumentService({
    create: vi.fn(),
    withDocument: (_ref, _signal, operation) => operation({ key: source.documentId,
      read: async () => ({ content, revision: String(revision) }), replace }),
  });
  const signal = new AbortController().signal;
  const commit = vi.fn<DesignClient['commit']>((input) => service.commit(commitDesignEdits.input.parse(input), signal));
  const client: DesignClient = {
    assets: {
      search: assets.searchImages ?? (async () => []), read: assets.readImage ?? vi.fn(), readLinkedImage: vi.fn(),
      requestClipboardPaste: assets.requestClipboardPaste ?? vi.fn().mockResolvedValue({ kind: 'unavailable' }),
      output: { saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(), copyDesignLayers: vi.fn(),
        readDesignLayers: assets.readDesignLayers ?? vi.fn(), copyText: vi.fn() },
    },
    list: vi.fn().mockResolvedValue([]), create: vi.fn(), importImage: assets.importImage ?? vi.fn(), read: (ref) => service.read(ref, signal), commit,
    navigate: (input) => service.navigate(input, signal),
  };
  const layoutEngine = await loadYoga();
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignEditor client={client} documentRef={documentRef} layoutEngine={layoutEngine} translate={(key) => key} />
  </ToastProvider></UiProvider>);
  return { documentRef, commit, replace, revision: () => revision, read: () => service.read(documentRef, signal) };
}

function number(label: string) {
  return screen.getByRole<HTMLInputElement>('spinbutton', { name: label });
}

it('commits a closed pen path once and saves a node drag without moving its other anchors', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'pen', rootIds: [], nodes: {} });
  const canvas = await screen.findByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const point = (clientX: number, clientY: number) => ({ pointerId: 1, button: 0, clientX, clientY });
  function place(x: number, y: number, end = point(x, y)) {
    fireEvent.pointerDown(canvas, point(x, y));
    if (x !== end.clientX || y !== end.clientY) fireEvent.pointerMove(canvas, end);
    fireEvent.pointerUp(canvas, end);
  }

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.tool.pen' }));
  place(78, 80);
  place(108, 80, point(120, 96));
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect((await read()).document.rootIds).toEqual([]);

  place(78, 80);
  place(108, 80, point(120, 96));
  place(110, 112);
  expect(commit).not.toHaveBeenCalled();
  place(78, 80);
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  expect(commit).toHaveBeenCalledOnce();
  const [id] = (await read()).document.rootIds;
  async function readPath() {
    const layer = (await read()).document.nodes[id];
    if (layer?.kind !== 'vector' || layer.geometry.kind !== 'path') throw new Error('Expected a saved vector path.');
    return { ...layer, geometry: layer.geometry };
  }
  const before = await readPath();
  const beforeDrawing = drawing.paths.get(id);
  expect(before.geometry.closed).toBe(true);
  expect(before.geometry.anchors).toHaveLength(3);
  expect(before.geometry.anchors[1]).toMatchObject({ incoming: expect.any(Object), outgoing: expect.any(Object) });

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.editPath' }));
  fireEvent.pointerDown(canvas, point(78, 80));
  fireEvent.pointerMove(canvas, point(70, 80));
  expect(drawing.paths.get(id)).not.toBe(beforeDrawing);
  expect(await readPath()).toEqual(before);
  fireEvent.keyDown(canvas, { key: 'Escape' });
  fireEvent.pointerUp(canvas, point(70, 80));
  expect(drawing.paths.get(id)).toBe(beforeDrawing);
  expect(commit).toHaveBeenCalledOnce();

  fireEvent.pointerDown(canvas, point(78, 80));
  fireEvent.pointerMove(canvas, point(70, 80));
  fireEvent.pointerUp(canvas, point(70, 80));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  await act(async () => { await commit.mock.results[1].value; });
  const after = await readPath();
  expect(after.x + after.geometry.anchors[0].x * after.width).toBeCloseTo(2);
  expect(after.x + after.geometry.anchors[2].x * after.width).toBeCloseTo(42);
  fireEvent.click(undo);
  await waitFor(async () => expect(await readPath()).toEqual(before));
  expect(commit).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.tool.pen' }));
  place(150, 80);
  place(180, 100);
  fireEvent.keyDown(canvas, { key: 'Enter' });
  await waitFor(async () => {
    const { document } = await read();
    expect(document.nodes[document.rootIds[1]]).toMatchObject({ kind: 'vector', geometry: { kind: 'path', closed: false } });
  });
  expect(commit).toHaveBeenCalledTimes(3);
});

it('saves polygon sides and can scroll, search, insert and replace a Lucide icon', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'vectors', rootIds: [], nodes: {} });
  const canvas = await screen.findByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.tool.polygon' }));
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 78, clientY: 80 });
  fireEvent.pointerMove(canvas, { pointerId: 1, button: 0, clientX: 138, clientY: 130 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 138, clientY: 130 });
  const sides = await screen.findByRole('spinbutton', { name: 'feature.design.polygonSides' });
  const [polygon] = (await read()).document.rootIds;
  expect((await read()).document.nodes[polygon]).toMatchObject({ width: 60, height: 50, geometry: { kind: 'polygon', sides: 5 } });
  sides.focus();
  fireEvent.change(sides, { target: { value: '7' } });
  fireEvent.keyDown(sides, { key: 'Enter' });
  await waitFor(async () => expect((await read()).document.nodes[polygon]).toMatchObject({ geometry: { kind: 'polygon', sides: 7 } }));

  const icons = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.addIcon' });
  await waitFor(() => expect(icons.disabled).toBe(false));
  fireEvent.click(icons);
  const picker = screen.getByRole('dialog', { name: 'feature.design.addIcon' });
  await within(picker).findByRole('button', { name: 'feature.design.icon.heart' });
  const grid = within(picker).getByRole('group', { name: 'feature.design.icon' });
  grid.scrollTop = 100_000;
  fireEvent.scroll(grid);
  await within(picker).findByRole('button', { name: 'zoom out' });
  fireEvent.change(within(picker).getByRole('textbox', { name: 'feature.design.searchIcons' }), { target: { value: 'rocket' } });
  expect(commit).toHaveBeenCalledTimes(2);
  const rocket = await within(picker).findByRole<HTMLButtonElement>('button', { name: 'rocket' });
  await waitFor(() => expect(rocket.disabled).toBe(false));
  fireEvent.click(rocket);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const { document } = await read();
  const iconId = document.rootIds[1];
  const inserted = document.nodes[iconId];
  expect(inserted).toMatchObject({ kind: 'vector', geometry: { kind: 'svg', icon: 'rocket' }, strokes: [{ width: 2 }] });
  expect(commit).toHaveBeenCalledTimes(3);

  fireEvent.click(await screen.findByRole('button', { name: 'feature.design.changeIcon' }));
  const changer = screen.getByRole('dialog', { name: 'feature.design.changeIcon' });
  fireEvent.change(within(changer).getByRole('textbox', { name: 'feature.design.searchIcons' }), { target: { value: 'palette' } });
  const palette = await within(changer).findByLabelText<HTMLButtonElement>('palette', { selector: 'button' });
  await waitFor(() => expect(palette.disabled).toBe(false));
  fireEvent.click(palette);
  await waitFor(async () => expect((await read()).document.nodes[iconId]).toMatchObject({
    x: inserted.x, y: inserted.y, width: inserted.width, strokes: inserted.strokes,
    geometry: { kind: 'svg', icon: 'palette', paths: expect.arrayContaining([expect.objectContaining({ fillFromStroke: true })]) },
  }));
  expect(commit).toHaveBeenCalledTimes(4);
  await waitFor(() => expect(changer.isConnected).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.undo' }));
  await waitFor(async () => expect((await read()).document.nodes[iconId]).toEqual(inserted));
});

it('inserts editable SVG files and clipboard content into an artboard without a selection', async () => {
  const markup = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#6f65bf" stroke="#223344" stroke-width="2"/></svg>';
  const importImage = vi.fn<DesignClient['importImage']>();
  const requestClipboardPaste = vi.fn<DesignAssets['requestClipboardPaste']>().mockResolvedValue({ kind: 'svg', markup });
  const { commit, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'svg', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 80, y: 60, width: 240, height: 180, childIds: [] } },
  }, undefined, { importImage, requestClipboardPaste });
  async function children() {
    const { document } = await read();
    expect(document.rootIds).toEqual(['board']);
    return (document.nodes.board as DesignFrame).childIds.map((id) => document.nodes[id]);
  }
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.addIcon' }));
  const picker = screen.getByRole('dialog', { name: 'feature.design.addIcon' });
  const fileInput = picker.querySelector<HTMLInputElement>('input[type=file]')!;
  fireEvent.change(fileInput, { target: { files: [new File([markup], 'badge.svg', { type: 'image/svg+xml' })] } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await children()).toMatchObject([{
    kind: 'vector', name: 'badge', x: 108, y: 78, geometry: { kind: 'svg' }, fills: [{ color: '#6f65bf' }], strokes: [{ color: '#223344', width: 2 }],
  }]);

  const stroke = screen.getByRole('textbox', { name: 'feature.design.stroke' });
  stroke.focus();
  fireEvent.change(stroke, { target: { value: 'E83D80' } });
  fireEvent.keyDown(stroke, { key: 'Enter' });
  await waitFor(async () => expect((await children())[0]).toMatchObject({ strokes: [{ color: '#E83D80', width: 2 }] }));

  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', markup);
  clipboardData.items.add(new File(['fallback bitmap'], 'badge.png', { type: 'image/png' }));
  canvas.focus();
  fireEvent.paste(canvas, { clipboardData });
  await waitFor(async () => expect(await children()).toHaveLength(2));
  fireEvent.keyDown(canvas, { key: 'v', code: 'KeyV', ctrlKey: true });
  await waitFor(async () => {
    expect((await children()).slice(1)).toEqual([
      expect.objectContaining({ kind: 'vector', geometry: expect.objectContaining({ kind: 'svg' }) }),
      expect.objectContaining({ kind: 'vector', geometry: expect.objectContaining({ kind: 'svg' }) }),
    ]);
  });
  expect(requestClipboardPaste).toHaveBeenCalledExactlyOnceWith(true);
  expect(importImage).not.toHaveBeenCalled();
  expect(commit).toHaveBeenCalledTimes(4);
});

function layerTransfer() {
  const dataTransfer = new DataTransfer();
  vi.spyOn(dataTransfer, 'setDragImage').mockImplementation(() => {});
  return dataTransfer;
}

function layerDragEvent(type: 'dragstart' | 'dragover' | 'dragleave' | 'dragend' | 'drop', target: HTMLElement, dataTransfer: DataTransfer, point: Point) {
  // happy-dom omits mouse coordinates from DragEvent.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return fireEvent(target, event);
}

it.each([
  { direction: 'out of', into: false, y: 101, rootIds: ['target', 'shape'], childIds: ['child'] },
  { direction: 'into', into: true, y: 116, rootIds: ['target'], childIds: ['child', 'shape'] },
])('commits a path drop $direction a component when window listeners flush before the list receives it', async ({ into, y, rootIds, childIds }) => {
  const bounds = { x: 0, y: 0, width: 20, height: 20 };
  const source: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'layer-order', rootIds: into ? ['target', 'shape'] : ['target'], nodes: {
      target: { ...bounds, kind: 'frame', component: true, name: 'Target component', childIds: into ? ['child'] : ['child', 'shape'] },
      shape: { ...bounds, kind: 'vector', name: 'Moving layer', geometry: { kind: 'path', anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false } },
      child: { ...bounds, kind: 'rectangle', cornerRadius: 0, name: 'Child layer' },
    },
  };
  const { commit, read } = await mountEditor(source);
  const moving = await screen.findByRole('button', { name: 'Moving layer' });
  const target = screen.getByRole('button', { name: 'Target component' });
  vi.spyOn(target.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 100, 200, 32));
  const transfer = layerTransfer();
  layerDragEvent('dragstart', moving, transfer, { x: 50, y: 80 });
  layerDragEvent('dragover', target, transfer, { x: 50, y });
  const slot = target.closest('aside')!.querySelector<HTMLElement>('[data-design-layer-drop-slot]')!;
  window.addEventListener('drop', () => flushSync(() => {}), { capture: true, once: true });
  vi.stubGlobal('event', new Event('drop')); // Give the native window listener React's discrete event priority.
  expect(layerDragEvent('drop', slot, transfer, { x: 50, y })).toBe(false);
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  expect(commit).toHaveBeenCalledOnce();
  expect((await read()).document).toMatchObject({ rootIds, nodes: { target: { childIds } } });
  fireEvent.click(undo);
  await waitFor(async () => expect((await read()).document).toEqual(source));
});

it('reflows canvas siblings when a layer is dropped in the same-group preview slot', async () => {
  const shape = { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } as const;
  const { commit, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'layer-flow', rootIds: ['frame'], nodes: {
      frame: { kind: 'frame', x: 0, y: 0, width: 100, height: 80, childIds: ['first', 'second'],
        layout: { direction: 'horizontal', gap: 6, padding: 0, align: 'start' } },
      first: { ...shape, name: 'First tile' }, second: { ...shape, name: 'Second tile' },
    },
  });
  const source = await screen.findByRole('button', { name: 'Second tile' });
  const target = screen.getByRole('button', { name: 'First tile' }).parentElement!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 100, 200, 31));
  expect([drawing.localX.get('first'), drawing.localX.get('second')]).toEqual([0, 16]);
  const transfer = layerTransfer();
  layerDragEvent('dragstart', source, transfer, { x: 50, y: 135 });
  expect(layerDragEvent('dragover', target.parentElement!, transfer, { x: 50, y: 99 })).toBe(false);
  const slot = target.closest('aside')!.querySelector<HTMLElement>('[data-design-layer-drop-slot]')!;
  expect(commit).not.toHaveBeenCalled();
  layerDragEvent('drop', slot, transfer, { x: 50, y: 125 });

  await waitFor(() => expect([drawing.localX.get('first'), drawing.localX.get('second')]).toEqual([16, 0]));
  expect((await read()).document.nodes.frame).toMatchObject({ childIds: ['second', 'first'] });
  expect(commit).toHaveBeenCalledOnce();
});

it('follows the canvas pointer before saving and undoes the move and reparent together', async () => {
  const source: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'layer-to-canvas', rootIds: ['target', 'shape'], nodes: {
      target: { kind: 'frame', name: 'Target frame', x: 4, y: 8, width: 80, height: 80, childIds: [] },
      shape: { kind: 'rectangle', name: 'Moving tile', x: 0, y: 0, width: 12, height: 10, cornerRadius: 0 },
    },
  };
  const { commit, read } = await mountEditor(source);
  const moving = await screen.findByRole('button', { name: 'Moving tile' });
  const canvas = screen.getByRole('region', { name: 'feature.design.canvas' });
  const grab = { x: 50, y: 80 };
  const pointer = { x: 88, y: 88 };

  const cancelled = layerTransfer();
  layerDragEvent('dragstart', moving, cancelled, grab);
  expect(layerDragEvent('dragover', canvas, cancelled, pointer)).toBe(false);
  expect(drawing.localX.get('shape')).toBe(14);
  layerDragEvent('dragover', canvas, cancelled, { x: 92, y: 88 });
  expect(drawing.localX.get('shape')).toBe(18);
  expect(commit).not.toHaveBeenCalled();
  expect((await read()).document).toEqual(source);
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect(drawing.localX.get('shape')).toBe(0);
  layerDragEvent('dragend', moving, cancelled, pointer);
  expect(layerDragEvent('drop', canvas, cancelled, pointer)).toBe(true);
  expect(commit).not.toHaveBeenCalled();

  const transfer = layerTransfer();
  layerDragEvent('dragstart', moving, transfer, grab);
  layerDragEvent('dragover', canvas, transfer, pointer);
  layerDragEvent('drop', canvas, transfer, pointer);

  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  expect(commit).toHaveBeenCalledOnce();
  expect((await read()).document).toMatchObject({ rootIds: ['target'], nodes: {
    target: { childIds: ['shape'] }, shape: { x: 10, y: 7 },
  } });
  expect(drawing.localX.get('shape')).toBe(10);
  fireEvent.click(undo);
  await waitFor(() => expect(undo.disabled).toBe(true));
  expect((await read()).document).toEqual(source);
});

it.each(['layer tree', 'canvas'])('reflows the canvas drop slot while dragging from the %s and saves it once', async (origin) => {
  const tile = { kind: 'rectangle', x: 0, y: 0, width: 6, height: 6, cornerRadius: 0 } as const;
  const source: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'canvas-layer-flow', rootIds: ['target', 'shape'], nodes: {
      target: { kind: 'frame', name: 'Layout frame', x: 0, y: 0, width: 80, height: 40, childIds: ['first', 'last'],
        layout: { direction: 'horizontal', gap: 2, padding: 0, align: 'start' } },
      first: { ...tile, name: 'First' }, last: { ...tile, name: 'Last' },
      shape: { ...tile, y: -12, name: 'Moving tile' },
    },
  };
  let release = () => {};
  const saveGate = new Promise<void>((resolve) => { release = resolve; });
  const { commit, read, replace } = await mountEditor(source, saveGate);
  const moving = await screen.findByRole('button', { name: 'Moving tile' });
  const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  const firstSlot = { x: 70, y: 76 };
  const middleSlot = { x: 75, y: 76 };
  const positions = () => ['first', 'last', 'shape'].map((id) => drawing.localX.get(id));
  function beginDrag() {
    if (origin === 'canvas') {
      canvas.setPointerCapture = () => undefined;
      drawing.hit = 'shape';
      const pointer = ({ x, y }: Point) => ({ pointerId: 1, button: 0, clientX: x, clientY: y });
      fireEvent.pointerDown(canvas, pointer({ x: 71, y: 59 }));
      return { move: (p: Point) => fireEvent.pointerMove(canvas, pointer(p)), drop: (p: Point) => fireEvent.pointerUp(canvas, pointer(p)) };
    }
    const transfer = layerTransfer();
    layerDragEvent('dragstart', moving, transfer, { x: 50, y: 80 });
    return {
      move: (p: Point) => layerDragEvent('dragover', canvas, transfer, p),
      drop(p: Point) {
        layerDragEvent('drop', canvas, transfer, p);
        layerDragEvent('dragend', moving, transfer, p);
      },
    };
  }

  try {
    const cancelled = beginDrag();
    cancelled.move(firstSlot);
    expect(positions()).toEqual([8, 16, -1]);
    cancelled.move(middleSlot);
    expect(positions()).toEqual([0, 16, 4]);
    cancelled.move({ x: 75, y: 58 });
    expect(positions()).toEqual([0, 8, 4]);
    cancelled.move(middleSlot);
    expect(positions()).toEqual([0, 16, 4]);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    cancelled.drop(middleSlot);
    expect(positions()).toEqual([0, 8, 0]);
    expect(commit).not.toHaveBeenCalled();

    const drag = beginDrag();
    drag.move(middleSlot);
    drag.drop(middleSlot);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(positions()).toEqual([0, 16, 8]);
    expect(commit).toHaveBeenCalledOnce();
    expect((await read()).document).toEqual(source);

    await act(async () => { release(); await commit.mock.results[0].value; });
    const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
    await waitFor(() => expect(undo.disabled).toBe(false));
    expect((await read()).document.nodes.target).toMatchObject({ childIds: ['first', 'shape', 'last'] });
    fireEvent.click(undo);
    await waitFor(() => expect(undo.disabled).toBe(true));
    expect((await read()).document).toEqual(source);
    expect(positions()).toEqual([0, 8, 0]);
  } finally {
    release();
  }
});

it('previews paint on the canvas and its component instance until one undoable save completes', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 16, height: 16, childIds: [] } satisfies DesignFrame;
  const source: DesignDocument = {
    schemaVersion: designDocumentVersion, documentId: 'design', rootIds: ['main', 'instance'], nodes: {
      main: { ...frame, name: 'Main component', component: true, fills: [{ color: '#ff0000' }] },
      instance: { ...frame, x: 20, name: 'Instance', instanceOf: 'main' },
    },
  };
  let releaseSave: () => void = () => undefined;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const { documentRef, commit, replace, revision } = await mountEditor(source, saveGate);
  fireEvent.click(await screen.findByRole('button', { name: 'Main component' }));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.fill' }));
  const picker = await screen.findByRole('slider', { name: 'Saturation and brightness' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 100));
  const start = { pointerId: 1, button: 0, clientX: 220, clientY: 55 };
  const move = { ...start, clientY: 80 };
  const release = { ...start, clientY: 105 };
  const fills = () => [drawing.frameFills.get('main'), drawing.frameFills.get('instance')];
  const hex = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.fill' }).value;
  const drag = () => {
    fireEvent.pointerDown(picker, start);
    fireEvent.pointerMove(picker, move);
  };

  try {
    await act(async () => { drag(); });
    expect(fills()).toEqual(['rgba(128, 0, 0, 1)', 'rgba(128, 0, 0, 1)']);
    expect(hex()).toBe('800000');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerCancel(picker, move);
    expect(fills()).toEqual(['rgba(255, 0, 0, 1)', 'rgba(255, 0, 0, 1)']);
    expect(hex()).toBe('FF0000');

    drag();
    fireEvent.pointerUp(picker, release);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(fills()).toEqual(['rgba(64, 0, 0, 1)', 'rgba(64, 0, 0, 1)']);
    expect(hex()).toBe('400000');
    expect(revision()).toBe(0);
    expect(commit).toHaveBeenCalledExactlyOnceWith({ ref: documentRef, expectedRevision: '0',
      edits: [{ kind: 'update', nodeId: 'main', node: { ...source.nodes.main, fills: [{ color: '#400000' }] } }] });

    const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
    await act(async () => { releaseSave(); await commit.mock.results[0].value; });
    await waitFor(() => expect(undo.disabled).toBe(false));
    expect(fills()).toEqual(['rgba(64, 0, 0, 1)', 'rgba(64, 0, 0, 1)']);
    expect(hex()).toBe('400000');
    fireEvent.click(undo);
    const redo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.redo' });
    await waitFor(() => expect(redo.disabled).toBe(false));
    expect(fills()).toEqual(['rgba(255, 0, 0, 1)', 'rgba(255, 0, 0, 1)']);
    expect(hex()).toBe('FF0000');
    expect(undo.disabled).toBe(true);
  } finally {
    releaseSave();
  }
});

it('limits gap and padding drags to canvas adjustment mode and saves each completed drag as one undoable edit', async () => {
  const frame = { kind: 'frame', x: -120, y: -100, width: 120, height: 64, childIds: [] } as const;
  const rectangle = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 } as const;
  const layout = { direction: 'horizontal', padding: 8, paddingSides: [8, 8, 8, 8], gap: 6,
    align: 'start', justify: 'space-between' } as const;
  const source: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'spacing', rootIds: ['main', 'instance'], nodes: {
    main: { ...frame, name: 'Layout source', component: true, childIds: ['first', 'last'], layout },
    instance: { ...frame, y: -32, instanceOf: 'main', name: 'Layout instance' },
    first: rectangle, last: rectangle,
  } };
  let releaseSave: () => void = () => undefined;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const { commit, replace, revision } = await mountEditor(source, saveGate);
  fireEvent.click(await screen.findByRole('button', { name: 'Layout source' }));
  const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  const redo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.redo' });
  const start = { pointerId: 1, button: 0, clientX: 40, clientY: 24 };
  const gapMove = { ...start, clientX: 30 };
  const gapRelease = { ...start, clientX: 20 };
  const paddingMove = { ...start, clientX: 50 };
  const positions = () => ['first', 'last', 'instance/first', 'instance/last'].map((id) => drawing.localX.get(id));
  const drag = (move: typeof start) => {
    fireEvent.pointerDown(canvas, start);
    fireEvent.pointerMove(canvas, move);
  };
  async function undoDrag() {
    fireEvent.click(undo);
    await waitFor(() => expect(redo.disabled).toBe(false));
    expect(positions()).toEqual([8, 92, 8, 92]);
    expect(undo.disabled).toBe(true);
  }

  try {
    drawing.hit = 'design-layout-gap';
    drag(gapMove);
    fireEvent.pointerUp(canvas, gapRelease);
    expect(positions()).toEqual([8, 92, 8, 92]);
    expect(commit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Layout source' }));
    fireEvent.click(screen.getByRole('button', { name: 'feature.design.adjustLayoutOnCanvas' }));
    await act(async () => { drag(gapMove); });
    expect(positions()).toEqual([8, 82, 8, 82]);
    expect(number('feature.design.gap').value).toBe('54');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.pointerUp(canvas, gapRelease);
    expect(positions()).toEqual([8, 92, 8, 92]);
    expect(number('feature.design.gap.minimum').value).toBe('6');

    drag(gapMove);
    fireEvent.pointerUp(canvas, gapRelease);
    fireEvent.pointerUp(canvas, gapRelease);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(revision()).toBe(0);
    expect(positions()).toEqual([8, 72, 8, 72]);
    expect(number('feature.design.gap').value).toBe('44');
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedRevision: '0', edits: [expect.objectContaining({
      kind: 'update', nodeId: 'main', node: expect.objectContaining({ layout: { ...layout, justify: 'start', gap: 44 } }),
    })] }));
    await act(async () => { releaseSave(); await commit.mock.results[0].value; });
    await waitFor(() => expect(undo.disabled).toBe(false));
    await undoDrag();

    drawing.hit = 'design-layout-left';
    drag(paddingMove);
    expect(positions()).toEqual([18, 92, 18, 92]);
    expect(number('feature.design.padding.left').value).toBe('18');
    fireEvent.pointerCancel(canvas, paddingMove);
    expect(positions()).toEqual([8, 92, 8, 92]);
    expect(number('feature.design.padding.left').value).toBe('8');
    expect(commit).toHaveBeenCalledTimes(1);

    drag(paddingMove);
    fireEvent.pointerUp(canvas, paddingMove);
    await waitFor(() => expect(undo.disabled).toBe(false));
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ edits: [expect.objectContaining({
      kind: 'update', nodeId: 'main', node: expect.objectContaining({ layout: { ...layout, paddingSides: [8, 8, 8, 18] } }),
    })] }));
    expect(positions()).toEqual([18, 92, 18, 92]);
    await undoDrag();

    fireEvent.keyDown(canvas, { key: 'Escape' });
    drawing.hit = 'design-anchor-4';
    drag({ ...start, clientX: 60 });
    expect(number('feature.design.width').value).toBe('140');
    expect(positions()).toEqual([8, 112, 8, 112]);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(number('feature.design.width').value).toBe('120');
    expect(positions()).toEqual([8, 92, 8, 92]);
    expect(commit).toHaveBeenCalledTimes(2);
  } finally {
    releaseSave();
  }
});

it('previews typed coordinates and preserves consecutive Tab edits across a pending save', async () => {
  const node = { kind: 'rectangle', name: 'Tile', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 } as const;
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const { commit, replace, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'coordinates', rootIds: ['tile'], nodes: { tile: node },
  }, saveGate);
  fireEvent.click(await screen.findByRole('button', { name: 'Tile' }));
  const x = number('X');
  const y = number('Y');
  try {
    x.focus();
    fireEvent.change(x, { target: { value: '15' } });
    expect(drawing.localX.get('tile')).toBe(15);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(x, { key: 'Escape' });
    expect(drawing.localX.get('tile')).toBe(0);
    expect(x.value).toBe('0');
    expect(commit).not.toHaveBeenCalled();

    x.focus();
    fireEvent.change(x, { target: { value: '12' } });
    y.focus();
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(y);
    expect(y.readOnly || y.matches(':disabled')).toBe(false);
    expect(drawing.localX.get('tile')).toBe(12);
    fireEvent.change(y, { target: { value: '9' } });
    y.blur();
    expect(commit).toHaveBeenCalledTimes(1);

    await act(async () => { releaseSave(); });
    await waitFor(async () => expect((await read()).document.nodes.tile).toMatchObject({ x: 12, y: 9 }));
    expect(commit.mock.calls.map(([input]) => input.expectedRevision)).toEqual(['0', '1']);
  } finally {
    releaseSave();
  }
});

it('applies a mixed fill to editable layers in one undo and leaves locked layers intact', async () => {
  const frame = { kind: 'frame', x: 0, y: 0, width: 16, height: 16, childIds: [] } satisfies DesignFrame;
  const bottom = { color: '#ffffff' };
  const original = {
    first: { ...frame, name: 'First', fills: [bottom, { color: '#ff0000', opacity: 0.4 }] },
    second: { ...frame, x: 20, name: 'Second', fills: [{ color: '#0000ff' }] },
    locked: { ...frame, x: 40, name: 'Locked', locked: true, fills: [{ color: '#00ff00' }] },
  };
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'batch', rootIds: Object.keys(original), nodes: original });
  fireEvent.click(await screen.findByRole('button', { name: 'First' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second' }), { shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Locked' }), { shiftKey: true });
  const hex = screen.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.fill' });
  expect(hex.value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.fill' }));
  const picker = await screen.findByRole('slider', { name: 'Saturation and brightness' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 100));
  const pointer = { pointerId: 1, button: 0, clientX: 220, clientY: 30 };
  fireEvent.pointerDown(picker, pointer);
  expect(hex.value).toBe('FF0000');
  expect(drawing.frameFills.get('second')).toBe('rgba(255, 0, 0, 1)');
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(picker, pointer);
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  expect(commit).toHaveBeenCalledOnce();
  const applied = (await read()).document.nodes;
  expect(applied.first).toMatchObject({ fills: original.first.fills });
  expect(applied.second).toMatchObject({ fills: [{ color: '#ff0000' }] });
  expect(applied.locked).toMatchObject({ fills: original.locked.fills });

  fireEvent.click(undo);
  await waitFor(() => expect(undo.disabled).toBe(true));
  expect((await read()).document.nodes).toMatchObject(original);
});

it('moves the image crop and its inspector values together, with cancellation and a single saved crop', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(async function (this: HTMLImageElement) {
    Object.defineProperties(this, { naturalWidth: { value: 80 }, naturalHeight: { value: 40 } });
  });
  const photo = { kind: 'image', name: 'Photo', x: 0, y: 0, width: 40, height: 40, assetPath: 'photo.png' } as const;
  const { commit, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'crop', rootIds: ['photo'], nodes: { photo },
  }, undefined, {
    searchImages: async (_ref, query) => query === 'new' ? ['other/new.png', 'images/new.png'] : ['photo.png'],
    readImage: async () => ({ kind: 'image', mimeType: 'image/png', base64: 'aW1hZ2U=' }),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(drawing.images.get('photo')?.crop?.x).toBe(20));
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.adjustCrop' }));
  const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
  canvas.setPointerCapture = () => undefined;
  drawing.hit = 'photo';
  const start = { pointerId: 1, button: 0, clientX: 20, clientY: 32 };
  const move = { ...start, clientX: 30 };
  const release = { ...start, clientX: 35 };
  function assertCrop(percent: number, imageX: number) {
    expect(number('feature.design.crop.x').value).toBe(String(percent));
    expect(drawing.images.get('photo')?.crop?.x).toBe(imageX);
  }
  function drag() {
    fireEvent.pointerDown(canvas, start);
    fireEvent.pointerMove(canvas, move);
    assertCrop(25, 10);
    expect(commit).not.toHaveBeenCalled();
  }
  drag();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  fireEvent.pointerUp(canvas, release);
  assertCrop(50, 20);
  drag();
  fireEvent.pointerUp(canvas, release);
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  assertCrop(12.5, 5);
  expect((await read()).document.nodes.photo).toMatchObject({ crop: { x: 0.125, y: 0.5 } });
  expect(commit).toHaveBeenCalledOnce();
  fireEvent.click(undo);
  await waitFor(() => expect(undo.disabled).toBe(true));
  assertCrop(50, 20);

  fireEvent.click(screen.getByRole('button', { name: 'feature.design.replaceImage' }));
  const dialog = screen.getByRole('dialog', { name: 'feature.design.replaceImage' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'feature.design.imagePath' }), { target: { value: 'new' } });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'images/new.png' }));
  const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'feature.design.replaceImage' });
  await waitFor(() => expect(confirm.disabled).toBe(false));
  expect(commit).toHaveBeenCalledOnce();
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await read()).document.nodes.photo).toMatchObject({ ...photo, assetPath: 'images/new.png' });
});

it('waits for the picked image to be stored before inserting a layer with its project path', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const assetPath = 'design-assets/photo.png';
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(async function (this: HTMLImageElement) {
    Object.defineProperties(this, { naturalWidth: { value: 80 }, naturalHeight: { value: 40 } });
  });
  let completeImport = () => {};
  const importing = new Promise<string>((resolve) => { completeImport = () => resolve(assetPath); });
  const importImage = vi.fn<DesignClient['importImage']>(() => importing);
  const readImage = vi.fn<DesignAssets['read']>(async () => ({ kind: 'image', mimeType: 'image/png', base64 }));
  const { commit, documentRef, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'import-image', rootIds: [], nodes: {},
  }, undefined, { readImage, importImage });
  fireEvent.click(await screen.findByRole('button', { name: 'feature.design.addImage' }));
  const dialog = screen.getByRole('dialog', { name: 'feature.design.addImage' });
  const picker = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  const open = vi.spyOn(picker, 'click').mockImplementation(() => {});
  try {
    fireEvent.click(within(dialog).getByRole('button', { name: 'feature.design.importLocalImage' }));
    expect(open).toHaveBeenCalledOnce();
    const file = new File([Uint8Array.from(Buffer.from(base64, 'base64'))], 'photo.png');
    fireEvent.change(picker, { target: { files: [file] } });
    const insert = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'feature.design.insert' });
    await waitFor(() => expect(insert.disabled).toBe(false));
    expect(importImage).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(insert);
    await waitFor(() => expect(importImage).toHaveBeenCalledExactlyOnceWith({
      ref: documentRef, name: file.name, base64,
    }, expect.any(AbortSignal)));
    expect(commit).not.toHaveBeenCalled();

    await act(async () => { completeImport(); });
    const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
    await waitFor(() => expect(undo.disabled).toBe(false));
    expect(commit).toHaveBeenCalledOnce();
    expect(readImage).toHaveBeenCalledWith(documentRef, assetPath);
    const { document } = await read();
    expect(document.rootIds).toHaveLength(1);
    expect(document.nodes[document.rootIds[0]]).toMatchObject({ kind: 'image', assetPath, width: 80, height: 40 });
  } finally {
    completeImport();
  }
});

it('routes paste shortcuts to images, image replacement, and copied layers without intercepting text edits', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const assetPath = 'design-assets/screenshot.png';
  const replacementPath = 'design-assets/replacement.png';
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(async function (this: HTMLImageElement) {
    Object.defineProperties(this, { naturalWidth: { value: 80 }, naturalHeight: { value: 40 } });
  });
  function imageClipboard(name: string) {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(Buffer.from(base64, 'base64'))], name, { type: 'image/png' }));
    return data;
  }
  let clipboardData = imageClipboard('screenshot.png');
  const requestClipboardPaste = vi.fn<DesignAssets['requestClipboardPaste']>(async () => {
    fireEvent.paste(document.activeElement!, { clipboardData });
    return { kind: 'issued' };
  });
  const readDesignLayers = vi.fn<DesignAssets['output']['readDesignLayers']>();
  const importImage = vi.fn<DesignClient['importImage']>()
    .mockResolvedValueOnce(assetPath)
    .mockResolvedValueOnce(replacementPath);
  const { commit, documentRef, read } = await mountEditor({
    schemaVersion: designDocumentVersion, documentId: 'clipboard', rootIds: ['board'],
    nodes: { board: { kind: 'frame', x: 80, y: 60, width: 240, height: 180, childIds: [] } },
  },
    undefined, {
      importImage, requestClipboardPaste, readDesignLayers,
      readImage: async () => ({ kind: 'image', mimeType: 'image/png', base64 }),
    });
  const canvas = await screen.findByRole('region', { name: 'feature.design.canvas' });
  const ctrlV = { key: 'v', code: 'KeyV', ctrlKey: true };
  const cmdV = { key: 'v', code: 'KeyV', metaKey: true };
  canvas.focus();
  fireEvent.keyDown(canvas, ctrlV);
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: 'feature.design.undo' });
  await waitFor(() => expect(undo.disabled).toBe(false));
  const [id] = ((await read()).document.nodes.board as DesignFrame).childIds;
  expect((await read()).document.nodes[id]).toMatchObject({ kind: 'image', assetPath });
  expect(importImage).toHaveBeenCalledExactlyOnceWith({ ref: documentRef, name: 'screenshot.png', base64 }, expect.any(AbortSignal));
  expect(readDesignLayers).not.toHaveBeenCalled();

  const name = screen.getByRole('textbox', { name: 'feature.design.name' });
  name.focus();
  expect(fireEvent.keyDown(name, cmdV)).toBe(true);
  expect(fireEvent.paste(name, { clipboardData })).toBe(true);
  expect(requestClipboardPaste).toHaveBeenCalledOnce();

  clipboardData = imageClipboard('replacement.png');
  async function previewReplacement() {
    fireEvent.click(screen.getByRole('button', { name: 'feature.design.replaceImage' }));
    const picker = screen.getByRole('dialog', { name: 'feature.design.replaceImage' });
    picker.focus();
    fireEvent.keyDown(picker, cmdV);
    const confirm = within(picker).getByRole<HTMLButtonElement>('button', { name: 'feature.design.replaceImage' });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    return { picker, confirm };
  }
  const { picker } = await previewReplacement();
  fireEvent.click(within(picker).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(importImage).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  fireEvent.click((await previewReplacement()).confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await read()).document).toMatchObject({ rootIds: ['board'], nodes: { board: { childIds: [id] }, [id]: { assetPath: replacementPath } } });

  const layer = { kind: 'rectangle', name: 'Copied tile', x: 0, y: 0, width: 40, height: 40, cornerRadius: 0 };
  clipboardData = new DataTransfer();
  readDesignLayers.mockResolvedValue(JSON.stringify({
    projectId: documentRef.projectId, rootId: documentRef.rootId,
    document: { schemaVersion: designDocumentVersion, documentId: 'copied', rootIds: ['tile'], nodes: { tile: layer } },
  }));
  canvas.focus();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  fireEvent.keyDown(canvas, ctrlV);
  await screen.findByRole('button', { name: layer.name });
  const current = (await read()).document;
  expect(current.rootIds).toEqual(['board']);
  const [, copied] = (current.nodes.board as DesignFrame).childIds;
  expect(current.nodes[copied]).toMatchObject({ kind: 'rectangle', name: layer.name, x: 100, y: 70 });
  expect(readDesignLayers).toHaveBeenCalledOnce();
  expect(importImage).toHaveBeenCalledTimes(2);
  expect(commit).toHaveBeenCalledTimes(3);
});
