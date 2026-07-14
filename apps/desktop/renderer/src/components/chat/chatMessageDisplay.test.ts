import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { activeAssistantRunItemId, assistantRunCopyText, createChatDisplayItems, createChatRenderWindow, createChatScrollSignal } from './chatMessageDisplay.js';

describe('createChatDisplayItems', () => {
  it('keeps manually compacted context at its runtime position instead of appending it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'compact_1',
        role: 'user',
        content: '<context_compaction_summary>older context</context_compaction_summary>',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 1,
          compactedTokens: 128,
          keptRecentMessageCount: 2,
          maxContextTokensK: 256,
          originalMessageCount: 3,
          originalTokens: 512,
          triggerScopes: ['manual'],
        },
      },
      {
        id: 'user_1',
        role: 'user',
        content: '你好',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '你好！',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => item.id)).toEqual([
      'compact_1',
      'user_1',
      'assistant_1',
    ]);
  });

  it('keeps review mode markers in their runtime order', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_review',
        turnId: 'turn_review',
        role: 'user',
        content: 'commit 1234567: Tidy UI colors',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'review_entered',
        turnId: 'turn_review',
        role: 'system',
        content: '',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        visibility: 'transcript',
        reviewMode: { kind: 'entered', review: 'commit 1234567: Tidy UI colors' },
      },
      {
        id: 'assistant_review',
        turnId: 'turn_review',
        role: 'assistant',
        content: 'No findings.',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'review_exited',
        turnId: 'turn_review',
        role: 'system',
        content: '',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'complete',
        visibility: 'transcript',
        reviewMode: { kind: 'exited', review: 'No findings.' },
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:user_review',
      'review:review_entered',
      'assistant:assistant_review',
      'review:review_exited',
    ]);
  });

  it('splits adjacent assistant runs when their turn ids differ', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'assistant_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'first',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_2',
        role: 'assistant',
        turnId: 'turn_2',
        content: 'second',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => item.id)).toEqual([
      'assistant_1',
      'assistant_2',
    ]);
  });

  it('folds steered user input into the same assistant turn item', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_initial',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'initial answer',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_followup',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'guided answer',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'complete',
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:user_initial',
      'assistant:assistant_initial__assistant_run__assistant_followup',
    ]);
    const items = createChatDisplayItems(messages);
    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: true,
      handledSteerMessageIds: ['user_steer'],
      messageIds: ['user_initial', 'user_steer'],
      steered: false,
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(items.find((item) => item.id === 'user_steer')).toBeUndefined();
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: ['user_steer'],
      messageIds: ['assistant_initial', 'user_steer', 'assistant_followup'],
      segments: [
        expect.objectContaining({ id: 'assistant_initial' }),
        expect.objectContaining({ id: 'assistant_followup' }),
      ],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(activeAssistantRunItemId(items, 'turn_1')).toBe('assistant_initial__assistant_run__assistant_followup');
  });

  it('keeps the same assistant turn item active while steered input waits for a follow-up segment', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_initial',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'initial answer',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];
    const items = createChatDisplayItems(messages);

    expect(createChatDisplayItems(messages).map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:user_initial',
      'assistant:assistant_initial',
    ]);
    expect(activeAssistantRunItemId(items, 'turn_1')).toBe('assistant_initial');
    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: false,
      handledSteerMessageIds: [],
      messageIds: ['user_initial', 'user_steer'],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: [],
      messageIds: ['assistant_initial', 'user_steer'],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
  });

  it('folds steered input even when the original user message lacks a turn id', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        content: 'legacy initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_initial',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'initial work',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_followup',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'guided follow-up',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'streaming',
      },
    ];
    const items = createChatDisplayItems(messages);

    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:user_initial',
      'assistant:assistant_initial__assistant_run__assistant_followup',
    ]);
    expect(items.find((item) => item.id === 'user_steer')).toBeUndefined();
    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      messageIds: ['user_initial', 'user_steer'],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      messageIds: ['assistant_initial', 'user_steer', 'assistant_followup'],
      segments: [
        expect.objectContaining({ id: 'assistant_initial' }),
        expect.objectContaining({ id: 'assistant_followup' }),
      ],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(activeAssistantRunItemId(items, 'turn_1')).toBe('assistant_initial__assistant_run__assistant_followup');
  });

  it('does not mark steered input handled for an empty assistant placeholder', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_initial',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'initial work',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_placeholder',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'streaming',
      },
    ];
    const items = createChatDisplayItems(messages);

    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: false,
      handledSteerMessageIds: [],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: [],
      segments: [
        expect.objectContaining({ id: 'assistant_initial' }),
        expect.objectContaining({ id: 'assistant_placeholder' }),
      ],
    });
  });

  it('keeps multiple steers and streaming placeholders inside one assistant turn item', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_initial',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'initial work',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        toolRuns: [{ id: 'tool_1', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'user_steer_1',
        role: 'user',
        turnId: 'turn_1',
        content: 'first steer',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_placeholder',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'streaming',
      },
      {
        id: 'user_steer_2',
        role: 'user',
        turnId: 'turn_1',
        content: 'second steer',
        createdAt: '2026-06-26T00:00:04.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_followup',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'follow-up work',
        createdAt: '2026-06-26T00:00:05.000Z',
        status: 'streaming',
      },
    ];
    const items = createChatDisplayItems(messages);

    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:user_initial',
      'assistant:assistant_initial__assistant_run__assistant_placeholder__assistant_run__assistant_followup',
    ]);
    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: true,
      handledSteerMessageIds: ['user_steer_1', 'user_steer_2'],
      messageIds: ['user_initial', 'user_steer_1', 'user_steer_2'],
      steerMessages: [
        expect.objectContaining({ id: 'user_steer_1' }),
        expect.objectContaining({ id: 'user_steer_2' }),
      ],
    });
    expect(items.find((item) => item.id === 'user_steer_1')).toBeUndefined();
    expect(items.find((item) => item.id === 'user_steer_2')).toBeUndefined();
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: ['user_steer_1', 'user_steer_2'],
      messageIds: [
        'assistant_initial',
        'user_steer_1',
        'assistant_placeholder',
        'user_steer_2',
        'assistant_followup',
      ],
      segments: [
        expect.objectContaining({ id: 'assistant_initial' }),
        expect.objectContaining({ id: 'assistant_placeholder' }),
        expect.objectContaining({ id: 'assistant_followup' }),
      ],
      steerMessages: [
        expect.objectContaining({ id: 'user_steer_1' }),
        expect.objectContaining({ id: 'user_steer_2' }),
      ],
    });
    expect(activeAssistantRunItemId(items, 'turn_1')).toBe('assistant_initial__assistant_run__assistant_placeholder__assistant_run__assistant_followup');
  });

  it('keeps model-only injected history out of the transcript', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'injected_boundary',
        role: 'user',
        content: 'Side conversation boundary.',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        visibility: 'model',
      },
      {
        id: 'visible_user',
        role: 'user',
        content: 'Visible request',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => item.id)).toEqual(['visible_user']);
  });

  it('keeps transcript-only archived history visible before compaction summaries', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'archived_user',
        role: 'user',
        content: 'old visible question',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        visibility: 'transcript',
      },
      {
        id: 'compact_1',
        role: 'user',
        content: '<context_compaction_summary>older context</context_compaction_summary>',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 1,
          compactedTokens: 128,
          keptRecentMessageCount: 2,
          maxContextTokensK: 256,
          originalMessageCount: 3,
          originalTokens: 512,
          triggerScopes: ['manual'],
        },
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => `${item.type}:${item.id}`)).toEqual([
      'user:archived_user',
      'context:compact_1',
    ]);
  });

  it('excludes completed thinking content from assistant copy text', () => {
    expect(assistantRunCopyText({
      type: 'assistant',
      id: 'assistant_1',
      handledSteerMessageIds: [],
      messageIds: ['assistant_1'],
      steerMessages: [],
      segments: [
        {
          id: 'assistant_1',
          role: 'assistant',
          content: '<think>internal plan</think>visible answer',
          createdAt: '2026-06-26T00:00:02.000Z',
          status: 'complete',
        },
      ],
    })).toBe('visible answer');
  });

  it('keeps the transcript source intact while windowing the rendered tail', () => {
    const messages: RuntimeMessage[] = Array.from({ length: 6 }, (_, index) => ({
      id: `user_${index + 1}`,
      role: 'user',
      content: `message ${index + 1}`,
      createdAt: `2026-06-26T00:00:0${index}.000Z`,
      status: 'complete',
    }));
    const items = createChatDisplayItems(messages);

    const windowed = createChatRenderWindow(items, { tailItemLimit: 3 });

    expect(items).toHaveLength(6);
    expect(windowed.hiddenItemCount).toBe(3);
    expect(windowed.hiddenMessageCount).toBe(3);
    expect(windowed.items.map((item) => item.id)).toEqual(['user_4', 'user_5', 'user_6']);
  });

  it('extends the render window to include the active turn', () => {
    const messages: RuntimeMessage[] = Array.from({ length: 6 }, (_, index) => ({
      id: `assistant_${index + 1}`,
      role: 'assistant',
      turnId: `turn_${index + 1}`,
      content: `answer ${index + 1}`,
      createdAt: `2026-06-26T00:00:0${index}.000Z`,
      status: index === 1 ? 'streaming' : 'complete',
    }));
    const items = createChatDisplayItems(messages);

    const windowed = createChatRenderWindow(items, { activeTurnId: 'turn_2', tailItemLimit: 2 });

    expect(windowed.hiddenItemCount).toBe(1);
    expect(windowed.items.map((item) => item.id)).toEqual([
      'assistant_2',
      'assistant_3',
      'assistant_4',
      'assistant_5',
      'assistant_6',
    ]);
  });

  it('keeps active review markers inside the render window', () => {
    const messages: RuntimeMessage[] = [
      ...Array.from({ length: 4 }, (_, index): RuntimeMessage => ({
        id: `user_${index + 1}`,
        role: 'user',
        content: `message ${index + 1}`,
        createdAt: `2026-06-26T00:00:0${index}.000Z`,
        status: 'complete',
      })),
      {
        id: 'review_entered',
        turnId: 'turn_review',
        role: 'system',
        content: '',
        createdAt: '2026-06-26T00:00:04.000Z',
        status: 'complete',
        visibility: 'transcript',
        reviewMode: { kind: 'entered', review: 'current changes' },
      },
      {
        id: 'user_tail',
        role: 'user',
        content: 'tail',
        createdAt: '2026-06-26T00:00:05.000Z',
        status: 'complete',
      },
    ];

    const windowed = createChatRenderWindow(createChatDisplayItems(messages), { activeTurnId: 'turn_review', tailItemLimit: 1 });

    expect(windowed.items.map((item) => item.id)).toEqual(['review_entered', 'user_tail']);
  });

  it('does not window the transcript while disabled', () => {
    const messages: RuntimeMessage[] = Array.from({ length: 4 }, (_, index) => ({
      id: `user_${index + 1}`,
      role: 'user',
      content: `message ${index + 1}`,
      createdAt: `2026-06-26T00:00:0${index}.000Z`,
      status: 'complete',
    }));
    const items = createChatDisplayItems(messages);

    expect(createChatRenderWindow(items, { enabled: false, tailItemLimit: 2 })).toEqual({
      hiddenItemCount: 0,
      hiddenMessageCount: 0,
      items,
    });
  });

  it('keeps hidden history out of the scroll signal', () => {
    const hiddenToolRun = {
      id: 'call_hidden',
      name: 'run_shell_command',
      status: 'running' as const,
      resultPreview: 'a',
    };
    const messages: RuntimeMessage[] = [
      {
        id: 'assistant_hidden',
        role: 'assistant',
        turnId: 'turn_hidden',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [hiddenToolRun],
      },
      {
        id: 'user_visible',
        role: 'user',
        content: 'tail',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
    ];
    const firstWindow = createChatRenderWindow(createChatDisplayItems(messages), { tailItemLimit: 1 });
    const firstSignal = createChatScrollSignal(firstWindow, { threadId: 'thread_1' });

    const nextMessages: RuntimeMessage[] = [
      {
        ...messages[0],
        toolRuns: [{ ...hiddenToolRun, resultPreview: 'a hidden output delta' }],
      },
      messages[1],
    ];
    const nextWindow = createChatRenderWindow(createChatDisplayItems(nextMessages), { tailItemLimit: 1 });

    expect(createChatScrollSignal(nextWindow, { threadId: 'thread_1' })).toBe(firstSignal);
  });

  it('includes visible tool output changes in the scroll signal', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'assistant_visible',
        role: 'assistant',
        turnId: 'turn_visible',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [
          {
            id: 'call_visible',
            name: 'run_shell_command',
            status: 'running',
            resultPreview: 'a',
          },
        ],
      },
    ];
    const firstWindow = createChatRenderWindow(createChatDisplayItems(messages), { tailItemLimit: 1 });
    const firstSignal = createChatScrollSignal(firstWindow, { threadId: 'thread_1' });
    const nextWindow = createChatRenderWindow(createChatDisplayItems([
      {
        ...messages[0],
        toolRuns: [{ ...messages[0].toolRuns![0], resultPreview: 'a visible output delta' }],
      },
    ]), { tailItemLimit: 1 });

    expect(createChatScrollSignal(nextWindow, { threadId: 'thread_1' })).not.toBe(firstSignal);
  });
});
