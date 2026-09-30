// @vitest-environment happy-dom
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RendererFeatureEventHub } from '../../../../src/composition/renderer-feature-event-hub.js';
import { RendererFeatureEventsProvider } from '../../../../src/composition/renderer-feature-events-context.js';
import { useRuntimeThreadState, type RuntimeThreadClient } from '../../../../src/services/runtime-client/useRuntimeThreadState.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, 'setsunaDesktop');
  vi.useRealTimers();
});

it('discovers background execution chats from an idle sidebar without selecting their hidden setup conversation', async () => {
  vi.useFakeTimers();
  const execution: RuntimeThread = {
    id: 'execution', title: 'Scheduled review', projectId: 'iriya', origin: { featureId: 'automation', entityId: 'task' },
    createdAt: '', updatedAt: '', archived: false, activeTurnId: 'turn',
    messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 1,
  };
  const setup: RuntimeThread = { ...execution, id: 'setup', featureId: 'automation', origin: undefined, activeTurnId: undefined };
  let threads: RuntimeThread[] = [];
  const client: RuntimeThreadClient = {
    answerApproval: vi.fn(), clearThreadContext: vi.fn(), compactThreadContext: vi.fn(),
    createThread: vi.fn(), deleteThread: vi.fn(), updateThread: vi.fn(), getThread: vi.fn(),
    listThreads: vi.fn(async () => ({ threads })), subscribeEvents: vi.fn(() => () => undefined),
  };
  const events = new RendererFeatureEventHub();
  const view = renderHook(() => useRuntimeThreadState({
    activeProjectId: null, client, onError: vi.fn(), onTurnSettled: vi.fn(),
    review: { start: vi.fn() }, setActiveProjectId: vi.fn(),
  }), { wrapper: ({ children }: { children: ReactNode }) => (
    <RendererFeatureEventsProvider events={events}>{children}</RendererFeatureEventsProvider>
  ) });
  threads = [setup, execution];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(view.result.current.threads).toEqual([execution]);
  expect(view.result.current.currentThread).toBeNull();
  expect(client.getThread).not.toHaveBeenCalled();
  threads = [setup, { ...execution, activeTurnId: undefined }];
  await act(async () => { await vi.advanceTimersByTimeAsync(1250); });
  expect(view.result.current.threads[0].activeTurnId).toBeUndefined();
  view.unmount();
  const requests = vi.mocked(client.listThreads).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(client.listThreads).toHaveBeenCalledTimes(requests);
});

it.each(['requested', null])('boots the window into %s, with saved selection only as a fallback', async (requested) => {
  localStorage.setItem('setsuna-desktop:last-active-thread-id', 'saved');
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    windowControls: { getInitialThreadId: vi.fn(async () => requested) },
  } });
  const threads = ['requested', 'saved'].map((id): RuntimeThread => ({
    id, projectId: `project-${id}`, title: id, createdAt: '', updatedAt: '', archived: false,
    messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  }));
  const client: RuntimeThreadClient = {
    answerApproval: vi.fn(), clearThreadContext: vi.fn(), compactThreadContext: vi.fn(),
    createThread: vi.fn(), deleteThread: vi.fn(), listThreads: vi.fn(), updateThread: vi.fn(),
    getThread: vi.fn(async (id) => threads.find((thread) => thread.id === id)!),
    subscribeEvents: vi.fn(() => () => undefined),
  };
  const events = new RendererFeatureEventHub();
  const setActiveProjectId = vi.fn();
  const view = renderHook(() => useRuntimeThreadState({
    activeProjectId: null, client, onError: vi.fn(), onTurnSettled: vi.fn(),
    review: { start: vi.fn() }, setActiveProjectId,
  }), { wrapper: ({ children }: { children: ReactNode }) => (
    <RendererFeatureEventsProvider events={events}>{children}</RendererFeatureEventsProvider>
  ) });
  await act(async () => view.result.current.applyBootstrapThreads({ allThreads: threads, visibleThreads: threads, projects: [] }));
  const expectedId = requested ?? 'saved';
  expect(client.getThread).toHaveBeenCalledExactlyOnceWith(expectedId);
  expect(view.result.current.currentThread?.id).toBe(expectedId);
  expect(setActiveProjectId).toHaveBeenCalledExactlyOnceWith(`project-${expectedId}`);
  expect(client.subscribeEvents).toHaveBeenCalledWith(expectedId, 0, expect.any(Function));
  await act(async () => view.result.current.applyBootstrapThreads({ allThreads: threads, visibleThreads: threads, projects: [] }));
  expect(client.getThread).toHaveBeenCalledOnce();
});
