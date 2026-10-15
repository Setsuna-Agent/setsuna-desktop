// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { DocumentPreviewProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock('../../../../../src/features/workspace/documents/document-preview-engine.js', () => ({ loadDocumentPreviewFactory: mocks.factory }));
import { useDocumentPreview } from '../../../../../src/features/workspace/documents/useDocumentPreview.js';

afterEach(() => { cleanup(); vi.resetAllMocks(); });
function Host(props: DocumentPreviewProps) {
  const { containerRef } = useDocumentPreview(props);
  return <div ref={containerRef} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it('does not read files or create workers when a delayed engine finishes after the preview closes', async () => {
  const engine = deferred<ReturnType<typeof vi.fn>>();
  const create = vi.fn();
  const load = vi.fn();
  mocks.factory.mockReturnValue(engine.promise);
  const view = render(<Host filePath="slow.docx" load={load} />);
  view.unmount();
  await act(async () => engine.resolve(create));
  expect(load).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('discards late bytes from the previous path and destroys the active viewer on close', async () => {
  const slow = deferred<Uint8Array>();
  const viewer = { load: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
  const create = vi.fn().mockReturnValue(viewer);
  mocks.factory.mockResolvedValue(create);
  const loadFirst = vi.fn().mockReturnValue(slow.promise);
  const original = new Uint8Array([1, 2, 3]);
  const loadSecond = vi.fn().mockResolvedValue(original);
  const view = render(<Host filePath="first.docx" load={loadFirst} />);
  await waitFor(() => expect(loadFirst).toHaveBeenCalledOnce());
  view.rerender(<Host filePath="second.pptx" load={loadSecond} />);
  await waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
  await act(async () => slow.resolve(new Uint8Array([9])));
  expect(create).toHaveBeenCalledOnce();
  expect(new Uint8Array(viewer.load.mock.calls[0][0])).toEqual(original);
  expect(viewer.load.mock.calls[0][0]).not.toBe(original.buffer);
  view.unmount();
  expect(viewer.destroy).toHaveBeenCalledOnce();
});

it('releases a parser that rejects while loading instead of keeping its worker alive', async () => {
  const viewer = { load: vi.fn().mockRejectedValue(new Error('corrupt ZIP')), destroy: vi.fn() };
  mocks.factory.mockResolvedValue(() => viewer);
  render(<Host filePath="corrupt.xlsx" load={async () => new Uint8Array([1])} />);
  await waitFor(() => expect(viewer.destroy).toHaveBeenCalledOnce());
});

it('releases a progressive parser when a later page fails after load has resolved', async () => {
  let reportError!: (error: Error) => void;
  const viewer = { load: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
  mocks.factory.mockResolvedValue((_container: HTMLElement, onError: typeof reportError) => {
    reportError = onError;
    return viewer;
  });
  const view = render(<Host filePath="multi-section.docx" load={async () => new Uint8Array([1])} />);
  await waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
  act(() => reportError(new Error('Later page layout failed.')));
  expect(viewer.destroy).toHaveBeenCalledOnce();
  view.unmount();
  expect(viewer.destroy).toHaveBeenCalledOnce();
});
