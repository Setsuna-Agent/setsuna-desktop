// @vitest-environment happy-dom

import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commitDesignEdits, designDocumentCodec, designDocumentVersion, type DesignGradient, type DesignNode, type DesignSnapshot } from '../../src/contracts/index.js';
import { DesignDocumentService } from '../../src/runtime/design-document-service.js';
import type { DesignAssets } from '../../src/renderer/client.js';
import type { LoadDesignImage } from '../../src/renderer/design-images.js';
import { DesignAppearanceFields } from '../../src/renderer/inspector/DesignAppearanceFields.js';
import { DesignGradientFields } from '../../src/renderer/inspector/DesignGradientFields.js';
import { DesignCanvasGradient } from '../../src/renderer/styles/DesignCanvasGradient.js';
import { DesignGradientSessionProvider } from '../../src/renderer/styles/DesignGradientSession.js';
import { useDesignCanvasGradient } from '../../src/renderer/styles/use-design-canvas-gradient.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mountAppearanceFields(layer: DesignNode, { schemaVersion = designDocumentVersion, loadImage = vi.fn(), editOnCanvas = false }:
  Readonly<{ schemaVersion?: number; loadImage?: LoadDesignImage; editOnCanvas?: boolean }> = {}) {
  const ref = { projectId: 'project', path: 'test.design.json' };
  let content = JSON.stringify({ schemaVersion, documentId: 'art', rootIds: ['tile'], nodes: { tile: layer } });
  let revision = 0;
  const service = new DesignDocumentService({ create: vi.fn(), withDocument: (_ref, _signal, operation) => operation({
    key: ref.path, read: async () => ({ content, revision: String(revision) }), replace: async (saved) => { content = saved; return String(++revision); },
  }) });
  const signal = new AbortController().signal;
  const initial = await service.read(ref, signal);
  const onPaintPreview = vi.fn<(value: DesignNode | undefined) => void>();
  const assets: DesignAssets = { search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(), output: {
    saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(), copyDesignLayers: vi.fn(),
    readDesignLayers: vi.fn(), copyText: vi.fn(),
  } };
  const paintAssets = { documentRef: ref, assets, loadImage, onImport: vi.fn() };
  function Fields() {
    const [state, setState] = useState(initial);
    const props = { disabled: false, node: state.document.nodes.tile, onPaintPreview, translate: (key: string) => key,
      onSave: async (node: DesignNode) => {
        const input = commitDesignEdits.input.parse({ ref, expectedRevision: state.revision, edits: [{ kind: 'update', nodeId: 'tile', node }] });
        const next = await service.commit(input, signal);
        setState(next);
        return true;
      } };
    const canvas = editOnCanvas ? <GradientCanvas snapshot={state} onSave={props.onSave} /> : null;
    const layer = editOnCanvas ? { id: 'tile', node: props.node, box: { x: 0, y: 0, width: 120, height: 80 } } : undefined;
    return <>{canvas}<DesignAppearanceFields {...props} assets={paintAssets} layer={layer} fieldEdits={{
      onFieldSave: (edit) => props.onSave(edit(props.node)),
      onFieldPreview: (_owner, edit) => onPaintPreview(edit?.(props.node)),
    }} /></>;
  }
  render(<UiProvider locale="en-US"><ToastProvider><DesignGradientSessionProvider><Fields /></DesignGradientSessionProvider></ToastProvider></UiProvider>);
  return { tile: () => designDocumentCodec.parse(JSON.parse(content)).nodes.tile, currentRevision: () => revision, onPaintPreview, service, ref, signal };
}

function GradientCanvas({ snapshot, onSave }: Readonly<{ snapshot: DesignSnapshot; onSave(node: DesignNode): Promise<boolean> }>) {
  const surface = useRef<HTMLDivElement>(null);
  const bounds = { x: 0, y: 0, width: 120, height: 80 };
  const { document, revision } = snapshot;
  const edit = useDesignCanvasGradient({ document, projected: document, revision, selectedId: 'tile', visible: true,
    scene: { tile: { ...bounds, absoluteX: 0, absoluteY: 0, angle: 0, scaleX: 1, scaleY: 1, parentId: null,
      visible: true, locked: false, visibleBounds: bounds, paintBounds: bounds } },
    onSave: (_id, node) => onSave(node) });
  return <div ref={surface} role="region" aria-label="Canvas">
    {edit ? <DesignCanvasGradient key={edit.key} {...edit.guides} surface={surface}
      viewport={{ x: 0, y: 0, scale: 1 }} disabled={false} translate={(key) => key} /> : null}
  </div>;
}

