// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThreadNavigationHistory } from '../../../../src/app/controller/useThreadNavigationHistory.js';

afterEach(cleanup);

describe('useThreadNavigationHistory', () => {
  it('moves through visited threads and replaces the forward branch after a new selection', async () => {
    const onOpenThread = vi.fn(async () => undefined);
    const view = renderHook(
      ({ threadId }) => useThreadNavigationHistory({
        currentThreadId: threadId,
        onOpenThread,
      }),
      { initialProps: { threadId: 'thread-a' as string | null } },
    );

    view.rerender({ threadId: 'thread-b' });
    expect(view.result.current.canGoBack).toBe(true);
    expect(view.result.current.canGoForward).toBe(false);

    await act(async () => {
      view.result.current.goBack();
      await Promise.resolve();
    });
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-a');

    view.rerender({ threadId: 'thread-a' });
    expect(view.result.current.canGoForward).toBe(true);

    await act(async () => {
      view.result.current.goForward();
      await Promise.resolve();
    });
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-b');

    view.rerender({ threadId: 'thread-b' });
    await act(async () => {
      view.result.current.goBack();
      await Promise.resolve();
    });
    view.rerender({ threadId: 'thread-a' });
    view.rerender({ threadId: 'thread-c' });

    expect(view.result.current.canGoForward).toBe(false);
  });
});
