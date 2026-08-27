import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAssistantGuidanceTimelinePlan,
} from '../../../../../src/features/chat/conversation/chatAssistantGuidanceTimeline.js';
import type { AssistantRunTimelineBlock } from '../../../../../src/features/chat/conversation/chatAssistantTimeline.js';

describe('createAssistantGuidanceTimelinePlan', () => {
  it('interleaves active guidance before the next work item in message order', () => {
    const before = assistantMessage('assistant_before', 'before');
    const after = assistantMessage('assistant_after', 'after');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      blocks: [workBlock('work_1', [before, after])],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_before', 'user_steer', 'assistant_after'],
      turnActive: true,
    });

    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({ type: 'workHistory' });
    if (plan.nodes[0]?.type !== 'workHistory') throw new Error('Expected work history plan');
    expect(plan.nodes[0].entries.map((entry) =>
      entry.type === 'guidance'
        ? entry.messages.map((message) => message.id).join(',')
        : entry.item.type === 'pluginUses'
          ? entry.item.id
          : entry.item.type === 'contextCompaction'
            ? entry.item.id
          : entry.item.segment.id,
    )).toEqual(['assistant_before:content', 'user_steer', 'assistant_after:content']);
  });

  it('preserves guidance position inside completed work history', () => {
    const before = assistantMessage('assistant_before', 'before');
    const after = assistantMessage('assistant_after', 'after');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      blocks: [workBlock('work_1', [before, after])],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_before', 'user_steer', 'assistant_after'],
      turnActive: false,
    });

    expect(plan.nodes[0]).toMatchObject({ type: 'workHistory' });
    if (plan.nodes[0]?.type !== 'workHistory') throw new Error('Expected work history plan');
    expect(plan.nodes[0].entries.map((entry) =>
      entry.type === 'guidance'
        ? entry.messages.map((message) => message.id).join(',')
        : entry.item.type === 'pluginUses'
          ? entry.item.id
          : entry.item.type === 'contextCompaction'
            ? entry.item.id
          : entry.item.segment.id,
    )).toEqual(['assistant_before:content', 'user_steer', 'assistant_after:content']);
  });

  it('keeps active guidance after non-work blocks when it follows that block', () => {
    const assistant = assistantMessage('assistant_content', 'answer');
    const guidance = userMessage('user_steer', 'extra guidance');
    const plan = createAssistantGuidanceTimelinePlan({
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer' }],
      guidanceMessages: [guidance],
      messageOrderIds: ['assistant_content', 'user_steer'],
      turnActive: false,
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
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer' }],
      guidanceMessages: [guidance],
      messageOrderIds: ['user_steer', 'assistant_content'],
      turnActive: false,
    });

    expect(plan.placeholderGuidance).toEqual([expect.objectContaining({ id: 'user_steer' })]);
  });

  it('keeps Plugin attribution as a completed body record while the turn continues', () => {
    const message = assistantMessage('assistant_plugin', 'working');
    const pluginBlock: Extract<AssistantRunTimelineBlock, { type: 'work' }> = {
      ...workBlock('work_plugin', [message]),
      active: false,
      items: [{
        type: 'pluginUses',
        id: 'assistant_plugin:plugins',
        plugins: [{ id: 'documents', installed: true, name: 'Word 文档处理' }],
      }],
    };
    const createPlan = (turnActive: boolean) => createAssistantGuidanceTimelinePlan({
      blocks: [pluginBlock],
      guidanceMessages: [],
      messageOrderIds: [message.id],
      turnActive,
    });

    expect(createPlan(true).nodes[0]).toMatchObject({
      type: 'workHistory',
      entries: [{
        type: 'workItem',
        item: { type: 'pluginUses' },
      }],
    });
    expect(createPlan(false).nodes[0]).toMatchObject({
      type: 'workHistory',
      entries: [{
        type: 'workItem',
        item: { type: 'pluginUses' },
      }],
    });
  });

  it('does not hoist later work above content that is already in the timeline', () => {
    const before = assistantMessage('assistant_before', 'before');
    const body = assistantMessage('assistant_body', '正文');
    const after = assistantMessage('assistant_after', 'after');
    const plan = createAssistantGuidanceTimelinePlan({
      blocks: [
        { ...workBlock('work_before', [before]), active: false },
        { type: 'content', id: 'assistant_body:content', segment: body, content: body.content },
        { ...workBlock('work_after', [after]), active: false },
      ],
      guidanceMessages: [],
      messageOrderIds: [before.id, body.id, after.id],
      turnActive: true,
    });

    expect(plan.nodes.map((node) => node.type)).toEqual([
      'workHistory',
      'block',
      'workHistory',
    ]);
    expect(plan.nodes[0]).toMatchObject({
      type: 'workHistory',
      blocks: [{ id: 'work_before' }],
      active: true,
      hasFollowingContent: true,
    });
    expect(plan.nodes[2]).toMatchObject({
      type: 'workHistory',
      blocks: [{ id: 'work_after' }],
      active: true,
      hasFollowingContent: false,
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
