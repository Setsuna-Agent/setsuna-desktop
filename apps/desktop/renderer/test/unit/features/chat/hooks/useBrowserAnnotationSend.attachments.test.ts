// @vitest-environment happy-dom

import type { RuntimeInlineMessageAttachment, RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBrowserAnnotationSend } from '../../../../../src/features/chat/hooks/useBrowserAnnotationSend.js';

afterEach(cleanup);

const image: RuntimeInlineMessageAttachment = {
  id: 'image', name: 'image.png', type: 'image/png', size: 5, url: 'data:image/png;base64,aW1hZ2U=',
};
function stored(assetId: string): RuntimeStoredMessageAttachment {
  return { id: assetId, assetId, source: 'runtime', name: image.name, type: image.type, size: image.size };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

it('discards completed and late uploads when one image fails, without masking the upload error', async () => {
  const uploads = Array.from({ length: 3 }, () => deferred<RuntimeStoredMessageAttachment>());
  const uploadAttachment = vi.fn()
    .mockReturnValueOnce(uploads[0].promise).mockReturnValueOnce(uploads[1].promise).mockReturnValueOnce(uploads[2].promise);
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }))
    .mockRejectedValueOnce(new Error('Runtime temporarily unavailable'));
  const sendInput = vi.fn(async () => true);
  const { result } = renderHook(() => useBrowserAnnotationSend({ identity: 'A', client: { uploadAttachment, deleteAttachment }, sendInput }));
  const pending = result.current('Feedback', [image, image, image]).catch((error: unknown) => error);
  await act(async () => { uploads[0].resolve(stored('early')); });
  expect(deleteAttachment).not.toHaveBeenCalled();
  const failure = new Error('Upload failed');
  uploads[1].reject(failure);
  expect(await pending).toBe(failure);
  expect(deleteAttachment).toHaveBeenCalledExactlyOnceWith('early');
  await act(async () => { uploads[2].resolve(stored('late')); });
  expect(deleteAttachment.mock.calls.map(([id]) => id)).toEqual(['early', 'late']);
  expect(sendInput).not.toHaveBeenCalled();
});

it.each(['switch', 'unmount'])('cleans completed uploads immediately on %s and cleans the remaining upload when it finishes', async (change) => {
  const uploads = [deferred<RuntimeStoredMessageAttachment>(), deferred<RuntimeStoredMessageAttachment>()];
  const uploadAttachment = vi.fn().mockReturnValueOnce(uploads[0].promise).mockReturnValueOnce(uploads[1].promise);
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }));
  const sendInput = vi.fn(async () => true);
  const client = { uploadAttachment, deleteAttachment };
  const view = renderHook(({ identity }) => useBrowserAnnotationSend({ identity, client, sendInput }), { initialProps: { identity: 'A' } });
  const pending = view.result.current('Feedback', [image, image]);
  await act(async () => { uploads[0].resolve(stored('early')); });
  if (change === 'switch') view.rerender({ identity: 'B' });
  else view.unmount();
  expect(deleteAttachment).toHaveBeenCalledExactlyOnceWith('early');
  uploads[1].resolve(stored('late'));
  expect(await pending).toBe(false);
  expect(deleteAttachment.mock.calls.map(([id]) => id)).toEqual(['early', 'late']);
  expect(sendInput).not.toHaveBeenCalled();
});

it('reclaims every failed attempt but retains a successful retry', async () => {
  let nextId = 0;
  const uploadAttachment = vi.fn(async () => stored(`asset-${++nextId}`));
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }));
  const failure = new Error('Submit failed');
  const sendInput = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(failure).mockResolvedValueOnce(true);
  const { result } = renderHook(() => useBrowserAnnotationSend({ identity: 'A', client: { uploadAttachment, deleteAttachment }, sendInput }));
  expect(await result.current('Feedback', [image, image])).toBe(false);
  await expect(result.current('Feedback', [image, image])).rejects.toBe(failure);
  expect(await result.current('Feedback', [image, image])).toBe(true);
  expect(deleteAttachment.mock.calls.map(([id]) => id)).toEqual(['asset-1', 'asset-2', 'asset-3', 'asset-4']);
  expect(sendInput).toHaveBeenLastCalledWith('Feedback', {
    attachments: [stored('asset-5'), stored('asset-6')], preserveDraft: true,
  });
});

it.each(['switch', 'unmount'])('retains images in an accepted in-flight submission after %s', async (change) => {
  const submission = deferred<boolean>();
  const uploadAttachment = vi.fn(async () => stored('submitted'));
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }));
  const sendInput = vi.fn(() => submission.promise);
  const client = { uploadAttachment, deleteAttachment };
  const view = renderHook(({ identity }) => useBrowserAnnotationSend({ identity, client, sendInput }), { initialProps: { identity: 'A' } });
  const pending = view.result.current('Feedback', [image]);
  await act(async () => undefined);
  expect(sendInput).toHaveBeenCalledOnce();
  if (change === 'switch') view.rerender({ identity: 'B' });
  else view.unmount();
  expect(deleteAttachment).not.toHaveBeenCalled();
  submission.resolve(true);
  expect(await pending).toBe(true);
  expect(deleteAttachment).not.toHaveBeenCalled();
});
