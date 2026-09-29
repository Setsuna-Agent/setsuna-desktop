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
