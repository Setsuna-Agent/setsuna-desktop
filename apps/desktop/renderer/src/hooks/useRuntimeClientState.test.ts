import { describe, expect, it } from 'vitest';
import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { activeTurnIdFromThreadSnapshot, inferActiveTurnIdFromThread, selectInitialThreadSummary } from './useRuntimeClientState.js';

describe('inferActiveTurnIdFromThread', () => {
  it('prefers the runtime snapshot active turn id even without streaming evidence', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_complete',
        turnId: 'turn_active',
        role: 'assistant',
        content: 'still active between model segments',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);
    thread.activeTurnId = 'turn_active';

    expect(activeTurnIdFromThreadSnapshot(thread, new Set())).toBe('turn_active');
  });

  it('clears active state when the runtime snapshot has no active turn and no fallback evidence', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_complete',
        turnId: 'turn_done',
        role: 'assistant',
        content: 'done',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);
    thread.activeTurnId = null;

    expect(activeTurnIdFromThreadSnapshot(thread, new Set())).toBeNull();
  });

  it('keeps a running tool turn cancellable even when local active state is empty', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_running',
        turnId: 'turn_running',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'read_file', status: 'running' }],
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set())).toBe('turn_running');
  });

  it('does not revive terminal turns', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_running',
        turnId: 'turn_done',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'read_file', status: 'running' }],
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set(['turn_done']))).toBeNull();
  });

  it('does not infer a turn from a completed intermediate assistant segment', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_tools',
        turnId: 'turn_tools',
        role: 'assistant',
        content: '我先看一下文件',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set())).toBeNull();
  });
});

describe('selectInitialThreadSummary', () => {
  it('restores the persisted thread when it still exists in the current list', () => {
    const threads = [
      threadSummary('global_1'),
      threadSummary('project_1', { projectId: 'project_a' }),
    ];

    expect(selectInitialThreadSummary(threads, 'project_1')?.id).toBe('project_1');
  });

  it('keeps the previous global-first fallback when the persisted thread is stale', () => {
    const threads = [
      threadSummary('project_1', { projectId: 'project_a' }),
      threadSummary('global_1'),
    ];

    expect(selectInitialThreadSummary(threads, 'missing')?.id).toBe('global_1');
  });

  it('falls back to the first thread when no global thread exists', () => {
    const threads = [
      threadSummary('project_1', { projectId: 'project_a' }),
      threadSummary('project_2', { projectId: 'project_b' }),
    ];

    expect(selectInitialThreadSummary(threads, null)?.id).toBe('project_1');
  });
});

function threadWithMessages(messages: RuntimeThread['messages']): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    archived: false,
    messageCount: messages.length,
    lastMessagePreview: '',
    lastSeq: messages.length,
    messages,
  };
}

function threadSummary(id: string, patch: Partial<RuntimeThreadSummary> = {}): RuntimeThreadSummary {
  return {
    id,
    title: id,
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    ...patch,
  };
}
