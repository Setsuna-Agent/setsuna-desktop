import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAssistantRunTimeline,
  shouldShowAssistantTrailingLoading,
} from '../../../../../src/features/chat/conversation/chatAssistantTimeline.js';

describe('createAssistantRunTimeline', () => {
  it('places Plugin attribution in the work body before a final answer', () => {
    const segments: RuntimeMessage[] = [{
      id: 'assistant_final',
      role: 'assistant',
      content: '文档已经生成。',
      createdAt: '2026-07-17T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }];
    const timeline = createAssistantRunTimeline(segments, [
      { id: 'documents', installed: true, name: 'Word 文档处理', icon: 'documents' },
    ]);

    expect(timeline.map((block) => block.id)).toEqual([
      'assistant_final:work',
      'assistant_final:content',
    ]);
    expect(timeline[0]).toMatchObject({
      type: 'work',
      active: false,
      items: [{
        type: 'pluginUses',
        plugins: [{ id: 'documents', installed: true, name: 'Word 文档处理', icon: 'documents' }],
      }],
    });
  });

  it('folds pre-final text and work into one top block', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_preamble',
        role: 'assistant',
        content: 'I will inspect the project first.',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
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
        phase: 'final_answer',
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
        { type: 'content', segment: { content: 'I will inspect the project first.' } },
        { type: 'toolRuns', toolRuns: [{ id: 'call_shell' }] },
      ],
      toolRuns: [{ id: 'call_shell' }],
    });
  });

  it('keeps answer text visible when its only tools update Plan and Goal state', () => {
    const segments: RuntimeMessage[] = [{
      id: 'assistant_final',
      role: 'assistant',
      content: '分析已经完成，正文不应折叠。',
      createdAt: '2026-08-11T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
      toolRuns: [
        { id: 'plan_update', name: 'update_plan', status: 'success' },
        { id: 'goal_update', name: 'update_goal', status: 'success' },
      ],
    }];

    expect(createAssistantRunTimeline(segments)).toMatchObject([
      {
        type: 'content',
        content: '分析已经完成，正文不应折叠。',
      },
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
        phase: 'final_answer',
      },
    ];

    expect(createAssistantRunTimeline(segments).map((block) => block.id)).toEqual([
      'assistant_answer:content',
    ]);
  });

  it('keeps completed structured thinking in the transcript when enabled', () => {
    const segments: RuntimeMessage[] = [{
      id: 'assistant_answer',
      role: 'assistant',
      content: 'Visible answer.',
      streamParts: [
        { type: 'reasoning', content: 'Inspect the relevant chain.' },
        { type: 'content', content: 'Visible answer.' },
      ],
      createdAt: '2026-06-27T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }];

    expect(createAssistantRunTimeline(
      segments,
      [],
      { showThinkingInTranscript: true },
    )).toMatchObject([
      {
        type: 'work',
        thinkingSegments: [{
          id: 'assistant_answer:thinking',
          content: 'Inspect the relevant chain.',
          active: false,
        }],
        items: [{
          type: 'thinking',
          segment: { content: 'Inspect the relevant chain.', active: false },
        }],
      },
      {
        type: 'content',
        id: 'assistant_answer:content',
        content: 'Visible answer.',
      },
    ]);
  });

  it('keeps leading literal think tags in authoritative structured content', () => {
    const content = '<think>literal example</think> is valid answer text.';
    const segments: RuntimeMessage[] = [{
      id: 'assistant_structured_leading_example',
      role: 'assistant',
      content,
      streamParts: [{ type: 'content', content }],
      createdAt: '2026-06-27T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }];

    expect(createAssistantRunTimeline(segments)).toMatchObject([{
      type: 'content',
      content,
    }]);
  });

  it('joins completed structured content parts into one Markdown stream', () => {
    const segments: RuntimeMessage[] = [{
      id: 'assistant_split_construct',
      role: 'assistant',
      content: '**bold text**',
      streamParts: [
        { type: 'content', content: '**bold' },
        { type: 'reasoning', content: 'checking emphasis' },
        { type: 'content', content: ' text**' },
      ],
      createdAt: '2026-06-27T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }];

    expect(createAssistantRunTimeline(segments)).toMatchObject([
      { type: 'content', content: '**bold text**' },
    ]);
  });

  it('keeps mid-answer literal tags in authoritative structured content', () => {
    const content = 'Explain raw <think>example</think> text.';
    const segments: RuntimeMessage[] = [{
      id: 'assistant_structured_example',
      role: 'assistant',
      content,
      streamParts: [{ type: 'content', content }],
      createdAt: '2026-06-27T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }];

    expect(createAssistantRunTimeline(segments)).toMatchObject([{
      type: 'content',
      content,
    }]);
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

  it('does not add a trailing loader while an active tool already reports progress', () => {
    const base = {
      active: true,
      hasRenderableContent: true,
      status: 'streaming' as const,
    };

    expect(shouldShowAssistantTrailingLoading({ ...base, toolRuns: [] })).toBe(true);
    expect(shouldShowAssistantTrailingLoading({
      ...base,
      toolRuns: [{ id: 'call_running', name: 'exec_command', status: 'running' }],
    })).toBe(false);
    expect(shouldShowAssistantTrailingLoading({
      ...base,
      toolRuns: [{
        id: 'call_pending',
        name: 'exec_command',
        status: 'pending_approval',
        approvalStatus: 'pending',
      }],
    })).toBe(false);
    expect(shouldShowAssistantTrailingLoading({
      ...base,
      toolRuns: [{
        id: 'call_approved',
        name: 'exec_command',
        status: 'pending_approval',
        approvalStatus: 'approved',
      }],
    })).toBe(true);
  });

  it('keeps all pre-final output in work before the final answer', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_first',
        role: 'assistant',
        content: 'I will update the file now.',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
      },
      {
        id: 'assistant_edit',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_edit', name: 'workspace_write_file', status: 'success' }],
      },
      {
        id: 'assistant_final',
        role: 'assistant',
        content: 'The file is updated.',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'complete',
        phase: 'final_answer',
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
          { type: 'content', segment: { content: 'I will update the file now.' } },
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

  it('preserves commentary and tool batches in source order', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_read',
        role: 'assistant',
        content: '先看一下 quick_sort.py 的内容。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_read', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'assistant_edit',
        role: 'assistant',
        content: '好的，参考现有风格来写归并排序。',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_edit', name: 'workspace_write_file', status: 'success' }],
      },
      {
        id: 'assistant_run',
        role: 'assistant',
        content: '文件已创建好，来跑一下验证是否正常工作。',
        createdAt: '2026-06-27T00:00:02.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_run', name: 'run_shell_command', status: 'success' }],
      },
      {
        id: 'assistant_final',
        role: 'assistant',
        content: '验证通过，文件已创建。',
        createdAt: '2026-06-27T00:00:03.000Z',
        status: 'complete',
        phase: 'final_answer',
      },
    ];
    const blocks = createAssistantRunTimeline(segments);
    const work = blocks[0];

    expect(blocks.map((block) => block.id)).toEqual(['assistant_read:work', 'assistant_final:content']);
    if (work?.type !== 'work') throw new Error('expected a top work block');
    expect(workItemOrder(work.items)).toEqual([
      'content:assistant_read:content',
      'tool:call_read',
      'content:assistant_edit:content',
      'tool:call_edit',
      'content:assistant_run:content',
      'tool:call_run',
    ]);
  });

  it('keeps completed and streaming commentary when their tools are visible', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_read',
        role: 'assistant',
        content: '正在读取项目结构。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_read', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'assistant_test',
        role: 'assistant',
        content: '正在运行定向测试。',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'streaming',
        phase: 'commentary',
        toolRuns: [{ id: 'call_test', name: 'run_shell_command', status: 'running' }],
      },
    ];
    const work = createAssistantRunTimeline(segments)[0];

    if (work?.type !== 'work') throw new Error('expected an active work block');
    expect(work.active).toBe(true);
    expect(workItemOrder(work.items)).toEqual([
      'content:assistant_read:content',
      'tool:call_read',
      'content:assistant_test:content',
      'tool:call_test',
    ]);
  });

  it('keeps a streaming preamble in place when its tool starts', () => {
    const statusSegment: RuntimeMessage = {
      id: 'assistant_test',
      role: 'assistant',
      content: '再看两个新增的测试文件。',
      createdAt: '2026-06-27T00:00:01.000Z',
      status: 'streaming',
    };
    const existingSegments: RuntimeMessage[] = [
      {
        id: 'assistant_read',
        role: 'assistant',
        content: '先确认当前改动。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'call_status', name: 'git_status', status: 'success' }],
      },
      statusSegment,
    ];
    const before = createAssistantRunTimeline(existingSegments)[0];
    const after = createAssistantRunTimeline([
      existingSegments[0]!,
      {
        ...statusSegment,
        phase: 'commentary',
        status: 'complete',
        toolRuns: [{ id: 'call_tests', name: 'workspace_read_file', status: 'running' }],
      },
    ])[0];

    if (before?.type !== 'work' || after?.type !== 'work') throw new Error('expected work blocks');
    expect(workItemOrder(before.items)).toEqual([
      'content:assistant_read:content',
      'tool:call_status',
      'content:assistant_test:content',
    ]);
    expect(workItemOrder(after.items)).toEqual([
      'content:assistant_read:content',
      'tool:call_status',
      'content:assistant_test:content',
      'tool:call_tests',
    ]);
  });

  it('does not promote an early Responses final hint above a later tool call', () => {
    const streaming: RuntimeMessage = {
      id: 'assistant_response',
      role: 'assistant',
      content: '先检查这两个文件。',
      createdAt: '2026-06-27T00:00:00.000Z',
      status: 'streaming',
      phase: 'final_answer',
    };
    const before = createAssistantRunTimeline([streaming])[0];
    const after = createAssistantRunTimeline([{
      ...streaming,
      status: 'complete',
      phase: 'commentary',
      toolRuns: [{ id: 'call_response', name: 'workspace_read_file', status: 'running' }],
    }])[0];

    if (before?.type !== 'work' || after?.type !== 'work') throw new Error('expected work blocks');
    expect(workItemOrder(before.items)).toEqual(['content:assistant_response:content']);
    expect(workItemOrder(after.items)).toEqual([
      'content:assistant_response:content',
      'tool:call_response',
    ]);
  });

  it('preserves completed commentary while the next update is streaming', () => {
    const work = createAssistantRunTimeline([
      {
        id: 'assistant_old_status',
        role: 'assistant',
        content: '旧状态。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
      },
      {
        id: 'assistant_current_status',
        role: 'assistant',
        content: '当前状态。',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'streaming',
        phase: 'commentary',
      },
    ])[0];

    if (work?.type !== 'work') throw new Error('expected a work block');
    expect(workItemOrder(work.items)).toEqual([
      'content:assistant_old_status:content',
      'content:assistant_current_status:content',
    ]);
  });

  it('keeps later thinking and tools below committed content', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'assistant_body',
        role: 'assistant',
        content: '已经输出的正文。',
        createdAt: '2026-06-27T00:00:00.000Z',
        status: 'complete',
        phase: 'final_answer',
      },
      {
        id: 'assistant_followup',
        role: 'assistant',
        content: '我继续核对后续状态。<think>继续检查',
        createdAt: '2026-06-27T00:00:01.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_followup', name: 'workspace_read_file', status: 'running' }],
      },
    ];

    const blocks = createAssistantRunTimeline(segments);

    expect(blocks.map((block) => block.type)).toEqual(['content', 'work']);
    expect(blocks[0]).toMatchObject({ type: 'content', content: '已经输出的正文。' });
    expect(blocks[1]).toMatchObject({
      type: 'work',
      items: [
        { type: 'content', segment: { content: '我继续核对后续状态。' } },
        { type: 'thinking', segment: { content: '继续检查' } },
        { type: 'toolRuns', toolRuns: [{ id: 'call_followup' }] },
      ],
    });
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

  it('keeps earlier thinking visible when a later file change starts', () => {
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
    expect(work.items.map((item) => item.type)).toEqual(['thinking', 'toolRuns']);
    expect(work.items[1]).toMatchObject({
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
        phase: 'final_answer',
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

function workItemOrder(items: Extract<ReturnType<typeof createAssistantRunTimeline>[number], { type: 'work' }>['items']): string[] {
  return items.flatMap((item) => {
    if (item.type === 'content') return [`content:${item.segment.id}`];
    if (item.type === 'thinking') return [`thinking:${item.segment.id}`];
    if (item.type === 'pluginUses') return [`plugins:${item.id}`];
    return item.toolRuns.map((run) => `tool:${run.id}`);
  });
}
