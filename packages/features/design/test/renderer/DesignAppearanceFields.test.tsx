// @vitest-environment happy-dom

import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { commitDesignEdits, designDocumentCodec, designDocumentVersion, type DesignDocument, type DesignGradient, type DesignNode } from '../../src/contracts/index.js';
import { DesignDocumentService } from '../../src/runtime/design-document-service.js';
import type { DesignAssets } from '../../src/renderer/client.js';
import { DesignAppearanceFields, DesignFillFields } from '../../src/renderer/inspector/DesignAppearanceFields.js';
import { DesignGradientFields } from '../../src/renderer/inspector/DesignGradientFields.js';

afterEach(cleanup);

it('adds independently editable outlines and persists a paint reorder once after a completed drop', async () => {
  const fill = [{ color: '#23243b' }, { color: '#df658f', opacity: 0.25 }];
  const first = { color: '#352f60', width: 6, alignment: 'outside' } as const;
  const layer = { kind: 'rectangle', x: 0, y: 0, width: 120, height: 80, cornerRadius: 8, fills: fill, strokes: [first] } as const;
  const ref = { projectId: 'project', path: 'test.design.json' };
  let content = JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'art', rootIds: ['tile'], nodes: { tile: layer } } satisfies DesignDocument);
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
  function Fields() {
    const [state, setState] = useState(initial);
    const props = { disabled: false, node: state.document.nodes.tile, onPaintPreview, translate: (key: string) => key,
      onSave: async (node: DesignNode) => {
        const input = commitDesignEdits.input.parse({ ref, expectedRevision: state.revision, edits: [{ kind: 'update', nodeId: 'tile', node }] });
        const next = await service.commit(input, signal);
        setState(next);
        return true;
      } };
    return <><DesignAppearanceFields {...props} /><DesignFillFields {...props}
      assets={{ documentRef: ref, assets, loadImage: vi.fn(), onImport: vi.fn() }} /></>;
  }
  render(<UiProvider locale="en-US"><ToastProvider><Fields /></ToastProvider></UiProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'feature.design.addStroke' }));
  await waitFor(() => expect(screen.getAllByRole('spinbutton', { name: 'feature.design.strokeWidth' })).toHaveLength(2));
  const [width] = screen.getAllByRole('spinbutton', { name: 'feature.design.strokeWidth' });
  width.focus();
  fireEvent.change(width, { target: { value: '2' } });
  fireEvent.keyDown(width, { key: 'Enter' });
  const before = [first, { color: '#171925', width: 2, opacity: 0.2 }];
  const tile = () => designDocumentCodec.parse(JSON.parse(content)).nodes.tile;
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
    expect(revision).toBe(2);

    dragEvent('drop', list, startDrag());
    await waitFor(() => expect(tile().strokes).toMatchObject([...before].reverse()));
    expect(revision).toBe(3);
    const [front] = screen.getAllByRole('button', { name: 'feature.design.reorderFill' });
    fireEvent.keyDown(front, { key: 'ArrowDown' });
    await waitFor(() => expect(tile()).toMatchObject({ fills: [...fill].reverse() }));
    expect(revision).toBe(4);

    const undoFill = await service.navigate({ ref, expectedRevision: '4', direction: 'undo' }, signal);
    expect(undoFill.document.nodes.tile).toMatchObject({ fills: fill, strokes: [...before].reverse() });
    const undoStroke = await service.navigate({ ref, expectedRevision: undoFill.revision, direction: 'undo' }, signal);
    expect(undoStroke.document.nodes.tile.strokes).toMatchObject(before);
  } finally {
    measure.mockRestore();
  }
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
