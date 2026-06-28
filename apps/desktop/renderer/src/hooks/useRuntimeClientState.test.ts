import { describe, expect, it } from 'vitest';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { inferActiveTurnIdFromThread } from './useRuntimeClientState.js';

describe('inferActiveTurnIdFromThread', () => {
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
