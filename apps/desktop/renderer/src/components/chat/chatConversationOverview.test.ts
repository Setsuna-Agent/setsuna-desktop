import { describe, expect, it } from 'vitest';
import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { conversationOverviewFromMessages, latestPlanItemsFromMessages } from './chatConversationOverview.js';

describe('chatConversationOverview', () => {
  it('summarizes the latest file changes before rendering the overview', () => {
    const messages: RuntimeMessage[] = [
      assistantMessage('assistant_1', [
        toolRun('write_1', 'write_file', {
          resultPreview: JSON.stringify({
            diff: {
              path: 'src/a.ts',
              additions: 3,
              deletions: 1,
              lines: [],
            },
          }),
        }),
      ]),
    ];

    expect(conversationOverviewFromMessages(messages)?.fileChangeSummary).toMatchObject({
      additions: 3,
      deletions: 1,
      files: [{ path: 'src/a.ts' }],
    });
  });

  it('keeps the overview available when the thread has no file changes', () => {
    expect(conversationOverviewFromMessages([assistantMessage('assistant_1', [toolRun('read_1', 'read_file')])])).toEqual({
      fileChangeSummary: null,
      planItems: [],
    });
  });

  it('reads the latest plan from structured update_plan data', () => {
    const messages: RuntimeMessage[] = [
      assistantMessage('assistant_1', [
        toolRun('plan_1', 'update_plan', {
          data: {
            plan: [
              { step: '旧步骤', status: 'completed' },
            ],
          },
        }),
      ]),
      assistantMessage('assistant_2', [
        toolRun('plan_2', 'update_plan', {
          data: {
            plan: [
              { step: '梳理需求边界', status: 'completed' },
              { step: '落地实现方案', status: 'in_progress' },
              { step: '补测试与验证', status: 'pending' },
            ],
          },
        }),
      ]),
    ];

    expect(latestPlanItemsFromMessages(messages)).toEqual([
      { step: '梳理需求边界', status: 'completed' },
      { step: '落地实现方案', status: 'in_progress' },
      { step: '补测试与验证', status: 'pending' },
    ]);
  });

  it('falls back to update_plan arguments while the tool is still running', () => {
    const messages: RuntimeMessage[] = [
      assistantMessage('assistant_1', [
        toolRun('plan_1', 'update_plan', {
          argumentsPreview: JSON.stringify({
            plan: [
              { step: '读取现有实现', status: 'in_progress' },
              { step: '编写组件', status: 'pending' },
            ],
          }),
          status: 'running',
        }),
      ]),
    ];

    expect(latestPlanItemsFromMessages(messages)).toEqual([
      { step: '读取现有实现', status: 'in_progress' },
      { step: '编写组件', status: 'pending' },
    ]);
  });
});

function assistantMessage(id: string, toolRuns: RuntimeToolRun[]): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: '2026-06-29T00:00:00.000Z',
    status: 'complete',
    toolRuns,
  };
}

function toolRun(
  id: string,
  name: string,
  overrides: Partial<RuntimeToolRun> = {},
): RuntimeToolRun {
  return {
    id,
    name,
    status: overrides.status ?? 'success',
    ...overrides,
  };
}
