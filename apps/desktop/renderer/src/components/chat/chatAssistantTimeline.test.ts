import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { createAssistantRunTimeline } from './chatAssistantTimeline.js';

describe('createAssistantRunTimeline', () => {
  it('keeps assistant work in one block above visible content', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_preamble',
        role: 'assistant',
        content: 'I will inspect the project first.',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_shell',
            name: 'run_shell_command',
            status: 'success',
            argumentsPreview: '{"command":"pnpm test"}',
            resultPreview: '$ pnpm test\nexit: 0',
          },
        ],
      },
      {
        id: 'assistant_final',
        role: 'assistant',
        content: 'The tests passed.',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
      },
    ];

    expect(createAssistantRunTimeline(segments).map((block) => block.id)).toEqual([
      'assistant_preamble:work',
      'assistant_preamble:content',
      'assistant_final:content',
    ]);
  });

  it('does not leave an empty work block for completed closed thinking', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_answer',
        role: 'assistant',
        content: '<think>plan</think>Visible answer.',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
      },
    ];

    expect(createAssistantRunTimeline(segments).map((block) => block.id)).toEqual([
      'assistant_answer:content',
    ]);
  });

  it('renders open streaming thinking as active work', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_thinking',
        role: 'assistant',
        content: '<think>planning',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'streaming',
      },
    ];

    expect(createAssistantRunTimeline(segments)).toMatchObject([
      { id: 'assistant_thinking:work', type: 'work', active: true },
    ]);
  });

  it('keeps streaming work above visible content', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_mixed',
        role: 'assistant',
        content: 'Visible first.<think>still planning',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'streaming',
      },
    ];

    expect(createAssistantRunTimeline(segments).map((block) => block.id)).toEqual([
      'assistant_mixed:work',
      'assistant_mixed:content',
    ]);
  });

  it('marks only active work blocks as active', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_done',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_done', name: 'run_shell_command', status: 'success' }],
      },
      {
        id: 'assistant_running',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_running', name: 'run_shell_command', status: 'running' }],
      },
    ];

    expect(createAssistantRunTimeline(segments).filter((block) => block.type === 'work').map((block) => block.active)).toEqual([true]);
  });

  it('collapses repeated tool and thinking work into one stable top block', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_first',
        role: 'assistant',
        content: '<think>checking files',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_ls', name: 'run_shell_command', status: 'running' }],
      },
      {
        id: 'assistant_second',
        role: 'assistant',
        content: '<think>reading output',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_cat', name: 'run_shell_command', status: 'running' }],
      },
    ];
    const blocks = createAssistantRunTimeline(segments);
    const workBlocks = blocks.filter((block) => block.type === 'work');

    expect(blocks[0]?.id).toBe('assistant_first:work');
    expect(workBlocks).toHaveLength(1);
    expect(workBlocks[0]).toMatchObject({
      type: 'work',
      active: true,
      thinkingSegments: [
        { id: 'assistant_first:thinking', content: 'checking files' },
        { id: 'assistant_second:thinking', content: 'reading output' },
      ],
      toolRuns: [
        { id: 'call_ls' },
        { id: 'call_cat' },
      ],
    });
  });
});