it('previews appearance slider changes and only persists a completed drag', async () => {
  const { tile, currentRevision, onPaintPreview } = await mountAppearanceFields({
    kind: 'rectangle', x: 0, y: 0, width: 120, height: 80, cornerRadius: 8, opacity: 0.6,
  });
  const radiusLabel = 'feature.design.cornerRadius';
  const opacityLabel = 'feature.design.opacity';
  const radius = screen.getByRole('slider', { name: radiusLabel });
  const opacity = screen.getByRole('slider', { name: opacityLabel });
  const radiusValue = screen.getByRole<HTMLInputElement>('spinbutton', { name: radiusLabel });
  const opacityValue = screen.getByRole<HTMLInputElement>('spinbutton', { name: opacityLabel });
  const pointer = { pointerId: 1, button: 0 };

  fireEvent.pointerDown(radius, pointer);
  fireEvent.change(radius, { target: { value: '24' } });
  expect(onPaintPreview.mock.lastCall?.[0]).toMatchObject({ cornerRadius: 24 });
  expect(radiusValue.value).toBe('24');
  fireEvent.keyDown(radius, { key: 'Escape' });
  fireEvent.change(radius, { target: { value: '30' } });
  fireEvent.pointerUp(radius, pointer);
  expect(onPaintPreview).toHaveBeenLastCalledWith(undefined);
  expect(radiusValue.value).toBe('8');
  expect(currentRevision()).toBe(0);

  fireEvent.pointerDown(opacity, pointer);
  fireEvent.change(opacity, { target: { value: '38' } });
  fireEvent.change(opacity, { target: { value: '25' } });
  expect(onPaintPreview.mock.lastCall?.[0]).toMatchObject({ opacity: 0.25 });
  expect(opacityValue.value).toBe('25');
  expect(currentRevision()).toBe(0);
  fireEvent.pointerUp(document.body, pointer);
  await waitFor(() => expect(tile()).toMatchObject({ opacity: 0.25, cornerRadius: 8 }));
  expect(currentRevision()).toBe(1);
});

