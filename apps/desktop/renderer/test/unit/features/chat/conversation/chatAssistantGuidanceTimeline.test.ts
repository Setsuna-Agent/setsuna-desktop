import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAssistantGuidanceTimelinePlan,
} from '../../../../../src/features/chat/conversation/chatAssistantGuidanceTimeline.js';
import { createAssistantRunTimeline, type AssistantRunTimelineBlock } from '../../../../../src/features/chat/conversation/chatAssistantTimeline.js';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('createAssistantGuidanceTimelinePlan', () => {
  it('preserves guidance order as tool-only followups arrive and the turn completes', () => {
    const before = [
      userMessage('user_initial', 'initial prompt'),
      assistantMessage('assistant_commentary', 'Inspecting the issue.'),
      toolMessage('assistant_read', 'call_read'),
      toolMessage('assistant_search', 'call_search'),
      userMessage('user_steer', 'extra guidance'),
    ];
    const after = [
      toolMessage('assistant_followup_read', 'call_followup_read'),
      toolMessage('assistant_followup_edit', 'call_followup_edit'),
    ];
    const final: RuntimeMessage = { ...assistantMessage('assistant_final', 'Done.'), phase: 'final_answer' };
    const snapshots: Array<{ followups: RuntimeMessage[]; turnActive: boolean; expectedTail: string[] }> = [
      { followups: [], turnActive: true, expectedTail: [] },
      {
        followups: [{
          ...after[0]!,
          status: 'streaming',
          toolRuns: [{ ...after[0]!.toolRuns![0]!, status: 'running' }],
        }],
        turnActive: true,
        expectedTail: ['assistant_followup_read:tools:call_followup_read'],
      },
      {
        followups: after,
        turnActive: true,
        expectedTail: ['assistant_followup_read:tools:call_followup_read,call_followup_edit'],
      },
      {
        followups: [...after, final],
        turnActive: false,
        expectedTail: ['assistant_followup_read:tools:call_followup_read,call_followup_edit', 'assistant_final:content'],
      },
    ];

    for (const snapshot of snapshots) {
      const messages = [...before, ...snapshot.followups].map((message) => ({ ...message, turnId: 'turn_1' }));
      const assistant = createChatDisplayItems(messages).find((item) => item.type === 'assistant');
      if (assistant?.type !== 'assistant') throw new Error('Expected assistant run');
      const plan = createAssistantGuidanceTimelinePlan({
        blocks: createAssistantRunTimeline(assistant.segments, [], { messageOrderIds: assistant.messageIds }),
        guidanceMessages: assistant.steerMessages,
        messageOrderIds: assistant.messageIds,
        turnActive: snapshot.turnActive,
      });
      const order = plan.nodes.flatMap((node) => {
        if (node.type === 'block') return [node.block.id];
        return node.entries.map((entry) => {
          if (entry.type === 'guidance') return entry.messages.map((message) => message.id).join(',');
          if (entry.item.type === 'toolRuns') return `${entry.item.id}:${entry.item.toolRuns.map((run) => run.id).join(',')}`;
          if (entry.item.type === 'content') return entry.item.segment.id;
          throw new Error(`Unexpected work item: ${entry.item.type}`);
        });
      });

      expect(plan.placeholderGuidance).toEqual([]);
      expect(order).toEqual([
        'assistant_commentary:content',
        'assistant_read:tools:call_read,call_search',
        'user_steer',
        ...snapshot.expectedTail,
      ]);
    }
  });

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
        : entry.item.type === 'pluginUses' || entry.item.type === 'hookRuns'
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
        : entry.item.type === 'pluginUses' || entry.item.type === 'hookRuns'
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
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer', finalAnswer: true }],
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
      blocks: [{ type: 'content', id: 'assistant_content:content', segment: assistant, content: 'answer', finalAnswer: true }],
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
        messageId: message.id,
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
        { type: 'content', id: 'assistant_body:content', segment: body, content: body.content, finalAnswer: true },
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

function toolMessage(id: string, toolCallId: string): RuntimeMessage {
  return {
    ...assistantMessage(id, ''),
    toolRuns: [{ id: toolCallId, name: 'run_shell_command', status: 'success' }],
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
