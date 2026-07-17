import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { AssistantRunTimelineBlock } from './chatAssistantTimeline.js';
import { createAssistantGuidanceTimelinePlan } from './chatAssistantGuidanceTimeline.js';

describe('createAssistantGuidanceTimelinePlan', () => {
  it('interleaves active guidance before the next work item in message order', () => {
    const before = assistantMessage('assistant_before', 'before');
    const after = assistantMessage('assistant_after', 'after');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      active: true,
      blocks: [workBlock('work_1', [before, after])],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_before', 'user_steer', 'assistant_after'],
      workHistoryActive: true,
    });

    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({ type: 'workHistory' });
    if (plan.nodes[0]?.type !== 'workHistory') throw new Error('Expected work history plan');
    expect(plan.nodes[0].entries.map((entry) =>
      entry.type === 'guidance'
        ? entry.messages.map((message) => message.id).join(',')
        : entry.item.type === 'pluginUses'
          ? entry.item.id
          : entry.item.segment.id,
    )).toEqual(['assistant_before:content', 'user_steer', 'assistant_after:content']);
  });

  it('collapses completed guidance into the completed work history plan', () => {
    const before = assistantMessage('assistant_before', 'before');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      active: false,
      blocks: [workBlock('work_1', [before])],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_before', 'user_steer'],
      workHistoryActive: false,
    });

    expect(plan.nodes[0]).toMatchObject({ type: 'workHistory' });
    if (plan.nodes[0]?.type !== 'workHistory') throw new Error('Expected work history plan');
    expect(plan.nodes[0].entries.at(-1)).toMatchObject({
      type: 'guidance',
      id: 'completed-guidance-inline',
      messages: [expect.objectContaining({ id: 'user_steer' })],
    });
  });

  it('keeps active guidance after non-work blocks when it follows that block', () => {
    const assistant = assistantMessage('assistant_content', 'answer');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      active: true,
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer' }],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_content', 'user_steer'],
      workHistoryActive: false,
    });

    expect(plan.placeholderGuidance).toEqual([]);
    expect(plan.nodes).toMatchObject([
      {
        type: 'block',
        guidanceAfter: [expect.objectContaining({ id: 'user_steer' })],
      },
    ]);
  });

  it('keeps active guidance in the placeholder when it arrives before the first non-work block', () => {
    const assistant = assistantMessage('assistant_content', 'answer');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      active: true,
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer' }],
      guidanceMessages: [guidance],
      messageOrderIds: ['user_steer', 'assistant_content'],
      workHistoryActive: false,
    });

    expect(plan.placeholderGuidance).toEqual([expect.objectContaining({ id: 'user_steer' })]);
  });

  it('keeps Plugin attribution active until the full turn completes', () => {
    const message = assistantMessage('assistant_plugin', 'working');
    const pluginBlock: Extract<AssistantRunTimelineBlock, { type: 'work' }> = {
      ...workBlock('work_plugin', [message]),
      active: false,
      items: [{
        type: 'pluginUses',
        id: 'assistant_plugin:plugins',
        plugins: [{ id: 'documents', name: 'Word 文档处理' }],
      }],
    };
    const createPlan = (active: boolean) => createAssistantGuidanceTimelinePlan({
      active,
      blocks: [pluginBlock],
      guidanceMessages: [],
      messageOrderIds: [message.id],
      workHistoryActive: active,
    });

    expect(createPlan(true).nodes[0]).toMatchObject({
      type: 'workHistory',
      entries: [{
        type: 'workItem',
        active: true,
        item: { type: 'pluginUses' },
      }],
    });
    expect(createPlan(false).nodes[0]).toMatchObject({
      type: 'workHistory',
      entries: [{
        type: 'workItem',
        active: false,
        item: { type: 'pluginUses' },
      }],
    });
  });
});

function workBlock(id: string, messages: RuntimeMessage[]): Extract<AssistantRunTimelineBlock, { type: 'work' }> {
  return {
    type: 'work',
    id,
    active: true,
    segments: messages,
    toolRuns: [],
    contentSegments: messages.map((message) => ({
      id: `${message.id}:content`,
      segment: message,
      content: message.content,
    })),
    thinkingSegments: [],
    items: messages.map((message) => ({
      type: 'content',
      segment: {
        id: `${message.id}:content`,
        segment: message,
        content: message.content,
      },
    })),
  };
}

function assistantMessage(id: string, content: string): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
    status: 'complete',
  };
}

function userMessage(id: string, content: string): RuntimeMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
    status: 'complete',
  };
}