it('adds independently editable outlines and persists a paint reorder once after a completed drop', async () => {
  const fill = [{ color: '#23243b' }, { color: '#df658f', opacity: 0.25 }];
  const first = { color: '#352f60', width: 6, alignment: 'outside' } as const;
  const { tile, currentRevision, onPaintPreview, service, ref, signal } = await mountAppearanceFields({
    kind: 'rectangle', x: 0, y: 0, width: 120, height: 80, cornerRadius: 8, fills: fill, strokes: [first],
  });
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.addStroke' }));
  await waitFor(() => expect(screen.getAllByRole('spinbutton', { name: 'feature.design.strokeWidth' })).toHaveLength(2));
  expect(tile().strokes).toEqual([first, { color: '#000000', width: 1 }]);
  const [width] = screen.getAllByRole('spinbutton', { name: 'feature.design.strokeWidth' });
  width.focus();
  fireEvent.change(width, { target: { value: '2' } });
  fireEvent.keyDown(width, { key: 'Enter' });
  const before = [first, { color: '#000000', width: 2 }];
  await waitFor(() => expect(tile().strokes).toMatchObject(before));

  const [handle, other] = screen.getAllByRole('button', { name: 'feature.design.reorderStroke' });
  const rows = [handle.parentElement!, other.parentElement!];
  rows.forEach((row, index) => Object.defineProperties(row, { offsetTop: { value: index * 70 }, offsetHeight: { value: 64 } }));
  const list = rows[0].parentElement!;
  const measure = vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 134));
  function dragEvent(type: string, target: HTMLElement, dataTransfer: DataTransfer) {
    // happy-dom's DragEvent does not expose the pointer coordinates used for drop hit testing.
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 125 });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    fireEvent(target, event);
  }
  function startDrag() {
    const dataTransfer = new DataTransfer();
    Object.defineProperty(dataTransfer, 'setDragImage', { value: vi.fn() });
    dragEvent('dragstart', handle, dataTransfer);
    dragEvent('dragover', list, dataTransfer);
    return dataTransfer;
  }
  try {
    const canceled = startDrag();
    expect(onPaintPreview.mock.lastCall?.[0]?.strokes).toMatchObject([...before].reverse());
    expect(tile().strokes).toMatchObject(before);
    dragEvent('dragend', handle, canceled);
    expect(onPaintPreview).toHaveBeenLastCalledWith(undefined);
    expect(currentRevision()).toBe(2);

    dragEvent('drop', list, startDrag());
    await waitFor(() => expect(tile().strokes).toMatchObject([...before].reverse()));
    expect(currentRevision()).toBe(3);
    const [front] = screen.getAllByRole('button', { name: 'feature.design.reorderFill' });
    fireEvent.keyDown(front, { key: 'ArrowDown' });
    await waitFor(() => expect(tile()).toMatchObject({ fills: [...fill].reverse() }));
    expect(currentRevision()).toBe(4);

    const undoFill = await service.navigate({ ref, expectedRevision: '4', direction: 'undo' }, signal);
    expect(undoFill.document.nodes.tile).toMatchObject({ fills: fill, strokes: [...before].reverse() });
    const undoStroke = await service.navigate({ ref, expectedRevision: undoFill.revision, direction: 'undo' }, signal);
    expect(undoStroke.document.nodes.tile.strokes).toMatchObject(before);
  } finally {
    measure.mockRestore();
  }
});

it('commits stroke paint changes with geometry and blend mode intact when reopening an older draft', async () => {
  const original = { color: '#352f60', width: 6, alignment: 'outside', join: 'bevel' } as const;
  const image = document.createElement('img');
  image.src = 'data:image/png;base64,cGFwZXI=';
  const loadImage = vi.fn<LoadDesignImage>().mockResolvedValue(image);
  const { tile } = await mountAppearanceFields({ kind: 'rectangle', x: 0, y: 0, width: 120, height: 80,
    cornerRadius: 8, strokes: [original] }, { schemaVersion: 8, loadImage });
  const user = userEvent.setup();

  const swatch = screen.getByRole('button', { name: 'feature.design.stroke' });
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(swatch, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 200, 24, 30));
  await user.click(swatch);
  const picker = within(await screen.findByRole('dialog', { name: 'feature.design.stroke' }));
  await user.click(picker.getByRole('button', { name: 'feature.design.gradient' }));
  await waitFor(() => expect(tile().strokes?.[0]).toMatchObject({ ...original, gradient: { kind: 'linear' } }));

  await user.click(picker.getByRole('combobox', { name: 'feature.design.gradient' }));
  await user.click(await screen.findByRole('option', { name: 'feature.design.fillType.radial' }));
  await waitFor(() => expect(tile().strokes?.[0]?.gradient?.kind).toBe('radial'));

  await user.click(picker.getByRole('combobox', { name: 'feature.design.blendMode' }));
  await user.click(await screen.findByRole('option', { name: 'feature.design.blendMode.multiply' }));
  await waitFor(() => expect(tile().strokes?.[0]?.blendMode).toBe('multiply'));

  await user.click(picker.getByRole('button', { name: 'feature.design.image' }));
  const path = 'design-assets/paper.png';
  const source = picker.getByRole('textbox', { name: 'feature.design.paintImageSource' });
  fireEvent.change(source, { target: { value: path } });
  fireEvent.submit(source.closest('form')!);
  await waitFor(() => expect(tile().strokes?.[0]).toMatchObject({ ...original, blendMode: 'multiply', gradient: undefined, image: { assetPath: path, fit: 'cover' } }));
  expect(loadImage).toHaveBeenCalledWith(path);

  await user.click(picker.getByRole('button', { name: 'feature.design.fillType.solid' }));
  await waitFor(() => expect(tile()).toMatchObject({ fills: undefined, strokes: [{ ...original, blendMode: 'multiply', gradient: undefined, image: undefined }] }));
});

