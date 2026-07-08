import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { createAssistantRunTimeline } from './chatAssistantTimeline.js';

describe('createAssistantRunTimeline', () => {
  it('folds pre-final text and work into one top block', () => {
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
      'assistant_final:content',
    ]);
    expect(createAssistantRunTimeline(segments)[0]).toMatchObject({
      type: 'work',
      contentSegments: [{ id: 'assistant_preamble:content', content: 'I will inspect the project first.' }],
      items: [
        { type: 'content', segment: { id: 'assistant_preamble:content' } },
        { type: 'toolRuns', toolRuns: [{ id: 'call_shell' }] },
      ],
      toolRuns: [{ id: 'call_shell' }],
    });
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

  it('folds visible streaming pre-final content into active work', () => {
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
    ]);
    expect(createAssistantRunTimeline(segments)).toMatchObject([
      {
        type: 'work',
        contentSegments: [{ id: 'assistant_mixed:content', content: 'Visible first.' }],
        thinkingSegments: [{ id: 'assistant_mixed:thinking', content: 'still planning' }],
      },
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

  it('keeps all pre-final output in work before the final answer', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_first',
        role: 'assistant',
        content: 'I will update the file now.',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_edit',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_edit', name: 'workspace_write_file', status: 'success' }],
      },
      {
        id: 'assistant_final',
        role: 'assistant',
        content: 'The file is updated.',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(createAssistantRunTimeline(segments).map((block) => block.id)).toEqual([
      'assistant_first:work',
      'assistant_final:content',
    ]);
    expect(createAssistantRunTimeline(segments)).toMatchObject([
      {
        type: 'work',
        contentSegments: [{ id: 'assistant_first:content', content: 'I will update the file now.' }],
        items: [
          { type: 'content', segment: { id: 'assistant_first:content' } },
          { type: 'toolRuns', toolRuns: [{ id: 'call_edit' }] },
        ],
        toolRuns: [{ id: 'call_edit' }],
      },
      {
        type: 'content',
        content: 'The file is updated.',
      },
    ]);
  });

  it('keeps process text and tool rows interleaved inside the top work block', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_read',
        role: 'assistant',
        content: '先看一下 quick_sort.py 的内容。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'assistant_edit',
        role: 'assistant',
        content: '好的，参考现有风格来写归并排序。',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_edit', name: 'workspace_write_file', status: 'success' }],
      },
      {
        id: 'assistant_run',
        role: 'assistant',
        content: '文件已创建好，来跑一下验证是否正常工作。',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_run', name: 'run_shell_command', status: 'success' }],
      },
      {
        id: 'assistant_final',
        role: 'assistant',
        content: '验证通过，文件已创建。',
        createdAt: '2026-06-27T00:00:03.000Z',
        status: 'complete',
      },
    ];
    const blocks = createAssistantRunTimeline(segments);
    const work = blocks[0];

    expect(blocks.map((block) => block.id)).toEqual(['assistant_read:work', 'assistant_final:content']);
    if (work?.type !== 'work') throw new Error('expected a top work block');
    expect(work.items.map((item) => {
      if (item.type === 'toolRuns') return `tool:${item.toolRuns[0]?.id}`;
      return `${item.type}:${item.segment.id}`;
    })).toEqual([
      'content:assistant_read:content',
      'tool:call_read',
      'content:assistant_edit:content',
      'tool:call_edit',
      'content:assistant_run:content',
      'tool:call_run',
    ]);
  });

  it('merges adjacent tool and thinking work without crossing visible content', () => {
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

  it('hides active thinking items once the work block enters a file change flow', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_thinking',
        role: 'assistant',
        content: '<think>preparing the edit',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'streaming',
      },
      {
        id: 'assistant_patch',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_patch', name: 'apply_patch', status: 'running' }],
      },
    ];
    const work = createAssistantRunTimeline(segments)[0];

    if (work?.type !== 'work') throw new Error('expected a work block');
    expect(work.thinkingSegments).toMatchObject([{ content: 'preparing the edit' }]);
    expect(work.items.map((item) => item.type)).toEqual(['toolRuns']);
    expect(work.items[0]).toMatchObject({
      type: 'toolRuns',
      toolRuns: [{ id: 'call_patch' }],
    });
  });

  it('merges adjacent tool-run items across assistant segment boundaries', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_first',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'assistant_second',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_search', name: 'workspace_search_text', status: 'success' }],
      },
    ];
    const work = createAssistantRunTimeline(segments)[0];

    if (work?.type !== 'work') throw new Error('expected a work block');
    expect(work.items).toMatchObject([
      {
        type: 'toolRuns',
        toolRuns: [{ id: 'call_read' }, { id: 'call_search' }],
      },
    ]);
  });

  it('keeps final text that mentions completed tool targets', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_find',
        role: 'assistant',
        content: '找到 quick_sort.py 在当前目录。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_write',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_write',
            name: 'write_file',
            status: 'success',
            argumentsPreview: JSON.stringify({ file_path: 'selection_sort.py' }),
            resultPreview: JSON.stringify({ diff: { path: 'selection_sort.py', action: 'Created' } }),
          },
        ],
      },
      {
        id: 'assistant_run',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_run',
            name: 'run_shell_command',
            status: 'success',
            argumentsPreview: JSON.stringify({ command: 'python3 selection_sort.py' }),
            resultPreview: '$ python3 selection_sort.py\nexit: 0',
          },
        ],
      },
      {
        id: 'assistant_echo',
        role: 'assistant',
        content: '已创建 `selection_sort.py`，并运行 `python3 selection_sort.py` 验证通过。',
        createdAt: '2026-06-27T00:00:03.000Z',
        status: 'complete',
      },
    ];

    const blocks = createAssistantRunTimeline(segments);

    expect(blocks.map((block) => block.type)).toEqual(['work', 'content']);
    expect(blocks[0]).toMatchObject({
      type: 'work',
      toolRuns: [{ id: 'call_write' }, { id: 'call_run' }],
    });
    expect(blocks[1]).toMatchObject({
      type: 'content',
      content: '已创建 `selection_sort.py`，并运行 `python3 selection_sort.py` 验证通过。',
    });
  });
});
