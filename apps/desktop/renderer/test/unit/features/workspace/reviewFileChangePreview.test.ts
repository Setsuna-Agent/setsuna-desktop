import type { RuntimeFileChangeOperation } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';
import { createReviewFileChangePreviewLoader } from '../../../../src/features/workspace/reviewFileChangePreview.js';

it('bounds in-flight preview requests and skips cancelled queued files', async () => {
  const pending: (() => void)[] = [];
  const getThreadFileChangePreview = vi.fn((_threadId: string, input: { path: string; toolCallIds: string[] }) => new Promise<RuntimeFileChangeOperation[]>((resolve) => {
    pending.push(() => resolve(operations(input.path, input.toolCallIds[0])));
  }));
  const getClient = vi.fn(() => ({ getThreadFileChangePreview }));
  const load = createReviewFileChangePreviewLoader(getClient);
  expect(getClient).not.toHaveBeenCalled();
  const controllers = Array.from({ length: 7 }, () => new AbortController());
  const requests = controllers.map((controller, index) => load({ threadId: 'thread', path: `file_${index}.ts`, toolCallIds: [`edit_${index}`] }, controller.signal));
  const outcomes = Promise.allSettled(requests);
  expect(getThreadFileChangePreview).toHaveBeenCalledTimes(4);
  controllers[0].abort(); // The bridge request still occupies a slot until it settles.
  controllers[4].abort();
  expect(getThreadFileChangePreview).toHaveBeenCalledTimes(4);
  pending[0]();
  await vi.waitFor(() => expect(getThreadFileChangePreview).toHaveBeenCalledTimes(5));
  expect(getThreadFileChangePreview.mock.calls[4][1].path).toBe('file_5.ts');
  pending[1]();
  await vi.waitFor(() => expect(getThreadFileChangePreview).toHaveBeenCalledTimes(6));
  pending.slice(2).forEach((resolve) => resolve());
  const results = await outcomes;
  expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  expect(results[1]).toMatchObject({ value: { path: 'file_1.ts', additions: 1, lines: [{ content: 'after' }] } });
  expect(getClient).toHaveBeenCalledTimes(1);
});

it('does not start already cancelled work and surfaces missing or failed previews', async () => {
  const getThreadFileChangePreview = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Runtime stopped'));
  const load = createReviewFileChangePreviewLoader(() => ({ getThreadFileChangePreview }));
  const reference = { threadId: 'thread', path: 'file.ts', toolCallIds: ['edit'] };
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(load(reference, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(getThreadFileChangePreview).not.toHaveBeenCalled();
  await expect(load(reference, new AbortController().signal)).rejects.toThrow('no longer available');
  await expect(load(reference, new AbortController().signal)).rejects.toThrow('Runtime stopped');
});

function operations(path: string, id: string): RuntimeFileChangeOperation[] {
  return [{ messageId: id, run: { id, name: 'edit', status: 'success', data: { diff: { type: 'file_diff', path, additions: 1,
    lines: [{ type: 'add', newLine: 1, content: 'after' }],
  } } } }];
}
