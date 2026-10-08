import type { RuntimeHookRun, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createAssistantRunTimeline } from '../../../../../../src/features/chat/conversation/chatAssistantTimeline.js';
import { runtimePluginUsesByTurn } from '../../../../../../src/features/chat/plugin-usage/runtimePluginUsage.js';
import { runtimeHookUsesByTurn } from '../../../../../../src/features/chat/conversation/activity/runtimeHookUsage.js';

describe('Hook activity projection', () => {
  it('retains pre-response failures and reconciles pending Hooks with their persisted owner', () => {
    const pending = hook('start', 'SessionStart', 1);
    const initial = thread([]);
    initial.pendingHookRuns = [pending];
    const uses = runtimeHookUsesByTurn(initial);
    expect(uses.get('turn')).toEqual([{ run: pending, anchor: undefined }]);

    const failed = { ...pending, status: 'failed' as const, message: 'Command failed' };
    const input = { ...message('input', 'user', 0), hookRuns: [failed] };
    const stopped = { ...initial, messages: [input] };
    const stoppedUses = runtimeHookUsesByTurn(stopped, uses);
    expect(stoppedUses.get('turn')).toEqual([{ run: failed, anchor: undefined }]);
    const response = message('response', 'assistant', 2);
    const resumed = thread([input, response]);
    const resumedUses = runtimeHookUsesByTurn(resumed, stoppedUses);
    expect(resumedUses.get('turn')).toEqual([{
      run: failed, anchor: { messageId: 'response', placement: 'before' },
    }]);
    expect(runtimeHookUsesByTurn(resumed, resumedUses).get('turn')).toBe(resumedUses.get('turn'));
    expect(input.hookRuns).toEqual([failed]);
    expect(response.hookRuns).toBeUndefined();
  });

  it('projects lifecycle and tool Hooks exactly once around their actual events and persistent results', () => {
    const input = {
      ...message('input', 'user', 0),
      hookRuns: [hook('prompt', 'UserPromptSubmit', 1), hook('stop', 'Stop', 8)],
    };
    const work = message('work', 'assistant', 2);
    work.toolRuns = [{
      id: 'tool', name: 'generate_image', status: 'success',
      hookRuns: [hook('pre', 'PreToolUse', 3), hook('post', 'PostToolUse', 4)],
    }];
    const final = { ...message('answer', 'assistant', 7), phase: 'final_answer' as const };
    const current = thread([input, work, final]);
    expect(activityOrder(current)).toEqual([
      'plugin:plugin', 'hook:prompt', 'content:work', 'hook:pre',
      'result:tool', 'hook:post', 'content:answer', 'hook:stop',
    ]);
  });

  it('keeps a steered prompt Hook at the new input boundary as the next response arrives', () => {
    const first = message('first', 'assistant', 1);
    const steer = { ...message('steer', 'user', 3), hookRuns: [hook('steer-hook', 'UserPromptSubmit', 4)] };
    const waiting = thread([first, steer]);
    expect(runtimeHookUsesByTurn(waiting).get('turn')?.[0]?.anchor).toEqual({ messageId: 'first', placement: 'after' });
    const continued = thread([first, steer, message('next', 'assistant', 5)]);
    expect(runtimeHookUsesByTurn(continued).get('turn')?.[0]?.anchor).toEqual({ messageId: 'next', placement: 'before' });
    expect(activityOrder(continued)).toEqual(['content:first', 'plugin:plugin', 'hook:steer-hook', 'content:next']);
  });

  it('does not repeat standalone compaction Hooks or carry Hooks into another turn', () => {
    const compaction: RuntimeMessage = {
      ...message('compact', 'system', 1),
      contextCompaction: {
        compactedMessageCount: 2, compactedTokens: 100, keptRecentMessageCount: 1,
        maxContextTokensK: 128, originalMessageCount: 3, originalTokens: 200,
      },
      hookRuns: [hook('compact-hook', 'PostCompact', 1)],
    };
    const oldInput = { ...message('old', 'user', 0), turnId: 'old-turn', hookRuns: [hook('old-hook', 'Stop', 1)] };
    const current = thread([oldInput, compaction, message('answer', 'assistant', 2)]);
    const uses = runtimeHookUsesByTurn(current);
    expect(uses.has('turn')).toBe(false);
    expect(uses.get('old-turn')?.map(({ run }) => run.id)).toEqual(['old-hook']);
  });
});

function activityOrder(current: RuntimeThread): string[] {
  const blocks = createAssistantRunTimeline(
    current.messages.filter((entry) => entry.role === 'assistant'),
    runtimePluginUsesByTurn(current, [], []).get('turn'),
    { hookUses: runtimeHookUsesByTurn(current).get('turn'), isTimelineToolResult: (run) => run.id === 'tool' },
  );
  return blocks.flatMap((block): string[] => {
    if (block.type === 'content') return [`content:${block.segment.id}`];
    if (block.type === 'toolResult') return [`result:${block.run.id}`];
    if (block.type !== 'work') return [];
    return block.items.flatMap((entry): string[] => {
      if (entry.type === 'hookRuns') return entry.runs.map((run) => `hook:${run.id}`);
      if (entry.type === 'pluginUses') return entry.plugins.map((plugin) => `plugin:${plugin.id}`);
      if (entry.type === 'content') return [`content:${entry.segment.segment.id}`];
      if (entry.type === 'toolRuns') return entry.toolRuns.map((run) => `tool:${run.id}`);
      return [];
    });
  });
}

function hook(id: string, eventName: RuntimeHookRun['eventName'], second: number): RuntimeHookRun {
  return { id, turnId: 'turn', eventName, handlerType: 'command', status: 'completed', startedAt: timestamp(second), pluginId: 'plugin' };
}

function message(id: string, role: RuntimeMessage['role'], second: number): RuntimeMessage {
  return { id, turnId: 'turn', role, content: id, createdAt: timestamp(second), status: 'complete', phase: 'commentary' };
}

function timestamp(second: number): string { return `2026-10-08T00:00:0${second}.000Z`; }

function thread(messages: RuntimeMessage[]): RuntimeThread {
  return { id: 'thread', title: '', createdAt: timestamp(0), updatedAt: timestamp(9), archived: false, messageCount: messages.length, lastMessagePreview: '', lastSeq: 0, messages };
}
