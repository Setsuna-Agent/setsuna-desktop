// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AutomationTask } from '../../src/contracts/index.js';
import type { AutomationClient } from '../../src/renderer/client.js';
import { useAutomationPage } from '../../src/renderer/useAutomationPage.js';

afterEach(cleanup);

it('keeps run selection distinct from its reused conversation and commits it only after navigation succeeds', async () => {
  const at = '2026-10-07T00:00:00Z';
  const task: AutomationTask = {
    id: 'daily', title: 'Daily brief', prompt: 'Write a brief',
    schedule: { kind: 'interval', minutes: 60 }, newChat: false,
    conversationThreadId: 'setup', executionThreadId: 'execution', status: 'active', nextRunAt: at,
    createdAt: at, updatedAt: at,
    runs: ['first', 'second'].map((id) => ({
      id, threadId: 'execution', turnId: `turn-${id}`, scheduledFor: at, startedAt: at, status: 'completed',
    })),
  };
  const client: AutomationClient = {
    snapshot: vi.fn(async () => ({ tasks: [structuredClone(task)], models: [], projects: [] })),
    createConversation: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), run: vi.fn(), delete: vi.fn(),
  };
  const openConversation = vi.fn(async () => true);
  const { result } = renderHook(() => useAutomationPage(client, 'setup', openConversation));
  await waitFor(() => expect(result.current.conversationId).toBe('setup'));

  await act(() => result.current.select('execution', task.id, 'first'));
  expect(result.current.selectedRunId).toBe('first');
  expect(result.current.selectedTask?.id).toBe(task.id);
  const firstRequest = result.current.turnNavigationRequest;
  expect(firstRequest).toEqual({ requestId: expect.any(Number), threadId: 'execution', turnId: 'turn-first' });

  openConversation.mockResolvedValueOnce(false);
  await act(() => result.current.select('execution', task.id, 'second'));
  expect(result.current.selectedRunId).toBe('first');
  expect(result.current.turnNavigationRequest).toEqual(firstRequest);

  await act(() => result.current.select('execution', task.id, 'second'));
  expect(result.current.selectedRunId).toBe('second');
  expect(result.current.conversationId).toBe('execution');
  const secondRequest = result.current.turnNavigationRequest;
  expect(secondRequest?.turnId).toBe('turn-second');

  await act(async () => { await result.current.refresh(); });
  expect(result.current.selectedRunId).toBe('second');
  expect(result.current.turnNavigationRequest).toEqual(secondRequest);

  await act(() => result.current.select('execution', task.id, 'second'));
  expect(result.current.turnNavigationRequest?.requestId).not.toBe(secondRequest?.requestId);

  await act(() => result.current.select('setup', task.id));
  expect(result.current.selectedRunId).toBeNull();
  expect(result.current.conversationId).toBe('setup');
  expect(result.current.turnNavigationRequest).toBeUndefined();
});
