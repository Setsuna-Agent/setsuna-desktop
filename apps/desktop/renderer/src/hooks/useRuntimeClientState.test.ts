import { describe, expect, it } from 'vitest';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { inferActiveTurnIdFromThread, turnHasFinished } from './useRuntimeClientState.js';

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

  it('does not finish a turn after an intermediate assistant tool-call message', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_tools',
        turnId: 'turn_tools',
        role: 'assistant',
        content: '我先看一下文件',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
      },
      {
        id: 'tool_1',
        turnId: 'turn_tools',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'file content',
        createdAt: '2026-06-29T00:00:01.000Z',
        status: 'complete',
      },
    ]);

    expect(turnHasFinished(thread, 'turn_tools')).toBe(false);
  });

  it('finishes a turn only after the final assistant answer completes', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_tools',
        turnId: 'turn_done',
        role: 'assistant',
        content: '我先看一下文件',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
      },
      {
        id: 'tool_1',
        turnId: 'turn_done',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'file content',
        createdAt: '2026-06-29T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_final',
        turnId: 'turn_done',
        role: 'assistant',
        content: '完成了',
        createdAt: '2026-06-29T00:00:02.000Z',
        status: 'complete',
      },
    ]);

    expect(turnHasFinished(thread, 'turn_done')).toBe(true);
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
