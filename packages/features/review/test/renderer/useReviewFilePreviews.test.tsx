// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopDiffFile, DesktopDiffSummary } from '../../src/contracts/index.js';
import { useReviewFilePreviews, useReviewFilePreviewRequest } from '../../src/renderer/hooks/useReviewFilePreviews.js';
import type { ReviewRendererHost } from '../../src/renderer/host.js';
import { resolveReviewFindingTarget } from '../../src/renderer/review-findings.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(cleanup);

it.each([false, true])('loads once on expansion and reuses a successful preview even when its result is truncated: %s', async (truncated) => {
  const pending = deferred();
  const load = vi.fn<ReviewRendererHost['loadFileChangePreview']>().mockReturnValue(pending.promise);
  const summary = source('thread');
  const hook = renderPreview(load, summary, false);
  expect(load).not.toHaveBeenCalled();
  hook.rerender({ summary, expanded: true });
  expect(load).toHaveBeenCalledTimes(1);
  hook.rerender({ summary: structuredClone(summary), expanded: true });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0][1].aborted).toBe(false);
  const finding = { priority: 'P2' as const, title: 'Check this edit', body: 'Review', path: 'file.ts', startLine: 10 };
  expect(resolveReviewFindingTarget(hook.result.current.summary, finding).anchor).toBeNull();
  await act(async () => pending.resolve({ ...preview('after'), truncated }));
  expect(hook.result.current.summary?.files[0]).toMatchObject({ path: 'file.ts', additions: 2, lines: [{ content: 'after' }], truncated });
  expect(resolveReviewFindingTarget(hook.result.current.summary, finding).anchor).toEqual({ side: 'additions', lineNumber: 10 });
  hook.rerender({ summary, expanded: false });
  hook.rerender({ summary, expanded: true });
  expect(load).toHaveBeenCalledTimes(1);
});

it('cancels stale requests and discards late results when the thread or operation set changes', async () => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const load = vi.fn<ReviewRendererHost['loadFileChangePreview']>()
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const hook = renderPreview(load, source('old'), true);
  const next = source('new');
  hook.rerender({ summary: next, expanded: true });
  expect(load.mock.calls[0][1].aborted).toBe(true);
  await act(async () => first.resolve(preview('old content')));
  expect(hook.result.current.summary?.files[0].lines).toEqual([]);
  await act(async () => second.resolve(preview('new content')));
  expect(hook.result.current.summary?.files[0].lines[0].content).toBe('new content');
  hook.rerender({ summary: source('new', ['early', 'late', 'new_edit']), expanded: true });
  expect(load).toHaveBeenCalledTimes(3);
  expect(hook.result.current.summary?.files[0].lines).toEqual([]);
  hook.unmount();
  expect(load.mock.calls[2][1].aborted).toBe(true);
  await act(async () => third.resolve(preview('ignored')));
});

it('keeps a failed file retryable on re-expansion without polling it continuously', async () => {
  const load = vi.fn<ReviewRendererHost['loadFileChangePreview']>().mockRejectedValueOnce(new Error('Read failed')).mockResolvedValue(preview('retry'));
  const summary = source('thread');
  const hook = renderPreview(load, summary, true);
  await waitFor(() => expect(hook.result.current.error).toBe('Read failed'));
  hook.rerender({ summary: structuredClone(summary), expanded: true });
  expect(load).toHaveBeenCalledTimes(1);
  hook.rerender({ summary, expanded: false });
  hook.rerender({ summary, expanded: true });
  await waitFor(() => expect(hook.result.current.summary?.files[0].lines[0]?.content).toBe('retry'));
  expect(load).toHaveBeenCalledTimes(2);
});

function renderPreview(loadFileChangePreview: ReviewRendererHost['loadFileChangePreview'], summary: DesktopDiffSummary, expanded: boolean) {
  return renderHook(({ summary: current, expanded: enabled }) => {
    const result = useReviewFilePreviews(current);
    const request = useReviewFilePreviewRequest(result.summary?.files[0]?.changeReference, enabled, result.requestPreview);
    return { ...result, ...request };
  }, { initialProps: { summary, expanded }, wrapper: ({ children }: PropsWithChildren) => (
    <ReviewRendererTestHost loadFileChangePreview={loadFileChangePreview}>{children}</ReviewRendererTestHost>
  ) });
}
function source(threadId: string, toolCallIds = ['early', 'late']): DesktopDiffSummary {
  return { additions: 2, deletions: 0, files: [{ path: 'file.ts', action: 'Edited', additions: 2, deletions: 0, truncated: true, lines: [],
    changeReference: { threadId, path: '/repo/file.ts', toolCallIds },
  }] };
}
function preview(content: string): DesktopDiffFile {
  return { path: '/repo/file.ts', action: 'Edited', additions: 2, deletions: 0, truncated: false,
    lines: [{ type: 'added', newLine: 10, lineNumber: 10, content }],
  };
}
function deferred() {
  let resolve!: (value: DesktopDiffFile) => void;
  const promise = new Promise<DesktopDiffFile>((done) => { resolve = done; });
  return { promise, resolve };
}
