import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { normalizeModelConversationOrder } from './runtime-model-message-order.js';

describe('model conversation ordering', () => {
  it('moves a persisted steer behind the tool result it interrupted', () => {
    const assistant = message('assistant_call', 'assistant', '', {
      toolCalls: [{ id: 'call_1', name: 'run_shell_command', arguments: '{}' }],
    });
    const steer = message('steer', 'user', 'Please use the skill.');
    const tool = message('tool_result', 'tool', 'command completed', {
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
    });
    const final = message('assistant_final', 'assistant', 'Done.');

    expect(normalizeModelConversationOrder([assistant, steer, tool, final]).map((item) => item.id)).toEqual([
      'assistant_call',
      'tool_result',
      'steer',
      'assistant_final',
    ]);
  });

  it('adds an explicit interrupted result when a historical tool call has no result', () => {
    const missingAssistant = message('assistant_missing', 'assistant', '', {
      toolCalls: [{ id: 'call_missing', name: 'view_image', arguments: '{}' }],
    });
    const user = message('user_continue', 'user', 'Continue.');
    const nextAssistant = message('assistant_next', 'assistant', '', {
      toolCalls: [{ id: 'call_next', name: 'read_file', arguments: '{}' }],
    });
    const nextTool = message('tool_next', 'tool', 'file contents', {
      toolCallId: 'call_next',
      toolName: 'read_file',
    });

    const normalized = normalizeModelConversationOrder([missingAssistant, user, nextAssistant, nextTool]);

    expect(normalized.map((item) => item.id)).toEqual([
      'assistant_missing',
      'model_recovery_assistant_missing_call_missing',
      'user_continue',
      'assistant_next',
      'tool_next',
    ]);
    expect(normalized[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call_missing',
      visibility: 'model',
      content: expect.stringContaining('did not produce a recorded result'),
    });
  });

  it('does not synthesize results for assistant messages hidden from the model', () => {
    const transcriptAssistant = message('assistant_transcript', 'assistant', '', {
      visibility: 'transcript',
      toolCalls: [{ id: 'call_hidden', name: 'view_image', arguments: '{}' }],
    });
    const user = message('user_continue', 'user', 'Continue.');

    expect(normalizeModelConversationOrder([transcriptAssistant, user])).toEqual([transcriptAssistant, user]);
  });
});

function message(
  id: string,
  role: RuntimeMessage['role'],
  content: string,
  extra: Partial<RuntimeMessage> = {},
): RuntimeMessage {
  return {
    id,
    turnId: 'turn_1',
    role,
    content,
    createdAt: '2026-07-18T00:00:00.000Z',
    status: 'complete',
    ...extra,
  };
}