it('previews a gradient stop crossing its neighbor and only saves the completed drag', async () => {
  const gradient: DesignGradient = { kind: 'linear', angle: 90, stops: [{ offset: 0.25, color: '#12203c' }, { offset: 0.6, color: '#85a1c6' }] };
  const preview = vi.fn<(gradient: DesignGradient | undefined) => void>();
  const save = vi.fn<(gradient: DesignGradient) => Promise<boolean>>().mockResolvedValue(true);
  render(<UiProvider locale="en-US"><DesignGradientFields gradient={gradient} disabled={false} onPreview={preview} onSave={save}
    translate={(key, args) => key === 'feature.design.gradientStop' ? `Stop ${args?.number}` : key} /></UiProvider>);
  const stop = screen.getByRole('slider', { name: 'Stop 1' });
  const track = vi.spyOn(stop.parentElement!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 20));
  const pointer = { pointerId: 1, button: 0, clientX: 50 };
  const move = { ...pointer, clientX: 150 };
  const applied = { ...gradient, stops: [gradient.stops[1], { ...gradient.stops[0], offset: 0.75 }] };
  try {
    fireEvent.pointerDown(stop, pointer);
    fireEvent.pointerMove(stop, move);
    expect(preview).toHaveBeenLastCalledWith(applied);
    expect(save).not.toHaveBeenCalled();
    fireEvent.pointerCancel(stop, move);
    expect(preview).toHaveBeenLastCalledWith(undefined);

    fireEvent.pointerDown(stop, pointer);
    await act(async () => { fireEvent.pointerUp(stop, move); });
    expect(save).toHaveBeenCalledExactlyOnceWith(applied);
  } finally {
    track.mockRestore();
  }
});

it('previews an angular stroke drag, discards a canceled gesture and restores the saved direction through history', async () => {
  const gradient: DesignGradient = { kind: 'angular', axis: { start: { x: 0.5, y: 0.5 }, end: { x: 1, y: 0.5 } },
    stops: [{ offset: 0, color: '#12203c' }, { offset: 1, color: '#85a1c6' }] };
  const stroke = { color: '#12203c', width: 4, alignment: 'inside', gradient } as const;
  const { tile, currentRevision, service, ref, signal } = await mountAppearanceFields({
    kind: 'rectangle', x: 0, y: 0, width: 120, height: 80, cornerRadius: 0, strokes: [stroke],
  }, { editOnCanvas: true });
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'feature.design.stroke' });
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 200, 24, 30));
  await user.click(trigger);
  const canvas = screen.getByRole('region', { name: 'Canvas' });
  const handle = within(canvas).getByRole('button', { name: 'feature.design.gradientEnd' });
  handle.setPointerCapture = vi.fn();
  const angle = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'feature.design.gradientAngle' });
  const pointer = { pointerId: 1, button: 0, clientX: 120, clientY: 40 };
  const move = { ...pointer, clientX: 60, clientY: 80 };
  fireEvent.pointerDown(handle, pointer);
  fireEvent.pointerMove(handle, move);
  expect(angle.value).toBe('180');
  expect(currentRevision()).toBe(0);

  fireEvent.pointerCancel(handle, move);
  expect(angle.value).toBe('90');
  expect(tile().strokes?.[0]).toMatchObject(stroke);

  fireEvent.pointerDown(handle, pointer);
  fireEvent.pointerMove(handle, move);
  fireEvent.pointerUp(handle, move);
  await waitFor(() => expect(tile().strokes?.[0]).toMatchObject({ ...stroke,
    gradient: { ...gradient, axis: { ...gradient.axis, end: { x: 0.5, y: 1 } } } }));
  expect(currentRevision()).toBe(1);
  const undone = await service.navigate({ ref, expectedRevision: '1', direction: 'undo' }, signal);
  expect(undone.document.nodes.tile.strokes?.[0]).toMatchObject(stroke);
});
