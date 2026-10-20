// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadPullRequest, ThreadPullRequestsResult, ThreadPullRequestsStateService } from '../../../src/contracts/index.js';
import { ThreadPullRequestsProvider, ThreadPullRequestNavigationProvider, ThreadPullRequestBadge, ConversationPullRequests } from '../../../src/renderer/threads/ThreadPullRequests.js';
import { ThreadPullRequestsState } from '../../../src/renderer/threads/state.js';

const item = (number: number): ThreadPullRequest => ({
  attachment: { repository: 'owner/repo', number, url: `https://github.com/owner/repo/pull/${number}`, attachedAt: '' }, summary: null, error: null,
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const translate = (key: string, params?: Record<string, string | number>) => `${key}${params?.count ?? ''}`;

it('opens the chosen PR and its owning conversation from the shared multi-PR entry or environment list', async () => {
  const open = vi.fn();
  const items = [item(12), item(13)];
  const service: ThreadPullRequestsStateService = { getSnapshot: () => items, subscribe: () => () => undefined, refresh: vi.fn() };
  const view = render(<ThreadPullRequestsProvider service={service}><ThreadPullRequestNavigationProvider onOpen={open}>
    <ThreadPullRequestBadge threadId="A" translate={translate} />
  </ThreadPullRequestNavigationProvider></ThreadPullRequestsProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'feature.pullRequests.threadRequestCount2' }));
  fireEvent.click(await screen.findByRole('button', { name: /owner\/repo #13/ }));
  expect(open).toHaveBeenCalledExactlyOnceWith('A', expect.objectContaining({ repository: 'owner/repo', number: 13 }));
  view.rerender(<ThreadPullRequestsProvider service={service}><ThreadPullRequestNavigationProvider onOpen={open}>
    <ConversationPullRequests threadId="B" translate={translate} />
  </ThreadPullRequestNavigationProvider></ThreadPullRequestsProvider>);
  fireEvent.click(screen.getByRole('button', { name: /owner\/repo #12/ }));
  expect(open).toHaveBeenLastCalledWith('B', expect.objectContaining({ repository: 'owner/repo', number: 12 }));
});

it('batches all mounted conversations, shares an association across surfaces, and cancels late responses when the last surface unmounts', async () => {
  vi.useFakeTimers();
  const results = (ids: string[]): ThreadPullRequestsResult => ({ threads: ids.map((threadId) => ({ threadId, items: [item(12)], error: null })) });
  let resolve!: (value: ThreadPullRequestsResult) => void;
  const threads = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockImplementation(async ({ threadIds }) => results(threadIds));
  const state = new ThreadPullRequestsState({ threads });
  expect(threads).not.toHaveBeenCalled();
  const first = vi.fn(); const second = vi.fn();
  const unsubscribeA = state.subscribe('A', first);
  const unsubscribeAlsoA = state.subscribe('A', second);
  const unsubscribeB = state.subscribe('B', vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(threads).toHaveBeenCalledExactlyOnceWith({ threadIds: ['A', 'B'] }, expect.any(AbortSignal));
  resolve(results(['A', 'B']));
  await vi.advanceTimersByTimeAsync(0);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  expect(state.getSnapshot('A')).toEqual([item(12)]);
  unsubscribeA(); unsubscribeB();
  await vi.advanceTimersByTimeAsync(5_001);
  expect(threads).toHaveBeenLastCalledWith({ threadIds: ['A'] }, expect.any(AbortSignal));
  threads.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  state.refresh();
  await vi.advanceTimersByTimeAsync(0);
  const signal = threads.mock.calls.at(-1)![1] as AbortSignal;
  unsubscribeAlsoA();
  expect(signal.aborted).toBe(true);
  resolve({ threads: [{ threadId: 'A', items: [item(99)], error: null }] });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.getSnapshot('A')).toEqual([item(12)]);
  expect(threads).toHaveBeenCalledTimes(3);
  state.dispose();
});

it('preserves subscribed associations when a history read fails', async () => {
  const threads = vi.fn().mockResolvedValue({ threads: [{ threadId: 'A', items: [item(12)], error: null }] });
  const state = new ThreadPullRequestsState({ threads });
  const listener = vi.fn(); const stop = state.subscribe('A', listener);
  await waitFor(() => expect(state.getSnapshot('A')).toHaveLength(1));
  threads.mockResolvedValueOnce({ threads: [{ threadId: 'A', items: [], error: 'Unavailable' }] });
  act(() => state.refresh());
  await waitFor(() => expect(threads).toHaveBeenCalledTimes(2));
  expect(state.getSnapshot('A')).toHaveLength(1);
  stop(); state.dispose();
});
