import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertModelHistoryInvariants,
  assertNewToolCallBatchInvariants,
  LEGACY_ORPHAN_TOOL_RESULT_OMITTED_WARNING,
  normalizeModelConversationHistory,
  normalizeModelConversationOrder,
} from '../../../src/loop/core/runtime-model-message-order.js';

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

  it('preserves parallel tool result order and is idempotent', () => {
    const assistant = message('assistant_parallel', 'assistant', '', {
      toolCalls: [
        { id: 'call_1', name: 'read_file', arguments: '{"path":"one"}' },
        { id: 'call_2', name: 'read_file', arguments: '{"path":"two"}' },
      ],
    });
    const steer = message('steer', 'user', 'Continue after both reads.');
    const second = message('tool_2', 'tool', 'two', { toolCallId: 'call_2', toolName: 'read_file' });
    const first = message('tool_1', 'tool', 'one', { toolCallId: 'call_1', toolName: 'read_file' });

    const normalized = normalizeModelConversationOrder([assistant, steer, second, first]);

    expect(normalized.map((item) => item.id)).toEqual([
      'assistant_parallel',
      'tool_2',
      'tool_1',
      'steer',
    ]);
    expect(normalizeModelConversationOrder(normalized)).toEqual(normalized);
  });

  it('rejects duplicate call IDs within one assistant transaction', () => {
    const duplicateWithinMessage = message('assistant_duplicate', 'assistant', '', {
      toolCalls: [
        { id: 'call_same', name: 'read_file', arguments: '{}' },
        { id: 'call_same', name: 'search', arguments: '{}' },
      ],
    });
    expect(() => assertModelHistoryInvariants([duplicateWithinMessage])).toThrow(
      'Invalid model history: duplicate tool call id "call_same".',
    );
  });

  it('rewrites provider IDs reused by separate tool transactions on the model-facing copy', () => {
    const first = message('assistant_first', 'assistant', '', {
      toolCalls: [{ id: 'call_same', name: 'read_file', arguments: '{}' }],
    });
    const firstResult = message('tool_first', 'tool', 'done', { toolCallId: 'call_same' });
    const second = message('assistant_second', 'assistant', '', {
      toolCalls: [{ id: 'call_same', name: 'search', arguments: '{}' }],
      providerMetadata: {
        anthropic: {
          contentBlocks: [{ type: 'tool_use', id: 'call_same', name: 'search', input: {} }],
        },
      },
    });
    const secondResult = message('tool_second', 'tool', 'found', { toolCallId: 'call_same' });

    const normalized = normalizeModelConversationHistory([first, firstResult, second, secondResult]);
    const secondWireId = normalized.messages[2]?.toolCalls?.[0]?.id;

    expect(secondWireId).toMatch(/^call_setsuna_[a-f0-9]{24}$/);
    expect(secondWireId).not.toBe('call_same');
    expect(normalized.messages[3]?.toolCallId).toBe(secondWireId);
    expect(normalized.messages[2]?.providerMetadata).toBeUndefined();
    expect(normalized.warnings).toEqual([]);
    expect(normalizeModelConversationHistory([first, firstResult, second, secondResult]).messages)
      .toEqual(normalized.messages);
    expect(second.toolCalls?.[0]?.id).toBe('call_same');
    expect(second.providerMetadata).toBeDefined();
  });

  it('hides an N-1 orphan result from the model and reports a compatibility warning', () => {
    const previousCall = message('assistant_previous', 'assistant', '', {
      toolCalls: [{ id: 'call_split', name: 'read_file', arguments: '{}' }],
    });
    const previousResult = message('tool_previous', 'tool', 'previous result', {
      toolCallId: 'call_split',
    });
    const hiddenCall = message('assistant_hidden', 'assistant', '', {
      visibility: 'transcript',
      toolCalls: [{ id: 'call_split', name: 'read_file', arguments: '{}' }],
    });
    const orphanResult = message('tool_visible', 'tool', 'legacy result', {
      toolCallId: 'call_split',
      visibility: 'model',
    });

    const normalized = normalizeModelConversationHistory([
      previousCall,
      previousResult,
      hiddenCall,
      orphanResult,
    ]);

    expect(normalized.messages).toEqual([
      previousCall,
      previousResult,
      hiddenCall,
      expect.objectContaining({ id: 'tool_visible', visibility: 'transcript' }),
    ]);
    expect(normalized.warnings).toEqual([LEGACY_ORPHAN_TOOL_RESULT_OMITTED_WARNING]);
  });

  it('rejects orphan, reversed, and duplicate tool results', () => {
    const call = message('assistant_call', 'assistant', '', {
      toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
    });
    const result = message('tool_result', 'tool', 'done', { toolCallId: 'call_1' });
    const duplicate = message('tool_duplicate', 'tool', 'done again', { toolCallId: 'call_1' });
    const orphan = message('tool_orphan', 'tool', 'orphan', { toolCallId: 'call_missing' });

    expect(() => assertModelHistoryInvariants([orphan])).toThrow(
      'Invalid model history: tool result references unknown call id "call_missing".',
    );
    expect(() => assertModelHistoryInvariants([result, call])).toThrow(
      'Invalid model history: tool result for call id "call_1" appears before its assistant call.',
    );
    expect(() => assertModelHistoryInvariants([call, result, duplicate])).toThrow(
      'Invalid model history: multiple tool results reference call id "call_1".',
    );
  });

  it('validates only uniqueness within a newly sampled batch', () => {
    expect(() => assertNewToolCallBatchInvariants([
      { id: 'call_old', name: 'search', arguments: '{}' },
    ])).not.toThrow();
    expect(() => assertNewToolCallBatchInvariants([
      { id: 'call_new', name: 'read_file', arguments: '{}' },
      { id: 'call_new', name: 'search', arguments: '{}' },
    ])).toThrow('Invalid model history: duplicate tool call id "call_new".');
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
